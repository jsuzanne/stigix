import path from 'path';
import os from 'os';
import fs from 'fs';
import net from 'net';
import { spawn } from 'child_process';
import { log } from './utils/logger.js';
import { StigixRegistryClient, RegistryInstance, RegistryInstanceSummary } from './stigix-registry-client.js';
import type { LocalRegistryServer } from './local-registry-server.js';

/**
 * RegistryManager — Orchestrates the lifecycle of registry integration.
 * Handles heartbeats, discovery, and persistence of the PoC identity.
 */
export class RegistryManager {
    private client: StigixRegistryClient;
    private localRegistryServer: LocalRegistryServer | null = null;
    private targetsManager: any = null;
    private telemetryProvider: (() => Promise<RegistryInstanceSummary> | RegistryInstanceSummary) | null = null;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private discoveryInterval: NodeJS.Timeout | null = null;
    private peerCache: Map<string, { instance: RegistryInstance, lastSeen: number }> = new Map();
    private lastMeshSignature: string = '';
    private sharedTargetsCache: any[] = [];
    private currentIp: string = '127.0.0.1';
    private leaderInfo: { ip: string, id: string } | null = null;
    private detectedRole: string | null = null;
    private isBranchGateway: boolean = false;
    private configDir: string;
    private statsFile: string;
    private stats: { reads: number; writes: number; since: string } = { reads: 0, writes: 0, since: new Date().toISOString() };
    private lastAnnounceTime: number = 0;
    private staticLeaderUrl: string | null = null;
    private directMode: boolean = false;

    public setLocalRegistryServer(server: LocalRegistryServer) {
        this.localRegistryServer = server;
    }

    public setTargetsManager(mgr: any) {
        this.targetsManager = mgr;
    }

    public setTelemetryProvider(provider: () => Promise<RegistryInstanceSummary> | RegistryInstanceSummary) {
        this.telemetryProvider = provider;
    }

    /**
     * Normalizes a user-supplied controller URL:
     * - Trims whitespace and trailing slash
     * - Adds http:// if no protocol
     * - Appends /api/registry path if absent
     * Returns empty string if the input is invalid.
     */
    private normalizeControllerUrl(input: string): string {
        if (!input) return '';
        let url = input.trim();
        if (!url.startsWith('http')) {
            url = `http://${url}`;
        }
        try {
            const u = new URL(url);
            const hostPart = url.split('://')[1] || '';
            const portPart = hostPart.split('/')[0] || '';
            if (!portPart.includes(':') && u.port === '') {
                u.port = '8080';
            }
            if (u.pathname === '/' || u.pathname === '') {
                u.pathname = '/api/registry';
            } else if (!u.pathname.includes('/api/registry')) {
                u.pathname = u.pathname.replace(/\/$/, '') + '/api/registry';
            }
            return u.toString().replace(/\/$/, '');
        } catch (e) {
            log('REGISTRY', `Invalid controller URL: "${input}"`, 'error');
            return '';
        }
    }

    constructor(configDir: string) {
        this.configDir = configDir;
        this.statsFile = path.join(configDir, 'registry-stats.json');
        this.loadStats();
        
        this.client = StigixRegistryClient.fromEnv((usage) => this.handleUsage(usage));
        this.currentIp = this.detectPrivateIp(configDir);
        this.loadStaticLeader();
        this.loadSiteName();

        // Direct mode: STIGIX_CONTROLLER_URL takes absolute priority over everything
        const envControllerUrl = process.env.STIGIX_CONTROLLER_URL;
        if (envControllerUrl) {
            const normalized = this.normalizeControllerUrl(envControllerUrl);
            if (normalized) {
                this.directMode = true;
                this.staticLeaderUrl = normalized;
                this.client.setLocalRegistryByUrl(normalized);
                // Derive a synthetic poc_id from the controller hostname so
                // register/instances calls are scoped and consistent across peers.
                const controllerHost = new URL(normalized).hostname;
                const syntheticPocId = `direct:${controllerHost}`;
                (this.client.getConfig() as any).pocId = syntheticPocId;
                (this.client.getConfig() as any).enabled = true;
                log('REGISTRY', `Direct mode activated. Controller: ${normalized}`);
            } else {
                log('REGISTRY', `STIGIX_CONTROLLER_URL is set but invalid: "${envControllerUrl}". Falling back to auto-discovery.`, 'error');
            }
        }
    }

    private loadStaticLeader() {
        try {
            const staticFile = path.join(this.configDir, 'static-leader.json');
            if (fs.existsSync(staticFile)) {
                const data = JSON.parse(fs.readFileSync(staticFile, 'utf8'));
                if (data.url) {
                    this.staticLeaderUrl = data.url;
                    log('REGISTRY', `Static Leader URL loaded: ${this.staticLeaderUrl}`);
                }
            }
        } catch (e) {
            log('REGISTRY', `Failed to load static leader config: ${e}`, 'error');
        }
    }

    private loadSiteName() {
        try {
            const siteNameFile = path.join(this.configDir, 'site-name.json');
            if (fs.existsSync(siteNameFile)) {
                const data = JSON.parse(fs.readFileSync(siteNameFile, 'utf8'));
                if (data.siteName) {
                    process.env.STIGIX_SITE_NAME = data.siteName;
                    (this.client.getConfig() as any).siteName = data.siteName;
                    (this.client.getConfig() as any).instanceId = data.siteName;
                    log('REGISTRY', `Site name loaded from config: "${data.siteName}"`);
                }
            }
        } catch (e) {
            log('REGISTRY', `Failed to load site name config: ${e}`, 'error');
        }
    }

    public async saveStaticLeader(url: string | null) {
        try {
            const staticFile = path.join(this.configDir, 'static-leader.json');
            if (url) {
                fs.writeFileSync(staticFile, JSON.stringify({ url, updatedAt: new Date().toISOString() }));
                this.staticLeaderUrl = url;
                log('REGISTRY', `Static Leader URL saved: ${url}`);
                // Re-initialize client with the new URL
                this.client.setLocalRegistryByUrl(url);
            } else {
                if (fs.existsSync(staticFile)) fs.unlinkSync(staticFile);
                this.staticLeaderUrl = null;
                this.client.resetToRemote();
                log('REGISTRY', `Static Leader URL removed. Reverted to auto-discovery.`);
            }
            // Trigger a re-start logic or setup intervals again
            await this.start();
        } catch (e) {
            log('REGISTRY', `Failed to save static leader config: ${e}`, 'error');
            throw e;
        }
    }

    public getClusterEnrollment(): { enrolled: boolean; tokenPrefix?: string; leaderUrl?: string; siteName?: string; enrolledAt?: string; nodeToken?: string } | null {
        try {
            const f = path.join(this.configDir, 'cluster-enrollment.json');
            if (fs.existsSync(f)) {
                return JSON.parse(fs.readFileSync(f, 'utf8'));
            }
        } catch {}
        return null;
    }

    public saveClusterEnrollment(data: any | null) {
        try {
            const f = path.join(this.configDir, 'cluster-enrollment.json');
            if (data) {
                fs.writeFileSync(f, JSON.stringify(data, null, 2), 'utf8');
            } else if (fs.existsSync(f)) {
                fs.unlinkSync(f);
            }
        } catch (e: any) {
            log('REGISTRY', `Failed to write cluster-enrollment.json: ${e.message}`, 'warn');
        }
    }

    public getControllerEndpoints(): string[] {
        try {
            const f = path.join(this.configDir, 'controller-endpoints.json');
            if (fs.existsSync(f)) {
                const data = JSON.parse(fs.readFileSync(f, 'utf8'));
                if (Array.isArray(data)) return data;
            }
        } catch {}
        return [];
    }

    public saveControllerEndpoints(endpoints: string[]): void {
        try {
            const f = path.join(this.configDir, 'controller-endpoints.json');
            if (Array.isArray(endpoints) && endpoints.length > 0) {
                fs.writeFileSync(f, JSON.stringify(endpoints, null, 2), 'utf8');
                log('REGISTRY', `Saved ${endpoints.length} controller fallback endpoints to controller-endpoints.json`);
            }
        } catch (e: any) {
            log('REGISTRY', `Failed to write controller-endpoints.json: ${e.message}`, 'warn');
        }
    }

    /**
     * Updates the site name (STIGIX_SITE_NAME) at runtime.
     * - Updates process.env so any future fromEnv() calls pick it up
     * - Updates the live registry client config so the next heartbeat sends the new name
     * - Persists to site-name.json (survives container restart via config volume)
     * - Triggers an immediate heartbeat so the leader is updated right away
     */
    public async setSiteName(newName: string): Promise<void> {
        if (!newName || !newName.trim()) throw new Error('Site name cannot be empty');
        const trimmed = newName.trim();

        // 1. Update live process env
        process.env.STIGIX_SITE_NAME = trimmed;

        // 2. Update registry client in-memory config
        (this.client.getConfig() as any).siteName = trimmed;
        (this.client.getConfig() as any).instanceId = trimmed;

        // 3. Persist to config dir (mounted volume → survives restart)
        const siteNameFile = path.join(this.configDir, 'site-name.json');
        fs.writeFileSync(siteNameFile, JSON.stringify({ siteName: trimmed, updatedAt: new Date().toISOString() }));
        log('REGISTRY', `Site name updated to: "${trimmed}"`);

        // 3b. Also persist STIGIX_SITE_NAME to .env if present so future container restarts or env readers stay in sync
        const envCandidates = [
            path.join(this.configDir, '.env'),
            path.join(process.cwd(), 'config', '.env'),
            path.join(process.cwd(), '.env'),
            '/app/config/.env'
        ];
        for (const ep of envCandidates) {
            try {
                if (fs.existsSync(ep)) {
                    let envContent = fs.readFileSync(ep, 'utf8');
                    if (/^STIGIX_SITE_NAME=/m.test(envContent)) {
                        envContent = envContent.replace(/^STIGIX_SITE_NAME=.*/m, `STIGIX_SITE_NAME=${trimmed}`);
                    } else {
                        envContent += `\nSTIGIX_SITE_NAME=${trimmed}\n`;
                    }
                    fs.writeFileSync(ep, envContent, 'utf8');
                    break;
                }
            } catch {}
        }

        // 4. Update any managed target matching our IP with the new site name
        if (this.targetsManager && typeof this.targetsManager.updateHostName === 'function' && this.currentIp) {
            this.targetsManager.updateHostName(this.currentIp, trimmed);
        }

        // 5. Trigger immediate heartbeat to propagate the change to the leader / peers
        await this.performHeartbeat();
    }

    /**
     * Returns the current site name, checking (in order):
     * persisted site-name.json → process.env.STIGIX_SITE_NAME → hostname
     */
    public getSiteName(): string {
        const siteNameFile = path.join(this.configDir, 'site-name.json');
        try {
            if (fs.existsSync(siteNameFile)) {
                const data = JSON.parse(fs.readFileSync(siteNameFile, 'utf8'));
                if (data.siteName) return data.siteName;
            }
        } catch {}
        return process.env.STIGIX_SITE_NAME || os.hostname();
    }

    public getCurrentIp(): string {
        return this.currentIp || '127.0.0.1';
    }

    private loadStats() {
        try {
            if (fs.existsSync(this.statsFile)) {
                const data = fs.readFileSync(this.statsFile, 'utf8');
                const parsed = JSON.parse(data);
                if (typeof parsed.reads === 'number' && typeof parsed.writes === 'number') {
                    this.stats = parsed;
                }
            }
        } catch (e) {
            log('REGISTRY', `Failed to load stats from ${this.statsFile}: ${e}`, 'error');
        }
    }

    private saveStats() {
        try {
            fs.writeFileSync(this.statsFile, JSON.stringify(this.stats, null, 2));
        } catch (e) {
            log('REGISTRY', `Failed to save stats to ${this.statsFile}: ${e}`, 'error');
        }
    }

    private handleUsage(usage: { reads: number; writes: number }) {
        this.stats.reads += usage.reads;
        this.stats.writes += usage.writes;
        this.saveStats();
    }

    private detectPrivateIp(configDir: string): string {
        // 1. Manual override
        if (process.env.STIGIX_PRIVATE_IP) {
            return process.env.STIGIX_PRIVATE_IP;
        }

        const nets = os.networkInterfaces();

        // 2. Try to use interface.txt / interfaces.txt
        try {
            const ifaceFile = path.join(configDir, 'interfaces.txt');
            if (fs.existsSync(ifaceFile)) {
                const ifaceName = fs.readFileSync(ifaceFile, 'utf8').trim().split('\n')[0].trim();
                const netInfo = nets[ifaceName];
                if (netInfo) {
                    const ipv4 = netInfo.find(ni => ni.family === 'IPv4');
                    if (ipv4) {
                        log('REGISTRY', `Selected IP from interfaces.txt (${ifaceName}): ${ipv4.address}`);
                        return ipv4.address;
                    }
                }
            }
        } catch (e) {
            log('REGISTRY', `Failed to read interfaces.txt for IP detection: ${e}`, 'warn');
        }

        // 3. Heuristic fallback
        const blacklist = ['docker', 'virbr', 'veth', 'br-', 'lo'];

        // Collect all possible IPs
        const candidates: string[] = [];

        for (const name of Object.keys(nets)) {
            // Skip blacklisted interfaces
            if (blacklist.some(b => name.startsWith(b))) continue;

            for (const netInfo of nets[name]!) {
                // Skip internally and non-IPv4
                if (netInfo.family === 'IPv4' && !netInfo.internal) {
                    candidates.push(netInfo.address);
                }
            }
        }

        // Return first candidate, or fallback
        if (candidates.length > 0) {
            // Heuristic: Prefer 192, 10, or 172 ranges (private)
            const preferred = candidates.find(ip =>
                ip.startsWith('192.') || ip.startsWith('10.') || ip.startsWith('172.')
            );
            return preferred || candidates[0];
        }

        return '127.0.0.1';
    }

    private async isPortOpen(host: string, port: number, timeout = 3000): Promise<boolean> {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            const timer = setTimeout(() => {
                socket.destroy();
                resolve(false);
            }, timeout);

            socket.connect(port, host, () => {
                clearTimeout(timer);
                socket.destroy();
                resolve(true);
            });

            socket.on('error', () => {
                clearTimeout(timer);
                socket.destroy();
                resolve(false);
            });
        });
    }

    private async autoDetectIdentity(): Promise<{ role: string | null, isBg: boolean }> {
        return new Promise((resolve) => {
            const pythonPath = process.env.PYTHON_PATH || 'python3';
            const scriptPath = path.join(process.cwd(), 'engines', 'getflow.py');

            log('REGISTRY', `Running identity auto-detection via ${scriptPath}...`);

            const proc = spawn(pythonPath, [scriptPath, '--auto-detect', '--json'], {
                env: { ...process.env, PYTHONUNBUFFERED: '1' }
            });

            let stdout = '';
            proc.stdout.on('data', d => stdout += d.toString());
            proc.on('close', (code) => {
                if (code === 0) {
                    try {
                        const data = JSON.parse(stdout);
                        resolve({
                            role: data.detected_site_role,
                            isBg: data.detected_branch_gateway
                        });
                        return;
                    } catch (e) { }
                }
                resolve({ role: null, isBg: false });
            });
            proc.on('error', () => resolve({ role: null, isBg: false }));
        });
    }

    async start() {
        const config = this.client.getConfig();

        // ── Direct Controller Mode ───────────────────────────────────────
        // When STIGIX_CONTROLLER_URL is set, bypass ALL Cloudflare logic.
        // Register directly with the explicit leader and refresh peer list.
        if (this.directMode && this.staticLeaderUrl) {
            log('REGISTRY', `Registry mode: direct`);
            log('REGISTRY', `Direct controller: ${this.staticLeaderUrl}`);
            process.env.STIGIX_REGISTRY_MODE_CURRENT = 'peer';
            const displayHost = (() => {
                try { return new URL(this.staticLeaderUrl).hostname; } catch { return this.staticLeaderUrl!; }
            })();
            this.leaderInfo = { ip: displayHost, id: displayHost };
            await this.performHeartbeat();
            await this.performDiscovery();
            this.setupIntervals();
            return;
        }
        // ─────────────────────────────────────────────────────────────────

        // 1. Always detect identity for UI visibility
        log('REGISTRY', `Running identity auto-detection...`);
        const identity = await this.autoDetectIdentity();
        this.detectedRole = identity.role;
        this.isBranchGateway = identity.isBg;

        let sysMode = 'standalone';
        try {
            const sysSettingsFile = path.join(this.configDir, 'system-settings.json');
            if (fs.existsSync(sysSettingsFile)) {
                const sysSettings = JSON.parse(fs.readFileSync(sysSettingsFile, 'utf8'));
                if (sysSettings.registry_mode) {
                    sysMode = sysSettings.registry_mode;
                }
                if (sysSettings.registry_url !== undefined) {
                    process.env.STIGIX_REGISTRY_URL = sysSettings.registry_url;
                    if (sysSettings.registry_url && String(sysSettings.registry_url).trim().length > 0) {
                        process.env.STIGIX_REGISTRY_ENABLED = 'true';
                    }
                    (this.client.getConfig() as any).registryUrl = sysSettings.registry_url;
                    (this.client.getConfig() as any).remoteUrl = sysSettings.registry_url;
                }
            }
        } catch (e) {
            log('REGISTRY', `Failed to read system-settings for registry mode: ${e}`, 'warn');
        }

        let mode = sysMode !== 'auto' ? sysMode : (process.env.STIGIX_REGISTRY_MODE || 'standalone');

        // Standalone Mode: 100% offline/independent. No discovery, no registration, no Cloudflare traffic.
        if (mode === 'standalone') {
            log('REGISTRY', `Node operating in standalone mode. Remote registry and clustering disabled.`);
            this.leaderInfo = null;
            process.env.STIGIX_REGISTRY_MODE_CURRENT = 'standalone';
            this.stop();
            return;
        }

        if (mode === 'auto') {
            // Logic: Hub OR Branch Gateway => Potential Leader
            if (this.detectedRole === 'HUB' || this.isBranchGateway) {
                log('REGISTRY', `Auto-detected as HUB/BG. Promoting to LEADER candidate.`);
                mode = 'leader';
            } else {
                log('REGISTRY', `Auto-detected as ${this.detectedRole || 'UNKNOWN'}. Defaulting to PEER.`);
                mode = 'peer';
            }
        } else {
            log('REGISTRY', `Manual Mode Override: ${mode.toUpperCase()}`);
        }

        log('REGISTRY', `Final Role: ${mode.toUpperCase()} for PoC: ${config.pocId}`);

        if (mode === 'leader') {
            this.leaderInfo = null;
            if (this.staticLeaderUrl && !this.directMode) {
                try {
                    const staticFile = path.join(this.configDir, 'static-leader.json');
                    if (fs.existsSync(staticFile)) fs.unlinkSync(staticFile);
                } catch {}
                this.staticLeaderUrl = null;
            }
            // Ensure Leader is enabled and has a fallback pocId so discovery fetchInstances() works locally
            (config as any).enabled = true;
            if (!config.pocId) {
                (config as any).pocId = 'local-leader';
            }
            // Leader Mode: Announce ourselves to Bootstrap Signal only if remoteUrl is configured
            if (config.remoteUrl) {
                await this.client.announceLeader(this.currentIp);
            } else {
                log('REGISTRY', 'Leader initialized locally (no remote Cloudflare registry configured).');
            }
            // Switch heartbeats to local server (self)
            this.client.setLocalRegistry('127.0.0.1');
        } else {
            // Peer Mode: 
            // 1. If we have a Static Leader URL, use it directly
            if (this.staticLeaderUrl) {
                log('REGISTRY', `Peer using STATIC LEADER: ${this.staticLeaderUrl}`);
                this.client.setLocalRegistryByUrl(this.staticLeaderUrl);
                
                let displayName = 'static';
                try {
                    const u = new URL(this.staticLeaderUrl);
                    displayName = u.hostname;
                } catch (e) {}
                
                this.leaderInfo = { ip: displayName, id: displayName };
            } else if (config.remoteUrl) {
                // 2. Otherwise, try to find local leader via Bootstrap (Cloudflare) if remoteUrl configured
                const leader = await this.client.findLeader();
                if (leader) {
                    log('REGISTRY', `Local leader discovered at ${leader.ip}. Verifying reachability...`);
                    const isOpen = await this.isPortOpen(leader.ip, 8080); // Default port

                    if (isOpen) {
                        this.leaderInfo = leader;
                        this.client.setLocalRegistry(leader.ip);
                        log('REGISTRY', `Local leader reached successfully. Target URL: ${config.registryUrl}`);
                    } else {
                        log('REGISTRY', `Local leader ${leader.ip} found but port 8080 is unreachable. Falling back to Cloudflare.`, 'warn');
                    }
                } else {
                    log('REGISTRY', `No local leader found. Using remote bootstrap (Cloudflare) at ${config.remoteUrl}`);
                }
            } else {
                log('REGISTRY', `No static leader and no remote Cloudflare registry configured. Operating as unattached peer.`);
            }
        }

        // Store the determined mode in current process env for later heartbeat checks
        process.env.STIGIX_REGISTRY_MODE_CURRENT = mode;

        // 1. Initial Registration
        await this.performHeartbeat();

        // 3. Initial Discovery
        await this.performDiscovery();

        this.setupIntervals();
    }

    public getInstanceId(): string {
        return this.client.getConfig().instanceId;
    }

    private setupIntervals() {
        const config = this.client.getConfig();
        const mode = process.env.STIGIX_REGISTRY_MODE_CURRENT || 'peer';
        const isRemote = config.registryUrl === config.remoteUrl;
        const isEnrolled = !!(this.getClusterEnrollment()?.enrolled || this.staticLeaderUrl);

        // Clear existing
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.discoveryInterval) clearInterval(this.discoveryInterval);

        // If peer is enrolled in a cluster and pointing to Cloudflare remote fallback,
        // completely disable polling Cloudflare to preserve quota (fleet-tunnel handles connectivity).
        if (mode === 'peer' && isRemote && isEnrolled) {
            log('REGISTRY', `Peer is enrolled in cluster; Cloudflare remote polling disabled to preserve quota.`);
            return;
        }

        // Discovery interval:
        // - Local mode (Leader or Peer talking to local Leader): 30s
        // - Cloudflare remote fallback: 300s (5 minutes) to protect quota
        const defaultDiscoverySec = isRemote ? 300 : 30;
        const discoveryMs = (config.discoveryIntervalSec || defaultDiscoverySec) * 1000;
        this.discoveryInterval = setInterval(() => this.performDiscovery(), discoveryMs);

        // Heartbeat interval:
        // - Local mode: 30s
        // - Cloudflare remote fallback: 300s (5 minutes)
        let heartbeatMs = 30000;
        if (isRemote) {
            heartbeatMs = (config.heartbeatIntervalSec || 300) * 1000;
        }

        log('REGISTRY', `Heartbeat interval set to ${heartbeatMs / 1000}s, discovery to ${discoveryMs / 1000}s (mode: ${mode}, target: ${config.registryUrl})`);
        this.heartbeatInterval = setInterval(() => this.performHeartbeat(), heartbeatMs);
    }

    public getNodeCapabilities(): { voice: boolean; convergence: boolean; custom_app: boolean; xfr: boolean; security: boolean; connectivity: boolean } {
        const file = path.join(this.configDir, 'node-capabilities.json');
        const defaultCaps = { voice: true, convergence: true, custom_app: true, xfr: true, security: true, connectivity: true };
        try {
            if (fs.existsSync(file)) {
                const data = JSON.parse(fs.readFileSync(file, 'utf8'));
                return { ...defaultCaps, ...data };
            }
        } catch {}
        return defaultCaps;
    }

    public async setNodeCapabilities(caps: Partial<{ voice: boolean; convergence: boolean; custom_app: boolean; xfr: boolean; security: boolean; connectivity: boolean }>): Promise<void> {
        const file = path.join(this.configDir, 'node-capabilities.json');
        const current = this.getNodeCapabilities();
        const updated = { ...current, ...caps };
        fs.writeFileSync(file, JSON.stringify(updated, null, 2), 'utf8');
        log('REGISTRY', `Node capabilities updated: ${JSON.stringify(updated)}`);
        await this.performHeartbeat();
    }

    public async refreshIp(): Promise<string> {
        this.currentIp = this.detectPrivateIp(this.configDir);
        log('REGISTRY', `Refreshed detected IP: ${this.currentIp}`);
        await this.performHeartbeat();
        return this.currentIp;
    }

    private async performHeartbeat() {
        const mode = process.env.STIGIX_REGISTRY_MODE_CURRENT || 'standalone';
        if (mode === 'standalone') return;

        // Dynamically update private IP in case interfaces.txt or network configuration changed
        this.currentIp = this.detectPrivateIp(this.configDir);
        const config = this.client.getConfig();

        // 1. Peer Recovery: If using Remote, try to reconnect to the leader
        if (mode === 'peer' && config.registryUrl === config.remoteUrl) {
            const isEnrolled = !!(this.getClusterEnrollment()?.enrolled || this.staticLeaderUrl);
            if (isEnrolled) {
                // If staticLeaderUrl is known, try re-pointing to it directly
                if (this.staticLeaderUrl) {
                    this.client.setLocalRegistryByUrl(this.staticLeaderUrl);
                    let displayName = 'static';
                    try { displayName = new URL(this.staticLeaderUrl).hostname; } catch {}
                    this.leaderInfo = { ip: displayName, id: displayName };
                }
                // Do not send heartbeat (POST /instances) to remote Cloudflare Worker
                return;
            }
            const connected = await this.tryConnectToLocalLeader();
            if (!connected) {
                // Safeguard: If no leader is found, do NOT register (POST) to Cloudflare.
                // This ensures Cloudflare is only contacted in READ ONLY mode (findLeader/fetchInstances).
                log('REGISTRY', `No local leader found. Skipping registration to save Cloudflare KV Quota.`);
                return;
            }
        }

        // 2. Leader Maintenance: Periodic Announcement to Bootstrap (Cloudflare)
        if (mode === 'leader' && config.registryUrl === config.remoteUrl) {
            // Re-announce to Cloudflare every 15 minutes (approx 3 heartbeats at 5-min intervals)
            // This refreshes the 24h lease and prevents takeover by a new leader.
            if (!this.lastAnnounceTime || Date.now() - this.lastAnnounceTime > 15 * 60 * 1000) {
                await this.client.announceLeader(this.currentIp);
                this.lastAnnounceTime = Date.now();
            }
        }

        // Build capabilities based on configured node capabilities
        const capabilities = this.getNodeCapabilities();

        let summary: RegistryInstanceSummary | undefined;
        if (this.telemetryProvider) {
            try {
                summary = await this.telemetryProvider();
            } catch (err) {
                log('REGISTRY', `Error collecting telemetry summary: ${err}`, 'warn');
            }
        }

        const activeSiteName = this.getSiteName();
        (config as any).siteName = activeSiteName;
        (config as any).instanceId = activeSiteName;

        if (this.localRegistryServer && (mode === 'leader' || this.isLeader())) {
            let version = 'v2';
            try {
                if (fs.existsSync('/app/VERSION')) {
                    version = fs.readFileSync('/app/VERSION', 'utf8').trim();
                }
            } catch {}

            const selfInstance: RegistryInstance = {
                poc_id: config.pocId || 'local-leader',
                instance_id: activeSiteName,
                type: 'leader',
                ip_private: this.currentIp,
                capabilities,
                summary,
                meta: {
                    site: activeSiteName,
                    region: config.region,
                    vendor: 'stigix',
                    version,
                    is_leader: true,
                },
                last_seen: new Date().toISOString()
            };
            this.localRegistryServer.upsertInstance(selfInstance);
        }

        const result = await this.client.register(this.currentIp, capabilities, summary);
        if (result && result.status === 'ok') {
            // Heartbeat successful
        } else if (mode === 'peer' && config.registryUrl !== config.remoteUrl && !this.directMode && !this.staticLeaderUrl) {
            // FAILURE RECOVERY (Auto-Discovery / Dynamic Leader mode only):
            // If local registration fails and no static leader is configured,
            // reset our registry URL to Remote (Cloudflare) to find a new leader.
            log('REGISTRY', `Local Leader heartbeat failed. Reverting to remote discovery via ${config.remoteUrl}`);
            this.client.resetToRemote();
            this.leaderInfo = null;
        }
    }

    private async tryConnectToLocalLeader(): Promise<boolean> {
        const leader = await this.client.findLeader();
        if (leader) {
            const isOpen = await this.isPortOpen(leader.ip, 8080);
            if (isOpen) {
                this.leaderInfo = leader;
                this.client.setLocalRegistry(leader.ip);
                log('REGISTRY', `Transitioning to local leader: http://${leader.ip}:8080/api/registry`);
                this.setupIntervals();
                return true;
            } else {
                log('REGISTRY', `Local leader ${leader.ip} found but port 8080 unreachable.`);
            }
        }
        return false;
    }

    private async performDiscovery() {
        const mode = process.env.STIGIX_REGISTRY_MODE_CURRENT || 'standalone';
        if (mode === 'standalone') return;

        const config = this.client.getConfig();

        // 1. Recovery Check: If on Fallback, try to find the Leader in the discovery phase
        if (mode === 'peer' && config.registryUrl === config.remoteUrl) {
            const isEnrolled = !!(this.getClusterEnrollment()?.enrolled || this.staticLeaderUrl);
            if (isEnrolled) {
                if (this.staticLeaderUrl) {
                    this.client.setLocalRegistryByUrl(this.staticLeaderUrl);
                    let displayName = 'static';
                    try { displayName = new URL(this.staticLeaderUrl).hostname; } catch {}
                    this.leaderInfo = { ip: displayName, id: displayName };
                }
                // Do not query Cloudflare Worker (GET /instances) when enrolled in a cluster
                return;
            }
            await this.tryConnectToLocalLeader();
        }

        const instances = await this.client.fetchInstances();
        if (instances && Array.isArray(instances)) {
            const now = Date.now();
            // Merge newly discovered instances and update their lastSeen timestamp
            for (const inst of instances) {
                if (!inst || !inst.instance_id) continue;
                if (inst.ip_private) {
                    for (const [existingId, existingEntry] of this.peerCache.entries()) {
                        if (existingEntry.instance?.ip_private === inst.ip_private && existingId !== inst.instance_id) {
                            this.peerCache.delete(existingId);
                        }
                    }
                    if (this.targetsManager && typeof this.targetsManager.updateHostName === 'function') {
                        this.targetsManager.updateHostName(inst.ip_private, inst.meta?.site || inst.instance_id);
                    }
                }
                this.peerCache.set(inst.instance_id, {
                    instance: inst,
                    lastSeen: now
                });
            }
            // Evict instances that haven't responded within GRACE_PERIOD_MS (15 min)
            const GRACE_PERIOD_MS = 15 * 60 * 1000;
            for (const [id, entry] of this.peerCache.entries()) {
                const entryLastSeen = entry.lastSeen || (entry.instance?.last_seen ? new Date(entry.instance.last_seen).getTime() : 0);
                if (now - entryLastSeen > GRACE_PERIOD_MS) {
                    this.peerCache.delete(id);
                }
            }
        }

        // Fetch shared targets from Leader if we are a Peer connected to Local Leader
        if (mode === 'peer' && config.registryUrl !== config.remoteUrl) {
            this.sharedTargetsCache = await this.client.fetchSharedTargets();
            // Sync global provisioning bundles if enabled
            await this.syncProvisioning();
        } else {
            this.sharedTargetsCache = [];
        }
    }

    public setProvisioningManager(pm: any) {
        this.provisioningManager = pm;
    }

    public async syncProvisioning(): Promise<void> {
        if (!this.provisioningManager) return;
        const state = this.provisioningManager.getState();
        if (!state.enabled) return;

        const manifest = await this.client.fetchProvisioningManifest();
        if (!manifest || !Array.isArray(manifest.bundles)) return;

        for (const bundle of manifest.bundles) {
            const currentApplied = state.appliedRevisions[bundle.type];
            const needsSync = !currentApplied ||
                              currentApplied.status !== 'applied' ||
                              currentApplied.revision !== bundle.revision ||
                              currentApplied.checksum !== bundle.checksum;

            if (needsSync) {
                log('PROVISIONING', `[SYNC] Pulling global bundle "${bundle.type}" rev ${bundle.revision} from Leader (current status: ${currentApplied?.status || 'none'}, local rev: ${currentApplied?.revision || 0})...`);
                const bundleItems = await this.client.fetchProvisioningBundle(bundle.type, bundle.revision);
                if (bundleItems !== null && bundleItems !== undefined) {
                    const success = this.provisioningManager.applyGlobalBundle(bundle.type as any, bundle.revision, bundle.checksum, bundleItems);
                    log('PROVISIONING', `[SYNC] Bundle "${bundle.type}" rev ${bundle.revision} apply result: ${success ? 'SUCCESS' : 'FAILED'}`);
                } else {
                    log('PROVISIONING', `[SYNC] Failed to fetch bundle items for "${bundle.type}" rev ${bundle.revision}`, 'error');
                }
            }
        }

        // Report updated state to Leader
        await this.client.reportProvisioningStatus(this.provisioningManager.getState());
    }

    getSharedTargets() {
        return this.sharedTargetsCache;
    }

    public updatePeersFromLeader(instances: RegistryInstance[]): void {
        if (!instances || !Array.isArray(instances)) return;
        const now = Date.now();
        const incomingIds = new Set(instances.map(i => i?.instance_id).filter(Boolean));

        for (const inst of instances) {
            if (!inst || !inst.instance_id) continue;
            if (inst.ip_private) {
                for (const [existingId, existingEntry] of this.peerCache.entries()) {
                    if (existingEntry.instance?.ip_private === inst.ip_private && existingId !== inst.instance_id) {
                        this.peerCache.delete(existingId);
                    }
                }
                if (this.targetsManager && typeof this.targetsManager.updateHostName === 'function') {
                    this.targetsManager.updateHostName(inst.ip_private, inst.meta?.site || inst.instance_id);
                }
            }
            this.peerCache.set(inst.instance_id, {
                instance: inst,
                lastSeen: now
            });
        }

        // If Leader sent an authoritative mesh list, prune cached entries no longer reported by Leader
        if (incomingIds.size > 0) {
            for (const id of this.peerCache.keys()) {
                if (!incomingIds.has(id)) {
                    this.peerCache.delete(id);
                }
            }
        }

        const activePeers = this.getPeers();
        const currentSignature = activePeers
            .map(p => `${p.instance_id}:${p.ip_private}:${p.site_name || ''}`)
            .sort()
            .join('|');

        if (!this.lastMeshSignature) {
            this.lastMeshSignature = currentSignature;
            const peerNames = activePeers.map(p => p.site_name || p.instance_id).filter(Boolean).join(', ');
            log('REGISTRY', `⚡ Synchronized cluster peer mesh from Leader: ${this.peerCache.size} peers cached (${activePeers.length} active peers: ${peerNames || 'none'})`);
        } else if (this.lastMeshSignature !== currentSignature) {
            this.lastMeshSignature = currentSignature;
            const peerNames = activePeers.map(p => p.site_name || p.instance_id).filter(Boolean).join(', ');
            log('REGISTRY', `⚡ Cluster peer mesh updated: ${this.peerCache.size} peers cached (${activePeers.length} active peers: ${peerNames || 'none'})`);
        }
    }

    getPeers(): RegistryInstance[] {
        const now = Date.now();
        const GRACE_PERIOD_MS = 15 * 60 * 1000; // 15 minutes
        const ownInstanceId = this.client.getConfig().instanceId;

        // On Leader, prefer localRegistryServer.getInstances() as authoritative source.
        // On Spokes/Peers, localRegistryServer is mounted for potential failover but empty; use peerCache.
        const rawInstances: RegistryInstance[] = (this.isLeader() && this.localRegistryServer)
            ? this.localRegistryServer.getInstances()
            : Array.from(this.peerCache.values()).map(e => e.instance);

        const activePeers: RegistryInstance[] = [];
        for (const inst of rawInstances) {
            const lastSeen = inst.last_seen ? new Date(inst.last_seen).getTime() : now;
            if (now - lastSeen < GRACE_PERIOD_MS) {
                // Defense in depth: never include self (by instance_id or IP), even if registry didn't filter it
                if (inst.instance_id === ownInstanceId || (this.currentIp && inst.ip_private === this.currentIp)) {
                    continue;
                }
                activePeers.push(inst);
            }
        }
        return activePeers;
    }

    getStatus() {
        const config = this.client.getConfig();
        const mode = this.directMode
            ? 'direct'
            : (process.env.STIGIX_REGISTRY_MODE_CURRENT || 'peer');
        const enrollment = this.getClusterEnrollment();
        const isClusterEnrolled = !!enrollment?.enrolled || process.env.STIGIX_MAGIC_JOIN === 'true';

        return {
            enabled: config.enabled,
            poc_id: config.pocId,
            instance_id: config.instanceId,
            poc_key: config.pocKey,
            is_registered: !!config.pocKey,
            peer_count: this.getPeers().length,
            peers: this.getPeers(),
            detected_ip: this.currentIp,
            registry_url: config.registryUrl,
            remote_url: config.remoteUrl,
            leader_info: this.leaderInfo,
            detected_role: this.detectedRole,
            is_bg: this.isBranchGateway,
            current_mode: mode,
            mode,
            // Direct mode fields (backward-compatible additions)
            direct_mode: this.directMode,
            controller_url: this.directMode ? this.staticLeaderUrl : null,
            static_leader_url: mode === 'leader' ? null : this.staticLeaderUrl,
            is_static_leader: mode !== 'leader' && !!this.staticLeaderUrl,
            site_name: this.getSiteName(),
            stats: this.stats,
            // Cluster Enrollment fields
            is_cluster_enrolled: isClusterEnrolled,
            enrolled_token_prefix: enrollment?.tokenPrefix || (process.env.STIGIX_JOIN_TOKEN ? (process.env.STIGIX_JOIN_TOKEN.slice(0, 12) + '...') : null),
            enrolled_at: enrollment?.enrolledAt || null,
            enrolled_leader_url: mode === 'leader' ? null : (enrollment?.leaderUrl || this.staticLeaderUrl)
        };
    }

    public isLeader(): boolean {
        if (this.directMode) return false;
        if (process.env.STIGIX_REGISTRY_MODE_CURRENT === 'leader') return true;
        try {
            const sysSettingsFile = path.join(this.configDir, 'system-settings.json');
            if (fs.existsSync(sysSettingsFile)) {
                const sysSettings = JSON.parse(fs.readFileSync(sysSettingsFile, 'utf8'));
                if (sysSettings.registry_mode === 'leader') return true;
                if (sysSettings.registry_mode === 'standalone' || sysSettings.registry_mode === 'peer') return false;
            }
        } catch {}
        const mode = process.env.STIGIX_REGISTRY_MODE_CURRENT || process.env.STIGIX_REGISTRY_MODE || 'peer';
        return mode === 'leader';
    }

    /**
     * Hot-reload: reinitialize the registry client with fresh credentials from env.
     * Call this after PRISMA_SDWAN_TSGID or STIGIX_REGISTRY_API_KEY changes at runtime.
     */
    async reinitialize(): Promise<void> {
        log('REGISTRY', 'Hot-reload: reinitializing registry client with updated credentials...');
        this.stop();
        this.leaderInfo = null;
        this.peerCache.clear();
        this.lastMeshSignature = '';
        this.sharedTargetsCache = [];
        // Recreate client from fresh process.env (already updated by savePrismaConfig)
        this.client = StigixRegistryClient.fromEnv((usage) => this.handleUsage(usage));
        this.loadSiteName();
        this.currentIp = this.detectPrivateIp(this.configDir);
        this.loadStaticLeader();
        await this.start();
        log('REGISTRY', 'Hot-reload complete.');
    }

    stop() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.discoveryInterval) clearInterval(this.discoveryInterval);
    }
}
