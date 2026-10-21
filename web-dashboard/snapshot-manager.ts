import fs from 'fs';
import path from 'path';

export interface StigixSnapshotNode {
    nodeId: string;
    siteName: string;
    role: string;
    version?: string;
    wanIp?: string;
}

export interface StigixSnapshotTunnel {
    peerId: string;
    siteName?: string;
    status: 'UP' | 'DOWN' | 'DEGRADED';
    endpoint?: string;
    latestHandshake?: number;
    transferRxBytes?: number;
    transferTxBytes?: number;
    ipPrivate?: string;
}

export interface StigixSnapshotDemMetric {
    targetPeer: string;
    targetName?: string;
    targetType?: string;
    targetUrl?: string;
    latencyAvgMs?: number;
    latencyMinMs?: number;
    latencyP95Ms?: number;
    jitterMs?: number;
    packetLossPercent?: number;
    mosScore?: number;
    score?: number;
    httpCode?: number;
    reachable?: boolean;
    sampleCount?: number;
    status?: 'PASS' | 'FAIL' | 'WARN' | 'UNKNOWN';
}

export interface StigixSnapshotSdwanWanInterface {
    name: string;
    circuitLabel?: string;
    ip?: string;
    linkUp: boolean;
    networkName?: string;
}

export interface StigixSnapshotSdwanServiceLink {
    name: string;
    circuitLabel?: string;
    provider?: string;
    endpointName?: string;
    state: string;
    up: boolean;
}

export interface StigixSnapshotSdwanDevice {
    deviceId: string;
    deviceName: string;
    model?: string;
    softwareVersion?: string;
    state?: string;
    connected: boolean;
    lanIps?: string[];
    wanIps?: string[];
    wanInterfaces?: StigixSnapshotSdwanWanInterface[];
    serviceLinks?: StigixSnapshotSdwanServiceLink[];
    wanUpCount?: number;
    wanTotalCount?: number;
    serviceLinksUpCount?: number;
    serviceLinksTotalCount?: number;
}

export interface StigixSnapshotSdwanSite {
    siteId: string;
    siteName: string;
    role: string;
    connected: boolean;
    devices: StigixSnapshotSdwanDevice[];
}

export interface StigixSnapshotSdwanTopology {
    siteCount: number;
    sites: StigixSnapshotSdwanSite[];
    saseSummary?: {
        totalServiceLinks: number;
        upServiceLinks: number;
        downServiceLinks: number;
        pops: string[];
    };
    underlay?: {
        available: boolean;
        matchedCount: number;
        noMatchCount: number;
        routers: string[];
    };
}

export interface StigixSnapshotVoiceTarget {
    target: string;
    codec?: string;
    calls: number;
    avgMos: number;
    minMos: number;
    avgRttMs: number;
    avgJitterMs: number;
    avgLossPct: number;
}

export interface StigixSnapshotVoice {
    enabled: boolean;
    configuredServersCount?: number;
    sampleCount: number;
    avgMos?: number;
    minMos?: number;
    avgRttMs?: number;
    avgJitterMs?: number;
    avgLossPct?: number;
    targets: StigixSnapshotVoiceTarget[];
}

export interface StigixSnapshotVyosInterface {
    name: string;
    description?: string;
    address?: string;
    status: 'up' | 'down' | 'unknown';
    latencyMs: number;
    lossPct: number;
}

export interface StigixSnapshotVyosRouter {
    id: string;
    name: string;
    host: string;
    location?: string;
    status: 'online' | 'offline' | 'unknown';
    interfaces: StigixSnapshotVyosInterface[];
    blackholes: string[];
}

export interface StigixSnapshotVyos {
    routerCount: number;
    onlineCount: number;
    activeImpairmentsCount: number;
    activeBlackholesCount: number;
    routers: StigixSnapshotVyosRouter[];
}

export interface StigixSnapshotConvergence {
    testId: string;
    timestamp: string;
    target?: string;
    blackoutMs: number;
    lossPct: number;
    avgRttMs: number;
    verdict?: string;
}

export interface StigixSnapshot {
    id: string;
    name: string;
    description?: string;
    timestamp: string;
    node: StigixSnapshotNode;
    tunnels: StigixSnapshotTunnel[]; // Stigix Mesh peers
    demMatrix: StigixSnapshotDemMetric[];
    sdwanTopology?: StigixSnapshotSdwanTopology; // SD-WAN Overlay (IONs & Sites)
    voice?: StigixSnapshotVoice; // Voice / RTP MOS QoE
    vyos?: StigixSnapshotVyos; // VyOS Underlay & Chaos/QoS Impairments
    convergence?: StigixSnapshotConvergence; // Latest Failover / Convergence test
    healthScore?: number;
    metadata?: {
        createdBy?: string;
        tags?: string[];
        customData?: Record<string, any>;
    };
}

export interface SnapshotSummary {
    id: string;
    name: string;
    description?: string;
    timestamp: string;
    node: StigixSnapshotNode;
    tunnelCount: number;
    tunnelsUpCount: number;
    probeCount: number;
    probesHealthyCount?: number;
    sdwanSiteCount?: number;
    sdwanSitesOnline?: number;
    voiceAvgMos?: number;
    vyosImpairmentsCount?: number;
    healthScore?: number;
    tags?: string[];
}

export interface SnapshotTunnelDelta {
    peerId: string;
    siteName?: string;
    endpoint?: string;
    ipPrivate?: string;
    statusBefore?: string;
    statusAfter?: string;
    stateChange: 'RECOVERED' | 'FAILED' | 'STABLE_UP' | 'STABLE_DOWN' | 'NEW' | 'REMOVED';
    transferRxDiff?: number;
    transferTxDiff?: number;
}

export interface SnapshotDemDelta {
    target: string;
    targetUrl?: string;
    type?: string;
    statusBefore?: string;
    statusAfter?: string;
    scoreBefore?: number;
    scoreAfter?: number;
    scoreDelta?: number;
    httpCodeBefore?: number;
    httpCodeAfter?: number;
    latencyBefore?: number;
    latencyAfter?: number;
    latencyDeltaMs?: number;
    latencyPercentChange?: number;
    packetLossBefore?: number;
    packetLossAfter?: number;
    packetLossDelta?: number;
    jitterBefore?: number;
    jitterAfter?: number;
    jitterDeltaMs?: number;
    mosBefore?: number;
    mosAfter?: number;
    mosDelta?: number;
    state: 'IMPROVED' | 'REGRESSED' | 'STABLE' | 'NEW' | 'REMOVED';
}

export interface SnapshotSdwanDeviceDelta {
    deviceId: string;
    deviceName: string;
    model?: string;
    softwareVersion?: string;
    connectedBefore: boolean;
    connectedAfter: boolean;
    wanUpBefore?: number;
    wanUpAfter?: number;
    wanTotal?: number;
    serviceLinksUpBefore?: number;
    serviceLinksUpAfter?: number;
    serviceLinksTotal?: number;
    wanIps?: string[];
    lanIps?: string[];
    stateChange: 'DISCONNECTED' | 'RECONNECTED' | 'DEGRADED_LINKS' | 'IMPROVED_LINKS' | 'STABLE_ONLINE' | 'STABLE_OFFLINE' | 'NEW' | 'REMOVED';
}

export interface SnapshotSdwanSiteDelta {
    siteId: string;
    siteName: string;
    role: string;
    connectedBefore: boolean;
    connectedAfter: boolean;
    stateChange: 'STABLE_ONLINE' | 'STABLE_OFFLINE' | 'DISCONNECTED' | 'RECONNECTED' | 'DEGRADED' | 'IMPROVED' | 'NEW' | 'REMOVED';
    deviceChanges: SnapshotSdwanDeviceDelta[];
}

export interface SnapshotSdwanUnderlayDelta {
    availableBefore?: boolean;
    availableAfter?: boolean;
    matchedBefore?: number;
    matchedAfter?: number;
    matchedDelta?: number;
    routersBefore?: string[];
    routersAfter?: string[];
    offlineRouters?: string[];
}

export interface SnapshotVoiceTargetDelta {
    target: string;
    codec?: string;
    callsBefore: number;
    callsAfter: number;
    mosBefore?: number;
    mosAfter?: number;
    mosDelta?: number;
    rttBefore?: number;
    rttAfter?: number;
    rttDeltaMs?: number;
    jitterBefore?: number;
    jitterAfter?: number;
    jitterDeltaMs?: number;
    lossBefore?: number;
    lossAfter?: number;
    lossDeltaPct?: number;
    state: 'IMPROVED' | 'REGRESSED' | 'STABLE' | 'NEW' | 'REMOVED';
}

export interface SnapshotVoiceDelta {
    enabledBefore: boolean;
    enabledAfter: boolean;
    sampleCountBefore: number;
    sampleCountAfter: number;
    avgMosBefore?: number;
    avgMosAfter?: number;
    mosDelta?: number;
    minMosBefore?: number;
    minMosAfter?: number;
    avgRttBefore?: number;
    avgRttAfter?: number;
    rttDeltaMs?: number;
    avgJitterBefore?: number;
    avgJitterAfter?: number;
    jitterDeltaMs?: number;
    avgLossBefore?: number;
    avgLossAfter?: number;
    lossDeltaPct?: number;
    targets: SnapshotVoiceTargetDelta[];
}

export interface SnapshotVyosImpairmentDelta {
    routerId: string;
    routerName: string;
    interfaceName: string;
    description?: string;
    statusBefore: string;
    statusAfter: string;
    latencyBeforeMs: number;
    latencyAfterMs: number;
    latencyDeltaMs: number;
    lossBeforePct: number;
    lossAfterPct: number;
    lossDeltaPct: number;
    changed: boolean;
}

export interface SnapshotVyosDelta {
    routersTotalBefore: number;
    routersTotalAfter: number;
    routersOnlineBefore: number;
    routersOnlineAfter: number;
    impairmentsBefore: number;
    impairmentsAfter: number;
    blackholesBefore: string[];
    blackholesAfter: string[];
    interfaceDeltas: SnapshotVyosImpairmentDelta[];
}

export interface SnapshotDiffResult {
    baseline: {
        id: string;
        name: string;
        timestamp: string;
        node: StigixSnapshotNode;
    };
    target: {
        id: string;
        name: string;
        timestamp: string;
        node: StigixSnapshotNode;
    };
    summary: {
        verdict: 'GO' | 'WARNING' | 'NO_GO';
        score: number; // 0 - 100
        totalTunnels: { before: number; after: number; delta: number };
        tunnelsUp: { before: number; after: number; delta: number };
        totalProbes: { before: number; after: number; delta: number };
        sdwanSites?: {
            before: number;
            after: number;
            delta: number;
            onlineBefore: number;
            onlineAfter: number;
            saseLinksUpBefore?: number;
            saseLinksUpAfter?: number;
            saseLinksTotal?: number;
        };
        voiceMos?: { before?: number; after?: number; delta?: number };
        vyosImpairments?: { before: number; after: number; delta: number };
        healthScore: { before?: number; after?: number; delta?: number };
    };
    regressions: string[];
    improvements: string[];
    tunnelDeltas: SnapshotTunnelDelta[]; // Stigix Mesh peers deltas
    demDeltas: SnapshotDemDelta[];
    sdwanDeltas?: SnapshotSdwanSiteDelta[]; // SD-WAN Overlay (IONs & Sites) deltas
    sdwanUnderlayDelta?: SnapshotSdwanUnderlayDelta;
    voiceDelta?: SnapshotVoiceDelta;
    vyosDelta?: SnapshotVyosDelta;
}

export interface SnapshotCaptureContext {
    registryManager?: any;
    connectivityLogger?: any;
    getAllProbes?: () => any[];
    getSystemSettings?: () => any;
    underlayTopologyManager?: any;
    getTopology?: () => Promise<any> | any;
    vyosManager?: any;
    voiceStatsFile?: string;
    voiceConfigFile?: string;
    convergenceHistoryFile?: string;
    version?: string;
}

export class SnapshotManager {
    private snapshotsDir: string;
    private configDir: string;
    private maxSnapshots: number = 50;

    constructor(configDir: string) {
        this.configDir = configDir;
        this.snapshotsDir = path.join(configDir, 'snapshots');
        try {
            if (!fs.existsSync(this.snapshotsDir)) {
                fs.mkdirSync(this.snapshotsDir, { recursive: true });
            }
        } catch (e) {
            console.error('[SNAPSHOT_MGR] Failed to initialize snapshots directory:', e);
        }
    }

    private slugify(str: string): string {
        return str
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'snap';
    }

    /**
     * Generates a smart default snapshot name: YYYYMMDD-HHMM-<SITE>-<SEQ>
     * Example: 20261021-1135-BR8-01
     */
    public generateDefaultName(siteName?: string, suffix?: string): string {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const datePrefix = `${yyyy}${mm}${dd}`;
        const timePart = `${hh}${min}`;

        const rawSite = (siteName || process.env.STIGIX_SITE_NAME || 'NODE')
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '')
            .slice(0, 8) || 'NODE';

        // Count existing snapshots captured today to generate sequence number 01, 02...
        let todayCount = 0;
        try {
            if (fs.existsSync(this.snapshotsDir)) {
                const files = fs.readdirSync(this.snapshotsDir).filter(f => f.endsWith('.json'));
                for (const f of files) {
                    if (f.includes(`snap-${datePrefix}`)) {
                        todayCount++;
                    }
                }
            }
        } catch {}

        const seq = String(todayCount + 1).padStart(2, '0');
        if (suffix && suffix.trim()) {
            const cleanSuffix = this.slugify(suffix);
            return `${datePrefix}-${timePart}-${rawSite}-${seq}-${cleanSuffix}`;
        }
        return `${datePrefix}-${timePart}-${rawSite}-${seq}`;
    }

    /**
     * Reads Voice RTP/MOS stats from voice-stats.jsonl within a window around referenceTimeMs
     */
    private captureVoiceState(ctx: SnapshotCaptureContext, referenceTimeMs: number = Date.now()): StigixSnapshotVoice | undefined {
        const logDir = path.join(path.dirname(this.configDir), 'logs');
        const voiceStatsFile = ctx.voiceStatsFile || path.join(logDir, 'voice-stats.jsonl');
        const voiceConfigFile = ctx.voiceConfigFile || path.join(this.configDir, 'voice-config.json');

        let enabled = false;
        let configuredServersCount = 0;
        try {
            if (fs.existsSync(voiceConfigFile)) {
                const cfg = JSON.parse(fs.readFileSync(voiceConfigFile, 'utf8'));
                enabled = Boolean(cfg?.control?.enabled);
                configuredServersCount = Array.isArray(cfg?.servers) ? cfg.servers.filter((s: any) => s.enabled !== false).length : 0;
            }
        } catch {}

        const records: any[] = [];
        try {
            if (fs.existsSync(voiceStatsFile)) {
                const content = fs.readFileSync(voiceStatsFile, 'utf8').trim();
                if (content) {
                    const lines = content.split('\n');
                    // Look at last 300 lines max
                    const recentLines = lines.slice(-300);
                    const windowMs = 60 * 60 * 1000; // 1 hour window before referenceTimeMs
                    const parsedAll: any[] = [];

                    for (const line of recentLines) {
                        try {
                            const entry = JSON.parse(line);
                            if (typeof entry.mos_score === 'number' && entry.mos_score > 0) {
                                parsedAll.push(entry);
                            }
                        } catch {}
                    }

                    // Filter entries recorded on or before referenceTimeMs (+2 min grace) and within windowMs
                    const inWindow = parsedAll.filter(e => {
                        const ts = e.timestamp ? new Date(e.timestamp).getTime() : 0;
                        return ts > 0 && ts <= referenceTimeMs + 120000 && ts >= referenceTimeMs - windowMs;
                    });

                    if (inWindow.length > 0) {
                        records.push(...inWindow.slice(-40));
                    } else if (parsedAll.length > 0) {
                        // Fallback to the closest 20 entries up to referenceTimeMs
                        const beforeRef = parsedAll.filter(e => {
                            const ts = e.timestamp ? new Date(e.timestamp).getTime() : 0;
                            return ts === 0 || ts <= referenceTimeMs + 120000;
                        });
                        records.push(...(beforeRef.length > 0 ? beforeRef.slice(-20) : parsedAll.slice(-20)));
                    }
                }
            }
        } catch {}

        if (!enabled && records.length === 0 && configuredServersCount === 0) {
            return undefined;
        }

        if (records.length === 0) {
            return {
                enabled,
                configuredServersCount,
                sampleCount: 0,
                targets: []
            };
        }

        const avg = (arr: number[]) => arr.length > 0 ? parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)) : 0;
        const mosValues = records.map(r => Number(r.mos_score)).filter(n => !isNaN(n) && n > 0);
        const rttValues = records.map(r => Number(r.avg_rtt_ms ?? 0)).filter(n => !isNaN(n));
        const jitterValues = records.map(r => Number(r.jitter_ms ?? 0)).filter(n => !isNaN(n));
        const lossValues = records.map(r => Number(r.loss_pct ?? 0)).filter(n => !isNaN(n));

        const byTarget = new Map<string, any[]>();
        for (const r of records) {
            const key = String(r.target || 'default');
            if (!byTarget.has(key)) byTarget.set(key, []);
            byTarget.get(key)!.push(r);
        }

        const targets: StigixSnapshotVoiceTarget[] = [];
        for (const [targetKey, list] of byTarget.entries()) {
            const tMos = list.map(x => Number(x.mos_score)).filter(n => !isNaN(n) && n > 0);
            const tRtt = list.map(x => Number(x.avg_rtt_ms ?? 0)).filter(n => !isNaN(n));
            const tJit = list.map(x => Number(x.jitter_ms ?? 0)).filter(n => !isNaN(n));
            const tLoss = list.map(x => Number(x.loss_pct ?? 0)).filter(n => !isNaN(n));
            const latestCodec = list[list.length - 1]?.codec;
            targets.push({
                target: targetKey,
                codec: latestCodec,
                calls: list.length,
                avgMos: avg(tMos),
                minMos: tMos.length > 0 ? parseFloat(Math.min(...tMos).toFixed(2)) : 0,
                avgRttMs: avg(tRtt),
                avgJitterMs: avg(tJit),
                avgLossPct: avg(tLoss)
            });
        }

        return {
            enabled,
            configuredServersCount,
            sampleCount: records.length,
            avgMos: avg(mosValues),
            minMos: mosValues.length > 0 ? parseFloat(Math.min(...mosValues).toFixed(2)) : undefined,
            avgRttMs: avg(rttValues),
            avgJitterMs: avg(jitterValues),
            avgLossPct: avg(lossValues),
            targets
        };
    }

    /**
     * Captures VyOS router states, interface statuses, active QoS impairments (latency/loss), and BGP blackholes
     */
    private captureVyosState(ctx: SnapshotCaptureContext): StigixSnapshotVyos | undefined {
        if (!ctx.vyosManager || typeof ctx.vyosManager.getRouters !== 'function') {
            return undefined;
        }
        try {
            const rawRouters = ctx.vyosManager.getRouters() || [];
            if (!Array.isArray(rawRouters) || rawRouters.length === 0) return undefined;

            let onlineCount = 0;
            let activeImpairmentsCount = 0;
            let activeBlackholesCount = 0;

            const routers: StigixSnapshotVyosRouter[] = rawRouters.map((r: any) => {
                const status: 'online' | 'offline' | 'unknown' =
                    r.status === 'online' ? 'online' : r.status === 'offline' ? 'offline' : 'unknown';
                if (status === 'online') onlineCount++;

                const interfaces: StigixSnapshotVyosInterface[] = (r.interfaces || []).map((iface: any) => {
                    const latencyMs = Number(iface.qos?.latency || 0);
                    const lossPct = Number(iface.qos?.loss || 0);
                    if (latencyMs > 0 || lossPct > 0 || iface.status === 'down') {
                        activeImpairmentsCount++;
                    }
                    return {
                        name: iface.name,
                        description: iface.description,
                        address: iface.address,
                        status: iface.status === 'up' ? 'up' : iface.status === 'down' ? 'down' : 'unknown',
                        latencyMs,
                        lossPct
                    };
                });

                const blackholes: string[] = (r.blackholeBlocks || []).map((b: any) => String(b.prefix || b)).filter(Boolean);
                activeBlackholesCount += blackholes.length;

                return {
                    id: r.id || r.name,
                    name: r.name || r.host || r.id,
                    host: r.host || '',
                    location: r.location,
                    status,
                    interfaces,
                    blackholes
                };
            });

            return {
                routerCount: routers.length,
                onlineCount,
                activeImpairmentsCount,
                activeBlackholesCount,
                routers
            };
        } catch (err) {
            return undefined;
        }
    }

    /**
     * Captures latest Failover / Convergence test result from convergence-history.jsonl
     */
    private captureConvergenceState(ctx: SnapshotCaptureContext): StigixSnapshotConvergence | undefined {
        const logDir = path.join(path.dirname(this.configDir), 'logs');
        const historyFile = ctx.convergenceHistoryFile || path.join(logDir, 'convergence-history.jsonl');
        try {
            if (!fs.existsSync(historyFile)) return undefined;
            const content = fs.readFileSync(historyFile, 'utf8').trim();
            if (!content) return undefined;
            const lines = content.split('\n');
            const lastLine = lines[lines.length - 1];
            const data = JSON.parse(lastLine);
            return {
                testId: data.test_id || data.testId || 'conv-test',
                timestamp: data.timestamp || new Date().toISOString(),
                target: data.target || data.target_ip,
                blackoutMs: Number(data.blackout_ms ?? data.convergence_ms ?? 0),
                lossPct: Number(data.loss_pct ?? data.packet_loss_pct ?? 0),
                avgRttMs: Number(data.avg_rtt_ms ?? data.rtt_avg_ms ?? 0),
                verdict: data.verdict || (Number(data.blackout_ms ?? 0) < 2000 ? 'PASS' : 'WARN')
            };
        } catch {
            return undefined;
        }
    }

    /**
     * Extracts normalized DEM metric values from either ConnectivityLogger entries (metrics.total_ms)
     * or unit test / legacy probe entries (latency / avg_latency).
     */
    private buildDemMetricForProbe(p: any, matchingResults: any[], latestSingle?: any): StigixSnapshotDemMetric {
        const samples = matchingResults.length > 0
            ? matchingResults.slice(0, 10)
            : (latestSingle ? [latestSingle] : []);
        const latest = samples[0] || latestSingle;

        const latencies = samples
            .map((r: any) => r?.metrics?.total_ms ?? r?.latency ?? r?.avg_latency)
            .filter((v: any): v is number => typeof v === 'number' && !isNaN(v) && v > 0);

        const jitters = samples
            .map((r: any) => r?.metrics?.jitter_ms ?? r?.jitter)
            .filter((v: any): v is number => typeof v === 'number' && !isNaN(v));

        const losses = samples
            .map((r: any) => {
                if (typeof r?.metrics?.loss_pct === 'number') return r.metrics.loss_pct;
                if (typeof r?.packet_loss === 'number') return r.packet_loss;
                const isOk = r?.reachable ?? r?.success;
                if (typeof isOk === 'boolean') return isOk ? 0 : 100;
                return undefined;
            })
            .filter((v: any): v is number => typeof v === 'number' && !isNaN(v));

        const avg = (arr: number[]) => arr.length > 0
            ? parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2))
            : undefined;

        const latencyAvgMs = avg(latencies) ?? (typeof latest?.metrics?.total_ms === 'number' ? latest.metrics.total_ms : (latest?.latency ?? latest?.avg_latency ?? undefined));
        const latencyMinMs = latencies.length > 0 ? parseFloat(Math.min(...latencies).toFixed(2)) : (latest?.min_latency ?? latencyAvgMs);
        const latencyP95Ms = latencies.length > 0 ? parseFloat(Math.max(...latencies).toFixed(2)) : (latest?.p95_latency ?? latencyAvgMs);
        const jitterMs = avg(jitters) ?? (latest?.metrics?.jitter_ms ?? latest?.jitter ?? undefined);
        const packetLossPercent = avg(losses) ?? 0;

        const isReachable = latest ? Boolean(latest.reachable ?? latest.success ?? true) : undefined;
        const score = typeof latest?.score === 'number' ? latest.score : undefined;
        const httpCode = typeof latest?.httpCode === 'number' ? latest.httpCode : undefined;

        let status: 'PASS' | 'FAIL' | 'WARN' | 'UNKNOWN' = 'UNKNOWN';
        if (latest) {
            if (isReachable === false || (packetLossPercent !== undefined && packetLossPercent >= 100)) {
                status = 'FAIL';
            } else if ((score !== undefined && score < 70) || (packetLossPercent !== undefined && packetLossPercent > 0)) {
                status = 'WARN';
            } else {
                status = 'PASS';
            }
        }

        return {
            targetPeer: p.name || p.id || latest?.endpointName || latest?.endpointId || 'unknown',
            targetName: p.name || latest?.endpointName || p.id,
            targetType: String(p.type || latest?.endpointType || 'PING').toUpperCase(),
            targetUrl: p.url || p.target || latest?.url || undefined,
            latencyAvgMs,
            latencyMinMs,
            latencyP95Ms,
            jitterMs,
            packetLossPercent,
            mosScore: latest?.mos ?? undefined,
            score,
            httpCode,
            reachable: isReachable,
            sampleCount: samples.length,
            status
        };
    }

    /**
     * Backfills historical DEM probe latencies & Voice MOS for snapshots that were captured
     * prior to the ConnectivityResult schema fix.
     */
    public async enrichSnapshotIfNeeded(snapshot: StigixSnapshot, ctx?: SnapshotCaptureContext): Promise<StigixSnapshot> {
        if (!ctx) return snapshot;
        const snapTimeMs = snapshot.timestamp ? new Date(snapshot.timestamp).getTime() : Date.now();

        // Check if DEM matrix is missing latency values for all probes
        const hasAnyLatency = (snapshot.demMatrix || []).some(d => typeof d.latencyAvgMs === 'number' && d.latencyAvgMs > 0);
        if (!hasAnyLatency && (snapshot.demMatrix || []).length > 0 && ctx.connectivityLogger?.getResults) {
            try {
                const res = await ctx.connectivityLogger.getResults({ limit: 5000 });
                const allLogs: any[] = Array.isArray(res) ? res : (res?.results || []);
                if (allLogs.length > 0) {
                    const windowMs = 30 * 60 * 1000; // 30 minutes around snapshot timestamp
                    const probesConfig = ctx.getAllProbes ? ctx.getAllProbes() : [];
                    const probeConfigMap = new Map<string, any>();
                    for (const p of probesConfig) {
                        const key = (p.name || p.id || '').toLowerCase().replace(/\s+/g, '-');
                        probeConfigMap.set(key, p);
                        probeConfigMap.set((p.name || p.id || '').toLowerCase(), p);
                    }

                    snapshot.demMatrix = (snapshot.demMatrix || []).map(dm => {
                        const probeNameLower = (dm.targetName || dm.targetPeer || '').toLowerCase();
                        const probeId = probeNameLower.replace(/\s+/g, '-');
                        const pCfg = probeConfigMap.get(probeId) || probeConfigMap.get(probeNameLower) || {
                            name: dm.targetName || dm.targetPeer,
                            type: dm.targetType
                        };

                        const probeLogs = allLogs.filter((r: any) => {
                            const rId = (r.endpointId || '').toLowerCase();
                            const rName = (r.endpointName || r.name || '').toLowerCase();
                            return rId === probeId || rName === probeNameLower || rName.replace(/\s+/g, '-') === probeId;
                        });

                        // Prefer logs recorded near or before snapshot timestamp
                        const nearLogs = probeLogs.filter((r: any) => {
                            const ts = typeof r.timestamp === 'number' ? r.timestamp : new Date(r.timestamp).getTime();
                            return ts <= snapTimeMs + 120000 && ts >= snapTimeMs - windowMs;
                        });

                        const chosenLogs = nearLogs.length > 0 ? nearLogs : probeLogs.slice(0, 5);
                        const latestFallback = chosenLogs[0] || ctx.connectivityLogger?.getLatestResult?.(probeId);
                        if (chosenLogs.length > 0 || latestFallback) {
                            return this.buildDemMetricForProbe(pCfg, chosenLogs, latestFallback);
                        }
                        return dm;
                    });
                }
            } catch {}
        }

        // Backfill Voice stats at snapshot timestamp if missing
        if (!snapshot.voice) {
            const voiceState = this.captureVoiceState(ctx, snapTimeMs);
            if (voiceState) {
                snapshot.voice = voiceState;
            }
        }

        return snapshot;
    }

    public async captureState(options: {
        name?: string;
        description?: string;
        tags?: string[];
        createdBy?: string;
        persist?: boolean;
        context?: SnapshotCaptureContext;
    }): Promise<StigixSnapshot> {
        const ctx = options.context || {};
        const regStatus = ctx.registryManager?.getStatus?.() || {};
        const siteName = ctx.registryManager?.getSiteName?.() || process.env.STIGIX_SITE_NAME || 'LOCAL';
        const nodeId = regStatus.instance_id || 'local-node';
        const role = regStatus.current_mode || process.env.STIGIX_REGISTRY_MODE || 'peer';
        const wanIp = regStatus.detected_ip || regStatus.ip_public || undefined;

        const effectiveName = (options.name && options.name.trim())
            ? options.name.trim()
            : this.generateDefaultName(siteName);

        // 1. Gather Stigix Mesh Peers
        const peers = typeof ctx.registryManager?.getPeers === 'function' ? ctx.registryManager.getPeers() : [];
        const tunnels: StigixSnapshotTunnel[] = peers.map((p: any) => {
            const lastSeenAgeMs = p.last_seen ? (Date.now() - new Date(p.last_seen).getTime()) : Infinity;
            const isOnline = p.status !== 'OFFLINE' && (p.status === 'ONLINE' || lastSeenAgeMs < 120000);
            return {
                peerId: p.instance_id || p.site_name || 'unknown-peer',
                siteName: p.site_name || p.instance_id,
                status: isOnline ? 'UP' : 'DOWN',
                endpoint: p.ip_public ? (p.port ? `${p.ip_public}:${p.port}` : p.ip_public) : undefined,
                latestHandshake: p.last_seen ? Math.floor(new Date(p.last_seen).getTime() / 1000) : undefined,
                transferRxBytes: p.transfer_rx_bytes || 0,
                transferTxBytes: p.transfer_tx_bytes || 0,
                ipPrivate: p.ip_private
            };
        });

        // 2. Gather DEM / Connectivity Probes & Stats
        const demMatrix: StigixSnapshotDemMetric[] = [];
        let healthScore: number | undefined;

        if (ctx.connectivityLogger?.getStats) {
            try {
                const stats = await ctx.connectivityLogger.getStats({ timeRange: '1h' });
                if (stats && typeof stats.globalHealth === 'number') {
                    healthScore = stats.globalHealth;
                }
            } catch {}
        }

        const probes = ctx.getAllProbes ? ctx.getAllProbes() : [];
        let probeResults: any[] = [];
        if (ctx.connectivityLogger?.getResults) {
            try {
                const res = await ctx.connectivityLogger.getResults({ limit: 2000 });
                probeResults = Array.isArray(res) ? res : (res?.results || []);
            } catch {}
        }

        for (const p of probes) {
            const rawName = (p.name || p.id || '').toLowerCase();
            const probeId = rawName.replace(/\s+/g, '-');
            const matching = probeResults.filter((r: any) => {
                const rId = (r.endpointId || '').toLowerCase();
                const rName = (r.endpointName || r.name || '').toLowerCase();
                return rId === probeId || rName === rawName || rName.replace(/\s+/g, '-') === probeId;
            });
            const latestSingle = matching[0] || ctx.connectivityLogger?.getLatestResult?.(probeId);
            demMatrix.push(this.buildDemMetricForProbe(p, matching, latestSingle));
        }

        // 3. Gather SD-WAN Overlay (Prisma SD-WAN IONs, WAN Circuits & SASE Service Links) + Underlay
        let sdwanTopology: StigixSnapshotSdwanTopology | undefined = undefined;
        if (ctx.getTopology) {
            try {
                const topoData = typeof ctx.getTopology === 'function' ? await ctx.getTopology() : ctx.getTopology;
                if (topoData && Array.isArray(topoData.sites)) {
                    const sites: StigixSnapshotSdwanSite[] = topoData.sites.map((s: any) => {
                        const devices: StigixSnapshotSdwanDevice[] = (s.devices || []).map((d: any) => {
                            const wanInterfaces: StigixSnapshotSdwanWanInterface[] = (d.wan_interfaces || []).map((w: any) => ({
                                name: w.name || w.circuit_label || 'WAN',
                                circuitLabel: w.circuit_label || w.network_name || w.name,
                                ip: w.wan_ip_only || w.ipv4_address || w.ip,
                                linkUp: w.link_up !== false && w.admin_up !== false,
                                networkName: w.network_name
                            }));

                            const serviceLinks: StigixSnapshotSdwanServiceLink[] = (d.service_links || []).map((sl: any) => {
                                const isUp = sl.operational_state === 'up' || sl.extended_state === 'tunnel_up' || sl.state === 'up';
                                return {
                                    name: sl.name || sl.id || 'IPsec',
                                    circuitLabel: sl.circuit_label || sl.circuit_name,
                                    provider: sl.provider || 'Prisma Access',
                                    endpointName: sl.service_endpoint_name || sl.remote_ip,
                                    state: sl.extended_state || sl.operational_state || (isUp ? 'up' : 'down'),
                                    up: isUp
                                };
                            });

                            const wanUpCount = wanInterfaces.filter(w => w.linkUp).length;
                            const serviceLinksUpCount = serviceLinks.filter(sl => sl.up).length;

                            const isConnected = Boolean(
                                d.connected ||
                                d.state === 'online' ||
                                d.state === 'connected' ||
                                wanUpCount > 0 ||
                                serviceLinksUpCount > 0
                            );

                            return {
                                deviceId: d.device_id || d.id || '',
                                deviceName: d.device_name || d.name || 'ION',
                                model: d.model,
                                softwareVersion: d.software_version,
                                state: d.state || (isConnected ? 'online' : 'offline'),
                                connected: isConnected,
                                lanIps: (d.lan_interfaces || []).map((l: any) => l.ipv4_address || l.ip).filter(Boolean),
                                wanIps: wanInterfaces.map(w => w.ip).filter((ip): ip is string => Boolean(ip)),
                                wanInterfaces,
                                serviceLinks,
                                wanUpCount,
                                wanTotalCount: wanInterfaces.length,
                                serviceLinksUpCount,
                                serviceLinksTotalCount: serviceLinks.length
                            };
                        });
                        const connected = devices.length > 0 && devices.some(dev => dev.connected);
                        return {
                            siteId: s.site_id || s.id || '',
                            siteName: s.site_name || s.name || 'Site',
                            role: s.site_role || s.role || 'SPOKE',
                            connected,
                            devices
                        };
                    });

                    let underlayInfo = undefined;
                    if (topoData.underlay) {
                        const u = topoData.underlay;
                        const routersList = u.routers ? (Array.isArray(u.routers) ? u.routers : Object.keys(u.routers)) : [];
                        underlayInfo = {
                            available: Boolean(u.available),
                            matchedCount: u.summary?.matched ?? 0,
                            noMatchCount: u.summary?.noMatch ?? 0,
                            routers: routersList
                        };
                    }

                    let saseSummary = undefined;
                    if (topoData.sase_infrastructure) {
                        const si = topoData.sase_infrastructure;
                        saseSummary = {
                            totalServiceLinks: Number(si.total_service_links ?? 0),
                            upServiceLinks: Number(si.up_service_links ?? 0),
                            downServiceLinks: Number(si.down_service_links ?? 0),
                            pops: Array.isArray(si.pops) ? si.pops.map((p: any) => p.name || p.endpoint_name || String(p)).filter(Boolean) : []
                        };
                    } else {
                        // Compute from device serviceLinks if sase_infrastructure not at root
                        let totalSl = 0;
                        let upSl = 0;
                        const popsSet = new Set<string>();
                        for (const s of sites) {
                            for (const d of s.devices) {
                                for (const sl of d.serviceLinks || []) {
                                    totalSl++;
                                    if (sl.up) upSl++;
                                    if (sl.endpointName) popsSet.add(sl.endpointName);
                                }
                            }
                        }
                        if (totalSl > 0) {
                            saseSummary = {
                                totalServiceLinks: totalSl,
                                upServiceLinks: upSl,
                                downServiceLinks: totalSl - upSl,
                                pops: Array.from(popsSet)
                            };
                        }
                    }

                    sdwanTopology = {
                        siteCount: sites.length,
                        sites,
                        saseSummary,
                        underlay: underlayInfo
                    };
                }
            } catch (err: any) {
                console.error('[SNAPSHOT_MGR] Failed to capture SD-WAN topology:', err?.message || err);
            }
        }

        // 4. Gather Voice / RTP MOS QoE
        const voice = this.captureVoiceState(ctx, Date.now());

        // 5. Gather VyOS Underlay & Chaos / QoS Impairments
        const vyos = this.captureVyosState(ctx);

        // 6. Gather Latest Failover / Convergence Test
        const convergence = this.captureConvergenceState(ctx);

        const timestamp = new Date().toISOString();
        const dateSlug = timestamp.replace(/[-:T]/g, '').slice(0, 14);
        const nameSlug = this.slugify(effectiveName);
        const id = `snap-${dateSlug}-${nameSlug}`;

        const snapshot: StigixSnapshot = {
            id,
            name: effectiveName,
            description: options.description?.trim(),
            timestamp,
            node: {
                nodeId,
                siteName,
                role,
                version: ctx.version || process.env.STIGIX_VERSION || '3.0.61',
                wanIp
            },
            tunnels,
            demMatrix,
            sdwanTopology,
            voice,
            vyos,
            convergence,
            healthScore,
            metadata: {
                createdBy: options.createdBy || 'copilot',
                tags: options.tags || [],
                customData: {}
            }
        };

        if (options.persist !== false) {
            await this.saveSnapshot(snapshot);
        }
        return snapshot;
    }

    public async saveSnapshot(snapshot: StigixSnapshot): Promise<void> {
        const filePath = path.join(this.snapshotsDir, `${snapshot.id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
        this.enforceRetention();
    }

    public listSnapshots(): SnapshotSummary[] {
        if (!fs.existsSync(this.snapshotsDir)) return [];
        const files = fs.readdirSync(this.snapshotsDir).filter(f => f.endsWith('.json'));
        const list: SnapshotSummary[] = [];

        for (const f of files) {
            try {
                const fullPath = path.join(this.snapshotsDir, f);
                const data: StigixSnapshot = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                const demList = data.demMatrix || [];
                const passingProbes = demList.filter(d => d.status === 'PASS' || d.reachable === true).length;
                const probeCount = demList.length;
                const probesHealthyCount = passingProbes > 0
                    ? passingProbes
                    : Math.round((probeCount * (data.healthScore ?? 100)) / 100);

                list.push({
                    id: data.id,
                    name: data.name,
                    description: data.description,
                    timestamp: data.timestamp,
                    node: data.node,
                    tunnelCount: data.tunnels?.length || 0,
                    tunnelsUpCount: (data.tunnels || []).filter(t => t.status === 'UP').length,
                    probeCount,
                    probesHealthyCount,
                    sdwanSiteCount: data.sdwanTopology?.siteCount || 0,
                    sdwanSitesOnline: (data.sdwanTopology?.sites || []).filter(s => s.connected).length,
                    voiceAvgMos: data.voice?.avgMos,
                    vyosImpairmentsCount: data.vyos?.activeImpairmentsCount,
                    healthScore: data.healthScore,
                    tags: data.metadata?.tags
                });
            } catch {}
        }

        return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }

    public getSnapshot(idOrName: string): StigixSnapshot | null {
        if (!fs.existsSync(this.snapshotsDir)) return null;
        const query = idOrName.toLowerCase().trim();

        // 1. Direct file check by ID
        const directPath = path.join(this.snapshotsDir, `${idOrName}.json`);
        if (fs.existsSync(directPath)) {
            try {
                return JSON.parse(fs.readFileSync(directPath, 'utf8'));
            } catch {}
        }

        // 2. Search through files by ID or Name
        const files = fs.readdirSync(this.snapshotsDir).filter(f => f.endsWith('.json'));
        for (const f of files) {
            try {
                const fullPath = path.join(this.snapshotsDir, f);
                const data: StigixSnapshot = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                if (data.id.toLowerCase() === query || data.name.toLowerCase() === query) {
                    return data;
                }
            } catch {}
        }
        return null;
    }

    public deleteSnapshot(idOrName: string): boolean {
        const snapshot = this.getSnapshot(idOrName);
        if (!snapshot) return false;
        const filePath = path.join(this.snapshotsDir, `${snapshot.id}.json`);
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                return true;
            }
        } catch {}
        return false;
    }

    private enforceRetention(): void {
        try {
            const files = fs.readdirSync(this.snapshotsDir)
                .filter(f => f.endsWith('.json'))
                .map(f => ({ name: f, time: fs.statSync(path.join(this.snapshotsDir, f)).mtimeMs }))
                .sort((a, b) => b.time - a.time);

            if (files.length > this.maxSnapshots) {
                const toDelete = files.slice(this.maxSnapshots);
                for (const item of toDelete) {
                    fs.unlinkSync(path.join(this.snapshotsDir, item.name));
                }
            }
        } catch {}
    }

    public computeDiff(
        baseline: StigixSnapshot,
        target: StigixSnapshot
    ): SnapshotDiffResult {
        const regressions: string[] = [];
        const improvements: string[] = [];

        // 1. Tunnel Deltas (Stigix Mesh Peers)
        const baselineTunnelsMap = new Map<string, StigixSnapshotTunnel>();
        for (const t of baseline.tunnels || []) {
            baselineTunnelsMap.set(t.peerId.toLowerCase(), t);
        }

        const targetTunnelsMap = new Map<string, StigixSnapshotTunnel>();
        for (const t of target.tunnels || []) {
            targetTunnelsMap.set(t.peerId.toLowerCase(), t);
        }

        const tunnelDeltas: SnapshotTunnelDelta[] = [];
        const allPeerIds = new Set([...baselineTunnelsMap.keys(), ...targetTunnelsMap.keys()]);

        let tunnelsUpBefore = 0;
        let tunnelsUpAfter = 0;

        for (const peerId of allPeerIds) {
            const b = baselineTunnelsMap.get(peerId);
            const t = targetTunnelsMap.get(peerId);

            if (b?.status === 'UP') tunnelsUpBefore++;
            if (t?.status === 'UP') tunnelsUpAfter++;

            if (!b && t) {
                tunnelDeltas.push({
                    peerId,
                    siteName: t.siteName,
                    endpoint: t.endpoint,
                    ipPrivate: t.ipPrivate,
                    statusBefore: 'NONE',
                    statusAfter: t.status,
                    stateChange: 'NEW'
                });
                improvements.push(`New mesh tunnel established to ${t.siteName || peerId} (Status: ${t.status})`);
            } else if (b && !t) {
                tunnelDeltas.push({
                    peerId,
                    siteName: b.siteName,
                    endpoint: b.endpoint,
                    ipPrivate: b.ipPrivate,
                    statusBefore: b.status,
                    statusAfter: 'NONE',
                    stateChange: 'REMOVED'
                });
                regressions.push(`Tunnel to ${b.siteName || peerId} was removed or disappeared`);
            } else if (b && t) {
                let stateChange: SnapshotTunnelDelta['stateChange'] = 'STABLE_UP';
                if (b.status === 'UP' && t.status !== 'UP') {
                    stateChange = 'FAILED';
                    regressions.push(`CRITICAL: Tunnel to ${t.siteName || peerId} went DOWN (was UP in baseline)`);
                } else if (b.status !== 'UP' && t.status === 'UP') {
                    stateChange = 'RECOVERED';
                    improvements.push(`Tunnel to ${t.siteName || peerId} recovered and is now UP`);
                } else if (b.status !== 'UP' && t.status !== 'UP') {
                    stateChange = 'STABLE_DOWN';
                }

                tunnelDeltas.push({
                    peerId,
                    siteName: t.siteName || b.siteName,
                    endpoint: t.endpoint || b.endpoint,
                    ipPrivate: t.ipPrivate || b.ipPrivate,
                    statusBefore: b.status,
                    statusAfter: t.status,
                    stateChange,
                    transferRxDiff: (t.transferRxBytes || 0) - (b.transferRxBytes || 0),
                    transferTxDiff: (t.transferTxBytes || 0) - (b.transferTxBytes || 0)
                });
            }
        }

        // 2. DEM / Probe Deltas
        const baselineDemMap = new Map<string, StigixSnapshotDemMetric>();
        for (const d of baseline.demMatrix || []) {
            baselineDemMap.set((d.targetPeer || '').toLowerCase(), d);
        }

        const targetDemMap = new Map<string, StigixSnapshotDemMetric>();
        for (const d of target.demMatrix || []) {
            targetDemMap.set((d.targetPeer || '').toLowerCase(), d);
        }

        const demDeltas: SnapshotDemDelta[] = [];
        const allDemTargets = new Set([...baselineDemMap.keys(), ...targetDemMap.keys()]);

        for (const targetKey of allDemTargets) {
            const b = baselineDemMap.get(targetKey);
            const t = targetDemMap.get(targetKey);

            if (!b && t) {
                demDeltas.push({
                    target: t.targetName || t.targetPeer,
                    targetUrl: t.targetUrl,
                    type: t.targetType,
                    statusBefore: 'NONE',
                    statusAfter: t.status || 'PASS',
                    scoreAfter: t.score,
                    httpCodeAfter: t.httpCode,
                    latencyAfter: t.latencyAvgMs,
                    packetLossAfter: t.packetLossPercent,
                    jitterAfter: t.jitterMs,
                    mosAfter: t.mosScore,
                    state: 'NEW'
                });
            } else if (b && !t) {
                demDeltas.push({
                    target: b.targetName || b.targetPeer,
                    targetUrl: b.targetUrl,
                    type: b.targetType,
                    statusBefore: b.status || 'PASS',
                    statusAfter: 'NONE',
                    scoreBefore: b.score,
                    httpCodeBefore: b.httpCode,
                    latencyBefore: b.latencyAvgMs,
                    packetLossBefore: b.packetLossPercent,
                    jitterBefore: b.jitterMs,
                    mosBefore: b.mosScore,
                    state: 'REMOVED'
                });
                regressions.push(`Probe to ${b.targetName || b.targetPeer} is no longer being monitored`);
            } else if (b && t) {
                let state: SnapshotDemDelta['state'] = 'STABLE';

                const latBefore = b.latencyAvgMs;
                const latAfter = t.latencyAvgMs;
                let latDelta: number | undefined;
                let latPct: number | undefined;

                if (typeof latBefore === 'number' && typeof latAfter === 'number') {
                    latDelta = parseFloat((latAfter - latBefore).toFixed(2));
                    latPct = latBefore > 0 ? parseFloat((((latAfter - latBefore) / latBefore) * 100).toFixed(1)) : 0;

                    // Latency improvement (-15% and >= 3ms)
                    if (latDelta <= -3 && latPct <= -15) {
                        state = 'IMPROVED';
                        improvements.push(`Latency to ${t.targetName || t.targetPeer} decreased by ${Math.abs(latDelta)}ms (${Math.abs(latPct)}%)`);
                    }
                    // Latency regression (+20% and >= 5ms)
                    else if (latDelta >= 5 && latPct >= 20) {
                        state = 'REGRESSED';
                        regressions.push(`Latency to ${t.targetName || t.targetPeer} increased by +${latDelta}ms (+${latPct}%)`);
                    }
                }

                const lossBefore = b.packetLossPercent ?? 0;
                const lossAfter = t.packetLossPercent ?? 0;
                const lossDelta = parseFloat((lossAfter - lossBefore).toFixed(2));

                if (lossDelta > 0) {
                    state = 'REGRESSED';
                    regressions.push(`Packet loss to ${t.targetName || t.targetPeer} increased by +${lossDelta}% (was ${lossBefore}%, now ${lossAfter}%)`);
                } else if (lossDelta < 0) {
                    state = 'IMPROVED';
                    improvements.push(`Packet loss to ${t.targetName || t.targetPeer} reduced by ${Math.abs(lossDelta)}%`);
                }

                // Check reachability transition
                if (b.status === 'PASS' && t.status === 'FAIL') {
                    state = 'REGRESSED';
                    if (lossDelta === 0) {
                        regressions.push(`Probe "${t.targetName || t.targetPeer}" went DOWN / UNREACHABLE`);
                    }
                } else if (b.status === 'FAIL' && t.status === 'PASS') {
                    state = 'IMPROVED';
                    improvements.push(`Probe "${t.targetName || t.targetPeer}" recovered and is now REACHABLE`);
                }

                const jitterBefore = b.jitterMs;
                const jitterAfter = t.jitterMs;
                let jitterDelta: number | undefined;
                if (typeof jitterBefore === 'number' && typeof jitterAfter === 'number') {
                    jitterDelta = parseFloat((jitterAfter - jitterBefore).toFixed(2));
                    if (jitterDelta > 10) {
                        state = 'REGRESSED';
                        regressions.push(`Jitter to ${t.targetName || t.targetPeer} surged by +${jitterDelta}ms`);
                    }
                }

                const scoreDelta = (typeof b.score === 'number' && typeof t.score === 'number')
                    ? parseFloat((t.score - b.score).toFixed(1))
                    : undefined;

                demDeltas.push({
                    target: t.targetName || t.targetPeer,
                    targetUrl: t.targetUrl || b.targetUrl,
                    type: t.targetType || b.targetType,
                    statusBefore: b.status || 'UNKNOWN',
                    statusAfter: t.status || 'UNKNOWN',
                    scoreBefore: b.score,
                    scoreAfter: t.score,
                    scoreDelta,
                    httpCodeBefore: b.httpCode,
                    httpCodeAfter: t.httpCode,
                    latencyBefore: latBefore,
                    latencyAfter: latAfter,
                    latencyDeltaMs: latDelta,
                    latencyPercentChange: latPct,
                    packetLossBefore: lossBefore,
                    packetLossAfter: lossAfter,
                    packetLossDelta: lossDelta,
                    jitterBefore,
                    jitterAfter,
                    jitterDeltaMs: jitterDelta,
                    mosBefore: b.mosScore,
                    mosAfter: t.mosScore,
                    mosDelta: (b.mosScore && t.mosScore) ? parseFloat((t.mosScore - b.mosScore).toFixed(2)) : undefined,
                    state
                });
            }
        }

        // 3. SD-WAN Overlay (Prisma SD-WAN Sites, IONs, WAN Circuits & SASE Service Links) Deltas
        const baselineSdwanMap = new Map<string, StigixSnapshotSdwanSite>();
        for (const s of baseline.sdwanTopology?.sites || []) {
            baselineSdwanMap.set(s.siteName.toLowerCase(), s);
        }

        const targetSdwanMap = new Map<string, StigixSnapshotSdwanSite>();
        for (const s of target.sdwanTopology?.sites || []) {
            targetSdwanMap.set(s.siteName.toLowerCase(), s);
        }

        const sdwanDeltas: SnapshotSdwanSiteDelta[] = [];
        const allSdwanSites = new Set([...baselineSdwanMap.keys(), ...targetSdwanMap.keys()]);

        let sdwanSitesOnlineBefore = 0;
        let sdwanSitesOnlineAfter = 0;
        let sdwanDevicesDisconnected = 0;
        let saseLinksUpBefore = baseline.sdwanTopology?.saseSummary?.upServiceLinks ?? 0;
        let saseLinksUpAfter = target.sdwanTopology?.saseSummary?.upServiceLinks ?? 0;
        let saseLinksTotal = target.sdwanTopology?.saseSummary?.totalServiceLinks ?? baseline.sdwanTopology?.saseSummary?.totalServiceLinks ?? 0;

        for (const siteKey of allSdwanSites) {
            const b = baselineSdwanMap.get(siteKey);
            const t = targetSdwanMap.get(siteKey);

            if (b?.connected) sdwanSitesOnlineBefore++;
            if (t?.connected) sdwanSitesOnlineAfter++;

            if (!b && t) {
                sdwanDeltas.push({
                    siteId: t.siteId,
                    siteName: t.siteName,
                    role: t.role,
                    connectedBefore: false,
                    connectedAfter: t.connected,
                    stateChange: 'NEW',
                    deviceChanges: (t.devices || []).map(d => ({
                        deviceId: d.deviceId,
                        deviceName: d.deviceName,
                        model: d.model,
                        softwareVersion: d.softwareVersion,
                        connectedBefore: false,
                        connectedAfter: d.connected,
                        wanUpBefore: 0,
                        wanUpAfter: d.wanUpCount ?? (d.wanIps?.length || 0),
                        wanTotal: d.wanTotalCount ?? (d.wanIps?.length || 0),
                        serviceLinksUpBefore: 0,
                        serviceLinksUpAfter: d.serviceLinksUpCount ?? 0,
                        serviceLinksTotal: d.serviceLinksTotalCount ?? 0,
                        wanIps: d.wanIps,
                        lanIps: d.lanIps,
                        stateChange: 'NEW'
                    }))
                });
                improvements.push(`SD-WAN Site "${t.siteName}" (${t.role}) joined overlay`);
            } else if (b && !t) {
                sdwanDeltas.push({
                    siteId: b.siteId,
                    siteName: b.siteName,
                    role: b.role,
                    connectedBefore: b.connected,
                    connectedAfter: false,
                    stateChange: 'REMOVED',
                    deviceChanges: (b.devices || []).map(d => ({
                        deviceId: d.deviceId,
                        deviceName: d.deviceName,
                        model: d.model,
                        softwareVersion: d.softwareVersion,
                        connectedBefore: d.connected,
                        connectedAfter: false,
                        wanUpBefore: d.wanUpCount ?? (d.wanIps?.length || 0),
                        wanUpAfter: 0,
                        wanTotal: d.wanTotalCount ?? (d.wanIps?.length || 0),
                        serviceLinksUpBefore: d.serviceLinksUpCount ?? 0,
                        serviceLinksUpAfter: 0,
                        serviceLinksTotal: d.serviceLinksTotalCount ?? 0,
                        wanIps: d.wanIps,
                        lanIps: d.lanIps,
                        stateChange: 'REMOVED'
                    }))
                });
                regressions.push(`CRITICAL: SD-WAN Site "${b.siteName}" disappeared from overlay`);
            } else if (b && t) {
                const deviceChanges: SnapshotSdwanDeviceDelta[] = [];
                let siteLinksDegraded = false;
                let siteLinksImproved = false;

                const allDevs = new Map<string, { bDev?: StigixSnapshotSdwanDevice; tDev?: StigixSnapshotSdwanDevice }>();
                for (const d of b.devices || []) {
                    allDevs.set((d.deviceId || d.deviceName).toLowerCase(), { bDev: d });
                }
                for (const d of t.devices || []) {
                    const key = (d.deviceId || d.deviceName).toLowerCase();
                    const existing = allDevs.get(key) || {};
                    allDevs.set(key, { ...existing, tDev: d });
                }

                for (const { bDev, tDev } of allDevs.values()) {
                    if (bDev && tDev) {
                        const wanUpB = bDev.wanUpCount ?? (bDev.wanIps?.length || 0);
                        const wanUpT = tDev.wanUpCount ?? (tDev.wanIps?.length || 0);
                        const wanTot = Math.max(bDev.wanTotalCount ?? 0, tDev.wanTotalCount ?? 0, wanUpB, wanUpT);

                        const slUpB = bDev.serviceLinksUpCount ?? 0;
                        const slUpT = tDev.serviceLinksUpCount ?? 0;
                        const slTot = Math.max(bDev.serviceLinksTotalCount ?? 0, tDev.serviceLinksTotalCount ?? 0, slUpB, slUpT);

                        let devState: SnapshotSdwanDeviceDelta['stateChange'] = tDev.connected ? 'STABLE_ONLINE' : 'STABLE_OFFLINE';

                        if (bDev.connected && !tDev.connected) {
                            devState = 'DISCONNECTED';
                            sdwanDevicesDisconnected++;
                            regressions.push(`CRITICAL: SD-WAN ION "${bDev.deviceName}" on Site "${t.siteName}" went OFFLINE / DISCONNECTED`);
                        } else if (!bDev.connected && tDev.connected) {
                            devState = 'RECONNECTED';
                            improvements.push(`SD-WAN ION "${bDev.deviceName}" on Site "${t.siteName}" recovered / CONNECTED`);
                        } else if (wanUpT < wanUpB || slUpT < slUpB) {
                            devState = 'DEGRADED_LINKS';
                            siteLinksDegraded = true;
                            if (slUpT < slUpB) {
                                regressions.push(`SD-WAN SASE Service Links on "${t.siteName}" (${tDev.deviceName}) degraded: ${slUpB}/${slTot} UP → ${slUpT}/${slTot} UP`);
                            }
                            if (wanUpT < wanUpB) {
                                regressions.push(`SD-WAN WAN Circuits on "${t.siteName}" (${tDev.deviceName}) degraded: ${wanUpB}/${wanTot} UP → ${wanUpT}/${wanTot} UP`);
                            }
                        } else if (wanUpT > wanUpB || slUpT > slUpB) {
                            devState = 'IMPROVED_LINKS';
                            siteLinksImproved = true;
                            improvements.push(`SD-WAN links on "${t.siteName}" (${tDev.deviceName}) recovered (${wanUpT}/${wanTot} WAN, ${slUpT}/${slTot} SASE UP)`);
                        }

                        deviceChanges.push({
                            deviceId: tDev.deviceId || bDev.deviceId,
                            deviceName: tDev.deviceName || bDev.deviceName,
                            model: tDev.model || bDev.model,
                            softwareVersion: tDev.softwareVersion || bDev.softwareVersion,
                            connectedBefore: bDev.connected,
                            connectedAfter: tDev.connected,
                            wanUpBefore: wanUpB,
                            wanUpAfter: wanUpT,
                            wanTotal: wanTot,
                            serviceLinksUpBefore: slUpB,
                            serviceLinksUpAfter: slUpT,
                            serviceLinksTotal: slTot,
                            wanIps: tDev.wanIps?.length ? tDev.wanIps : bDev.wanIps,
                            lanIps: tDev.lanIps?.length ? tDev.lanIps : bDev.lanIps,
                            stateChange: devState
                        });
                    }
                }

                let stateChange: SnapshotSdwanSiteDelta['stateChange'] = 'STABLE_ONLINE';
                if (b.connected && !t.connected) {
                    stateChange = 'DISCONNECTED';
                } else if (!b.connected && t.connected) {
                    stateChange = 'RECONNECTED';
                } else if (!b.connected && !t.connected) {
                    stateChange = 'STABLE_OFFLINE';
                } else if (siteLinksDegraded) {
                    stateChange = 'DEGRADED';
                } else if (siteLinksImproved) {
                    stateChange = 'IMPROVED';
                }

                // Always include all SD-WAN sites in sdwanDeltas so the user can inspect the full overlay state
                sdwanDeltas.push({
                    siteId: t.siteId,
                    siteName: t.siteName,
                    role: t.role,
                    connectedBefore: b.connected,
                    connectedAfter: t.connected,
                    stateChange,
                    deviceChanges
                });
            }
        }

        // 4. VyOS Underlay & Chaos / QoS Impairments Deltas
        let sdwanUnderlayDelta: SnapshotSdwanUnderlayDelta | undefined = undefined;
        if (baseline.sdwanTopology?.underlay || target.sdwanTopology?.underlay) {
            const bU = baseline.sdwanTopology?.underlay;
            const tU = target.sdwanTopology?.underlay;
            const bRouters = (bU?.routers || []) as any[];
            const tRouters = (tU?.routers || []) as any[];

            const bRouterNames = bRouters.map(r => r.name || r.id || r.host || String(r));
            const tRouterMap = new Map<string, any>();
            tRouters.forEach(r => {
                const key = r.name || r.id || r.host || String(r);
                tRouterMap.set(key, r);
            });

            const offlineRouters: string[] = [];
            for (const r of bRouters) {
                const name = r.name || r.id || r.host || String(r);
                const tR = tRouterMap.get(name);
                const isOnline = tR && (typeof tR === 'string' ? true : (tR.status === 'online' || tR.status === 'up'));
                if (!isOnline) {
                    offlineRouters.push(name);
                }
            }

            if (offlineRouters.length > 0) {
                regressions.push(`CRITICAL: VyOS Underlay router(s) unreachable: ${offlineRouters.join(', ')}`);
            }

            sdwanUnderlayDelta = {
                availableBefore: bU?.available,
                availableAfter: tU?.available,
                matchedBefore: bU?.matchedCount,
                matchedAfter: tU?.matchedCount,
                matchedDelta: (tU?.matchedCount ?? 0) - (bU?.matchedCount ?? 0),
                routersBefore: bRouterNames,
                routersAfter: Array.from(tRouterMap.keys()),
                offlineRouters
            };
        }

        // Detailed VyOS Router & Interface QoS Impairment Deltas
        let vyosDelta: SnapshotVyosDelta | undefined = undefined;
        if (baseline.vyos || target.vyos) {
            const bVyos = baseline.vyos;
            const tVyos = target.vyos;
            const interfaceDeltas: SnapshotVyosImpairmentDelta[] = [];

            const bRouterMap = new Map<string, StigixSnapshotVyosRouter>();
            for (const r of bVyos?.routers || []) {
                bRouterMap.set((r.id || r.name).toLowerCase(), r);
            }
            const tRouterMap = new Map<string, StigixSnapshotVyosRouter>();
            for (const r of tVyos?.routers || []) {
                tRouterMap.set((r.id || r.name).toLowerCase(), r);
            }

            const allRouterKeys = new Set([...bRouterMap.keys(), ...tRouterMap.keys()]);
            for (const rKey of allRouterKeys) {
                const bR = bRouterMap.get(rKey);
                const tR = tRouterMap.get(rKey);
                const rName = tR?.name || bR?.name || rKey;
                const rId = tR?.id || bR?.id || rKey;

                if (bR?.status === 'online' && tR?.status === 'offline') {
                    regressions.push(`CRITICAL: VyOS router "${rName}" went OFFLINE`);
                } else if (bR?.status === 'offline' && tR?.status === 'online') {
                    improvements.push(`VyOS router "${rName}" came back ONLINE`);
                }

                const bIfaceMap = new Map<string, StigixSnapshotVyosInterface>();
                for (const i of bR?.interfaces || []) bIfaceMap.set(i.name, i);
                const tIfaceMap = new Map<string, StigixSnapshotVyosInterface>();
                for (const i of tR?.interfaces || []) tIfaceMap.set(i.name, i);

                const allIfaces = new Set([...bIfaceMap.keys(), ...tIfaceMap.keys()]);
                for (const ifName of allIfaces) {
                    const bIf = bIfaceMap.get(ifName);
                    const tIf = tIfaceMap.get(ifName);
                    const statusB = bIf?.status || 'up';
                    const statusT = tIf?.status || 'up';
                    const latB = bIf?.latencyMs ?? 0;
                    const latT = tIf?.latencyMs ?? 0;
                    const lossB = bIf?.lossPct ?? 0;
                    const lossT = tIf?.lossPct ?? 0;
                    const changed = statusB !== statusT || latB !== latT || lossB !== lossT;

                    if (changed || latB > 0 || latT > 0 || lossB > 0 || lossT > 0 || statusB === 'down' || statusT === 'down') {
                        interfaceDeltas.push({
                            routerId: rId,
                            routerName: rName,
                            interfaceName: ifName,
                            description: tIf?.description || bIf?.description,
                            statusBefore: statusB,
                            statusAfter: statusT,
                            latencyBeforeMs: latB,
                            latencyAfterMs: latT,
                            latencyDeltaMs: latT - latB,
                            lossBeforePct: lossB,
                            lossAfterPct: lossT,
                            lossDeltaPct: lossT - lossB,
                            changed
                        });

                        if (statusB === 'up' && statusT === 'down') {
                            regressions.push(`VyOS interface ${rName}:${ifName} (${tIf?.description || 'WAN'}) was shut DOWN`);
                        } else if (statusB === 'down' && statusT === 'up') {
                            improvements.push(`VyOS interface ${rName}:${ifName} (${tIf?.description || 'WAN'}) came UP`);
                        }

                        if (latT > latB) {
                            regressions.push(`VyOS QoS latency impairment added on ${rName}:${ifName}: ${latB}ms → ${latT}ms (+${latT - latB}ms)`);
                        } else if (latT < latB) {
                            improvements.push(`VyOS QoS latency impairment reduced on ${rName}:${ifName}: ${latB}ms → ${latT}ms`);
                        }

                        if (lossT > lossB) {
                            regressions.push(`VyOS QoS packet loss impairment added on ${rName}:${ifName}: ${lossB}% → ${lossT}%`);
                        } else if (lossT < lossB) {
                            improvements.push(`VyOS QoS packet loss impairment cleared on ${rName}:${ifName}: ${lossB}% → ${lossT}%`);
                        }
                    }
                }
            }

            const blackholesBefore = (bVyos?.routers || []).flatMap(r => r.blackholes.map(bh => `${r.name}:${bh}`));
            const blackholesAfter = (tVyos?.routers || []).flatMap(r => r.blackholes.map(bh => `${r.name}:${bh}`));

            vyosDelta = {
                routersTotalBefore: bVyos?.routerCount ?? 0,
                routersTotalAfter: tVyos?.routerCount ?? 0,
                routersOnlineBefore: bVyos?.onlineCount ?? 0,
                routersOnlineAfter: tVyos?.onlineCount ?? 0,
                impairmentsBefore: bVyos?.activeImpairmentsCount ?? 0,
                impairmentsAfter: tVyos?.activeImpairmentsCount ?? 0,
                blackholesBefore,
                blackholesAfter,
                interfaceDeltas
            };
        }

        // 5. Voice / RTP MOS QoE Deltas
        let voiceDelta: SnapshotVoiceDelta | undefined = undefined;
        if (baseline.voice || target.voice) {
            const bV = baseline.voice;
            const tV = target.voice;

            const mosDelta = (typeof bV?.avgMos === 'number' && typeof tV?.avgMos === 'number')
                ? parseFloat((tV.avgMos - bV.avgMos).toFixed(2))
                : undefined;
            const rttDeltaMs = (typeof bV?.avgRttMs === 'number' && typeof tV?.avgRttMs === 'number')
                ? parseFloat((tV.avgRttMs - bV.avgRttMs).toFixed(2))
                : undefined;
            const jitterDeltaMs = (typeof bV?.avgJitterMs === 'number' && typeof tV?.avgJitterMs === 'number')
                ? parseFloat((tV.avgJitterMs - bV.avgJitterMs).toFixed(2))
                : undefined;
            const lossDeltaPct = (typeof bV?.avgLossPct === 'number' && typeof tV?.avgLossPct === 'number')
                ? parseFloat((tV.avgLossPct - bV.avgLossPct).toFixed(2))
                : undefined;

            if (typeof mosDelta === 'number') {
                if (mosDelta <= -0.25 || (typeof tV?.avgMos === 'number' && tV.avgMos < 3.6 && (bV?.avgMos ?? 4.0) >= 3.6)) {
                    regressions.push(`Voice QoE MOS degraded from ${bV?.avgMos?.toFixed(2)} to ${tV?.avgMos?.toFixed(2)} (${mosDelta > 0 ? '+' : ''}${mosDelta.toFixed(2)})`);
                } else if (mosDelta >= 0.25) {
                    improvements.push(`Voice QoE MOS improved from ${bV?.avgMos?.toFixed(2)} to ${tV?.avgMos?.toFixed(2)} (+${mosDelta.toFixed(2)})`);
                }
            }

            const bTargetMap = new Map<string, StigixSnapshotVoiceTarget>();
            for (const vt of bV?.targets || []) bTargetMap.set(vt.target.toLowerCase(), vt);
            const tTargetMap = new Map<string, StigixSnapshotVoiceTarget>();
            for (const vt of tV?.targets || []) tTargetMap.set(vt.target.toLowerCase(), vt);

            const targetDeltas: SnapshotVoiceTargetDelta[] = [];
            const allVoiceTargets = new Set([...bTargetMap.keys(), ...tTargetMap.keys()]);

            for (const tk of allVoiceTargets) {
                const bT = bTargetMap.get(tk);
                const tT = tTargetMap.get(tk);

                if (bT && tT) {
                    const tMosDelta = parseFloat((tT.avgMos - bT.avgMos).toFixed(2));
                    const tRttDelta = parseFloat((tT.avgRttMs - bT.avgRttMs).toFixed(2));
                    const tJitDelta = parseFloat((tT.avgJitterMs - bT.avgJitterMs).toFixed(2));
                    const tLossDelta = parseFloat((tT.avgLossPct - bT.avgLossPct).toFixed(2));
                    let vState: SnapshotVoiceTargetDelta['state'] = 'STABLE';
                    if (tMosDelta <= -0.2 || tLossDelta >= 1 || tRttDelta >= 15) vState = 'REGRESSED';
                    else if (tMosDelta >= 0.2 || (tLossDelta <= -1) || tRttDelta <= -15) vState = 'IMPROVED';

                    targetDeltas.push({
                        target: tT.target,
                        codec: tT.codec || bT.codec,
                        callsBefore: bT.calls,
                        callsAfter: tT.calls,
                        mosBefore: bT.avgMos,
                        mosAfter: tT.avgMos,
                        mosDelta: tMosDelta,
                        rttBefore: bT.avgRttMs,
                        rttAfter: tT.avgRttMs,
                        rttDeltaMs: tRttDelta,
                        jitterBefore: bT.avgJitterMs,
                        jitterAfter: tT.avgJitterMs,
                        jitterDeltaMs: tJitDelta,
                        lossBefore: bT.avgLossPct,
                        lossAfter: tT.avgLossPct,
                        lossDeltaPct: tLossDelta,
                        state: vState
                    });
                } else if (!bT && tT) {
                    targetDeltas.push({
                        target: tT.target,
                        codec: tT.codec,
                        callsBefore: 0,
                        callsAfter: tT.calls,
                        mosAfter: tT.avgMos,
                        rttAfter: tT.avgRttMs,
                        jitterAfter: tT.avgJitterMs,
                        lossAfter: tT.avgLossPct,
                        state: 'NEW'
                    });
                } else if (bT && !tT) {
                    targetDeltas.push({
                        target: bT.target,
                        codec: bT.codec,
                        callsBefore: bT.calls,
                        callsAfter: 0,
                        mosBefore: bT.avgMos,
                        rttBefore: bT.avgRttMs,
                        jitterBefore: bT.avgJitterMs,
                        lossBefore: bT.avgLossPct,
                        state: 'REMOVED'
                    });
                }
            }

            voiceDelta = {
                enabledBefore: Boolean(bV?.enabled),
                enabledAfter: Boolean(tV?.enabled),
                sampleCountBefore: bV?.sampleCount ?? 0,
                sampleCountAfter: tV?.sampleCount ?? 0,
                avgMosBefore: bV?.avgMos,
                avgMosAfter: tV?.avgMos,
                mosDelta,
                minMosBefore: bV?.minMos,
                minMosAfter: tV?.minMos,
                avgRttBefore: bV?.avgRttMs,
                avgRttAfter: tV?.avgRttMs,
                rttDeltaMs,
                avgJitterBefore: bV?.avgJitterMs,
                avgJitterAfter: tV?.avgJitterMs,
                jitterDeltaMs,
                avgLossBefore: bV?.avgLossPct,
                avgLossAfter: tV?.avgLossPct,
                lossDeltaPct,
                targets: targetDeltas
            };
        }

        // 6. Score & Verdict Calculation
        let score = 100;
        // Critical penalty: Stigix Mesh tunnel went down (-40 each)
        const failedTunnels = tunnelDeltas.filter(t => t.stateChange === 'FAILED');
        score -= failedTunnels.length * 40;

        // Critical penalty: SD-WAN ION device disconnected (-30 each)
        score -= sdwanDevicesDisconnected * 30;

        // Critical penalty: Underlay router offline (-25 each)
        if (sdwanUnderlayDelta?.offlineRouters?.length) {
            score -= sdwanUnderlayDelta.offlineRouters.length * 25;
        }

        // Packet loss regressions (-20 each)
        const packetLossRegressions = demDeltas.filter(d => (d.packetLossDelta || 0) > 0);
        score -= packetLossRegressions.length * 20;

        // Latency regressions (-10 each)
        const latencyRegressions = demDeltas.filter(d => (d.latencyDeltaMs || 0) > 5 && (d.latencyPercentChange || 0) > 20);
        score -= latencyRegressions.length * 10;

        // Voice MOS degradation penalty (-15)
        if (voiceDelta?.mosDelta !== undefined && voiceDelta.mosDelta <= -0.3) {
            score -= 15;
        }

        score = Math.max(0, Math.min(100, score));

        let verdict: 'GO' | 'WARNING' | 'NO_GO' = 'GO';
        if (failedTunnels.length > 0 || sdwanDevicesDisconnected > 0 || (sdwanUnderlayDelta?.offlineRouters?.length || 0) > 0 || score < 50) {
            verdict = 'NO_GO';
        } else if (regressions.length > 0 || score < 85) {
            verdict = 'WARNING';
        }

        return {
            baseline: {
                id: baseline.id,
                name: baseline.name,
                timestamp: baseline.timestamp,
                node: baseline.node
            },
            target: {
                id: target.id,
                name: target.name,
                timestamp: target.timestamp,
                node: target.node
            },
            summary: {
                verdict,
                score,
                totalTunnels: {
                    before: baseline.tunnels?.length || 0,
                    after: target.tunnels?.length || 0,
                    delta: (target.tunnels?.length || 0) - (baseline.tunnels?.length || 0)
                },
                tunnelsUp: {
                    before: tunnelsUpBefore,
                    after: tunnelsUpAfter,
                    delta: tunnelsUpAfter - tunnelsUpBefore
                },
                totalProbes: {
                    before: baseline.demMatrix?.length || 0,
                    after: target.demMatrix?.length || 0,
                    delta: (target.demMatrix?.length || 0) - (baseline.demMatrix?.length || 0)
                },
                sdwanSites: {
                    before: baseline.sdwanTopology?.siteCount || 0,
                    after: target.sdwanTopology?.siteCount || 0,
                    delta: (target.sdwanTopology?.siteCount || 0) - (baseline.sdwanTopology?.siteCount || 0),
                    onlineBefore: sdwanSitesOnlineBefore,
                    onlineAfter: sdwanSitesOnlineAfter,
                    saseLinksUpBefore,
                    saseLinksUpAfter,
                    saseLinksTotal
                },
                voiceMos: {
                    before: baseline.voice?.avgMos,
                    after: target.voice?.avgMos,
                    delta: voiceDelta?.mosDelta
                },
                vyosImpairments: {
                    before: baseline.vyos?.activeImpairmentsCount ?? 0,
                    after: target.vyos?.activeImpairmentsCount ?? 0,
                    delta: (target.vyos?.activeImpairmentsCount ?? 0) - (baseline.vyos?.activeImpairmentsCount ?? 0)
                },
                healthScore: {
                    before: baseline.healthScore,
                    after: target.healthScore,
                    delta: (baseline.healthScore !== undefined && target.healthScore !== undefined)
                        ? parseFloat((target.healthScore - baseline.healthScore).toFixed(1))
                        : undefined
                }
            },
            regressions,
            improvements,
            tunnelDeltas,
            demDeltas,
            sdwanDeltas,
            sdwanUnderlayDelta,
            voiceDelta,
            vyosDelta
        };
    }
}
