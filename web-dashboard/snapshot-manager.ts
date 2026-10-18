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
    latencyAvgMs?: number;
    latencyMinMs?: number;
    latencyP95Ms?: number;
    jitterMs?: number;
    packetLossPercent?: number;
    mosScore?: number;
    status?: 'PASS' | 'FAIL' | 'WARN' | 'UNKNOWN';
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
    underlay?: {
        available: boolean;
        matchedCount: number;
        noMatchCount: number;
        routers: string[];
    };
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
    sdwanSiteCount?: number;
    sdwanSitesOnline?: number;
    healthScore?: number;
    tags?: string[];
}

export interface SnapshotTunnelDelta {
    peerId: string;
    siteName?: string;
    statusBefore?: string;
    statusAfter?: string;
    stateChange: 'RECOVERED' | 'FAILED' | 'STABLE_UP' | 'STABLE_DOWN' | 'NEW' | 'REMOVED';
    transferRxDiff?: number;
    transferTxDiff?: number;
}

export interface SnapshotDemDelta {
    target: string;
    type?: string;
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
    connectedBefore: boolean;
    connectedAfter: boolean;
    stateChange: 'DISCONNECTED' | 'RECONNECTED' | 'STABLE_ONLINE' | 'STABLE_OFFLINE' | 'NEW' | 'REMOVED';
}

export interface SnapshotSdwanSiteDelta {
    siteId: string;
    siteName: string;
    role: string;
    connectedBefore: boolean;
    connectedAfter: boolean;
    stateChange: 'STABLE_ONLINE' | 'STABLE_OFFLINE' | 'DISCONNECTED' | 'RECONNECTED' | 'NEW' | 'REMOVED';
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
        sdwanSites?: { before: number; after: number; delta: number; onlineBefore: number; onlineAfter: number };
        healthScore: { before?: number; after?: number; delta?: number };
    };
    regressions: string[];
    improvements: string[];
    tunnelDeltas: SnapshotTunnelDelta[]; // Stigix Mesh peers deltas
    demDeltas: SnapshotDemDelta[];
    sdwanDeltas?: SnapshotSdwanSiteDelta[]; // SD-WAN Overlay (IONs & Sites) deltas
    sdwanUnderlayDelta?: SnapshotSdwanUnderlayDelta;
}

export class SnapshotManager {
    private snapshotsDir: string;
    private maxSnapshots: number = 50;

    constructor(configDir: string) {
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

    public async captureState(options: {
        name: string;
        description?: string;
        tags?: string[];
        createdBy?: string;
        context?: {
            registryManager?: any;
            connectivityLogger?: any;
            getAllProbes?: () => any[];
            getSystemSettings?: () => any;
            underlayTopologyManager?: any;
            getTopology?: () => Promise<any> | any;
            version?: string;
        };
    }): Promise<StigixSnapshot> {
        const ctx = options.context || {};
        const regStatus = ctx.registryManager?.getStatus?.() || {};
        const siteName = ctx.registryManager?.getSiteName?.() || process.env.STIGIX_SITE_NAME || 'LOCAL';
        const nodeId = regStatus.instance_id || 'local-node';
        const role = regStatus.current_mode || process.env.STIGIX_REGISTRY_MODE || 'peer';
        const wanIp = regStatus.detected_ip || regStatus.ip_public || undefined;

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
                const res = await ctx.connectivityLogger.getResults({ limit: 100 });
                probeResults = Array.isArray(res) ? res : (res?.results || []);
            } catch {}
        }

        for (const p of probes) {
            const probeId = (p.name || p.id || '').toLowerCase().replace(/\s+/g, '-');
            const recent = probeResults.find((r: any) => (r.endpointId || '').toLowerCase() === probeId || (r.name || '').toLowerCase() === probeId);
            
            demMatrix.push({
                targetPeer: p.name || p.id,
                targetName: p.name,
                targetType: (p.type || 'PING').toUpperCase(),
                latencyAvgMs: recent?.latency ?? recent?.avg_latency ?? undefined,
                latencyMinMs: recent?.min_latency ?? undefined,
                latencyP95Ms: recent?.p95_latency ?? undefined,
                jitterMs: recent?.jitter ?? undefined,
                packetLossPercent: recent?.packet_loss ?? (recent?.success === false ? 100 : 0),
                mosScore: recent?.mos ?? undefined,
                status: recent ? (recent.success ? 'PASS' : 'FAIL') : 'UNKNOWN'
            });
        }

        // 3. Gather SD-WAN Overlay (Prisma SD-WAN IONs & Sites) + VyOS Underlay
        let sdwanTopology: StigixSnapshotSdwanTopology | undefined = undefined;
        if (ctx.getTopology) {
            try {
                const topoData = typeof ctx.getTopology === 'function' ? await ctx.getTopology() : ctx.getTopology;
                if (topoData && Array.isArray(topoData.sites)) {
                    const sites: StigixSnapshotSdwanSite[] = topoData.sites.map((s: any) => {
                        const devices: StigixSnapshotSdwanDevice[] = (s.devices || []).map((d: any) => {
                            const isConnected = Boolean(
                                d.connected || 
                                d.state === 'online' ||
                                (Array.isArray(d.wan_interfaces) && d.wan_interfaces.some((w: any) => w.link_up === true)) ||
                                (Array.isArray(d.service_links) && d.service_links.some((sl: any) => sl.operational_state === 'up' || sl.extended_state === 'tunnel_up'))
                            );
                            return {
                                deviceId: d.device_id || d.id || '',
                                deviceName: d.device_name || d.name || 'ION',
                                model: d.model,
                                softwareVersion: d.software_version,
                                state: d.state,
                                connected: isConnected,
                                lanIps: (d.lan_interfaces || []).map((l: any) => l.ipv4_address || l.ip).filter(Boolean),
                                wanIps: (d.wan_interfaces || []).map((w: any) => w.ipv4_address || w.ip).filter(Boolean)
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

                    sdwanTopology = {
                        siteCount: sites.length,
                        sites,
                        underlay: underlayInfo
                    };
                }
            } catch (err: any) {
                console.error('[SNAPSHOT_MGR] Failed to capture SD-WAN topology:', err?.message || err);
            }
        }

        const timestamp = new Date().toISOString();
        const dateSlug = timestamp.replace(/[-:T]/g, '').slice(0, 14);
        const nameSlug = this.slugify(options.name);
        const id = `snap-${dateSlug}-${nameSlug}`;

        const snapshot: StigixSnapshot = {
            id,
            name: options.name.trim(),
            description: options.description?.trim(),
            timestamp,
            node: {
                nodeId,
                siteName,
                role,
                version: ctx.version || process.env.STIGIX_VERSION || '3.0.39',
                wanIp
            },
            tunnels,
            demMatrix,
            sdwanTopology,
            healthScore,
            metadata: {
                createdBy: options.createdBy || 'copilot',
                tags: options.tags || [],
                customData: {}
            }
        };

        await this.saveSnapshot(snapshot);
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
                list.push({
                    id: data.id,
                    name: data.name,
                    description: data.description,
                    timestamp: data.timestamp,
                    node: data.node,
                    tunnelCount: data.tunnels?.length || 0,
                    tunnelsUpCount: (data.tunnels || []).filter(t => t.status === 'UP').length,
                    probeCount: data.demMatrix?.length || 0,
                    sdwanSiteCount: data.sdwanTopology?.siteCount || 0,
                    sdwanSitesOnline: (data.sdwanTopology?.sites || []).filter(s => s.connected).length,
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

        // 1. Tunnel Deltas
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
                    statusBefore: 'NONE',
                    statusAfter: t.status,
                    stateChange: 'NEW'
                });
                improvements.push(`New tunnel established to ${t.siteName || peerId} (Status: ${t.status})`);
            } else if (b && !t) {
                tunnelDeltas.push({
                    peerId,
                    siteName: b.siteName,
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
                    type: t.targetType,
                    latencyAfter: t.latencyAvgMs,
                    packetLossAfter: t.packetLossPercent,
                    jitterAfter: t.jitterMs,
                    mosAfter: t.mosScore,
                    state: 'NEW'
                });
            } else if (b && !t) {
                demDeltas.push({
                    target: b.targetName || b.targetPeer,
                    type: b.targetType,
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

                demDeltas.push({
                    target: t.targetName || t.targetPeer,
                    type: t.targetType || b.targetType,
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

        // 3. SD-WAN Overlay (Prisma SD-WAN Sites & IONs) Deltas
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
                    deviceChanges: []
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
                    deviceChanges: []
                });
                regressions.push(`CRITICAL: SD-WAN Site "${b.siteName}" disappeared from overlay`);
            } else if (b && t) {
                const deviceChanges: SnapshotSdwanDeviceDelta[] = [];
                for (const bDev of b.devices || []) {
                    const tDev = (t.devices || []).find(d => d.deviceId === bDev.deviceId || d.deviceName === bDev.deviceName);
                    if (tDev) {
                        if (bDev.connected && !tDev.connected) {
                            deviceChanges.push({
                                deviceId: bDev.deviceId,
                                deviceName: bDev.deviceName,
                                model: bDev.model,
                                connectedBefore: true,
                                connectedAfter: false,
                                stateChange: 'DISCONNECTED'
                            });
                            sdwanDevicesDisconnected++;
                            regressions.push(`CRITICAL: SD-WAN ION "${bDev.deviceName}" on Site "${t.siteName}" went OFFLINE / DISCONNECTED`);
                        } else if (!bDev.connected && tDev.connected) {
                            deviceChanges.push({
                                deviceId: bDev.deviceId,
                                deviceName: bDev.deviceName,
                                model: bDev.model,
                                connectedBefore: false,
                                connectedAfter: true,
                                stateChange: 'RECONNECTED'
                            });
                            improvements.push(`SD-WAN ION "${bDev.deviceName}" on Site "${t.siteName}" recovered / CONNECTED`);
                        }
                    }
                }

                let stateChange: SnapshotSdwanSiteDelta['stateChange'] = 'STABLE_ONLINE';
                if (b.connected && !t.connected) {
                    stateChange = 'DISCONNECTED';
                } else if (!b.connected && t.connected) {
                    stateChange = 'RECONNECTED';
                } else if (!b.connected && !t.connected) {
                    stateChange = 'STABLE_OFFLINE';
                }

                if (deviceChanges.length > 0 || stateChange !== 'STABLE_ONLINE') {
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
        }

        // 4. VyOS Underlay Deltas
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
                const isOnline = tR && (tR.status === 'online' || tR.status === 'up');
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

        // 5. Score & Verdict Calculation
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
                    onlineAfter: sdwanSitesOnlineAfter
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
            sdwanUnderlayDelta
        };
    }
}
