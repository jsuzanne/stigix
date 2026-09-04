import path from 'path';
import os from 'os';
import fs from 'fs';
import net from 'net';
import { spawn } from 'child_process';
import { log } from './utils/logger.js';
import { StigixRegistryClient, RegistryInstance } from './stigix-registry-client.js';
import type { LocalRegistryServer } from './local-registry-server.js';

/**
 * RegistryManager — Orchestrates the lifecycle of registry integration.
 * Handles heartbeats, discovery, and persistence of the PoC identity.
 */
export class RegistryManager {
    private client: StigixRegistryClient;
    private localRegistryServer: LocalRegistryServer | null = null;
    private targetsManager: any = null;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private discoveryInterval: NodeJS.Timeout | null = null;
    private peerCache: Map<string, { instance: RegistryInstance, lastSeen: number }> = new Map();
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
        if (!config.enabled) {
            log('REGISTRY', `Disabled by configuration.`);
            return;
        }

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

        let sysMode = 'auto';
        try {
            const sysSettingsFile = path.join(this.configDir, 'system-settings.json');
            if (fs.existsSync(sysSettingsFile)) {
                const sysSettings = JSON.parse(fs.readFileSync(sysSettingsFile, 'utf8'));
                if (sysSettings.registry_mode) {
                    sysMode = sysSettings.registry_mode;
                }
            }
        } catch (e) {
            log('REGISTRY', `Failed to read system-settings for registry mode: ${e}`, 'warn');
        }

        let mode = sysMode !== 'auto' ? sysMode : (process.env.STIGIX_REGISTRY_MODE || 'auto');

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
            // Ensure Leader has a fallback pocId so discovery fetchInstances() works locally
            if (!config.pocId) {
                (config as any).pocId = 'local-leader';
                (config as any).enabled = true;
            }
            // Leader Mode: Announce ourselves to Bootstrap Signal
            await this.client.announceLeader(this.currentIp);
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
            } else {
                // 2. Otherwise, try to find local leader via Bootstrap (Cloudflare)
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

    private setupIntervals() {
        const config = this.client.getConfig();
        const mode = process.env.STIGIX_REGISTRY_MODE_CURRENT || 'peer';

        // Clear existing
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.discoveryInterval) clearInterval(this.discoveryInterval);

        // Discovery is always 30s (Read-only, 100k/day quota is safe)
        const discoveryMs = (config.discoveryIntervalSec || 30) * 1000;
        this.discoveryInterval = setInterval(() => this.performDiscovery(), discoveryMs);

        // Heartbeat is adaptive
        let heartbeatMs = (config.heartbeatIntervalSec || 300) * 1000;

        // If we are a Peer using a LOCAL Leader, we can go faster (no Cloudflare quota impact)
        // If we are the Leader, we still heartbeat slow to Cloudflare to save quota
        if (mode === 'peer' && config.registryUrl !== config.remoteUrl) {
            heartbeatMs = 60000; // 1 minute
            log('REGISTRY', `Local mode detected. Heartbeat increased to 60s.`);
        }

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
        // Dynamically update private IP in case interfaces.txt or network configuration changed
        this.currentIp = this.detectPrivateIp(this.configDir);
        const config = this.client.getConfig();
        const mode = process.env.STIGIX_REGISTRY_MODE_CURRENT || 'peer';

        // 1. Peer Recovery: If using Remote, try to find a Local Leader
        if (mode === 'peer' && config.registryUrl === config.remoteUrl && !this.staticLeaderUrl) {
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

        const result = await this.client.register(this.currentIp, capabilities);
        if (result && result.status === 'ok') {
            // Heartbeat successful
        } else if (mode === 'peer' && config.registryUrl !== config.remoteUrl && !this.directMode) {
            // FAILURE RECOVERY (Hybrid/Cloudflare mode only):
            // If local registration fails, it means the Leader is likely dead.
            // We MUST reset our registry URL to the Remote (Cloudflare) so that 
            // the next heartbeat will trigger a new findLeader() lookup.
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
        const config = this.client.getConfig();
        const mode = process.env.STIGIX_REGISTRY_MODE_CURRENT || 'peer';

        // 1. Recovery Check: If on Fallback, try to find the Leader in the discovery phase
        // (Discovery is 30s vs Heartbeat 300s, so this makes recovery much faster)
        if (mode === 'peer' && config.registryUrl === config.remoteUrl) {
            await this.tryConnectToLocalLeader();
        }

        const instances = await this.client.fetchInstances();
        if (instances && Array.isArray(instances)) {
            const now = Date.now();
            const freshCache = new Map<string, { instance: RegistryInstance, lastSeen: number }>();
            for (const inst of instances) {
                freshCache.set(inst.instance_id, {
                    instance: inst,
                    lastSeen: now
                });
            }
            this.peerCache = freshCache;
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

    getPeers(): RegistryInstance[] {
        const now = Date.now();
        const GRACE_PERIOD_MS = 15 * 60 * 1000; // 15 minutes
        const ownInstanceId = this.client.getConfig().instanceId;

        // On Leader, prefer localRegistryServer.getInstances() as authoritative source
        const rawInstances: RegistryInstance[] = this.localRegistryServer
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
        return {
            enabled: config.enabled,
            poc_id: config.pocId,
            instance_id: config.instanceId,
            poc_key: config.pocKey,
            is_registered: !!config.pocKey,
            peer_count: this.getPeers().length,
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
            static_leader_url: this.staticLeaderUrl,
            is_static_leader: !!this.staticLeaderUrl,
            site_name: this.getSiteName(),
            stats: this.stats
        };
    }

    public isLeader(): boolean {
        if (this.directMode) return false;
        const mode = process.env.STIGIX_REGISTRY_MODE_CURRENT || 'peer';
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
        this.sharedTargetsCache = [];
        // Recreate client from fresh process.env (already updated by savePrismaConfig)
        this.client = StigixRegistryClient.fromEnv((usage) => this.handleUsage(usage));
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
