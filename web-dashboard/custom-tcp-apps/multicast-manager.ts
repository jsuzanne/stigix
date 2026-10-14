/**
 * Stigix SD-WAN Overlay Multicast Validation — Cluster & Local Manager
 * Coordinates local UDP/IGMP sender/receiver runtimes, config persistence,
 * and cluster-wide Leader -> Peer fan-out orchestration.
 */

import crypto from 'crypto';
import os from 'os';
import {
    CustomMulticastApplicationConfig,
    MulticastSenderStats,
    MulticastReceiverStats,
    MulticastNodePreflightResult,
    MulticastClusterStatus,
    MulticastHealthVerdict,
    MulticastExpectationMode
} from './types.js';
import { CustomTcpConfigStore } from './config-store.js';
import { validateMulticastApplicationConfig } from './validation.js';
import {
    MulticastSenderRuntime,
    MulticastReceiverRuntime,
    inspectLocalMulticastPreflight,
    computeStreamId
} from './multicast-runtime.js';

export type ClusterNodeForwarder = (
    nodeId: string,
    method: 'GET' | 'POST',
    subPath: string,
    body?: any
) => Promise<any>;

export type LocalNodeMatcher = (nodeId: string) => boolean;

export class MulticastAppManager {
    private readonly configStore: CustomTcpConfigStore;
    private readonly activeSenders = new Map<string, MulticastSenderRuntime>();
    private readonly activeReceivers = new Map<string, MulticastReceiverRuntime>();
    private readonly activeClusterStreams = new Map<string, { startedAt: number }>();
    private readonly runtimeConfigCache = new Map<string, CustomMulticastApplicationConfig>();

    private nodeForwarder?: ClusterNodeForwarder;
    private localNodeMatcher?: LocalNodeMatcher;
    private getLocalSiteNameFn?: () => string;

    constructor(configStore: CustomTcpConfigStore) {
        this.configStore = configStore;
    }

    public setClusterHooks(options: {
        nodeForwarder: ClusterNodeForwarder;
        localNodeMatcher: LocalNodeMatcher;
        getLocalSiteName?: () => string;
    }): void {
        this.nodeForwarder = options.nodeForwarder;
        this.localNodeMatcher = options.localNodeMatcher;
        this.getLocalSiteNameFn = options.getLocalSiteName;
    }

    public getLocalNodeId(): string {
        if (this.getLocalSiteNameFn) {
            const name = this.getLocalSiteNameFn();
            if (name && name.trim()) return name.trim();
        }
        const cached = this.configStore.getCached();
        if (cached?.instance?.siteName) return cached.instance.siteName;
        return this.configStore.getResolvedSiteName() || os.hostname();
    }

    public isLocalNode(nodeId: string): boolean {
        if (!nodeId || nodeId === 'local' || nodeId === 'localhost' || nodeId === '127.0.0.1') {
            return true;
        }
        if (this.localNodeMatcher && this.localNodeMatcher(nodeId)) {
            return true;
        }
        const localSite = this.getLocalNodeId().toLowerCase();
        const cached = this.configStore.getCached();
        const instanceId = cached?.instance?.instanceId?.toLowerCase();
        const hostname = os.hostname().toLowerCase();
        const target = nodeId.trim().toLowerCase();

        return target === localSite || target === instanceId || target === hostname;
    }

    /**
     * Normalizes either flat CustomMulticastApplicationConfig or legacy nested { multicast, sender } input.
     */
    private normalizeAppConfig(input: any): CustomMulticastApplicationConfig {
        const mc = input?.multicast || input || {};
        const senderObj = input?.sender || {};
        const rawMode = String(mc.mode || input?.mode || 'asm').toLowerCase();
        const mode = rawMode === 'ssm' ? 'ssm' : 'asm';

        const rawRateMode = String(input?.rate?.mode || mc.profile || 'cbr').toLowerCase();
        const rateMode = rawRateMode === 'burst' ? 'burst' : 'cbr';
        const kbps = Number(input?.rate?.kbps ?? mc.bitrateKbps ?? input?.kbps ?? 1000) || 1000;
        const burstPackets = Number(input?.rate?.burstPackets ?? mc.burstSizePackets ?? 10) || 10;
        const burstIntervalMs = Number(input?.rate?.burstIntervalMs ?? mc.burstIntervalMs ?? 1000) || 1000;

        const senderNode = String(input?.senderNode || senderObj.nodeId || senderObj.node || this.getLocalNodeId()).trim();
        const senderInterfaceIp = (input?.senderInterfaceIp ?? senderObj.interfaceIp ?? 'auto') || 'auto';

        const receivers = Array.isArray(input?.receivers)
            ? input.receivers.map((r: any) => {
                const node = String(r.node || r.nodeId || '').trim();
                const rawExpect = String(r.expect || 'traffic').toLowerCase();
                const expect: MulticastExpectationMode = rawExpect === 'none' ? 'none' : 'traffic';
                return {
                    node,
                    expect,
                    interfaceIp: r.interfaceIp ? String(r.interfaceIp).trim() : 'auto',
                    enabled: r.enabled !== false
                };
            }).filter((r: any) => Boolean(r.node))
            : [];

        const appId = input?.id?.trim() || `mc-${crypto.randomUUID().substring(0, 6)}`;
        return {
            id: appId,
            name: String(input?.name || 'Multicast Stream').trim(),
            description: input?.description || '',
            enabled: input?.enabled !== false,
            group: String(mc.group || input?.group || '239.1.1.100').trim(),
            port: Number(mc.port ?? input?.port) || 5001,
            mode,
            ssmSource: mode === 'ssm' ? (String(mc.ssmSource || input?.ssmSource || '').trim() || undefined) : undefined,
            senderNode,
            senderInterfaceIp: String(senderInterfaceIp).trim(),
            receivers,
            rate: {
                mode: rateMode,
                kbps,
                burstPackets,
                burstIntervalMs
            },
            payloadBytes: Number(input?.payloadBytes ?? mc.packetSizeBytes) || 1200,
            ttl: mc.ttl !== undefined ? Number(mc.ttl) : (input?.ttl !== undefined ? Number(input.ttl) : 8),
            dscp: String(mc.dscp || input?.dscp || 'EF').trim().toUpperCase(),
            durationSec: Number(input?.durationSec) || 0,
            thresholds: {
                maxLossPct: input?.thresholds?.maxLossPct !== undefined ? Number(input.thresholds.maxLossPct) : 0.1,
                degradedLossPct: input?.thresholds?.degradedLossPct !== undefined ? Number(input.thresholds.degradedLossPct) : 2.0,
                maxGapMs: input?.thresholds?.maxGapMs !== undefined ? Number(input.thresholds.maxGapMs) : 3000
            }
        };
    }

    // ─── Configuration CRUD ───────────────────────────────────────────────────

    public listApplications(): CustomMulticastApplicationConfig[] {
        const file = this.configStore.getCached();
        if (!file) return [];
        if (!Array.isArray(file.multicastApplications)) {
            file.multicastApplications = [];
        }
        return file.multicastApplications.map(a => this.normalizeAppConfig(a));
    }

    public getApplication(idOrName: string): CustomMulticastApplicationConfig | undefined {
        const list = this.listApplications();
        const found = list.find(
            a => a.id === idOrName || a.name.toLowerCase() === idOrName.toLowerCase()
        );
        if (found) return found;
        return this.runtimeConfigCache.get(idOrName);
    }

    public async saveApplication(input: any): Promise<CustomMulticastApplicationConfig> {
        const file = this.configStore.getCached() || await this.configStore.load();
        if (!Array.isArray(file.multicastApplications)) {
            file.multicastApplications = [];
        }

        const app = this.normalizeAppConfig(input);
        const validation = validateMulticastApplicationConfig(app, file.multicastApplications);
        if (!validation.valid) {
            throw new Error(`Multicast validation failed: ${validation.errors.join('; ')}`);
        }

        const existingIdx = file.multicastApplications.findIndex(a => a.id === app.id);
        if (existingIdx >= 0) {
            file.multicastApplications[existingIdx] = app;
        } else {
            file.multicastApplications.push(app);
        }

        this.runtimeConfigCache.set(app.id, app);
        await this.configStore.save(file);

        // Update active local runtimes if any
        const activeSender = this.activeSenders.get(app.id);
        if (activeSender) {
            activeSender.updateConfig(app, this.getLocalNodeId());
        }
        const activeReceiver = this.activeReceivers.get(app.id);
        if (activeReceiver) {
            const localNodeId = this.getLocalNodeId();
            const rcvCfg = app.receivers.find(r => r.node.toLowerCase() === localNodeId.toLowerCase());
            activeReceiver.updateConfig(app, localNodeId, rcvCfg?.expect, rcvCfg?.interfaceIp);
        }

        return app;
    }

    public async deleteApplication(appId: string): Promise<void> {
        await this.stopLocalSender(appId).catch(() => {});
        await this.leaveLocalReceiver(appId).catch(() => {});
        this.activeReceivers.delete(appId);
        this.activeClusterStreams.delete(appId);
        this.runtimeConfigCache.delete(appId);

        const file = this.configStore.getCached() || await this.configStore.load();
        if (Array.isArray(file.multicastApplications)) {
            file.multicastApplications = file.multicastApplications.filter(a => a.id !== appId);
            await this.configStore.save(file);
        }
    }

    // ─── Node-Local Runtime Execution (Sender & Receiver) ─────────────────────

    private resolveEffectiveConfig(appId: string, overrideConfig?: any): CustomMulticastApplicationConfig {
        if (overrideConfig && (overrideConfig.group || overrideConfig.multicast)) {
            const normalized = this.normalizeAppConfig({ ...overrideConfig, id: overrideConfig.id || appId });
            this.runtimeConfigCache.set(appId, normalized);
            return normalized;
        }
        const app = this.getApplication(appId);
        if (!app) {
            throw new Error(`Multicast application '${appId}' not found`);
        }
        return app;
    }

    public async startLocalSender(
        appId: string,
        overrideConfig?: any,
        interfaceIpOverride?: string | null
    ): Promise<MulticastSenderStats> {
        const baseConfig = this.resolveEffectiveConfig(appId, overrideConfig);
        const effectiveConfig: CustomMulticastApplicationConfig = JSON.parse(JSON.stringify(baseConfig));
        if (interfaceIpOverride !== undefined && interfaceIpOverride !== null) {
            effectiveConfig.senderInterfaceIp = interfaceIpOverride;
        }

        const localNodeId = this.getLocalNodeId();
        let sender = this.activeSenders.get(effectiveConfig.id);
        if (sender && sender.isRunning()) {
            await sender.stop();
        }
        if (!sender) {
            sender = new MulticastSenderRuntime(effectiveConfig, localNodeId);
            this.activeSenders.set(effectiveConfig.id, sender);
        } else {
            sender.updateConfig(effectiveConfig, localNodeId);
        }

        // Enable IP_MULTICAST_LOOP if any receiver is on the same node or using loopback IP
        const hasCoLocatedReceiver = effectiveConfig.receivers.some(
            r => r.node.toLowerCase() === effectiveConfig.senderNode.toLowerCase() ||
                 r.node.toLowerCase() === localNodeId.toLowerCase() ||
                 r.interfaceIp === '127.0.0.1'
        ) || effectiveConfig.senderInterfaceIp === '127.0.0.1' || this.activeReceivers.has(effectiveConfig.id);

        return await sender.start(hasCoLocatedReceiver);
    }

    public async stopLocalSender(appId: string): Promise<MulticastSenderStats | null> {
        const sender = this.activeSenders.get(appId);
        if (!sender) return null;
        return await sender.stop();
    }

    public async joinLocalReceiver(
        appId: string,
        options?: {
            expect?: string;
            interfaceIp?: string | null;
            config?: any;
            nodeId?: string;
        }
    ): Promise<MulticastReceiverStats> {
        const effectiveConfig = this.resolveEffectiveConfig(appId, options?.config);
        const localNodeId = options?.nodeId || this.getLocalNodeId();

        const matchedReceiver = effectiveConfig.receivers.find(
            r => r.node.toLowerCase() === localNodeId.toLowerCase() || this.isLocalNode(r.node)
        );

        const rawExpect = options?.expect || matchedReceiver?.expect || 'traffic';
        const expectMode: MulticastExpectationMode = rawExpect === 'none' ? 'none' : 'traffic';
        const interfaceIp = options?.interfaceIp !== undefined && options?.interfaceIp !== null
            ? options.interfaceIp
            : (matchedReceiver?.interfaceIp || 'auto');

        const existing = this.activeReceivers.get(effectiveConfig.id);
        if (existing) {
            await existing.leave().catch(() => {});
        }

        const receiver = new MulticastReceiverRuntime(
            effectiveConfig,
            localNodeId,
            expectMode,
            interfaceIp
        );
        this.activeReceivers.set(effectiveConfig.id, receiver);
        return await receiver.join();
    }

    public async leaveLocalReceiver(appId: string): Promise<MulticastReceiverStats | null> {
        const receiver = this.activeReceivers.get(appId);
        if (!receiver) return null;
        return await receiver.leave();
    }

    public getLocalStats(appId: string): {
        nodeId: string;
        sender: MulticastSenderStats | null;
        receiver: MulticastReceiverStats | null;
    } {
        const sender = this.activeSenders.get(appId);
        const receiver = this.activeReceivers.get(appId);
        const senderActive = sender ? sender.isRunning() : undefined;
        return {
            nodeId: this.getLocalNodeId(),
            sender: sender ? sender.getStats() : null,
            receiver: receiver ? receiver.getStats(senderActive) : null
        };
    }

    public async getLocalPreflight(
        appId: string,
        overrideConfig?: any,
        preferredIp?: string | null
    ): Promise<MulticastNodePreflightResult> {
        const cfg = this.resolveEffectiveConfig(appId, overrideConfig);
        const localNodeId = this.getLocalNodeId();
        const isSender = cfg.senderNode.toLowerCase() === localNodeId.toLowerCase();

        const resolvedIp = preferredIp !== undefined && preferredIp !== null
            ? preferredIp
            : (isSender
                ? cfg.senderInterfaceIp
                : cfg.receivers.find(r => r.node.toLowerCase() === localNodeId.toLowerCase())?.interfaceIp || 'auto');

        return await inspectLocalMulticastPreflight(
            localNodeId,
            isSender ? 'sender' : 'receiver',
            cfg,
            resolvedIp
        );
    }

    // ─── Cluster-Orchestrated Operations (Leader -> Peers Fan-Out) ────────────

    private async dispatchToNode(
        nodeId: string,
        method: 'GET' | 'POST',
        subPath: string,
        body?: any
    ): Promise<any> {
        if (this.isLocalNode(nodeId)) {
            const parts = subPath.split('/').filter(Boolean); // e.g. ['multicast', appId, 'local-join']
            const appId = decodeURIComponent(parts[1] || '');
            const action = parts.slice(2).join('/');

            if (action === 'local-sender/start') {
                const stats = await this.startLocalSender(appId, body?.config, body?.interfaceIp);
                return { success: true, sender: stats };
            }
            if (action === 'local-sender/stop') {
                const stats = await this.stopLocalSender(appId);
                return { success: true, sender: stats };
            }
            if (action === 'local-join') {
                const stats = await this.joinLocalReceiver(appId, {
                    expect: body?.expect,
                    interfaceIp: body?.interfaceIp,
                    config: body?.config,
                    nodeId
                });
                return { success: true, receiver: stats };
            }
            if (action === 'local-leave') {
                const stats = await this.leaveLocalReceiver(appId);
                return { success: true, receiver: stats };
            }
            if (action === 'local-stats') {
                return { success: true, ...this.getLocalStats(appId) };
            }
            if (action === 'local-preflight') {
                const preflight = await this.getLocalPreflight(appId, body?.config, body?.interfaceIp);
                return { success: true, preflight };
            }
        }

        if (!this.nodeForwarder) {
            throw new Error(`Cluster node forwarder not configured to reach remote node '${nodeId}'`);
        }

        return await this.nodeForwarder(nodeId, method, subPath, body);
    }

    /**
     * Orchestrates cluster-wide stream start:
     * 1. Instructs all enabled receivers to join the IGMP group first
     * 2. Instructs the sender node to start transmitting UDP multicast packets
     */
    public async startClusterStream(appId: string): Promise<MulticastClusterStatus> {
        const app = this.resolveEffectiveConfig(appId);
        const enabledReceivers = app.receivers.filter(r => r.enabled !== false);

        // Step 1: Fan-out IGMP Join to all enabled receivers concurrently
        await Promise.allSettled(
            enabledReceivers.map(r =>
                this.dispatchToNode(r.node, 'POST', `/multicast/${encodeURIComponent(app.id)}/local-join`, {
                    expect: r.expect,
                    interfaceIp: r.interfaceIp,
                    config: app
                })
            )
        );

        // Brief 100ms settle window so IGMP Membership Reports propagate before first packet #0
        await new Promise(r => setTimeout(r, 100));

        // Step 2: Start UDP Multicast Sender on designated sender node
        await this.dispatchToNode(
            app.senderNode,
            'POST',
            `/multicast/${encodeURIComponent(app.id)}/local-sender/start`,
            {
                interfaceIp: app.senderInterfaceIp,
                config: app
            }
        );

        this.activeClusterStreams.set(app.id, { startedAt: Date.now() });
        return await this.getClusterStats(app.id);
    }

    /**
     * Orchestrates cluster-wide stream stop:
     * 1. Stops UDP Multicast Sender first so no further in-flight packets are generated
     * 2. Instructs all receivers to leave the IGMP group
     */
    public async stopClusterStream(appId: string): Promise<MulticastClusterStatus> {
        const app = this.resolveEffectiveConfig(appId);

        // Step 1: Stop sender
        await this.dispatchToNode(
            app.senderNode,
            'POST',
            `/multicast/${encodeURIComponent(app.id)}/local-sender/stop`,
            {}
        ).catch(() => {});

        // Step 2: Leave all receivers
        await Promise.allSettled(
            app.receivers.map(r =>
                this.dispatchToNode(
                    r.node,
                    'POST',
                    `/multicast/${encodeURIComponent(app.id)}/local-leave`,
                    {}
                )
            )
        );

        this.activeClusterStreams.delete(app.id);
        return await this.getClusterStats(app.id);
    }

    /**
     * Allows dynamic per-receiver Late Join (Scenario S4) or IGMP Leave/Prune (Scenario S8)
     * while the stream is active.
     */
    public async toggleClusterReceiver(
        appId: string,
        nodeId: string,
        action: 'join' | 'leave',
        expectOverride?: string
    ): Promise<MulticastClusterStatus> {
        const app = this.resolveEffectiveConfig(appId);
        const rcvCfg = app.receivers.find(r => r.node.toLowerCase() === nodeId.toLowerCase());

        if (action === 'join') {
            await this.dispatchToNode(
                nodeId,
                'POST',
                `/multicast/${encodeURIComponent(app.id)}/local-join`,
                {
                    expect: expectOverride || rcvCfg?.expect || 'traffic',
                    interfaceIp: rcvCfg?.interfaceIp || 'auto',
                    config: app
                }
            );
        } else {
            await this.dispatchToNode(
                nodeId,
                'POST',
                `/multicast/${encodeURIComponent(app.id)}/local-leave`,
                {}
            );
        }

        return await this.getClusterStats(app.id);
    }

    /**
     * Aggregates real-time Sender + N Receiver telemetry across the cluster
     * and computes health verdicts and SD-WAN diagnostic hints.
     */
    public async getClusterStats(appId: string): Promise<MulticastClusterStatus> {
        const app = this.resolveEffectiveConfig(appId);

        const uniqueNodes = new Set<string>();
        if (app.senderNode) uniqueNodes.add(app.senderNode);
        for (const r of app.receivers) {
            if (r.node) uniqueNodes.add(r.node);
        }

        const nodeResponses = new Map<string, {
            ok: boolean;
            sender: MulticastSenderStats | null;
            receiver: MulticastReceiverStats | null;
            error?: string;
        }>();

        await Promise.all(
            Array.from(uniqueNodes).map(async (nodeId) => {
                try {
                    const res = await this.dispatchToNode(
                        nodeId,
                        'GET',
                        `/multicast/${encodeURIComponent(app.id)}/local-stats`
                    );
                    nodeResponses.set(nodeId, {
                        ok: true,
                        sender: res?.sender || null,
                        receiver: res?.receiver || null
                    });
                } catch (err: any) {
                    nodeResponses.set(nodeId, {
                        ok: false,
                        sender: null,
                        receiver: null,
                        error: err?.message || 'Node unreachable'
                    });
                }
            })
        );

        const senderNodeRes = nodeResponses.get(app.senderNode);
        const senderStats: MulticastSenderStats = senderNodeRes?.sender || {
            appId: app.id,
            node: app.senderNode,
            active: false,
            group: app.group,
            port: app.port,
            interfaceName: 'auto',
            interfaceIp: app.senderInterfaceIp || 'auto',
            runId: 0,
            streamId: computeStreamId(app.id),
            currentSeq: 0,
            packetsSent: 0,
            bytesSent: 0,
            txBitrateKbps: 0,
            txPps: 0,
            targetKbps: app.rate?.kbps || 1000,
            payloadBytes: app.payloadBytes || 1200,
            ttl: app.ttl || 8,
            dscp: app.dscp || 'EF',
            uptimeSec: 0,
            lastError: senderNodeRes?.ok === false ? senderNodeRes.error : undefined
        };

        const receiverStatsList: MulticastReceiverStats[] = app.receivers.map(r => {
            const nodeRes = nodeResponses.get(r.node);
            if (nodeRes?.receiver) {
                return nodeRes.receiver;
            }
            const isUnreachable = nodeRes?.ok === false;
            return {
                appId: app.id,
                node: r.node,
                joined: false,
                expect: r.expect,
                group: app.group,
                port: app.port,
                mode: app.mode,
                ssmSource: app.ssmSource,
                interfaceName: 'auto',
                interfaceIp: r.interfaceIp || 'auto',
                igmpVersion: 'v3',
                runId: 0,
                firstSeq: null,
                highestSeq: null,
                packetsReceived: 0,
                packetsExpected: 0,
                packetsLost: 0,
                lossPct: 0,
                duplicatePackets: 0,
                reorderedPackets: 0,
                foreignPackets: 0,
                bytesReceived: 0,
                rxBitrateKbps: 0,
                rxPps: 0,
                jitterMs: 0,
                maxGapMs: 0,
                currentSilenceMs: 0,
                joinLatencyMs: null,
                verdict: isUnreachable ? 'FAILED' : 'NO_TRAFFIC',
                verdictReason: isUnreachable
                    ? `Node unreachable: ${nodeRes?.error}`
                    : (r.enabled === false ? 'Receiver disabled in profile' : 'Not joined'),
                lastError: isUnreachable ? nodeRes?.error : undefined,
                history: []
            };
        });

        const isActive = Boolean(senderStats.active) || receiverStatsList.some(r => r.joined);
        if (!isActive) {
            this.activeClusterStreams.delete(app.id);
        }

        const diagnostics: string[] = [];
        let overallVerdict: MulticastHealthVerdict = 'NO_TRAFFIC';

        if (isActive) {
            const activeReceivers = receiverStatsList.filter(r => r.joined || r.verdict === 'FAILED');
            if (activeReceivers.some(r => r.verdict === 'FAILED')) {
                overallVerdict = 'FAILED';
            } else if (activeReceivers.some(r => r.verdict === 'DEGRADED')) {
                overallVerdict = 'DEGRADED';
            } else if (activeReceivers.some(r => r.verdict === 'HEALTHY')) {
                overallVerdict = 'HEALTHY';
            } else {
                overallVerdict = (senderStats.packetsSent || 0) > 15 ? 'FAILED' : 'NO_TRAFFIC';
            }

            // Generate actionable SD-WAN Multicast troubleshooting hints
            for (const r of receiverStatsList) {
                if (r.expect === 'traffic' && r.joined && r.packetsReceived === 0 && (senderStats.packetsSent || 0) >= 10) {
                    diagnostics.push(
                        `[${r.node}] Joined ${app.group}:${app.port} (${app.mode.toUpperCase()}) on ${r.interfaceName} (${r.interfaceIp}) but received 0 packets while Sender [${app.senderNode}] sent ${senderStats.packetsSent} packets. Check SD-WAN overlay multicast replication, PIM Rendezvous Point (RP) / IGMP proxy on branch ION, or Linux rp_filter on ${r.node}.`
                    );
                } else if (r.expect === 'none' && r.packetsReceived > 0) {
                    diagnostics.push(
                        `[${r.node}] SECURITY / POLICY LEAK: Node configured with expect='none' received ${r.packetsReceived} multicast packets on ${app.group}:${app.port}. Verify SD-WAN multicast zone segmentation or firewall policy.`
                    );
                } else if (r.verdict === 'DEGRADED' || (r.verdict === 'FAILED' && r.packetsReceived > 0)) {
                    diagnostics.push(
                        `[${r.node}] SLA violation on ${app.group}: Loss=${r.lossPct}% (max ${app.thresholds?.maxLossPct ?? 0.1}%), Duplicates=${r.duplicatePackets}, Jitter=${r.jitterMs}ms, MaxGap=${r.maxGapMs}ms.`
                    );
                }
            }

            if (app.ttl <= 1) {
                diagnostics.push(
                    `Multicast TTL is set to 1. Packets will not traverse L3 routers or SD-WAN overlay tunnels (recommended TTL: 8–64).`
                );
            }
        }

        return {
            appId: app.id,
            appName: app.name,
            group: app.group,
            port: app.port,
            mode: app.mode,
            ssmSource: app.ssmSource,
            active: isActive,
            startedAt: this.activeClusterStreams.get(app.id)?.startedAt,
            sender: senderStats,
            receivers: receiverStatsList,
            overallVerdict,
            diagnostics
        };
    }

    /**
     * Runs pre-flight checks across the Sender and all Receiver nodes concurrently.
     */
    public async runClusterPreflight(appId: string): Promise<{
        appId: string;
        timestamp: number;
        allPassed: boolean;
        nodes: Record<string, MulticastNodePreflightResult>;
    }> {
        const app = this.resolveEffectiveConfig(appId);
        const uniqueNodes = new Map<string, string | null>();
        uniqueNodes.set(app.senderNode, app.senderInterfaceIp || null);
        for (const r of app.receivers) {
            if (!uniqueNodes.has(r.node)) {
                uniqueNodes.set(r.node, r.interfaceIp || null);
            }
        }

        const nodes: Record<string, MulticastNodePreflightResult> = {};

        await Promise.all(
            Array.from(uniqueNodes.entries()).map(async ([nodeId, preferredIp]) => {
                try {
                    const res = await this.dispatchToNode(
                        nodeId,
                        'POST',
                        `/multicast/${encodeURIComponent(app.id)}/local-preflight`,
                        {
                            config: app,
                            interfaceIp: preferredIp
                        }
                    );
                    if (res?.preflight) {
                        nodes[nodeId] = res.preflight;
                    } else {
                        throw new Error('Invalid preflight response');
                    }
                } catch (err: any) {
                    nodes[nodeId] = {
                        node: nodeId,
                        role: nodeId.toLowerCase() === app.senderNode.toLowerCase() ? 'sender' : 'receiver',
                        reachable: false,
                        status: 'fail',
                        interfaceName: 'unreachable',
                        interfaceIp: '0.0.0.0',
                        multicastCapable: false,
                        igmpVersion: 'unknown',
                        rpFilter: null,
                        portAvailable: false,
                        checks: [
                            {
                                name: 'Cluster Node Reachability',
                                status: 'fail',
                                detail: err?.message || `Cannot reach node ${nodeId} via Fleet Gateway`
                            }
                        ],
                        hints: [`Verify that Stigix peer node ${nodeId} is online and reachable.`]
                    };
                }
            })
        );

        const allPassed = Object.values(nodes).every(n => n.status !== 'fail');
        return {
            appId: app.id,
            timestamp: Date.now(),
            allPassed,
            nodes
        };
    }

    public async stopAll(): Promise<void> {
        for (const sender of this.activeSenders.values()) {
            try { await sender.stop(); } catch {}
        }
        for (const receiver of this.activeReceivers.values()) {
            try { await receiver.leave(); } catch {}
        }
        this.activeSenders.clear();
        this.activeReceivers.clear();
        this.activeClusterStreams.clear();
    }
}
