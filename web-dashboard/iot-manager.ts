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

export class IoTManager extends EventEmitter {
    private devices: Map<string, ChildProcess> = new Map();
    private pythonScriptPath: string;
    private interface: string;
    private statsCache: Map<string, any> = new Map();
    private logsCache: Map<string, any[]> = new Map();

    constructor(networkInterface: string = 'eth0') {
        super();
        this.interface = networkInterface;
        // The script is in ../iot/iot_emulator.py (dev) or ./iot/iot_emulator.py (docker)
        let scriptPath = path.resolve(path.join(__dirname, '../iot/iot_emulator.py'));
        if (!fs.existsSync(scriptPath)) {
            scriptPath = path.resolve(path.join(__dirname, './iot/iot_emulator.py'));
        }
        this.pythonScriptPath = scriptPath;
        log('IOT', `Manager initialized on interface: ${this.interface}`);
        log('IOT', `Python script path: ${this.pythonScriptPath}`, 'debug');
    }

    async startDevice(deviceConfig: IoTDeviceConfig): Promise<void> {
        if (this.devices.has(deviceConfig.id)) {
            log('IOT', `Device ${deviceConfig.id} already running, skipping start`, 'debug');
            return;
        }

        log('IOT', `Starting device: ${deviceConfig.id} (${deviceConfig.name})`);

        const args = [
            '--device-id', deviceConfig.id,
            '--device-name', deviceConfig.name,
            '--vendor', deviceConfig.vendor,
            '--device-type', deviceConfig.type,
            '--mac', deviceConfig.mac,
            '--interface', this.interface,
            '--protocols', deviceConfig.protocols.join(','),
            '--traffic-interval', String(deviceConfig.traffic_interval || 60),
            '--json-output'
        ];

        log('IOT', `Spawning process: python3 ${this.pythonScriptPath} ${args.join(' ')}`, 'debug');

        if (deviceConfig.ip_start) {
            args.push('--ip-static', deviceConfig.ip_start);
        }

        if (deviceConfig.gateway) {
            args.push('--gateway', deviceConfig.gateway);
        }

        // Pass DHCP fingerprint to Python script if present
        if (deviceConfig.fingerprint) {
            args.push('--fingerprint', JSON.stringify(deviceConfig.fingerprint));
        }

        // Pass Security configuration to Python script if present and bad behavior is enabled
        if (deviceConfig.security?.bad_behavior) {
            args.push('--enable-bad-behavior');
            args.push('--security', JSON.stringify({
                bad_behavior: true,
                behavior_type: deviceConfig.security.behavior_type || ['random']
            }));
        }

        try {
            const pythonProcess = spawn('python3', [this.pythonScriptPath, ...args], {
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: false
            });

            pythonProcess.stdout?.on('data', (data: Buffer) => {
                const lines = data.toString().split('\n').filter(l => l.trim());
                lines.forEach(line => {
                    try {
                        const msg = JSON.parse(line);
                        this.handlePythonMessage(msg);
                    } catch (e) {
                        // Not JSON, might be raw output or partial line
                        if (line.includes('Permission denied')) {
                            this.emit('device:error', {
                                device_id: deviceConfig.id,
                                error: 'Permission denied: Scapy requires root/sudo',
                                severity: 'error'
                            });
                        }
                    }
                });
            });

            pythonProcess.stderr?.on('data', (data: Buffer) => {
                const errorOutput = data.toString();

                // Filter out "Unknown protocol" warnings (expected behavior)
                if (errorOutput.includes('WARNING - Unknown protocol')) {
                    return; // Silently ignore
                }

                log('IOT-PY-ERR', `[${deviceConfig.id}]: ${errorOutput}`, 'error');
                this.emit('device:error', {
                    device_id: deviceConfig.id,
                    error: errorOutput,
                    severity: 'error'
                });
            });

            pythonProcess.on('exit', (code) => {
                log('IOT', `Device ${deviceConfig.id} exited with code ${code}`);
                this.devices.delete(deviceConfig.id);
                this.emit('device:stopped', { device_id: deviceConfig.id, code });
            });

            pythonProcess.on('error', (err) => {
                log('IOT', `Failed to start Python process for ${deviceConfig.id}: ${err.message}`, 'error');
                this.emit('device:error', {
                    device_id: deviceConfig.id,
                    error: err.message,
                    severity: 'error'
                });
            });

            this.devices.set(deviceConfig.id, pythonProcess);
        } catch (err: any) {
            log('IOT', `Error spawning process for ${deviceConfig.id}: ${err.message}`, 'error');
            throw err;
        }
    }

    async stopDevice(deviceId: string): Promise<void> {
        const process = this.devices.get(deviceId);
        if (!process) return;

        log('IOT', `Stopping device: ${deviceId}`);
        process.kill('SIGTERM');

            if (this.devices.has(deviceId)) {
                log('IOT', `Device ${deviceId} still alive after SIGTERM, sending SIGKILL`, 'warn');
                process.kill('SIGKILL');
            }
    }

    async stopAll(): Promise<void> {
        log('IOT', `Stopping all ${this.devices.size} devices...`);
        const deviceIds = Array.from(this.devices.keys());
        for (const id of deviceIds) {
            await this.stopDevice(id);
        }
    }

    private handlePythonMessage(msg: any): void {
        const { type, device_id } = msg;
        if (!device_id) return;

        switch (type) {
            case 'started':
                this.emit('device:started', msg);
                break;
            case 'stopped':
                this.emit('device:stopped', msg);
                break;
            case 'stats':
                this.statsCache.set(device_id, msg.stats);
                this.emit('device:stats', msg);
                break;
            case 'log':
                // Store recent logs
                const logs = this.logsCache.get(device_id) || [];
                logs.push(msg);
                if (logs.length > 100) logs.shift();
                this.logsCache.set(device_id, logs);
                this.emit('device:log', msg);
                break;
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

    getAllStats(): any {
        const result: any = {};
        this.statsCache.forEach((stats, id) => {
            result[id] = {
                running: this.devices.has(id),
                ...stats
            };
        });
        return result;
    }

    getDeviceStatus(id: string): any {
        return {
            running: this.devices.has(id),
            stats: this.statsCache.get(id) || null,
            logs: this.logsCache.get(id) || []
        };
    }

    getRunningDevices(): string[] {
        return Array.from(this.devices.keys());
    }

    setInterface(newInterface: string): void {
        if (this.interface !== newInterface) {
            log('IOT', `Updating interface from ${this.interface} to ${newInterface}`);
            this.interface = newInterface;
        }
    }
}
