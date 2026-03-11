import crypto from 'node:crypto';
import os from 'node:os';

/**
 * StigixRegistryClient — A standalone library to interface with the Stigix Registry (Cloudflare Worker).
 * Handles auto-registration, heartbeats, and peer discovery.
 */

export interface RegistryConfig {
    enabled: boolean;
    registryUrl: string;
    pocId: string | null;
    instanceId: string;
    siteName?: string;
    region?: string;
    instanceType?: string;
    apiKey?: string; // Global shared key (optional)
    clientId?: string; // Prisma Client ID (shared secret for hash)
    pocKey?: string; // PoC-specific key (derived or received)
    heartbeatIntervalSec?: number;
    discoveryIntervalSec?: number;
    remoteUrl?: string; // Original Cloudflare URL
}

export interface RegistryInstance {
    poc_id: string;
    instance_id: string;
    type: string;
    ip_private: string;
    ip_public?: string;
    location?: {
        country?: string;
        city?: string;
    };
    capabilities?: {
        voice?: boolean;
        convergence?: boolean;
        xfr?: boolean;
        security?: boolean;
        connectivity?: boolean;
        [key: string]: any;
    };
    meta?: {
        site?: string;
        region?: string;
        vendor?: string;
        version?: string;
        [key: string]: any;
    };
    last_seen?: string;
}

export class StigixRegistryClient {
    private config: RegistryConfig;

    constructor(config: RegistryConfig) {
        this.config = config;
        // Auto-derive PoC key if possible
        if (!this.config.pocKey && this.config.pocId && this.config.clientId) {
            this.config.pocKey = this.derivePoCKey(this.config.pocId, this.config.clientId);
        }
        this.config.remoteUrl = this.config.registryUrl;
    }

    /**
     * Derives a stable PoC Key from shared secrets.
     * This makes discovery "stateless" for instances sharing the same credentials.
     */
    private derivePoCKey(pocId: string, clientId: string): string {
        return crypto.createHash('md5').update(`${pocId}:${clientId}:stigix-v1`).digest('hex');
    }

    /**
     * Factory method to create a client from environment variables.
     */
    static fromEnv(): StigixRegistryClient {
        const pocId = process.env.PRISMA_SDWAN_TSGID || null;
        const clientId = process.env.PRISMA_SDWAN_CLIENT_ID;

        // Auto-enable logic:
        const explicitToggle = process.env.STIGIX_REGISTRY_ENABLED;
        const enabled = explicitToggle === 'true' ||
            (explicitToggle !== 'false' && !!pocId && !!clientId);

        const registryUrl = process.env.STIGIX_REGISTRY_URL || 'https://stigix-registry.jlsuzanne.workers.dev';

        const hostname = os.hostname();
        const siteName = process.env.STIGIX_SITE_NAME || process.env.STIGIX_INSTANCE_ID || hostname;
        const instanceId = process.env.STIGIX_INSTANCE_ID || process.env.STIGIX_SITE_NAME || hostname;

        const region = process.env.PRISMA_SDWAN_REGION;
        const instanceType = process.env.STIGIX_INSTANCE_TYPE || 'docker';
        const apiKey = process.env.STIGIX_REGISTRY_API_KEY;

        return new StigixRegistryClient({
            enabled,
            registryUrl,
            pocId,
            instanceId,
            siteName,
            region,
            instanceType,
            apiKey,
            clientId,
            heartbeatIntervalSec: parseInt(process.env.STIGIX_REGISTRY_HEARTBEAT_SEC || '300'),
            discoveryIntervalSec: parseInt(process.env.STIGIX_REGISTRY_DISCOVERY_SEC || '120')
        });
    }

    getConfig(): RegistryConfig {
        return this.config;
    }

    setPoCKey(key: string) {
        this.config.pocKey = key;
    }

    private getHeaders() {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (this.config.apiKey) {
            headers['X-Api-Key'] = this.config.apiKey;
        }
        if (this.config.pocKey) {
            headers['X-PoC-Key'] = this.config.pocKey;
        }
        return headers;
    }

    async register(ipPrivate: string, capabilities: RegistryInstance["capabilities"] = {}): Promise<any | null> {
        if (!this.config.enabled || !this.config.pocId) return null;

        const payload = {
            poc_id: this.config.pocId,
            instance_id: this.config.instanceId,
            type: this.config.instanceType,
            ip_private: ipPrivate,
            capabilities,
            meta: {
                site: this.config.siteName,
                region: this.config.region,
                vendor: 'stigix',
                version: '1.2.1'
            }
        };

        try {
            const res = await fetch(`${this.config.registryUrl}/register`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                console.error(`[REGISTRY] Registration failed: ${res.status} ${await res.text()}`);
                return null;
            }

            const data = await res.json();
            if (data.poc_key) {
                this.config.pocKey = data.poc_key;
            }
            return data;
        } catch (e) {
            console.error(`[REGISTRY] Network error during registration:`, e);
            return null;
        }
    }

    async fetchInstances(): Promise<RegistryInstance[]> {
        if (!this.config.enabled || !this.config.pocId) return [];

        const url = new URL(`${this.config.registryUrl}/instances`);
        url.searchParams.set('poc_id', this.config.pocId);
        url.searchParams.set('scope', 'others');
        url.searchParams.set('self_instance_id', this.config.instanceId);

        try {
            const res = await fetch(url.toString(), {
                headers: this.getHeaders()
            });

            if (!res.ok) {
                if (res.status === 403) {
                    console.warn(`[REGISTRY] Discovery forbidden. PoC Key may be invalid or missing.`);
                } else {
                    console.error(`[REGISTRY] Fetch instances failed: ${res.status}`);
                }
                return [];
            }

            const data = await res.json();
            return data.instances || [];
        } catch (e) {
            console.error(`[REGISTRY] Network error during discovery:`, e);
            return [];
        }
    }

    async announceLeader(localIp: string): Promise<boolean> {
        if (!this.config.pocId || !this.config.remoteUrl) return false;

        try {
            const res = await fetch(`${this.config.remoteUrl}/leader`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({
                    poc_id: this.config.pocId,
                    leader_ip: localIp
                })
            });
            return res.ok;
        } catch (e) {
            console.error(`[REGISTRY] Failed to announce leader:`, e);
            return false;
        }
    }

    async findLeader(): Promise<string | null> {
        if (!this.config.pocId || !this.config.remoteUrl) return null;

        try {
            const url = new URL(`${this.config.remoteUrl}/leader`);
            url.searchParams.set('poc_id', this.config.pocId);

            const res = await fetch(url.toString(), {
                headers: this.getHeaders()
            });

            if (!res.ok) return null;
            const data = await res.json();
            return data.leader_ip || null;
        } catch (e) {
            console.error(`[REGISTRY] Failed to find leader:`, e);
            return null;
        }
    }

    setLocalRegistry(leaderIp: string, port: number = 5000) {
        this.config.registryUrl = `http://${leaderIp}:${port}/api/registry`;
        console.log(`[REGISTRY] Switched to Local Leader: ${this.config.registryUrl}`);
    }

    resetToRemote() {
        if (this.config.remoteUrl) {
            this.config.registryUrl = this.config.remoteUrl;
            console.log(`[REGISTRY] Reset to Remote Bootstrap: ${this.config.registryUrl}`);
        }
    }
}
