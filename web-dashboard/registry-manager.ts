import path from 'path';
import { StigixRegistryClient, RegistryInstance } from './stigix-registry-client.js';
import os from 'os';

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

    async start() {
        const config = this.client.getConfig();
        if (!config.enabled) {
            console.log(`[REGISTRY] Disabled by configuration.`);
            return;
        }

        const mode = process.env.STIGIX_REGISTRY_MODE || 'peer';
        console.log(`[REGISTRY] Starting in ${mode.toUpperCase()} mode for PoC: ${config.pocId}`);

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
            } else {
                console.log(`[REGISTRY] No local leader found. Using remote bootstrap for now.`);
            }
        }

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
        const mode = process.env.STIGIX_REGISTRY_MODE || 'peer';

        // 1. Peer Recovery: If using Remote, try to find a Local Leader
        if (mode === 'peer' && config.registryUrl === config.remoteUrl) {
            const leader = await this.client.findLeader();
            if (leader) {
                this.leaderInfo = leader;
                this.client.setLocalRegistry(leader.ip);
            }
        }

        // 2. Leader Maintenance: Periodic Announcement to Bootstrap (Cloudflare)
        if (mode === 'leader') {
            // Every heartbeat is local, but re-announce to Cloudflare occasionally
            // Using a simple Math.random() or counter to avoid spamming
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
        }
    }

    private async performDiscovery() {
        const instances = await this.client.fetchInstances();
        this.discoveredPeers = instances;
        // console.log(`[REGISTRY] Discovered ${instances.length} peers.`);
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
            leader_info: this.leaderInfo
        };
    }

    stop() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.discoveryInterval) clearInterval(this.discoveryInterval);
    }
}
