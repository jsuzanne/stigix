import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { log } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type DeviceState = 'ACTIVE' | 'QUEUED' | 'IDLE' | 'STOPPED';

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

const MAX_RESTART_ATTEMPTS = 5;
const RESTART_BASE_DELAY_MS = 2000;
const RESTART_MAX_DELAY_MS = 30000;
const DEFAULT_MAX_CONCURRENT = 30;

export class IoTManager extends EventEmitter {
    // ── Daemon ───────────────────────────────────────────────────────────────
    private daemonProcess: ChildProcess | null = null;
    private daemonReady: boolean = false;
    private daemonInterface: string;
    private restartAttempts: number = 0;
    private restartTimer: ReturnType<typeof setTimeout> | null = null;
    private gaveUp: boolean = false;
    private pythonScriptPath: string;

    // ── Per-device state ─────────────────────────────────────────────────────
    private runningDevices: Map<string, IoTDeviceConfig> = new Map();  // in daemon
    private statsCache: Map<string, any> = new Map();
    private logsCache: Map<string, any[]> = new Map();
    // Traffic rate tracking — snapshot of last received stats per device
    private lastStatsSnapshot: Map<string, { packets: number; bytes: number; ts: number }> = new Map();
    // Per-device pps/bps (refreshed on each stats message, ~every 5s)
    private deviceRates: Map<string, { pps: number; bps: number }> = new Map();
    private cumulativeStats: Map<string, any> = new Map();
    private cumulativeTime: Map<string, { active: number; idle: number; queued: number }> = new Map();
    private stateEnteredAt: Map<string, number> = new Map();
    private deviceQueue: string[] = [];

    // ── Concurrency throttle ─────────────────────────────────────────────────
    private maxConcurrentDevices: number = DEFAULT_MAX_CONCURRENT;
    private managedDevices: Map<string, IoTDeviceConfig> = new Map();  // all user-requested
    private deviceStates: Map<string, DeviceState> = new Map();
    private idleTimers: Map<string, NodeJS.Timeout> = new Map();   // IDLE → re-queue
    private cycleTimers: Map<string, NodeJS.Timeout> = new Map();  // ACTIVE → cycle stop
    private activatedAt: Map<string, number> = new Map();  // deviceId → ACTIVE start timestamp (ms)
    private idledAt: Map<string, number> = new Map();      // deviceId → IDLE start timestamp (ms)
    private configDir: string;

    // ── Global bad behavior state ─────────────────────────────────────────────
    // Tracks the last setBadBehavior() call so we can re-apply it after a daemon restart.
    private badBehaviorEnabled: boolean = true; // mirrors --enable-bad-behavior CLI flag
    private engineRuntime: 'legacy' | 'go' = 'legacy';
    private goBinaryPath: string | null = null;

    constructor(networkInterface: string = 'eth0', configDir?: string) {
        super();
        this.daemonInterface = networkInterface;
        this.configDir = configDir || path.join(process.cwd(), 'config');

        let scriptPath = path.resolve(path.join(__dirname, '../iot/iot_emulator.py'));
        if (!fs.existsSync(scriptPath)) {
            scriptPath = path.resolve(path.join(__dirname, './iot/iot_emulator.py'));
        }
        this.pythonScriptPath = scriptPath;
        this.loadSettings();
        log('IOT', `Manager initialized — interface: ${this.daemonInterface}, maxConcurrent: ${this.maxConcurrentDevices}`);
    }

    // ── Settings persistence ─────────────────────────────────────────────────

    private getSettingsPath(): string {
        return path.join(this.configDir, 'iot-settings.json');
    }

    private loadSettings(): void {
        try {
            const p = this.getSettingsPath();
            if (fs.existsSync(p)) {
                const data = JSON.parse(fs.readFileSync(p, 'utf8'));
                if (typeof data.maxConcurrentDevices === 'number' && data.maxConcurrentDevices > 0) {
                    this.maxConcurrentDevices = data.maxConcurrentDevices;
                }
            }
        } catch (e) { log('IOT', `Failed to load settings: ${e}`, 'warn'); }
    }

    private saveSettings(): void {
        try {
            fs.writeFileSync(this.getSettingsPath(), JSON.stringify({
                maxConcurrentDevices: this.maxConcurrentDevices
            }, null, 2));
        } catch (e) { log('IOT', `Failed to save settings: ${e}`, 'warn'); }
    }

    private changeDeviceState(id: string, newState: DeviceState | 'STOPPED'): void {
        const oldState = this.deviceStates.get(id) || 'STOPPED';
        const now = Date.now();
        const enteredAt = this.stateEnteredAt.get(id);

        if (enteredAt && oldState !== 'STOPPED') {
            const duration = Math.max(0, now - enteredAt);
            let ct = this.cumulativeTime.get(id);
            if (!ct) { ct = { active: 0, idle: 0, queued: 0 }; this.cumulativeTime.set(id, ct); }
            if (oldState === 'ACTIVE') ct.active += duration;
            else if (oldState === 'IDLE') ct.idle += duration;
            else if (oldState === 'QUEUED') ct.queued += duration;
        }

        if (newState === 'STOPPED') {
            this.deviceStates.delete(id);
            this.stateEnteredAt.delete(id);
        } else {
            this.deviceStates.set(id, newState);
            this.stateEnteredAt.set(id, now);
        }

        if (newState === 'QUEUED') {
            if (!this.deviceQueue.includes(id)) this.deviceQueue.push(id);
        } else {
            const qIdx = this.deviceQueue.indexOf(id);
            if (qIdx !== -1) this.deviceQueue.splice(qIdx, 1);
        }
    }

    // ── Throttle helpers ─────────────────────────────────────────────────────

    private getActiveCount(): number {
        let n = 0;
        for (const s of this.deviceStates.values()) if (s === 'ACTIVE') n++;
        return n;
    }

    private async activateDevice(config: IoTDeviceConfig): Promise<void> {
        this.ensureDaemon();
        await this.waitForDaemonReady(8000);
        this.runningDevices.set(config.id, config);
        const prevStats = this.cumulativeStats.get(config.id);
        const configWithStats = { ...config, enabled: true, previous_stats: prevStats || {} };
        this.sendCommand({ cmd: 'start', device: configWithStats });
        this.activatedAt.set(config.id, Date.now());
        this.idledAt.delete(config.id);
        log('IOT', `Activated: ${config.id} [${this.getActiveCount()}/${this.maxConcurrentDevices}]`);

        // Schedule automatic cycle stop so queued devices get their turn.
        const cycleMs = Math.max(30_000, (config.traffic_interval || 60) * 1000);
        const cycleTimer = setTimeout(() => this.endDeviceCycle(config.id), cycleMs);
        this.cycleTimers.set(config.id, cycleTimer);
        log('IOT', `Cycle timer set for ${config.id}: ${Math.round(cycleMs / 1000)}s`);
    }

    /** Called when a device's cycle timer expires — stops it so the next QUEUED can run. */
    private endDeviceCycle(deviceId: string): void {
        this.cycleTimers.delete(deviceId);
        if (this.deviceStates.get(deviceId) !== 'ACTIVE') return; // already stopped/dequeued
        if (!this.managedDevices.has(deviceId)) return;
        log('IOT', `Cycle complete for ${deviceId} — stopping for rotation`);
        // Remove from runningDevices now; the daemon will confirm via 'stopped' event.
        // We DON'T remove from managedDevices so the device stays in the rotation.
        this.runningDevices.delete(deviceId);
        this.sendCommand({ cmd: 'stop', device_id: deviceId });
        // The existing 'stopped' handler will: set IDLE → wait traffic_interval → re-queue
    }

    private promoteNextQueued(): void {
        while (this.deviceQueue.length > 0 && this.getActiveCount() < this.maxConcurrentDevices) {
            const id = this.deviceQueue.shift()!;
            const cfg = this.managedDevices.get(id);
            if (cfg && this.deviceStates.get(id) === 'QUEUED') {
                this.changeDeviceState(id, 'ACTIVE');
                this.activateDevice(cfg).catch(e => {
                    log('IOT', `Promote failed ${id}: ${e}`, 'error');
                    this.changeDeviceState(id, 'QUEUED'); // rollback (puts it at the end of the queue)
                });
            }
        }
    }

    private requeueDevice(deviceId: string): void {
        this.idleTimers.delete(deviceId);
        const cfg = this.managedDevices.get(deviceId);
        if (!cfg || this.deviceStates.get(deviceId) !== 'IDLE') return;

        if (this.getActiveCount() < this.maxConcurrentDevices) {
            // MUST set ACTIVE synchronously before the async call.
            // If we don't, deviceStates stays 'IDLE'; when the daemon later emits 'stopped',
            // the handler checks currentState === 'ACTIVE' → false → no idleTimer → device stuck.
            this.changeDeviceState(deviceId, 'ACTIVE');
            this.activateDevice(cfg).catch(e => {
                log('IOT', `Requeue activate failed ${deviceId}: ${e}`, 'error');
                this.changeDeviceState(deviceId, 'QUEUED'); // rollback
            });
        } else {
            this.changeDeviceState(deviceId, 'QUEUED');
            log('IOT', `Device ${deviceId} re-queued (slots full)`);
        }
    }

    // ── Public API ───────────────────────────────────────────────────────────

    async startDevice(deviceConfig: IoTDeviceConfig): Promise<void> {
        if (this.managedDevices.has(deviceConfig.id)) {
            log('IOT', `Device ${deviceConfig.id} already managed`, 'debug');
            return;
        }
        this.managedDevices.set(deviceConfig.id, deviceConfig);

        // Reserve slot SYNCHRONOUSLY before any await — prevents race condition
        // when many devices are started in parallel (e.g. auto-restart on boot).
        if (this.getActiveCount() < this.maxConcurrentDevices) {
            this.changeDeviceState(deviceConfig.id, 'ACTIVE'); // slot reserved immediately
            this.activateDevice(deviceConfig).catch(e => {
                log('IOT', `Failed to activate ${deviceConfig.id}: ${e.message}`, 'error');
                // On failure: release the slot and queue instead
                this.changeDeviceState(deviceConfig.id, 'QUEUED');
                this.runningDevices.delete(deviceConfig.id);
            });
        } else {
            this.changeDeviceState(deviceConfig.id, 'QUEUED');
            log('IOT', `Device ${deviceConfig.id} queued (${this.getActiveCount()}/${this.maxConcurrentDevices} slots used)`);
            this.emit('device:queued', { device_id: deviceConfig.id });
        }
    }

    async stopDevice(deviceId: string): Promise<void> {
        // Clear both timers unconditionally
        const idle = this.idleTimers.get(deviceId);
        if (idle) { clearTimeout(idle); this.idleTimers.delete(deviceId); }
        const cycle = this.cycleTimers.get(deviceId);
        if (cycle) { clearTimeout(cycle); this.cycleTimers.delete(deviceId); }
        this.activatedAt.delete(deviceId);
        this.idledAt.delete(deviceId);

        const state = this.deviceStates.get(deviceId);
        this.managedDevices.delete(deviceId);
        this.changeDeviceState(deviceId, 'STOPPED');

        if (state === 'ACTIVE' && this.runningDevices.has(deviceId)) {
            this.runningDevices.delete(deviceId);
            this.sendCommand({ cmd: 'stop', device_id: deviceId });
            log('IOT', `Stopping active device: ${deviceId}`);
            setTimeout(() => this.promoteNextQueued(), 500);
        } else {
            log('IOT', `Device ${deviceId} removed from queue (was ${state || 'unknown'})`);
        }

        if (this.managedDevices.size === 0 && this.daemonProcess) {
            setTimeout(() => {
                if (this.managedDevices.size === 0) this.shutdownDaemon();
            }, 500);
        }
    }

    async stopAll(): Promise<void> {
        log('IOT', `Stopping all ${this.managedDevices.size} managed devices...`);
        for (const timer of this.idleTimers.values()) clearTimeout(timer);
        for (const timer of this.cycleTimers.values()) clearTimeout(timer);
        this.idleTimers.clear();
        this.cycleTimers.clear();
        this.activatedAt.clear();
        this.idledAt.clear();
        this.managedDevices.clear();
        this.deviceStates.clear();
        this.runningDevices.clear();
        if (this.daemonProcess) {
            this.sendCommand({ cmd: 'stop_all' });
            setTimeout(() => {
                if (this.managedDevices.size === 0) this.shutdownDaemon();
            }, 300);
        }
    }

    private shutdownDaemon(): void {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        const proc = this.daemonProcess;
        if (!proc) return;
        log('IOT', 'Shutting down idle IoT daemon process...');
        this.daemonProcess = null;
        this.daemonReady = false;
        try {
            proc.kill('SIGTERM');
            setTimeout(() => {
                try {
                    if (proc.exitCode === null && !proc.killed) {
                        proc.kill('SIGKILL');
                    }
                } catch {}
            }, 2000);
        } catch {}
    }

    setMaxConcurrent(max: number): void {
        const prev = this.maxConcurrentDevices;
        this.maxConcurrentDevices = Math.max(1, max);
        this.saveSettings();

        if (max > prev) {
            const beforeActive = this.getActiveCount();
            this.promoteNextQueued();
            const promoted = this.getActiveCount() - beforeActive;
            if (promoted > 0) log('IOT', `Promoted ${promoted} queued devices (limit → ${max})`);
        } else {
            log('IOT', `Limit reduced to ${max} — active devices finish naturally (no SIGKILL)`);
        }
    }

    getMaxConcurrent(): number { return this.maxConcurrentDevices; }

    getQueueStats(): { max: number; active: number; queued: number; idle: number } {
        let active = 0, queued = 0, idle = 0;
        for (const s of this.deviceStates.values()) {
            if (s === 'ACTIVE') active++;
            else if (s === 'QUEUED') queued++;
            else if (s === 'IDLE') idle++;
        }
        return { max: this.maxConcurrentDevices, active, queued, idle };
    }

    getDeviceStates(): Record<string, DeviceState> {
        const out: Record<string, DeviceState> = {};
        for (const [id, state] of this.deviceStates.entries()) out[id] = state;
        return out;
    }

    /**
     * Returns per-device timing info for the UI:
     * - ACTIVE: activatedAt timestamp (ms) so client can compute elapsed
     * - IDLE:   idledAt timestamp (ms) + traffic_interval so client can compute remaining
     * - QUEUED: position in queue (1-based)
     */
    getTimingInfo(): Record<string, { activatedAt?: number; idledAt?: number; cycleSeconds?: number; queuePosition?: number }> {
        const out: Record<string, any> = {};
        let queuePos = 0;
        for (const [id, state] of this.deviceStates.entries()) {
            if (state === 'ACTIVE') {
                out[id] = { activatedAt: this.activatedAt.get(id) };
            } else if (state === 'IDLE') {
                const cfg = this.managedDevices.get(id);
                out[id] = {
                    idledAt: this.idledAt.get(id),
                    cycleSeconds: cfg?.traffic_interval || 60,
                };
            } else if (state === 'QUEUED') {
                queuePos++;
                out[id] = { queuePosition: queuePos };
            }

            const ct = this.cumulativeTime.get(id);
            const entered = this.stateEnteredAt.get(id);
            if (ct || entered) {
                const currentActive = state === 'ACTIVE' ? Date.now() - (entered || Date.now()) : 0;
                const currentIdle = state === 'IDLE' ? Date.now() - (entered || Date.now()) : 0;
                const currentQueued = state === 'QUEUED' ? Date.now() - (entered || Date.now()) : 0;
                out[id].cumulative = {
                    active: (ct?.active || 0) + Math.max(0, currentActive),
                    idle: (ct?.idle || 0) + Math.max(0, currentIdle),
                    queued: (ct?.queued || 0) + Math.max(0, currentQueued)
                };
            }
        }
        return out;
    }

    // ── Daemon lifecycle ─────────────────────────────────────────────────────

    getEngineRuntime(): 'legacy' | 'go' {
        return this.engineRuntime;
    }

    async setEngineRuntime(mode: 'legacy' | 'go', goBinaryPath?: string | null): Promise<void> {
        const prevMode = this.engineRuntime;
        this.engineRuntime = mode;
        if (goBinaryPath !== undefined) {
            this.goBinaryPath = goBinaryPath;
        }
        if (prevMode === mode) return;

        log('IOT', `Switching IoT Engine runtime: ${prevMode} → ${mode}`);
        if (!this.daemonProcess) return;

        const activeConfigs = Array.from(this.runningDevices.values());
        this.shutdownDaemon();
        await new Promise(r => setTimeout(r, 250));

        if (activeConfigs.length > 0) {
            this.restartAttempts = 0;
            this.gaveUp = false;
            this.spawnDaemon();
            await this.waitForDaemonReady(5000);
            if (this.daemonReady) {
                if (!this.badBehaviorEnabled) {
                    this.sendCommand({ cmd: 'disable_bad_behavior' });
                }
                for (const cfg of activeConfigs) {
                    this.runningDevices.set(cfg.id, cfg);
                    const prevStats = this.cumulativeStats.get(cfg.id);
                    const configWithStats = { ...cfg, enabled: true, previous_stats: prevStats || {} };
                    this.sendCommand({ cmd: 'start', device: configWithStats });
                }
                log('IOT', `Hot-migrated ${activeConfigs.length} active IoT device(s) to ${mode} daemon`);
            }
        }
    }

    private spawnDaemon(): void {
        if (this.daemonProcess) return;

        const useGo = this.engineRuntime === 'go' && !!this.goBinaryPath;
        const bin = useGo ? this.goBinaryPath! : 'python3';
        const args = useGo
            ? [
                'iot',
                '--daemon',
                '--interface', this.daemonInterface,
                '--dhcp-mode', 'auto',
                '--json-output',
                ...(this.badBehaviorEnabled ? ['--enable-bad-behavior'] : []),
            ]
            : [
                this.pythonScriptPath,
                '--daemon',
                '--interface', this.daemonInterface,
                '--dhcp-mode', 'auto',
                '--json-output',
                ...(this.badBehaviorEnabled ? ['--enable-bad-behavior'] : []),
            ];

        log('IOT', `Spawning daemon (${useGo ? 'go' : 'legacy'}): ${bin} ${args.join(' ')}`, 'debug');

        const proc = spawn(bin, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: false,
            env: {
                ...process.env,
                DHCP_LEASE_FILE: path.join(this.configDir, 'dhcp_leases.json'),
            },
        });
        this.daemonProcess = proc;

        proc.stdout?.on('data', (data: Buffer) => {
            if (this.daemonProcess !== proc) return;
            const lines = data.toString().split('\n').filter(l => l.trim());
            for (const line of lines) {
                try {
                    this.handlePythonMessage(JSON.parse(line));
                } catch {
                    if (line.includes('Permission denied')) {
                        this.emit('daemon:error', { error: 'Permission denied: Raw socket requires root/CAP_NET_RAW' });
                    }
                }
            }
        });

        proc.stderr?.on('data', (data: Buffer) => {
            if (this.daemonProcess !== proc) return;
            const txt = data.toString();
            if (txt.includes('WARNING - Unknown protocol')) return;
            log(useGo ? 'IOT-GO' : 'IOT-PY-ERR', txt.trim(), useGo ? 'debug' : 'error');
        });

        proc.on('exit', (code, signal) => {
            if (this.daemonProcess !== proc) {
                // Intentional shutdown or hot-switch
                return;
            }
            log('IOT', `Daemon exited (code=${code}, signal=${signal})`, 'warn');
            this.daemonProcess = null;
            this.daemonReady = false;
            for (const id of this.runningDevices.keys()) {
                this.emit('device:stopped', { device_id: id, code });
            }
            if (!this.gaveUp && this.managedDevices.size > 0) this.scheduleRestart();
        });

        proc.on('error', (err) => {
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
            if (this.managedDevices.size === 0) return;
            this.spawnDaemon();
            const recovered = new Map(this.runningDevices);
            await this.waitForDaemonReady(5000);
            if (this.daemonReady) {
                log('IOT', `Daemon recovered — re-sending ${recovered.size} device start commands`);
                this.restartAttempts = 0;
                // Re-apply bad behavior state (daemon resets to enabled on spawn)
                if (!this.badBehaviorEnabled) {
                    this.sendCommand({ cmd: 'disable_bad_behavior' });
                    log('IOT', 'Re-applied disable_bad_behavior after daemon restart');
                }
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
        if (this.gaveUp) throw new Error('IoT daemon is in failed state — manual restart required');
        if (!this.daemonProcess) {
            this.restartAttempts = 0;
            this.gaveUp = false;
            this.spawnDaemon();
        }
    }

    // ── Message handler ───────────────────────────────────────────────────────

    private handlePythonMessage(msg: any): void {
        const { type, device_id } = msg;

        if (type === 'daemon_ready') {
            log('IOT', `Daemon ready (interface=${msg.interface})`);
            this.daemonReady = true;
            this.emit('_daemon_ready');
            return;
        }
        if (type === 'daemon_error') { log('IOT', `Daemon error: ${msg.error}`, 'error'); return; }
        if (type === 'daemon_status') { this.emit('daemon:status', msg); return; }
        if (!device_id) return;

        switch (type) {
            case 'started':
                this.emit('device:started', msg);
                break;
            case 'stopped': {
                this.runningDevices.delete(device_id);
                const cfg = this.managedDevices.get(device_id);
                const currentState = this.deviceStates.get(device_id);
                if (cfg && currentState === 'ACTIVE') {
                    // Device completed its cycle → IDLE → re-queue after traffic_interval
                    this.changeDeviceState(device_id, 'IDLE');
                    this.idledAt.set(device_id, Date.now());
                    this.activatedAt.delete(device_id);
                    const delayMs = (cfg.traffic_interval || 60) * 1000;
                    const timer = setTimeout(() => this.requeueDevice(device_id), delayMs);
                    this.idleTimers.set(device_id, timer);
                    log('IOT', `Device ${device_id} idle for ${cfg.traffic_interval}s before re-queue`);
                    // Let another queued device fill the freed slot immediately
                    this.promoteNextQueued();
                }
                this.emit('device:stopped', msg);
                break;
            }
            case 'stats': {
                const incoming = msg.stats;
                this.statsCache.set(device_id, incoming);
                this.cumulativeStats.set(device_id, {
                    packets_sent: incoming.packets_sent,
                    bytes_sent: incoming.bytes_sent,
                    protocols: incoming.protocols || {},
                    uptime_seconds: incoming.uptime_seconds || 0
                });
                // ── Rate calculation ─────────────────────────────────────────
                const now_ms = Date.now();
                const prev = this.lastStatsSnapshot.get(device_id);
                if (prev) {
                    const deltaSec = (now_ms - prev.ts) / 1000;
                    if (deltaSec > 0) {
                        const deltaP = Math.max(0, (incoming.packets_sent || 0) - prev.packets);
                        const deltaB = Math.max(0, (incoming.bytes_sent   || 0) - prev.bytes);
                        this.deviceRates.set(device_id, {
                            pps: deltaP / deltaSec,
                            bps: deltaB / deltaSec,
                        });
                    }
                }
                this.lastStatsSnapshot.set(device_id, {
                    packets: incoming.packets_sent || 0,
                    bytes:   incoming.bytes_sent   || 0,
                    ts:      now_ms,
                });
                this.emit('device:stats', msg);
                break;
            }
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
            result[id] = { running: this.runningDevices.has(id), ...stats };
        });
        return result;
    }

    /** Aggregate pps/bps/ppm across all currently tracked devices. */
    getTrafficRate(): { pps: number; bps: number; ppm: number; bpm: number; activeDevices: number } {
        // Only count devices that sent a stats update in the last 30s
        const cutoff = Date.now() - 30_000;
        let totalPps = 0;
        let totalBps = 0;
        let activeDevices = 0;
        this.deviceRates.forEach((rate, id) => {
            const snap = this.lastStatsSnapshot.get(id);
            if (snap && snap.ts >= cutoff) {
                totalPps += rate.pps;
                totalBps += rate.bps;
                activeDevices++;
            }
        });
        return {
            pps:           Math.round(totalPps),
            bps:           Math.round(totalBps),
            ppm:           Math.round(totalPps * 60),
            bpm:           Math.round(totalBps * 60),
            activeDevices,
        };
    }

    getDeviceStatus(id: string, includeLogs: boolean = false): any {
        const status: any = {
            running: this.runningDevices.has(id),
            state: this.deviceStates.get(id) || 'STOPPED',
            stats: this.statsCache.get(id) || null,
        };
        if (includeLogs) {
            status.logs = this.logsCache.get(id) || [];
        }
        return status;
    }

    getRunningDevices(): string[] { return Array.from(this.runningDevices.keys()); }

    setBadBehavior(enabled: boolean): void {
        this.badBehaviorEnabled = enabled;
        if (!this.daemonProcess) {
            log('IOT', `Bad behavior ${enabled ? 'ENABLED' : 'DISABLED'} globally (saved for next daemon start)`);
            return;
        }
        this.sendCommand({ cmd: enabled ? 'enable_bad_behavior' : 'disable_bad_behavior' });
        log('IOT', `Bad behavior ${enabled ? 'ENABLED' : 'DISABLED'} globally`);
    }

    getBadBehavior(): boolean { return this.badBehaviorEnabled; }

    isDaemonHealthy(): boolean { return this.daemonProcess !== null && this.daemonReady && !this.gaveUp; }

    setInterface(newInterface: string): void {
        if (this.daemonInterface !== newInterface) {
            log('IOT', `Interface change requested (${this.daemonInterface} → ${newInterface}) — ignored, restart Stigix to change interface`);
        }
    }
}
