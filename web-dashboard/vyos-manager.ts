import { spawn, exec, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { log } from './utils/logger.js';

const execPromise = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface VyosRouterInterface {
    name: string;
    description: string | null;
    address: string[];
}

export interface VyosRouter {
    id: string;
    name: string;           // hostname from VyOS
    host: string;           // IP address
    apiKey: string;
    version: string;        // auto-detected
    location?: string;
    interfaces: VyosRouterInterface[];
    enabled: boolean;
    status: 'online' | 'offline' | 'unknown';
    lastSeen?: number;
}

export interface VyosAction {
    id: string;
    offset_minutes: number;
    router_id: string;
    command: string;
    params: any;
}

export class VyosManager extends EventEmitter {
    private pythonScriptPath: string;
    private routersFile: string;
    private routers: Map<string, VyosRouter> = new Map();

    constructor(configDir: string) {
        super();
        this.routersFile = path.join(configDir, 'vyos-config.json');

        // Target path: Option B (process.cwd()) as recommended in Plan v2
        this.pythonScriptPath = path.join(process.cwd(), 'vyos/vyos_sdwan_ctl.py');

        // Fallback for dev if not found in cwd
        if (!fs.existsSync(this.pythonScriptPath)) {
            const fallback = path.join(__dirname, '../vyos/vyos_sdwan_ctl.py');
            if (fs.existsSync(fallback)) {
                this.pythonScriptPath = fallback;
            }
        }

        this.loadRouters();
        log('VYOS', `Manager initialized. File: ${this.routersFile}`);
    }

    private loadRouters() {
        if (fs.existsSync(this.routersFile)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.routersFile, 'utf8'));
                if (data.routers && Array.isArray(data.routers)) {
                    data.routers.forEach((r: VyosRouter) => this.routers.set(r.id, r));
                }
            } catch (e: any) {
                log('VYOS', `Failed to load routers: ${e.message}`, 'error');
            }
        }
    }

    private saveRouters() {
        try {
            let data: any = { routers: [] };
            if (fs.existsSync(this.routersFile)) {
                data = JSON.parse(fs.readFileSync(this.routersFile, 'utf8'));
            }
            data.routers = Array.from(this.routers.values());
            fs.writeFileSync(this.routersFile, JSON.stringify(data, null, 2));
        } catch (e: any) {
            log('VYOS', `Failed to save routers: ${e.message}`, 'error');
        }
    }

    /**
     * Discover a router's hardware and software info.
     * Uses: python3 vyos/vyos_sdwan_ctl.py --host <host> --key <key> get-info
     */
    async discoverRouter(host: string, apiKey: string): Promise<any> {
        log('VYOS', `Discovering router at ${host}...`);

        // 1. Pre-flight Ping check
        const isUp = await this.pingHost(host);
        if (!isUp) {
            throw new Error(`Router Unreachable: No ping response from ${host}`);
        }

        // Configurable timeout (default 30s, was hardcoded 15s with wrong error message)
        const DISCOVERY_TIMEOUT_MS = parseInt(
            process.env.VYOS_DISCOVERY_TIMEOUT_MS || '30000',
            10
        );

        return new Promise((resolve, reject) => {
            // Set configurable timeout
            const timeout = setTimeout(() => {
                proc.kill();
                reject(new Error(`Discovery timeout (${DISCOVERY_TIMEOUT_MS}ms)`));
            }, DISCOVERY_TIMEOUT_MS);

            // Scrub API key for logging
            const scrubbedArgs = [this.pythonScriptPath, '--host', host, '--key', apiKey.substring(0, 4) + '***', 'get-info'];
            log('VYOS', `Discover CLI: python3 ${scrubbedArgs.join(' ')}`, 'debug');
            const proc = spawn('python3', [this.pythonScriptPath, '--host', host, '--key', apiKey, 'get-info']);

            let output = '';
            let errorMsg = '';

            proc.stdout.on('data', (data) => output += data.toString());
            proc.stderr.on('data', (data) => errorMsg += data.toString());

            proc.on('close', (code) => {
                clearTimeout(timeout);
                if (code === 0) {
                    try {
                        const jsonStart = output.indexOf('{');
                        const jsonStr = jsonStart !== -1 ? output.substring(jsonStart) : output;
                        const info = JSON.parse(jsonStr);
                        resolve({
                            hostname: info.hostname || 'unknown',
                            version: info.version || 'unknown',
                            interfaces: info.interfaces || []
                        });
                    } catch (e) {
                        reject(new Error('Invalid JSON response from controller'));
                    }
                } else {
                    reject(new Error(errorMsg.trim() || `Process exited with code ${code}`));
                }
            });
        });
    }

    getRouter(id: string): VyosRouter | undefined {
        return this.routers.get(id);
    }

    getRouters(): VyosRouter[] {
        return Array.from(this.routers.values());
    }

    saveRouter(router: VyosRouter) {
        const existing = this.routers.get(router.id);
        if (existing) {
            // Perform a shallow merge to preserve fields like 'status' or 'interfaces' 
            // if the incoming payload is partial (e.g. from the location edit modal)
            const updated = { ...existing, ...router };
            this.routers.set(router.id, updated);
            log('VYOS', `Router ${router.id} updated (Location: ${updated.location || 'none'})`);
        } else {
            this.routers.set(router.id, router);
            log('VYOS', `Router ${router.id} created`);
        }
        this.saveRouters();
        this.emit('router:updated', this.routers.get(router.id)!);
    }

    /**
     * Incrementally refresh router info (hostname, version, interfaces)
     */
    async refreshRouter(id: string): Promise<VyosRouter> {
        const router = this.routers.get(id);
        if (!router) throw new Error('Router not found');

        log('VYOS', `Refreshing router ${router.name} (${router.host})...`);
        const info = await this.discoverRouter(router.host, router.apiKey);

        router.name = info.hostname;
        router.version = info.version;
        router.interfaces = info.interfaces;
        router.status = 'online';
        router.lastSeen = Date.now();

        this.saveRouter(router);
        return router;
    }

    deleteRouter(id: string) {
        if (this.routers.delete(id)) {
            this.saveRouters();
            this.emit('router:deleted', id);
        }
    }

    /**
     * Slugify a string for router ID (e.g., "VyosBranch206" -> "vyos-branch206")
     */
    slugify(text: string): string {
        return text
            .toString()
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')     // Replace spaces with -
            .replace(/[^\w-]+/g, '')  // Remove all non-word chars
            .replace(/--+/g, '-');    // Replace multiple - with single -
    }

    /**
     * Enhanced Health Check: Detects changes in version, hostname, and interfaces.
     */
    async checkHealth() {
        log('VYOS', 'Starting background health check...', 'debug');
        for (const router of this.routers.values()) {
            if (!router.enabled) continue;

            try {
                const info = await this.discoverRouter(router.host, router.apiKey);

                let changed = false;

                // Version change detection
                if (info.version !== router.version) {
                    log('VYOS', `Router ${router.name}: Version updated ${router.version} -> ${info.version}`);
                    router.version = info.version;
                    changed = true;
                }

                // Hostname change detection
                if (info.hostname !== router.name) {
                    log('VYOS', `Router ${router.name}: Hostname changed to ${info.hostname}`, 'warn');
                    router.name = info.hostname;
                    changed = true;
                }

                // Interface changes detection (shallow comparison of count/names)
                if (JSON.stringify(info.interfaces) !== JSON.stringify(router.interfaces)) {
                    log('VYOS', `Router ${router.name}: Interface configuration changed`);
                    router.interfaces = info.interfaces;
                    changed = true;
                }

                router.status = 'online';
                router.lastSeen = Date.now();

                if (changed) {
                    this.saveRouter(router);
                }
            } catch (error: any) {
                log('VYOS', `Router ${router.name} (${router.host}) is offline: ${error.message}`, 'error');
                if (router.status !== 'offline') {
                    router.status = 'offline';
                    this.saveRouter(router);
                }
            }
        }
        this.saveRouters();
    }

    /**
     * Execute a specific action on a router
     */
    async executeAction(routerId: string, action: VyosAction): Promise<any> {
        const router = this.routers.get(routerId);
        if (!router) throw new Error('Router not found');

        // Command mapping: UI -> Python CLI
        let command = action.command;
        if (command === 'interface-down') command = 'shut';
        if (command === 'interface-up') command = 'no-shut';
        if (command === 'set-qos') command = 'set-qos';
        if (command === 'clear-qos') command = 'clear-qos';

        // NEW: Firewall commands
        if (command === 'deny-traffic') command = 'simple-block';
        if (command === 'allow-traffic') command = 'simple-unblock';
        if (command === 'show-denied') command = 'get-blocks';
        if (command === 'clear-all-blocks') command = 'clear-blocks';

        // Action syntax: vyos_sdwan_ctl.py --host ... --key ... --version ... <subcommand> [params...]
        const args = [
            this.pythonScriptPath,
            '--host', router.host,
            '--key', router.apiKey,
            '--version', router.version || '1.4',
            command
        ];

        // Map params to CLI arguments
        if (action.params) {
            Object.keys(action.params).forEach(key => {
                const val = action.params[key];
                if (val !== null && val !== undefined && val !== '') {
                    let flag = key;
                    // Alignment with Python CLI flags
                    if (key === 'latency') flag = 'ms';
                    if (key === 'loss') flag = 'loss';
                    if (key === 'corrupt') flag = 'corruption';
                    if (key === 'interface') flag = 'iface';

                    // NEW: Firewall flags
                    if (key === 'ip') flag = 'ip';
                    if (key === 'force') flag = 'force';

                    // Filter parameters based on subcommand
                    const isSetLatency = command === 'set-latency' && flag === 'ms';
                    const isSetLoss = command === 'set-loss' && flag === 'percent';
                    const isSetCorruption = command === 'set-corruption' && flag === 'corruption';
                    const isSetRate = command === 'set-rate' && flag === 'rate';

                    // Interface is needed for most commands EXCEPT block/unblock/clear/get-blocks
                    const isIface = flag === 'iface' && !['simple-block', 'simple-unblock', 'clear-blocks', 'get-blocks'].includes(command);
                    const isQoS = command === 'set-qos';

                    // Firewall filters: block/unblock need --ip, clear-blocks and get-blocks need NOTHING
                    const isDenyTraffic = command === 'simple-block' && flag === 'ip';
                    const isAllowTraffic = command === 'simple-unblock' && flag === 'ip';
                    // clear-blocks and get-blocks should NOT accept ANY parameters
                    const skipParameter = ['clear-blocks', 'get-blocks'].includes(command);

                    if (skipParameter) {
                        // Skip all parameters for clear-blocks and get-blocks
                        return;
                    }

                    if (isQoS || isIface || isSetLatency || isSetLoss || isSetCorruption || isSetRate ||
                        isDenyTraffic || isAllowTraffic) {

                        // Handle boolean flags (e.g., --force)
                        if (typeof val === 'boolean') {
                            if (val === true) {
                                args.push(`--${flag}`);  // Only add flag if true
                            }
                        } else {
                            args.push(`--${flag}`, val.toString());
                        }
                    }
                }
            });
        }

        // Scrub secrets for logging
        const scrubbedArgs = args.map(arg => (arg === router.apiKey ? '***' : arg));
        log('VYOS', `Executing CLI: python3 ${scrubbedArgs.join(' ')}`, 'debug');

        // NEW: Log full command for debugging (with real values for troubleshooting)
        const fullCommand = `vyos_sdwan_ctl.py --host ${router.host} --key ${router.apiKey.substring(0, 8)}... ${args.slice(7).join(' ')}`;
        log('VYOS', `Full command: ${fullCommand}`, 'info');

        return new Promise((resolve, reject) => {
            const proc = spawn('python3', args);
            let output = '';
            let errorMsg = '';

            proc.stdout.on('data', (data) => output += data.toString());
            proc.stderr.on('data', (data) => errorMsg += data.toString());

            proc.on('close', (code) => {
                if (code === 0) {
                    try {
                        const jsonStart = output.indexOf('{');
                        const jsonStr = jsonStart !== -1 ? output.substring(jsonStart) : output;
                        resolve(JSON.parse(jsonStr));
                    } catch {
                        resolve({ success: true, output });
                    }
                } else {
                    reject(new Error(errorMsg.trim() || `Process exited with code ${code}`));
                }
            });
        });
    }

    /**
     * Simple ping for fast connectivity check
     */
    private async pingHost(host: string): Promise<boolean> {
        try {
            const cmd = (process.platform === 'win32')
                ? `ping -n 1 -w 1000 ${host}`
                : `ping -c 1 -W 1 ${host}`;
            await execPromise(cmd);
            return true;
        } catch {
            return false;
        }
    }

    async testConnection(routerId: string): Promise<boolean> {
        const router = this.routers.get(routerId);
        if (!router) return false;
        return this.pingHost(router.host);
    }

    /**
     * Get list of denied traffic rules on an interface
     */
    async getBlocks(routerId: string, iface: string): Promise<any> {
        const router = this.routers.get(routerId);
        if (!router) throw new Error('Router not found');

        const args = [
            this.pythonScriptPath,
            '--host', router.host,
            '--key', router.apiKey,
            '--version', router.version || '1.4',
            'get-blocks',
            '--iface', iface
        ];

        const scrubbedArgs = args.map(arg => (arg === router.apiKey ? '***' : arg));
        log('VYOS', `Get blocks CLI: python3 ${scrubbedArgs.join(' ')}`, 'debug');

        return new Promise((resolve, reject) => {
            const proc = spawn('python3', args);
            let output = '';
            let errorMsg = '';

            proc.stdout.on('data', (data) => output += data.toString());
            proc.stderr.on('data', (data) => errorMsg += data.toString());

            proc.on('close', (code) => {
                if (code === 0) {
                    try {
                        const jsonStart = output.indexOf('{');
                        const jsonStr = jsonStart !== -1 ? output.substring(jsonStart) : output;
                        resolve(JSON.parse(jsonStr));
                    } catch {
                        reject(new Error('Invalid JSON response'));
                    }
                } else {
                    reject(new Error(errorMsg.trim() || `Process exited with code ${code}`));
                }
            });
        });
    }

    /**
     * Get the full unified configuration
     */
    getFullConfig(): any {
        if (fs.existsSync(this.routersFile)) {
            try {
                return JSON.parse(fs.readFileSync(this.routersFile, 'utf8'));
            } catch (e: any) {
                log('VYOS', `Failed to read config file: ${e.message}`, 'error');
            }
        }
        return { routers: [], sequences: [] };
    }

    /**
     * Overwrite the full unified configuration
     */
    setFullConfig(config: any) {
        try {
            // Validation: Ensure basic structure
            if (!config.routers || !Array.isArray(config.routers)) {
                throw new Error('Invalid config: missing routers array');
            }

            fs.writeFileSync(this.routersFile, JSON.stringify(config, null, 2));

            // Reload internal state
            this.routers.clear();
            config.routers.forEach((r: VyosRouter) => this.routers.set(r.id, r));

            log('VYOS', `Full configuration updated manually. ${config.routers.length} routers, ${config.sequences?.length || 0} sequences.`);
            this.emit('config-updated');
        } catch (e: any) {
            log('VYOS', `Failed to set full config: ${e.message}`, 'error');
            throw e;
        }
    }

    /**
     * Reset configuration to empty state
     */
    resetConfig() {
        const emptyConfig = { routers: [], sequences: [] };
        this.setFullConfig(emptyConfig);
    }
}
