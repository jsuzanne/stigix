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

        console.log(`[REGISTRY] Starting integration for PoC: ${config.pocId}, Instance: ${config.instanceId}`);

        // 1. Initial Registration
        await this.performHeartbeat();

        // 2. Setup Loops
        this.heartbeatInterval = setInterval(() => this.performHeartbeat(), 60000); // 1 min heartbeat
        this.discoveryInterval = setInterval(() => this.performDiscovery(), 30000); // 30s discovery

        // 3. Initial Discovery
        await this.performDiscovery();
    }

    private async performHeartbeat() {
        // Build capabilities based on available services (could be dynamic later)
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
            detected_ip: this.currentIp
        };
    }

    stop() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.discoveryInterval) clearInterval(this.discoveryInterval);
    }
}
