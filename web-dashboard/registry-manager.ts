import path from 'path';
import os from 'os';
import fs from 'fs';
import net from 'net';
import { spawn } from 'child_process';
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
    private currentIp: string = '127.0.0.1';
    private leaderInfo: { ip: string, id: string } | null = null;
    private detectedRole: string | null = null;
    private isBranchGateway: boolean = false;

    constructor(configDir: string) {
        this.client = StigixRegistryClient.fromEnv();
        this.currentIp = this.detectPrivateIp(configDir);
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
                        console.log(`[REGISTRY] Selected IP from interfaces.txt (${ifaceName}): ${ipv4.address}`);
                        return ipv4.address;
                    }
                }
            }
        } catch (e) {
            console.warn(`[REGISTRY] Failed to read interfaces.txt for IP detection:`, e);
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

            console.log(`[REGISTRY] Running identity auto-detection via ${scriptPath}...`);

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
            console.log(`[REGISTRY] Disabled by configuration.`);
            return;
        }

        // 1. Always detect identity for UI visibility
        console.log(`[REGISTRY] Running identity auto-detection...`);
        const identity = await this.autoDetectIdentity();
        this.detectedRole = identity.role;
        this.isBranchGateway = identity.isBg;

        let mode = process.env.STIGIX_REGISTRY_MODE || 'auto';

        if (mode === 'auto') {
            // Logic: Hub OR Branch Gateway => Potential Leader
            if (this.detectedRole === 'HUB' || this.isBranchGateway) {
                console.log(`[REGISTRY] Auto-detected as HUB/BG. Promoting to LEADER candidate.`);
                mode = 'leader';
            } else {
                console.log(`[REGISTRY] Auto-detected as ${this.detectedRole || 'UNKNOWN'}. Defaulting to PEER.`);
                mode = 'peer';
            }
        } else {
            console.log(`[REGISTRY] Manual Mode Override: ${mode.toUpperCase()}`);
        }

        console.log(`[REGISTRY] Final Role: ${mode.toUpperCase()} for PoC: ${config.pocId}`);

        if (mode === 'leader') {
            // Leader Mode: Announce ourselves to Bootstrap Signal
            await this.client.announceLeader(this.currentIp);
            // Switch heartbeats to local server (self)
            this.client.setLocalRegistry('127.0.0.1');
        } else {
            // Peer Mode: Try to find local leader via Bootstrap
            const leader = await this.client.findLeader();
            if (leader) {
                console.log(`[REGISTRY] Local leader discovered at ${leader.ip}. Verifying reachability...`);
                const isOpen = await this.isPortOpen(leader.ip, 8080); // Default port

                if (isOpen) {
                    this.leaderInfo = leader;
                    this.client.setLocalRegistry(leader.ip);
                    console.log(`[REGISTRY] Local leader reached successfully. Switching to local mode.`);
                } else {
                    console.warn(`[REGISTRY] Local leader ${leader.ip} found but port 8080 is unreachable. Falling back to Cloudflare.`);
                }
            } else {
                console.log(`[REGISTRY] No local leader found. Using remote bootstrap (Cloudflare).`);
            }
        }

        // Store the determined mode in current process env for later heartbeat checks
        process.env.STIGIX_REGISTRY_MODE_CURRENT = mode;

        // 1. Initial Registration
        await this.performHeartbeat();

        // 2. Setup Loops
        const heartbeatMs = (config.heartbeatIntervalSec || 300) * 1000;
        const discoveryMs = (config.discoveryIntervalSec || 120) * 1000;

        this.heartbeatInterval = setInterval(() => this.performHeartbeat(), heartbeatMs);
        this.discoveryInterval = setInterval(() => this.performDiscovery(), discoveryMs);

        // 3. Initial Discovery
        await this.performDiscovery();
    }

    private async performHeartbeat() {
        const config = this.client.getConfig();
        const mode = process.env.STIGIX_REGISTRY_MODE_CURRENT || 'peer';

        // 1. Peer Recovery: If using Remote, try to find a Local Leader
        if (mode === 'peer' && config.registryUrl === config.remoteUrl) {
            const leader = await this.client.findLeader();
            if (leader) {
                const isOpen = await this.isPortOpen(leader.ip, 8080);
                if (isOpen) {
                    this.leaderInfo = leader;
                    this.client.setLocalRegistry(leader.ip);
                    console.log(`[REGISTRY] Transitioning to local leader at ${leader.ip}`);
                } else {
                    // Leader found but not reachable, so we can't use it.
                    // Fall through to the "no leader found" logic.
                    console.log(`[REGISTRY] Local leader ${leader.ip} found but port 8080 is unreachable. Skipping registration.`);
                    // Safeguard: If no leader is found, do NOT register (POST) to Cloudflare.
                    // This ensures Cloudflare is only contacted in READ ONLY mode (findLeader/fetchInstances).
                    console.log(`[REGISTRY] No local leader found. Skipping registration to save Cloudflare KV Quota.`);
                    return;
                }
            } else {
                // Safeguard: If no leader is found, do NOT register (POST) to Cloudflare.
                // This ensures Cloudflare is only contacted in READ ONLY mode (findLeader/fetchInstances).
                console.log(`[REGISTRY] No local leader found. Skipping registration to save Cloudflare KV Quota.`);
                return;
            }
        }

        // 2. Leader Maintenance: Periodic Announcement to Bootstrap (Cloudflare)
        if (mode === 'leader') {
            // Re-announce to Cloudflare occasionally (20% of heartbeats)
            if (Math.random() > 0.8) {
                await this.client.announceLeader(this.currentIp);
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
            console.log(`[REGISTRY] Local Leader heartbeat failed. Reverting to remote discovery...`);
            this.client.resetToRemote();
            this.leaderInfo = null;
        }
    }

    private async performDiscovery() {
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
            current_mode: process.env.STIGIX_REGISTRY_MODE_CURRENT
        };
    }

    stop() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.discoveryInterval) clearInterval(this.discoveryInterval);
    }
}
