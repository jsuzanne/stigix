import path from 'path';
import os from 'os';
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
    private discoveredPeers: RegistryInstance[] = [];
    private currentIp: string = '127.0.0.1';
    private leaderInfo: { ip: string, id: string } | null = null;
    private detectedRole: string | null = null;
    private isBranchGateway: boolean = false;

    constructor(configDir: string) {
        this.client = StigixRegistryClient.fromEnv();
        this.currentIp = this.detectPrivateIp();
    }

    private detectPrivateIp(): string {
        const nets = os.networkInterfaces();
        for (const name of Object.keys(nets)) {
            for (const net of nets[name]!) {
                // Skip internally and non-IPv4
                if (net.family === 'IPv4' && !net.internal) {
                    return net.address;
                }
            }
        }
        return '127.0.0.1';
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
                this.leaderInfo = leader;
                this.client.setLocalRegistry(leader.ip);
                console.log(`[REGISTRY] Local leader discovered at ${leader.ip} (${leader.id})`);
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
                this.leaderInfo = leader;
                this.client.setLocalRegistry(leader.ip);
                console.log(`[REGISTRY] Transitioning to local leader at ${leader.ip}`);
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
        this.discoveredPeers = instances;
    }

    getPeers(): RegistryInstance[] {
        return this.discoveredPeers;
    }

    getStatus() {
        const config = this.client.getConfig();
        return {
            enabled: config.enabled,
            poc_id: config.pocId,
            instance_id: config.instanceId,
            poc_key: config.pocKey,
            is_registered: !!config.pocKey,
            peer_count: this.discoveredPeers.length,
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
