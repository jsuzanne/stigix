import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { log } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface IoTDeviceConfig {
    id: string;
    name: string;
    vendor: string;
    type: string;
    mac: string;
    ip_start?: string;
    protocols: string[];
    enabled: boolean;
    traffic_interval: number;
    description?: string;
    gateway?: string;
    fingerprint?: {
        dhcp?: {
            hostname?: string;
            vendor_class_id?: string;
            client_id_type?: number;
            param_req_list?: number[];
        };
    };
    security?: {
        bad_behavior: boolean;
        behavior_type: string[];
    };
}

// ─── Daemon restart constants ────────────────────────────────────────────────
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_BASE_DELAY_MS = 2000;
const RESTART_MAX_DELAY_MS = 30000;

export class IoTManager extends EventEmitter {
    // ── Daemon process (1 shared for all devices) ───────────────────────────
    private daemonProcess: ChildProcess | null = null;
    private daemonReady: boolean = false;
    private daemonInterface: string;

    // ── Per-device state (for restart recovery + status tracking) ───────────
    private runningDevices: Map<string, IoTDeviceConfig> = new Map();
    private statsCache: Map<string, any> = new Map();
    private logsCache: Map<string, any[]> = new Map();

    // ── Restart state ────────────────────────────────────────────────────────
    private restartAttempts: number = 0;
    private restartTimer: ReturnType<typeof setTimeout> | null = null;
    private gaveUp: boolean = false;

    private pythonScriptPath: string;

    constructor(networkInterface: string = 'eth0') {
        super();
        this.daemonInterface = networkInterface;

        let scriptPath = path.resolve(path.join(__dirname, '../iot/iot_emulator.py'));
        if (!fs.existsSync(scriptPath)) {
            scriptPath = path.resolve(path.join(__dirname, './iot/iot_emulator.py'));
        }
        this.pythonScriptPath = scriptPath;
        log('IOT', `Manager initialized on interface: ${this.daemonInterface}`);
        log('IOT', `Python script: ${this.pythonScriptPath}`, 'debug');
    }

    // ── Daemon lifecycle ─────────────────────────────────────────────────────

    private spawnDaemon(): void {
        if (this.daemonProcess) return;

        const args = [
            this.pythonScriptPath,
            '--daemon',
            '--interface', this.daemonInterface,
            '--dhcp-mode', 'auto',
            '--json-output',
            '--enable-bad-behavior',
        ];

        log('IOT', `Spawning daemon: python3 ${args.join(' ')}`, 'debug');

        this.daemonProcess = spawn('python3', args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: false,
        });

        this.daemonProcess.stdout?.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n').filter(l => l.trim());
            for (const line of lines) {
                try {
                    const msg = JSON.parse(line);
                    this.handlePythonMessage(msg);
                } catch {
                    if (line.includes('Permission denied')) {
                        this.emit('daemon:error', { error: 'Permission denied: Scapy requires root/sudo' });
                    }
                }
            }
        });

        this.daemonProcess.stderr?.on('data', (data: Buffer) => {
            const txt = data.toString();
            if (txt.includes('WARNING - Unknown protocol')) return;
            log('IOT-PY-ERR', txt, 'error');
        });

        this.daemonProcess.on('exit', (code, signal) => {
            log('IOT', `Daemon exited (code=${code}, signal=${signal})`, 'warn');
            this.daemonProcess = null;
            this.daemonReady = false;

            // Emit stopped for all running devices
            for (const id of this.runningDevices.keys()) {
                this.emit('device:stopped', { device_id: id, code });
            }

            if (!this.gaveUp) {
                this.scheduleRestart();
            }
        });

        this.daemonProcess.on('error', (err) => {
            log('IOT', `Daemon process error: ${err.message}`, 'error');
            this.emit('daemon:error', { error: err.message });
        });
    }

    private scheduleRestart(): void {
        this.restartAttempts++;

        if (this.restartAttempts > MAX_RESTART_ATTEMPTS) {
            log('IOT', `Daemon failed ${MAX_RESTART_ATTEMPTS} times — giving up`, 'error');
            this.gaveUp = true;
            this.emit('daemon:failed', {
                message: 'IoT daemon crashed repeatedly — manual restart required',
                attempts: this.restartAttempts - 1,
            });
            return;
        }

        const delay = Math.min(
            RESTART_BASE_DELAY_MS * Math.pow(2, this.restartAttempts - 1),
            RESTART_MAX_DELAY_MS
        );

        log('IOT', `Daemon restart attempt ${this.restartAttempts}/${MAX_RESTART_ATTEMPTS} in ${delay}ms`, 'warn');

        this.restartTimer = setTimeout(async () => {
            this.spawnDaemon();
            // Wait for daemon_ready before re-sending device configs
            const recovered = new Map(this.runningDevices);
            await this.waitForDaemonReady(5000);
            if (this.daemonReady) {
                log('IOT', `Daemon recovered — re-sending ${recovered.size} device start commands`);
                this.restartAttempts = 0; // Reset on successful recovery
                for (const cfg of recovered.values()) {
                    this.sendCommand({ cmd: 'start', device: cfg });
                }
            }
        }, delay);
    }

    private waitForDaemonReady(timeoutMs: number): Promise<void> {
        return new Promise(resolve => {
            if (this.daemonReady) { resolve(); return; }
            const timer = setTimeout(resolve, timeoutMs);
            const onReady = () => { clearTimeout(timer); resolve(); };
            this.once('_daemon_ready', onReady);
        });
    }

    private sendCommand(cmd: object): void {
        if (!this.daemonProcess || !this.daemonProcess.stdin) {
            log('IOT', 'Cannot send command — daemon not running', 'warn');
            return;
        }
        try {
            this.daemonProcess.stdin.write(JSON.stringify(cmd) + '\n');
        } catch (e: any) {
            log('IOT', `Failed to write to daemon stdin: ${e.message}`, 'error');
        }
    }

    private ensureDaemon(): void {
        if (this.gaveUp) {
            throw new Error('IoT daemon is in failed state — manual restart required');
        }
        if (!this.daemonProcess) {
            this.restartAttempts = 0; // fresh start
            this.gaveUp = false;
            this.spawnDaemon();
        }
    }

    // ── Public API (unchanged interface for server.ts) ───────────────────────

    async startDevice(deviceConfig: IoTDeviceConfig): Promise<void> {
        if (this.runningDevices.has(deviceConfig.id)) {
            log('IOT', `Device ${deviceConfig.id} already tracked`, 'debug');
            return;
        }

        this.ensureDaemon();
        await this.waitForDaemonReady(8000);

        log('IOT', `Starting device: ${deviceConfig.id} (${deviceConfig.name})`);
        this.runningDevices.set(deviceConfig.id, deviceConfig);
        this.sendCommand({ cmd: 'start', device: deviceConfig });
    }

    async stopDevice(deviceId: string): Promise<void> {
        if (!this.runningDevices.has(deviceId)) return;
        log('IOT', `Stopping device: ${deviceId}`);
        this.runningDevices.delete(deviceId);
        this.sendCommand({ cmd: 'stop', device_id: deviceId });
    }

    async stopAll(): Promise<void> {
        log('IOT', `Stopping all ${this.runningDevices.size} devices...`);
        this.runningDevices.clear();
        this.sendCommand({ cmd: 'stop_all' });
    }

    // ── Message handler (unchanged event names) ───────────────────────────────

    private handlePythonMessage(msg: any): void {
        const { type, device_id } = msg;

        // Daemon lifecycle events
        if (type === 'daemon_ready') {
            log('IOT', `Daemon ready (interface=${msg.interface})`);
            this.daemonReady = true;
            this.emit('_daemon_ready');
            return;
        }
        if (type === 'daemon_error') {
            log('IOT', `Daemon error: ${msg.error}`, 'error');
            return;
        }
        if (type === 'daemon_status') {
            this.emit('daemon:status', msg);
            return;
        }

        if (!device_id) return;

        switch (type) {
            case 'started':
                this.emit('device:started', msg);
                break;
            case 'stopped':
                this.runningDevices.delete(device_id);
                this.emit('device:stopped', msg);
                break;
            case 'stats':
                this.statsCache.set(device_id, msg.stats);
                this.emit('device:stats', msg);
                break;
            case 'log': {
                const logs = this.logsCache.get(device_id) || [];
                logs.push(msg);
                if (logs.length > 100) logs.shift();
                this.logsCache.set(device_id, logs);
                this.emit('device:log', msg);
                break;
            }
            case 'dhcp_offer':
            case 'dhcp_ack':
            case 'dhcp_discover':
                this.emit(`device:${type}`, msg);
                break;
            case 'error':
                this.emit('device:error', msg);
                break;
        }
    }

    // ── Status helpers ────────────────────────────────────────────────────────

    getAllStats(): any {
        const result: any = {};
        this.statsCache.forEach((stats, id) => {
            result[id] = {
                running: this.runningDevices.has(id),
                ...stats,
            };
        });
        return result;
    }

    getDeviceStatus(id: string): any {
        return {
            running: this.runningDevices.has(id),
            stats: this.statsCache.get(id) || null,
            logs: this.logsCache.get(id) || [],
        };
    }

    getRunningDevices(): string[] {
        return Array.from(this.runningDevices.keys());
    }

    isDaemonHealthy(): boolean {
        return this.daemonProcess !== null && this.daemonReady && !this.gaveUp;
    }

    setInterface(newInterface: string): void {
        // Interface is auto-detected and fixed at startup — log only
        if (this.daemonInterface !== newInterface) {
            log('IOT', `Interface change requested (${this.daemonInterface} → ${newInterface}) — ignored, restart Stigix to change interface`);
        }
    }
}
