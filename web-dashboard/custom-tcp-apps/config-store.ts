/**
 * Stigix Custom TCP Inter-Site Applications — Config Store (Atomic JSON)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import {
    CustomTcpApplicationsFile,
    CustomTcpApplicationConfig,
    InstanceIdentityConfig
} from './types.js';

export class CustomTcpConfigStore {
    private readonly filePath: string;
    private cachedConfig: CustomTcpApplicationsFile | null = null;

    constructor(configDir: string) {
        this.filePath = path.join(configDir, 'custom-tcp-applications.json');
    }

    /**
     * Loads the configuration from disk or creates default template.
     */
    public async load(defaultSiteName?: string): Promise<CustomTcpApplicationsFile> {
        if (fs.existsSync(this.filePath)) {
            try {
                const data = await fs.promises.readFile(this.filePath, 'utf8');
                const parsed = JSON.parse(data) as CustomTcpApplicationsFile;
                if (parsed && parsed.version && Array.isArray(parsed.applications)) {
                    // Ensure instance identity exists
                    if (!parsed.instance || !parsed.instance.instanceId) {
                        parsed.instance = this.generateDefaultIdentity(defaultSiteName);
                        await this.save(parsed);
                    }
                    this.cachedConfig = parsed;
                    return parsed;
                }
            } catch (err) {
                console.error('[CUSTOM_TCP_CONFIG] Corrupt config file, backing up and recreating:', err);
                const backupPath = `${this.filePath}.backup-${Date.now()}`;
                try { await fs.promises.copyFile(this.filePath, backupPath); } catch {}
            }
        }

        // Initialize default configuration
        const initialConfig: CustomTcpApplicationsFile = {
            version: 1,
            instance: this.generateDefaultIdentity(defaultSiteName),
            applications: [this.generateDefaultSampleApp()]
        };

        await this.save(initialConfig);
        this.cachedConfig = initialConfig;
        return initialConfig;
    }

    /**
     * Atomically saves configuration to disk (write to temp file then rename).
     */
    public async save(config: CustomTcpApplicationsFile): Promise<void> {
        const tempPath = `${this.filePath}.tmp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const jsonStr = JSON.stringify(config, null, 2);

        await fs.promises.writeFile(tempPath, jsonStr, 'utf8');
        await fs.promises.rename(tempPath, this.filePath);
        this.cachedConfig = config;
    }

    public getCached(): CustomTcpApplicationsFile | null {
        return this.cachedConfig;
    }

    /**
     * Strips secrets (e.g. auth tokens) before returning data to the frontend or API GET routes.
     */
    public sanitizeForClient(config: CustomTcpApplicationsFile): any {
        const copy: CustomTcpApplicationsFile = JSON.parse(JSON.stringify(config));
        for (const app of copy.applications) {
            if (app.listener?.auth?.token) {
                app.listener.auth.token = '********';
            }
            if (app.peers) {
                for (const p of app.peers) {
                    if (p.token) p.token = '********';
                }
            }
        }
        return copy;
    }

    private generateDefaultIdentity(siteName?: string): InstanceIdentityConfig {
        return {
            instanceId: crypto.randomUUID(),
            siteName: (siteName || os.hostname()).toUpperCase(),
            hostname: os.hostname(),
            displayName: siteName || os.hostname()
        };
    }

    private generateDefaultSampleApp(): CustomTcpApplicationConfig {
        return {
            id: 'erp-tcp-demo',
            name: 'ERP-TCP-Demo',
            description: 'Sample enterprise ERP transaction simulation',
            enabled: true,
            listener: {
                bindAddress: '0.0.0.0',
                port: 8443,
                maxConnections: 100,
                idleTimeoutMs: 60000,
                maxPayloadBytes: 1048576,
                tcpKeepalive: true,
                allowCidrs: [],
                auth: {
                    enabled: false
                }
            },
            serverBehavior: {
                mode: 'echo',
                fixedDelayMs: 0,
                randomDelayMinMs: 0,
                randomDelayMaxMs: 0,
                loopingNormalSec: 60,
                loopingSlowSec: 60,
                loopingSlowDelayMs: 1000,
                dropProbability: 0,
                errorProbability: 0
            },
            clientDefaults: {
                mode: 'persistent_request_reply',
                connectionsPerPeer: 2,
                intervalMs: 1000,
                payloadBytes: 1024,
                requestTimeoutMs: 5000,
                connectTimeoutMs: 5000,
                autoReconnect: true,
                reconnectInitialMs: 1000,
                reconnectMaxMs: 30000,
                tcpKeepalive: true,
                sourceInterface: 'auto'
            },
            peers: [],
            startup: {
                startListener: true,
                startClientWorkload: false
            }
        };
    }
}
