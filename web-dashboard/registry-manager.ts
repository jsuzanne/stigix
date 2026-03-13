import path from 'path';
import os from 'os';
import fs from 'fs';
import net from 'net';
import { spawn } from 'child_process';
import { log } from './utils/logger.js';
import { StigixRegistryClient, RegistryInstance } from './stigix-registry-client.js';

/**
 * RegistryManager — Orchestrates the lifecycle of registry integration.
 * Handles heartbeats, discovery, and persistence of the PoC identity.
 */
export class RegistryManager {
    private client: StigixRegistryClient;
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

    constructor(configDir: string) {
        this.configDir = configDir;
        this.statsFile = path.join(configDir, 'registry-stats.json');
        this.loadStats();
        
        this.client = StigixRegistryClient.fromEnv((usage) => this.handleUsage(usage));
        this.currentIp = this.detectPrivateIp(configDir);
        this.loadStaticLeader();
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

        // 1. Always detect identity for UI visibility
        log('REGISTRY', `Running identity auto-detection...`);
        const identity = await this.autoDetectIdentity();
        this.detectedRole = identity.role;
        this.isBranchGateway = identity.isBg;

        let mode = process.env.STIGIX_REGISTRY_MODE || 'auto';

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

    private async performHeartbeat() {
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
        // 2. Leader Maintenance: Periodic Announcement to Bootstrap (Cloudflare)
        if (mode === 'leader') {
            // Re-announce to Cloudflare every 15 minutes (approx 3 heartbeats at 5-min intervals)
            // This refreshes the 24h lease and prevents takeover by a new leader.
            if (!this.lastAnnounceTime || Date.now() - this.lastAnnounceTime > 15 * 60 * 1000) {
                await this.client.announceLeader(this.currentIp);
                this.lastAnnounceTime = Date.now();
            }
        }

        // Build capabilities based on available services
        const capabilities = {
            voice: true,
            convergence: true,
            xfr: true,
            security: true,
            connectivity: true
        };

        const result = await this.client.register(this.currentIp, capabilities);
        if (result && result.status === 'ok') {
            // Heartbeat successful
        } else if (mode === 'peer' && config.registryUrl !== config.remoteUrl) {
            // FAILURE RECOVERY:
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
            for (const inst of instances) {
                this.peerCache.set(inst.instance_id, {
                    instance: inst,
                    lastSeen: now
                });
            }
        }

        // Fetch shared targets from Leader if we are a Peer connected to Local Leader
        if (mode === 'peer' && config.registryUrl !== config.remoteUrl) {
            this.sharedTargetsCache = await this.client.fetchSharedTargets();
        } else {
            this.sharedTargetsCache = [];
        }
    }

    getSharedTargets() {
        return this.sharedTargetsCache;
    }

    getPeers(): RegistryInstance[] {
        const now = Date.now();
        const GRACE_PERIOD_MS = 15 * 60 * 1000; // 15 minutes

        const activePeers: RegistryInstance[] = [];
        for (const [id, entry] of this.peerCache.entries()) {
            if (now - entry.lastSeen < GRACE_PERIOD_MS) {
                activePeers.push(entry.instance);
            } else {
                // Cleanup old entries
                this.peerCache.delete(id);
            }
        }
        return activePeers;
    }

    getStatus() {
        const config = this.client.getConfig();
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
            current_mode: process.env.STIGIX_REGISTRY_MODE_CURRENT,
            static_leader_url: this.staticLeaderUrl,
            is_static_leader: !!this.staticLeaderUrl,
            stats: this.stats
        };
    }

    stop() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.discoveryInterval) clearInterval(this.discoveryInterval);
    }
}
