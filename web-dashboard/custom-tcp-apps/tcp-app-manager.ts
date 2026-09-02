/**
 * Stigix Custom TCP Inter-Site Applications — Central Manager Singleton
 * Coordinates server runtimes, client runtimes, metrics, history, and config lifecycle.
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import {
    CustomTcpApplicationConfig,
    CustomTcpApplicationsFile,
    AppRuntimeMetrics,
    IncomingSessionState,
    OutgoingSessionState,
    RunHistoryRecord
} from './types.js';
import { CustomTcpConfigStore } from './config-store.js';
import { CustomTcpHistoryStore } from './history-store.js';
import { AppMetricsTracker } from './metrics.js';
import { TcpServerRuntime } from './tcp-server-runtime.js';
import { TcpClientRuntime } from './tcp-client-runtime.js';
import { validateApplicationConfig, checkHostPortAvailable } from './validation.js';

interface AppInstanceContext {
    config: CustomTcpApplicationConfig;
    metrics: AppMetricsTracker;
    serverRuntime: TcpServerRuntime;
    clientRuntime: TcpClientRuntime;
    clientRunStartTs?: number;
    clientTargetedPeers?: string[];
}

export class TcpAppManager extends EventEmitter {
    private readonly configStore: CustomTcpConfigStore;
    private readonly historyStore: CustomTcpHistoryStore;
    private readonly appInstances = new Map<string, AppInstanceContext>();
    private isInitialized: boolean = false;

    constructor(configDir: string) {
        super();
        this.configStore = new CustomTcpConfigStore(configDir);
        this.historyStore = new CustomTcpHistoryStore(configDir);
    }

    public async init(defaultSiteName?: string, autoRestart: boolean = true): Promise<void> {
        if (this.isInitialized) return;

        const config = await this.configStore.load(defaultSiteName);

        for (const app of config.applications) {
            this.registerAppInstance(app, config.instance);
        }

        // Handle auto-start on initialization if autoRestart is enabled
        if (autoRestart) {
            for (const app of config.applications) {
                if (app.enabled !== false) {
                    // Start listener if startListener is true (default true)
                    if (app.startup?.startListener !== false) {
                        this.startListener(app.id, false).catch(err => {
                            console.error(`[CUSTOM_TCP_MGR] Failed to autostart listener for "${app.name}":`, err.message);
                        });
                    }
                    // Resume client workload if startClientWorkload was active
                    if (app.startup?.startClientWorkload === true) {
                        this.startClient(app.id, undefined, false).catch(err => {
                            console.error(`[CUSTOM_TCP_MGR] Failed to autostart client for "${app.name}":`, err.message);
                        });
                    }
                }
            }
        }

        this.isInitialized = true;
    }

    public getConfig(): CustomTcpApplicationsFile {
        const cached = this.configStore.getCached();
        if (!cached) throw new Error('Config not loaded');
        return cached;
    }

    public getSanitizedConfig(): any {
        const config = this.getConfig();
        return this.configStore.sanitizeForClient(config);
    }

    public async updateSiteName(newSiteName: string): Promise<void> {
        const trimmed = newSiteName.trim();
        if (!trimmed) return;
        await this.configStore.updateSiteName(trimmed);
        const config = this.getConfig();
        if (config && config.instance) {
            config.instance.siteName = trimmed;
            config.instance.displayName = trimmed;
            for (const [, ctx] of this.appInstances.entries()) {
                if (ctx.serverRuntime) ctx.serverRuntime.updateIdentity(config.instance);
                if (ctx.clientRuntime) ctx.clientRuntime.updateIdentity(config.instance);
            }
        }
    }

    public async saveApplication(app: CustomTcpApplicationConfig): Promise<void> {
        const file = this.getConfig();
        const validation = validateApplicationConfig(app, file.applications);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join('; ')}`);
        }

        const existingIdx = file.applications.findIndex(a => a.id === app.id);
        const prevApp = existingIdx >= 0 ? file.applications[existingIdx] : null;

        if (existingIdx >= 0) {
            file.applications[existingIdx] = app;
        } else {
            file.applications.push(app);
        }

        await this.configStore.save(file);

        // Update runtime instance
        const ctx = this.appInstances.get(app.id);
        if (ctx) {
            const portChanged = prevApp && prevApp.listener?.port !== app.listener?.port;
            const wasListening = ctx.metrics.listenerState === 'listening';

            if (portChanged) {
                // If port changed, stop old listener and cleanly migrate to new port
                await ctx.serverRuntime.stop();
                this.registerAppInstance(app, file.instance);
                if (wasListening || (app.enabled && app.startup?.startListener !== false)) {
                    await this.startListener(app.id, false).catch(err => {
                        console.error(`[CUSTOM_TCP_MGR] Failed to restart listener on new port ${app.listener?.port}:`, err.message);
                    });
                }
            } else {
                // Seamless hot-update of behavior, peers, and timeouts without port restart
                ctx.config = app;
                ctx.metrics.appName = app.name;
                ctx.metrics.port = app.listener.port;
                ctx.serverRuntime.updateConfig(app);
                ctx.clientRuntime.updateConfig(app);
            }
        } else {
            this.registerAppInstance(app, file.instance);
            if (app.enabled && app.startup?.startListener !== false) {
                await this.startListener(app.id, false).catch(() => {});
            }
        }

        this.emit('config_updated', app);
    }

    public async deleteApplication(appId: string): Promise<void> {
        const file = this.getConfig();
        const idx = file.applications.findIndex(a => a.id === appId);
        if (idx < 0) throw new Error(`Application ${appId} not found`);

        const ctx = this.appInstances.get(appId);
        if (ctx) {
            await ctx.clientRuntime.stop();
            await ctx.serverRuntime.stop();
            this.appInstances.delete(appId);
        }

        file.applications.splice(idx, 1);
        await this.configStore.save(file);
        this.emit('app_deleted', appId);
    }

    public async startListener(appId: string, persist: boolean = true): Promise<void> {
        const ctx = this.appInstances.get(appId);
        if (!ctx) throw new Error(`Application ${appId} not registered`);

        // Check if port is free before starting
        const port = ctx.config.listener.port;
        const available = await checkHostPortAvailable(port, ctx.config.listener.bindAddress);
        if (!available) {
            ctx.metrics.listenerState = 'port_conflict';
            ctx.metrics.listenerError = `Port ${port} is already in use on the host network.`;
            throw new Error(`Port ${port} is occupied on the host`);
        }

        await ctx.serverRuntime.start();

        if (persist) {
            ctx.config.startup = {
                startListener: true,
                startClientWorkload: ctx.config.startup?.startClientWorkload ?? false
            };
            await this.persistAppStartupState(appId);
        }

        this.emit('state_changed', { appId, type: 'listener_started' });
    }

    public async stopListener(appId: string, persist: boolean = true): Promise<void> {
        const ctx = this.appInstances.get(appId);
        if (!ctx) throw new Error(`Application ${appId} not registered`);
        await ctx.serverRuntime.stop();

        if (persist) {
            ctx.config.startup = {
                startListener: false,
                startClientWorkload: ctx.config.startup?.startClientWorkload ?? false
            };
            await this.persistAppStartupState(appId);
        }

        this.emit('state_changed', { appId, type: 'listener_stopped' });
    }

    public async startClient(appId: string, targetedPeerIds?: string[], persist: boolean = true): Promise<void> {
        const ctx = this.appInstances.get(appId);
        if (!ctx) throw new Error(`Application ${appId} not registered`);

        ctx.clientRunStartTs = Date.now();
        ctx.clientTargetedPeers = targetedPeerIds;
        await ctx.clientRuntime.start(targetedPeerIds);

        if (persist) {
            ctx.config.startup = {
                startListener: ctx.config.startup?.startListener ?? true,
                startClientWorkload: true
            };
            await this.persistAppStartupState(appId);
        }

        this.emit('state_changed', { appId, type: 'client_started' });
    }

    public async stopClient(appId: string, persist: boolean = true): Promise<void> {
        const ctx = this.appInstances.get(appId);
        if (!ctx) throw new Error(`Application ${appId} not registered`);

        await ctx.clientRuntime.stop();

        // Record run history record
        if (ctx.clientRunStartTs) {
            const durationSec = Math.round((Date.now() - ctx.clientRunStartTs) / 1000);
            const outgoing = ctx.clientRuntime.getOutgoingSessions();
            const record: RunHistoryRecord = {
                id: `run-${crypto.randomUUID().substring(0, 8)}`,
                appId,
                appName: ctx.config.name,
                startedAt: new Date(ctx.clientRunStartTs).toISOString(),
                endedAt: new Date().toISOString(),
                durationSec,
                targetedPeers: ctx.clientTargetedPeers || ctx.config.peers.map(p => p.name),
                desiredConnections: outgoing.length,
                totalTxBytes: ctx.metrics.totalTxBytes,
                totalRxBytes: ctx.metrics.totalRxBytes,
                totalRequests: ctx.metrics.totalRequests,
                totalResponses: ctx.metrics.totalResponses,
                totalTimeouts: ctx.metrics.totalTimeouts,
                totalErrors: ctx.metrics.totalErrors,
                totalReconnects: ctx.metrics.totalReconnects,
                rttStats: {
                    last: ctx.metrics.avgRttMs,
                    min: 0,
                    avg: ctx.metrics.avgRttMs,
                    p50: ctx.metrics.avgRttMs,
                    p95: ctx.metrics.p95RttMs,
                    max: 0,
                    samples: ctx.metrics.totalResponses
                },
                status: 'completed',
                summary: `Completed run with ${ctx.metrics.totalResponses} replies and ${ctx.metrics.totalTimeouts} timeouts`
            };
            await this.historyStore.appendRecord(record);
            ctx.clientRunStartTs = undefined;
        }

        if (persist) {
            ctx.config.startup = {
                startListener: ctx.config.startup?.startListener ?? true,
                startClientWorkload: false
            };
            await this.persistAppStartupState(appId);
        }

        this.emit('state_changed', { appId, type: 'client_stopped' });
    }

    private async persistAppStartupState(appId: string): Promise<void> {
        try {
            const file = this.configStore.getCached();
            if (!file) return;
            const app = file.applications.find(a => a.id === appId);
            const ctx = this.appInstances.get(appId);
            if (app && ctx) {
                app.startup = {
                    startListener: ctx.config.startup?.startListener ?? true,
                    startClientWorkload: ctx.config.startup?.startClientWorkload ?? false
                };
                await this.configStore.save(file);
            }
        } catch (e: any) {
            console.error(`[CUSTOM_TCP_MGR] Failed to persist startup state for app "${appId}":`, e.message);
        }
    }

    public async testPeer(appId: string, peerId: string): Promise<{
        success: boolean;
        rttMs?: number;
        responder?: any;
        error?: string;
    }> {
        const ctx = this.appInstances.get(appId);
        if (!ctx) throw new Error(`Application ${appId} not found`);

        const peer = ctx.config.peers.find(p => p.id === peerId);
        if (!peer) throw new Error(`Peer ${peerId} not found in application ${appId}`);

        return ctx.clientRuntime.testPeerHandshake(peer);
    }

    public getAppStatus(appId: string): AppRuntimeMetrics {
        const ctx = this.appInstances.get(appId);
        if (!ctx) throw new Error(`Application ${appId} not found`);

        const inCount = ctx.serverRuntime.getActiveSessionsCount();
        const outCount = ctx.clientRuntime.getActiveSessionsCount();
        return ctx.metrics.getSnapshot(inCount, outCount);
    }

    public getAllAppsStatus(): AppRuntimeMetrics[] {
        return Array.from(this.appInstances.keys()).map(id => this.getAppStatus(id));
    }

    public getIncomingSessions(appId: string): IncomingSessionState[] {
        const ctx = this.appInstances.get(appId);
        if (!ctx) return [];
        return ctx.serverRuntime.getIncomingSessions();
    }

    public getOutgoingSessions(appId: string): OutgoingSessionState[] {
        const ctx = this.appInstances.get(appId);
        if (!ctx) return [];
        return ctx.clientRuntime.getOutgoingSessions();
    }

    public async getHistory(appId?: string, limit: number = 50): Promise<RunHistoryRecord[]> {
        return this.historyStore.getRecords(appId, limit);
    }

    public async hotReload(newApps?: CustomTcpApplicationConfig[]): Promise<void> {
        const file = await this.configStore.load();
        if (newApps && Array.isArray(newApps)) {
            file.applications = newApps;
            await this.configStore.save(file);
        }

        const newAppMap = new Map<string, CustomTcpApplicationConfig>(file.applications.map(a => [a.id, a]));

        // 1. Stop and remove deleted applications
        for (const [id, ctx] of Array.from(this.appInstances.entries())) {
            if (!newAppMap.has(id)) {
                try { await ctx.clientRuntime.stop(); } catch {}
                try { await ctx.serverRuntime.stop(); } catch {}
                this.appInstances.delete(id);
                this.emit('app_deleted', id);
            }
        }

        // 2. Update or register new applications
        for (const app of file.applications) {
            const ctx = this.appInstances.get(app.id);
            if (ctx) {
                const prevPort = ctx.config.listener?.port;
                const newPort = app.listener?.port;
                ctx.config = app;
                ctx.metrics.appName = app.name;
                ctx.metrics.port = app.listener?.port;

                if (prevPort !== newPort && ctx.metrics.listenerState === 'listening') {
                    await ctx.serverRuntime.stop();
                    this.registerAppInstance(app, file.instance);
                    if (app.enabled && app.startup?.startListener !== false) {
                        await this.startListener(app.id).catch(() => {});
                    }
                }

                // If startClientWorkload is active and client is not running, auto-start client traffic
                if (app.enabled && app.startup?.startClientWorkload === true && ctx.metrics.clientSessionCount === 0 && (app.peers || []).length > 0) {
                    this.startClient(app.id).catch(err => {
                        console.error(`[CUSTOM_TCP_MGR] Hot-reload client autostart failed for "${app.name}":`, err.message);
                    });
                }
            } else {
                this.registerAppInstance(app, file.instance);
                if (app.enabled) {
                    if (app.startup?.startListener !== false) {
                        this.startListener(app.id).catch(err => {
                            console.error(`[CUSTOM_TCP_MGR] Hot-reload listener failed for "${app.name}":`, err.message);
                        });
                    }
                    if (app.startup?.startClientWorkload === true && (app.peers || []).length > 0) {
                        this.startClient(app.id).catch(err => {
                            console.error(`[CUSTOM_TCP_MGR] Hot-reload client failed for "${app.name}":`, err.message);
                        });
                    }
                }
            }
            this.emit('config_updated', app);
        }
    }

    public async stopAll(): Promise<void> {
        for (const ctx of this.appInstances.values()) {
            try { await ctx.clientRuntime.stop(); } catch {}
            try { await ctx.serverRuntime.stop(); } catch {}
        }
        this.appInstances.clear();
    }

    private registerAppInstance(app: CustomTcpApplicationConfig, identity: any): void {
        const metrics = new AppMetricsTracker(app.id, app.name, app.listener.port);
        const serverRuntime = new TcpServerRuntime(app, identity, metrics);
        const clientRuntime = new TcpClientRuntime(app, identity, metrics);

        this.appInstances.set(app.id, {
            config: app,
            metrics,
            serverRuntime,
            clientRuntime
        });
    }
}
