import React, { useState, useEffect, useMemo } from 'react';
import { 
    Globe, RefreshCw, Search, Server, Gauge, 
    CheckCircle2, XCircle, ExternalLink, 
    Check, X, Filter, Copy, Clock, AlertTriangle, ShieldCheck,
    Zap, ChevronDown, ChevronRight, Play, Square, Radio, Phone, Pause, Activity, Trash2, CheckSquare
} from 'lucide-react';
import { cn } from './lib/utils';
import { usePeerContext } from './PeerContext';
import { FleetSkeleton } from './components/skeletons/FleetSkeleton';

interface FleetProps {
    token: string;
    onNavigate?: (view: any) => void;
}

type FleetEventCategory = 'tunnel' | 'config' | 'sla' | 'engine';
type FleetEventSeverity = 'info' | 'success' | 'warning' | 'critical';

interface FleetEvent {
    id: string;
    timestamp: string;
    epochMs?: number;
    epoch_ms?: number;
    category: FleetEventCategory;
    severity: FleetEventSeverity;
    site: string;
    instanceId?: string;
    instance_id?: string;
    title: string;
    details?: string;
    detail?: string;
}

interface PeerInstance {
    poc_id: string;
    instance_id: string;
    type: string;
    ip_private: string;
    ip_public?: string;
    is_leader?: boolean;
    has_tunnel?: boolean;
    tunnel_direction?: string;
    tunnel_source_ip?: string;
    tunnel_dest_ip?: string;
    tunnel_source_port?: number;
    tunnel_dest_port?: number;
    tunnel_connected_at?: number;
    tunnel_uptime_seconds?: number;
    tunnel_reconnect_count?: number;
    tunnel_last_disconnected_at?: number;
    tunnel_last_disconnect_reason?: string;
    tunnel_path_profile?: 'lan' | 'wan' | 'cloud_relay';
    status: 'online' | 'offline';
    is_stale: boolean;
    last_seen_seconds_ago: number;
    last_seen?: string;
    rtt_ms?: number;
    ewma_rtt_ms?: number;
    jitter_ms?: number;
    min_rtt_ms?: number;
    max_rtt_ms?: number;
    last_pong?: string;
    config_sync_status?: 'synced' | 'behind' | 'na';
    behind_bundles_count?: number;
    capabilities?: {
        voice?: boolean;
        convergence?: boolean;
        xfr?: boolean;
        security?: boolean;
        connectivity?: boolean;
        custom_app?: boolean;
        [key: string]: any;
    };
    meta?: {
        site?: string;
        region?: string;
        vendor?: string;
        version?: string;
        management_url?: string;
        management_ip?: string;
        [key: string]: any;
    };
    summary?: {
        probes_paused?: boolean;
        probes_global_health?: number; // 0-100 Global Experience score
        probes_total?: number;
        probes_passing?: number;
        failing_probes?: Array<{
            name: string;
            type: string;
            target: string;
            error: string;
            reliability?: number;
        }>;
        traffic_state?: 'RUNNING' | 'STOPPED' | 'IDLE';
        traffic_rate_mbps?: number;
        traffic_tx_mbps?: number;
        traffic_rx_mbps?: number;
        voice_active?: boolean;
        voice_mos?: number;
        iot_active?: boolean;
        iot_running_count?: number;
        iot_total_count?: number;
        convergence_active?: boolean;
        xfr_active?: boolean;
        uptime_seconds?: number;
        [key: string]: any;
    };
    provisioning_status?: {
        appliedRevisions?: Record<string, any>;
        lastReportedAt?: string;
        [key: string]: any;
    };
}

interface FleetOverviewResponse {
    total_instances: number;
    online_count: number;
    offline_count: number;
    avg_global_experience: number | null;
    leader_revisions?: Record<string, any>;
    events_count?: number;
    latest_event?: FleetEvent | null;
    instances: PeerInstance[];
    generated_at: string;
}

// Standard Stigix capability color coding and labels matching Edit Target modal
const CAPABILITIES_CONFIG = [
    { key: 'voice', label: 'Voice', activeClass: 'bg-blue-600/15 text-blue-400 border-blue-500/40 ring-1 ring-blue-500/20', dotClass: 'bg-blue-500' },
    { key: 'convergence', label: 'Failover', activeClass: 'bg-purple-600/15 text-purple-400 border-purple-500/40 ring-1 ring-purple-500/20', dotClass: 'bg-purple-500' },
    { key: 'custom_app', label: 'Custom Apps', activeClass: 'bg-teal-600/15 text-teal-400 border-teal-500/40 ring-1 ring-teal-500/20', dotClass: 'bg-teal-500' },
    { key: 'xfr', label: 'Speedtest', activeClass: 'bg-cyan-600/15 text-cyan-400 border-cyan-500/40 ring-1 ring-cyan-500/20', dotClass: 'bg-cyan-500' },
    { key: 'security', label: 'Security', activeClass: 'bg-rose-600/15 text-rose-400 border-rose-500/40 ring-1 ring-rose-500/20', dotClass: 'bg-rose-500' },
    { key: 'connectivity', label: 'Connectivity', activeClass: 'bg-emerald-600/15 text-emerald-400 border-emerald-500/40 ring-1 ring-emerald-500/20', dotClass: 'bg-emerald-500' },
];

// Mini Badge for Global Experience Score (in Table only)
function ScoreMiniBadge({ score, isStale, isOnline, isPaused }: { score?: number | null; isStale?: boolean; isOnline?: boolean; isPaused?: boolean }) {
    if (isStale || !isOnline) {
        return (
            <span className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-card-secondary text-text-muted border border-border whitespace-nowrap">
                — Offline
            </span>
        );
    }

    if (isPaused) {
        return (
            <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25 whitespace-nowrap"
                title="Local DEM probe execution is paused on this node (Standby mode)"
            >
                <span>⏸</span>
                <span className="text-[10px] uppercase tracking-wider">Standby</span>
            </span>
        );
    }

    if (score === undefined || score === null) {
        return (
            <span className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-card-secondary/80 text-text-muted border border-border/60 whitespace-nowrap" title="No probe telemetry reported">
                — N/A
            </span>
        );
    }

    const isOptimal = score >= 80;
    const isGood = score >= 65 && score < 80;
    const isDegraded = score >= 50 && score < 65;

    const badgeClass = isOptimal
        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
        : isGood
        ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
        : isDegraded
        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
        : 'bg-red-500/10 text-red-400 border-red-500/30';

    const label = isOptimal ? 'Optimal' : isGood ? 'Good' : isDegraded ? 'Degraded' : 'Critical';

    return (
        <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-bold font-mono border whitespace-nowrap ${badgeClass}`}
            title={`Global Experience Score: ${score} / 100 (${label})`}
        >
            <span className="text-xs font-black">{score}</span>
            <span className="text-[10px] uppercase tracking-wider opacity-85 whitespace-nowrap">· {label}</span>
        </span>
    );
}

function formatUptime(seconds?: number) {
    if (!seconds || seconds <= 0) return '—';
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function formatTunnelUptime(seconds?: number) {
    if (seconds === undefined || seconds === null || seconds < 0) return '—';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return s > 0 ? `${m}m ${s}s` : `${m}m`;
    }
    return formatUptime(seconds);
}

function evaluateTunnelPathAndRtt(peer: PeerInstance) {
    const lastRtt = peer.rtt_ms ?? peer.meta?.rtt_ms;
    const ewmaRtt = peer.ewma_rtt_ms ?? peer.meta?.ewma_rtt_ms;
    const minRtt = peer.min_rtt_ms ?? peer.meta?.min_rtt_ms;
    const maxRtt = peer.max_rtt_ms ?? peer.meta?.max_rtt_ms;
    const jitter = peer.jitter_ms ?? peer.meta?.jitter_ms;
    const displayRtt = ewmaRtt ?? lastRtt;

    let pathProfile: 'lan' | 'wan' | 'cloud_relay' =
        (peer.tunnel_path_profile as any) ||
        (peer.meta?.tunnel_path_profile as any) ||
        (peer.tunnel_dest_port === 443 ? 'cloud_relay' : 'lan');

    if (pathProfile === 'lan' && (minRtt ?? displayRtt ?? 0) > 25) {
        pathProfile = 'wan';
    }

    const pathLabel = pathProfile === 'cloud_relay' ? 'CLOUD RELAY' : pathProfile === 'wan' ? 'WAN' : 'LAN';

    // Self-calibrating SLA thresholds combining Path Profile + learned physical propagation floor (minRtt)
    const baseGreen = pathProfile === 'cloud_relay' ? 185 : pathProfile === 'wan' ? 110 : 35;
    const optimalCeiling = Math.max(baseGreen, minRtt ? Math.min(220, Math.round(minRtt * 1.45 + 25)) : 0);
    const elevatedCeiling = Math.max(optimalCeiling + 80, Math.round((minRtt || optimalCeiling) * 2.2 + 60));

    let rttColor = 'text-emerald-400';
    let rttBadgeClass = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    if (displayRtt !== undefined && displayRtt !== null) {
        if (displayRtt > elevatedCeiling) {
            rttColor = 'text-rose-400';
            rttBadgeClass = 'text-rose-400 bg-rose-500/10 border-rose-500/20';
        } else if (displayRtt > optimalCeiling) {
            rttColor = 'text-amber-400';
            rttBadgeClass = 'text-amber-400 bg-amber-500/10 border-amber-500/20';
        }
    }

    return {
        pathProfile,
        pathLabel,
        displayRtt,
        lastRtt,
        ewmaRtt,
        minRtt,
        maxRtt,
        jitter,
        optimalCeiling,
        elevatedCeiling,
        rttColor,
        rttBadgeClass
    };
}

function formatLastSeen(secondsAgo: number, lastSeenIso?: string) {
    let timeStr = '';
    if (lastSeenIso) {
        try {
            const date = new Date(lastSeenIso);
            const now = new Date();
            const isToday = date.toDateString() === now.toDateString();
            timeStr = isToday
                ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : `${date.toLocaleDateString([], { day: '2-digit', month: '2-digit' })} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        } catch { }
    }

    let rel = '';
    if (secondsAgo < 60) rel = `${secondsAgo}s ago`;
    else if (secondsAgo < 3600) rel = `${Math.floor(secondsAgo / 60)}m ago`;
    else rel = `${Math.floor(secondsAgo / 3600)}h ago`;

    return { rel, timeStr };
}

export default function Fleet({ token, onNavigate: _onNavigate }: FleetProps) {
    const { activePeerId, setActivePeerId } = usePeerContext();
    const [data, setData] = useState<FleetOverviewResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('all');
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [selectedPeer, setSelectedPeer] = useState<PeerInstance | null>(null);
    const [openSections, setOpenSections] = useState<{ tunnel: boolean; probes: boolean; config: boolean; capabilities: boolean }>({
        tunnel: false,
        probes: false,
        config: false,
        capabilities: false,
    });
    const [lastRefreshTime, setLastRefreshTime] = useState<Date>(new Date());
    const [copiedIp, setCopiedIp] = useState<string | null>(null);

    // Bulk Orchestration State (Proposition 1)
    const [selectedPeerIds, setSelectedPeerIds] = useState<Set<string>>(new Set());
    const [bulkActionLoading, setBulkActionLoading] = useState<string | null>(null);
    const [bulkBanner, setBulkBanner] = useState<{
        ok: boolean;
        title: string;
        results?: Array<{ peer_id: string; site: string; ok: boolean; error?: string }>;
    } | null>(null);
    const [syncingPeerId, setSyncingPeerId] = useState<string | null>(null);

    // Live Event Timeline Drawer State (Proposition 4)
    const [timelineOpen, setTimelineOpen] = useState(false);
    const [timelineEvents, setTimelineEvents] = useState<FleetEvent[]>([]);
    const [timelineLoading, setTimelineLoading] = useState(false);
    const [timelineCategory, setTimelineCategory] = useState<'all' | FleetEventCategory>('all');
    const [timelineSite, setTimelineSite] = useState<string>('all');

    const fetchTimelineEvents = async () => {
        setTimelineLoading(true);
        try {
            const res = await fetch('/api/fleet/events?limit=200', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const json = await res.json();
                setTimelineEvents(Array.isArray(json.events) ? json.events : []);
            }
        } catch {
            // Non-blocking
        } finally {
            setTimelineLoading(false);
        }
    };

    const clearTimelineEvents = async () => {
        try {
            const res = await fetch('/api/fleet/events', {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                setTimelineEvents([]);
                setData(prev => prev ? { ...prev, events_count: 0, latest_event: null } : prev);
            }
        } catch {}
    };

    useEffect(() => {
        if (timelineOpen) {
            fetchTimelineEvents();
        }
    }, [timelineOpen]);

    const executeBulkAction = async (action: string, customPeerIds?: string[]) => {
        const targets = customPeerIds || Array.from(selectedPeerIds);
        if (targets.length === 0) return;
        setBulkActionLoading(action);
        setBulkBanner(null);
        try {
            const res = await fetch('/api/fleet/bulk-action', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ action, peer_ids: targets })
            });
            const json = await res.json();
            if (!res.ok) {
                setBulkBanner({
                    ok: false,
                    title: json.error || `Bulk action failed (${res.status})`
                });
            } else {
                setBulkBanner({
                    ok: json.failed === 0,
                    title: `${json.label || action}: ${json.succeeded}/${json.total} node(s) succeeded`,
                    results: json.results
                });
                await fetchFleetOverview(false);
                if (timelineOpen) {
                    fetchTimelineEvents();
                }
            }
        } catch (err: any) {
            setBulkBanner({
                ok: false,
                title: err?.message || 'Error executing bulk action'
            });
        } finally {
            setBulkActionLoading(null);
        }
    };

    const handleSinglePeerConfigSync = async (e: React.MouseEvent, peer: PeerInstance) => {
        e.stopPropagation();
        if (syncingPeerId) return;
        setSyncingPeerId(peer.instance_id);
        try {
            await executeBulkAction('config_sync', [peer.instance_id]);
        } finally {
            setSyncingPeerId(null);
        }
    };

    const togglePeerSelection = (e: React.MouseEvent, instanceId: string) => {
        e.stopPropagation();
        setSelectedPeerIds(prev => {
            const next = new Set(prev);
            if (next.has(instanceId)) {
                next.delete(instanceId);
            } else {
                next.add(instanceId);
            }
            return next;
        });
    };

    const toggleSection = (key: 'tunnel' | 'probes' | 'config' | 'capabilities') => {
        setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handleCopy = (e: React.MouseEvent, text: string) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopiedIp(text);
        setTimeout(() => setCopiedIp(null), 2000);
    };

    const fetchFleetOverview = async (isManual = false) => {
        if (isManual) setLoading(true);
        try {
            const [res, tunnelsRes] = await Promise.all([
                fetch('/api/fleet/overview', {
                    headers: { 'Authorization': `Bearer ${token}` }
                }),
                fetch('/api/fleet/tunnels', {
                    headers: { 'Authorization': `Bearer ${token}` }
                }).catch(() => null)
            ]);

            if (!res.ok) {
                if (res.status === 403) {
                    throw new Error('This node is not in Leader mode. Mesh Overview is only accessible on the Leader.');
                }
                throw new Error(`Failed to fetch mesh overview (${res.status})`);
            }
            const json: FleetOverviewResponse = await res.json();

            const tunnelKeys = new Set<string>();
            let tunnelsList: any[] = [];
            if (tunnelsRes && tunnelsRes.ok) {
                try {
                    const tData = await tunnelsRes.json();
                    tunnelsList = tData.tunnels || [];
                    tunnelsList.forEach((t: any) => {
                        if (t.instanceId) tunnelKeys.add(t.instanceId.toLowerCase());
                        if (t.siteName) tunnelKeys.add(t.siteName.toLowerCase());
                        if (t.ip) tunnelKeys.add(t.ip.toLowerCase());
                        if (t.remoteIp) tunnelKeys.add(t.remoteIp.toLowerCase());
                    });
                } catch {}
            }

            if (Array.isArray(json.instances)) {
                json.instances = json.instances.map(inst => {
                    const id = (inst.instance_id || '').toLowerCase();
                    const site = (inst.meta?.site || inst.instance_id || '').toLowerCase();
                    const ip = (inst.ip_private || '').toLowerCase();
                    const matchedTunnel = tunnelsList.find((t: any) => 
                        (t.instanceId && t.instanceId.toLowerCase() === id) ||
                        (t.siteName && t.siteName.toLowerCase() === site) ||
                        (t.ip && t.ip.toLowerCase() === ip) ||
                        (t.remoteIp && t.remoteIp.toLowerCase() === ip) ||
                        (t.sourceIp && t.sourceIp.toLowerCase() === ip) ||
                        (t.destIp && t.destIp.toLowerCase() === ip)
                    );
                    const hasTunnel = tunnelKeys.has(id) || tunnelKeys.has(site) || (ip ? tunnelKeys.has(ip) : false) || !!matchedTunnel;
                    const connectedAt = matchedTunnel?.connectedAt ?? inst.tunnel_connected_at;
                    const uptimeSeconds = matchedTunnel?.uptimeSeconds ?? (connectedAt ? Math.max(0, Math.floor((Date.now() - connectedAt) / 1000)) : inst.tunnel_uptime_seconds);
                    return {
                        ...inst,
                        has_tunnel: hasTunnel,
                        tunnel_direction: matchedTunnel?.direction || inst.tunnel_direction,
                        tunnel_source_ip: matchedTunnel?.sourceIp || inst.tunnel_source_ip,
                        tunnel_dest_ip: matchedTunnel?.destIp || inst.tunnel_dest_ip,
                        tunnel_source_port: matchedTunnel?.sourcePort || inst.tunnel_source_port,
                        tunnel_dest_port: matchedTunnel?.destPort || inst.tunnel_dest_port,
                        tunnel_connected_at: connectedAt,
                        tunnel_uptime_seconds: uptimeSeconds,
                        tunnel_reconnect_count: matchedTunnel?.reconnectCount ?? inst.tunnel_reconnect_count ?? 0,
                        tunnel_last_disconnected_at: matchedTunnel?.lastDisconnectedAt ?? inst.tunnel_last_disconnected_at,
                        tunnel_last_disconnect_reason: matchedTunnel?.lastDisconnectReason ?? inst.tunnel_last_disconnect_reason,
                        tunnel_path_profile: matchedTunnel?.pathProfile ?? inst.tunnel_path_profile,
                        rtt_ms: matchedTunnel?.rttMs ?? inst.rtt_ms,
                        ewma_rtt_ms: matchedTunnel?.ewmaRttMs ?? inst.ewma_rtt_ms,
                        jitter_ms: matchedTunnel?.jitterMs ?? inst.jitter_ms,
                        min_rtt_ms: matchedTunnel?.minRttMs ?? inst.min_rtt_ms,
                        max_rtt_ms: matchedTunnel?.maxRttMs ?? inst.max_rtt_ms
                    };
                });
            }

            setData(json);
            setError(null);
            setLastRefreshTime(new Date());

            // If a peer modal is open, refresh its data reference
            if (selectedPeer) {
                const refreshed = json.instances.find(i => i.instance_id === selectedPeer.instance_id);
                if (refreshed) setSelectedPeer(refreshed);
            }
        } catch (err: any) {
            setError(err.message || 'Error contacting Mesh API');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchFleetOverview(true);
    }, []);

    useEffect(() => {
        if (!autoRefresh) return;
        const interval = setInterval(() => {
            fetchFleetOverview(false);
        }, 15000); // Poll every 15s
        return () => clearInterval(interval);
    }, [autoRefresh]);

    const filteredInstances = useMemo(() => {
        if (!data?.instances) return [];
        return data.instances.filter(inst => {
            const matchesStatus = statusFilter === 'all' || inst.status === statusFilter;
            const query = searchQuery.toLowerCase().trim();
            const matchesSearch = !query || 
                (inst.meta?.site || '').toLowerCase().includes(query) ||
                inst.instance_id.toLowerCase().includes(query) ||
                inst.ip_private.toLowerCase().includes(query) ||
                (inst.meta?.management_ip || '').toLowerCase().includes(query);
            return matchesStatus && matchesSearch;
        });
    }, [data, statusFilter, searchQuery]);

    if (loading && !data?.instances) {
        return <FleetSkeleton />;
    }

    return (
        <div className="space-y-6">
            {/* Top Header with Integrated Telemetry Ribbon */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-card/60 backdrop-blur-md p-5 rounded-2xl border border-border shadow-xl">
                <div className="flex flex-wrap items-center gap-4">
                    <div className="w-11 h-11 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shadow-inner flex-shrink-0">
                        <Globe size={24} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2.5">
                            <h1 className="text-xl font-black tracking-tight text-text">Mesh Overview</h1>
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                                <ShieldCheck size={11} />
                                Leader Active
                            </span>
                        </div>
                        <p className="text-xs text-text-muted mt-0.5 hidden sm:block">
                            Centralized observability & telemetry aggregation across distributed Stigix peers
                        </p>
                    </div>

                    {/* Compact Telemetry Ribbon (Saves ~100px vertical space) */}
                    <div className="flex flex-wrap items-center gap-2 sm:ml-2 sm:pl-3 sm:border-l sm:border-border/60">
                        {/* Total Nodes */}
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-card-secondary/70 border border-border text-xs">
                            <Server size={12} className="text-text-muted" />
                            <span className="text-[10px] uppercase font-bold text-text-muted tracking-wider">Nodes:</span>
                            <span className="font-mono font-black text-text-primary">{data?.total_instances ?? '—'}</span>
                        </div>

                        {/* Online */}
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-600 dark:text-emerald-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="text-[10px] uppercase font-bold tracking-wider">Online:</span>
                            <span className="font-mono font-black">{data?.online_count ?? '—'}</span>
                        </div>

                        {/* Offline */}
                        <div className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs",
                            (data?.offline_count ?? 0) > 0
                                ? "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400 font-bold"
                                : "bg-card-secondary/50 border-border text-text-muted"
                        )}>
                            <XCircle size={11} className={(data?.offline_count ?? 0) > 0 ? "text-rose-500 animate-pulse" : "text-text-muted opacity-50"} />
                            <span className="text-[10px] uppercase font-bold tracking-wider">Offline:</span>
                            <span className="font-mono font-bold">{data?.offline_count ?? 0}</span>
                        </div>

                        {/* Mesh Global Experience */}
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-600 dark:text-blue-400">
                            <Gauge size={12} className="text-blue-500" />
                            <span className="text-[10px] uppercase font-bold tracking-wider">Mesh Exp:</span>
                            <span className="font-mono font-black">
                                {data?.avg_global_experience !== null && data?.avg_global_experience !== undefined 
                                    ? `${data.avg_global_experience}%` 
                                    : '—'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2.5 self-end lg:self-auto">
                    <button
                        onClick={() => setAutoRefresh(prev => !prev)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 ${
                            autoRefresh 
                                ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' 
                                : 'bg-card-secondary text-text-muted border-border hover:text-text-primary'
                        }`}
                        title="Toggle 15s auto-refresh"
                    >
                        <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-blue-400 animate-pulse' : 'bg-neutral-600'}`} />
                        Auto-Refresh (15s)
                    </button>

                    <span className="text-[11px] font-mono text-text-muted hidden md:inline">
                        {lastRefreshTime.toLocaleTimeString()}
                    </span>

                    <button
                        onClick={() => fetchFleetOverview(true)}
                        disabled={loading}
                        className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-md active:scale-95 disabled:opacity-50"
                    >
                        <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* 1-Line Live Event Ticker + Slide-Over Timeline Trigger (Proposition 4) */}
            <div className="flex items-center justify-between gap-3 px-3.5 py-2 rounded-xl bg-card/50 border border-border/80 text-xs shadow-sm">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
                        <Activity size={11} className="animate-pulse" />
                        Live Feed
                    </span>
                    {data?.latest_event ? (() => {
                        const ev = data.latest_event;
                        const sevDot = ev.severity === 'critical' ? 'bg-rose-500'
                            : ev.severity === 'warning' ? 'bg-amber-400'
                            : ev.severity === 'success' ? 'bg-emerald-400'
                            : 'bg-blue-400';
                        const timeStr = new Date(ev.epochMs || ev.epoch_ms || ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                        const detailText = ev.details || ev.detail;
                        return (
                            <div
                                onClick={() => setTimelineOpen(true)}
                                className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer hover:opacity-90 transition-opacity"
                                title="Click to open full Fleet Live Timeline"
                            >
                                <span className={`w-2 h-2 rounded-full shrink-0 ${sevDot}`} />
                                <span className="font-mono text-[11px] text-text-muted shrink-0">{timeStr}</span>
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-card-secondary text-text-secondary border border-border shrink-0">
                                    {ev.site}
                                </span>
                                <span className="font-bold text-text truncate">{ev.title}</span>
                                {detailText && (
                                    <span className="text-text-muted font-mono text-[11px] truncate hidden md:inline">
                                        — {detailText}
                                    </span>
                                )}
                            </div>
                        );
                    })() : (
                        <span className="text-text-muted font-mono text-[11px] truncate">
                            Monitoring mesh tunnels, config revisions, SLA probes & engines in real time...
                        </span>
                    )}
                </div>

                <button
                    onClick={() => setTimelineOpen(true)}
                    className="px-3 py-1 rounded-lg bg-card-secondary hover:bg-card-hover text-text-primary border border-border hover:border-blue-500/40 font-bold text-xs flex items-center gap-1.5 transition-all shrink-0 shadow-xs"
                >
                    <Clock size={12} className="text-blue-400" />
                    <span>Live Timeline</span>
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-blue-500/15 text-blue-400 border border-blue-500/25">
                        {data?.events_count ?? timelineEvents.length}
                    </span>
                </button>
            </div>

            {/* Error Banner */}
            {error && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-3">
                    <AlertTriangle size={18} className="shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* Filter and Search Bar with Integrated Dynamic Badges */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-card/40 p-3.5 rounded-xl border border-border">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                    <div className="relative w-full sm:w-72">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                        <input
                            type="text"
                            placeholder="Search by Site, Node ID, IP..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-4 py-1.5 bg-background border border-border rounded-lg text-xs text-text focus:outline-none focus:border-blue-500 transition-colors"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            const spokeIds = filteredInstances
                                .filter(i => i.status === 'online' && !i.is_leader && i.type !== 'leader')
                                .map(i => i.instance_id);
                            setSelectedPeerIds(new Set(spokeIds));
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-card-secondary hover:bg-card-hover text-text-secondary hover:text-text border border-border text-xs font-bold flex items-center gap-1.5 whitespace-nowrap transition-colors"
                        title="Select all online Spoke nodes for bulk orchestration"
                    >
                        <CheckSquare size={13} className="text-blue-400" />
                        <span className="hidden md:inline">Select Spokes</span>
                    </button>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
                    <span className="text-xs text-text-muted flex items-center gap-1 mr-1">
                        <Filter size={12} /> Status:
                    </span>
                    {(['all', 'online', 'offline'] as const).map(f => {
                        const count = f === 'all' 
                            ? (data?.total_instances ?? 0)
                            : f === 'online' 
                                ? (data?.online_count ?? 0)
                                : (data?.offline_count ?? 0);
                        return (
                            <button
                                key={f}
                                onClick={() => setStatusFilter(f)}
                                className={cn(
                                    "px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5",
                                    statusFilter === f
                                        ? 'bg-blue-600 text-white shadow-sm'
                                        : 'bg-card-secondary text-text-muted hover:text-text-primary hover:bg-card-hover'
                                )}
                            >
                                <span>{f}</span>
                                <span className={cn(
                                    "text-[10px] px-1.5 py-0.2 rounded-full font-mono",
                                    statusFilter === f
                                        ? "bg-white/20 text-white"
                                        : "bg-background/80 text-text-muted"
                                )}>
                                    {count}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Contextual Bulk Orchestration Bar (Directly above Peers Table - Proposition 1) */}
            {(selectedPeerIds.size > 0 || bulkBanner) && (
                <div className="bg-blue-950/20 dark:bg-blue-950/30 border border-blue-500/30 rounded-2xl p-3.5 shadow-lg space-y-2.5 animate-in fade-in duration-150">
                    {selectedPeerIds.size > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            {/* Selection Counter & Quick Select */}
                            <div className="flex items-center gap-2">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-600 text-white text-xs font-black font-mono shadow-xs">
                                    <Check size={13} />
                                    {selectedPeerIds.size} Selected
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const allOnline = filteredInstances.filter(i => i.status === 'online').map(i => i.instance_id);
                                        setSelectedPeerIds(new Set(allOnline));
                                    }}
                                    className="px-2 py-1 rounded-md text-[11px] font-bold bg-card-secondary hover:bg-card-hover text-text-secondary border border-border transition-colors"
                                >
                                    All Online
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const spokes = filteredInstances.filter(i => i.status === 'online' && !i.is_leader && i.type !== 'leader').map(i => i.instance_id);
                                        setSelectedPeerIds(new Set(spokes));
                                    }}
                                    className="px-2 py-1 rounded-md text-[11px] font-bold bg-card-secondary hover:bg-card-hover text-text-secondary border border-border transition-colors"
                                >
                                    Spokes Only
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setSelectedPeerIds(new Set())}
                                    className="px-2 py-1 rounded-md text-[11px] font-bold text-text-muted hover:text-rose-400 transition-colors"
                                >
                                    Clear
                                </button>
                            </div>

                            {/* Grouped Bulk Action Buttons */}
                            <div className="flex flex-wrap items-center gap-2">
                                {/* Traffic Gen Group */}
                                <div className="inline-flex items-center rounded-lg bg-card/90 border border-border p-0.5">
                                    <span className="px-2 text-[10px] font-mono font-bold uppercase text-text-muted">Traffic</span>
                                    <button
                                        type="button"
                                        disabled={!!bulkActionLoading}
                                        onClick={() => executeBulkAction('traffic_start')}
                                        className="px-2 py-1 rounded-md text-xs font-bold text-emerald-400 hover:bg-emerald-500/15 flex items-center gap-1 transition-colors disabled:opacity-50"
                                        title="Start Traffic Generator on selected nodes"
                                    >
                                        <Play size={11} className="fill-emerald-400" />
                                        Start
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!!bulkActionLoading}
                                        onClick={() => executeBulkAction('traffic_stop')}
                                        className="px-2 py-1 rounded-md text-xs font-bold text-rose-400 hover:bg-rose-500/15 flex items-center gap-1 transition-colors disabled:opacity-50"
                                        title="Stop Traffic Generator on selected nodes"
                                    >
                                        <Square size={10} className="fill-rose-400" />
                                        Stop
                                    </button>
                                </div>

                                {/* Voice Group */}
                                <div className="inline-flex items-center rounded-lg bg-card/90 border border-border p-0.5">
                                    <span className="px-2 text-[10px] font-mono font-bold uppercase text-text-muted">Voice</span>
                                    <button
                                        type="button"
                                        disabled={!!bulkActionLoading}
                                        onClick={() => executeBulkAction('voice_start')}
                                        className="px-2 py-1 rounded-md text-xs font-bold text-cyan-400 hover:bg-cyan-500/15 flex items-center gap-1 transition-colors disabled:opacity-50"
                                        title="Start Voice RTP Simulation on selected nodes"
                                    >
                                        <Phone size={11} />
                                        Start
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!!bulkActionLoading}
                                        onClick={() => executeBulkAction('voice_stop')}
                                        className="px-2 py-1 rounded-md text-xs font-bold text-rose-400 hover:bg-rose-500/15 flex items-center gap-1 transition-colors disabled:opacity-50"
                                        title="Stop Voice RTP Simulation on selected nodes"
                                    >
                                        <Square size={10} className="fill-rose-400" />
                                        Stop
                                    </button>
                                </div>

                                {/* IoT Emulation Group */}
                                <div className="inline-flex items-center rounded-lg bg-card/90 border border-border p-0.5">
                                    <span className="px-2 text-[10px] font-mono font-bold uppercase text-text-muted">IoT</span>
                                    <button
                                        type="button"
                                        disabled={!!bulkActionLoading}
                                        onClick={() => executeBulkAction('iot_start')}
                                        className="px-2 py-1 rounded-md text-xs font-bold text-teal-400 hover:bg-teal-500/15 flex items-center gap-1 transition-colors disabled:opacity-50"
                                        title="Start all enabled IoT devices on selected nodes"
                                    >
                                        <Radio size={11} />
                                        Start All
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!!bulkActionLoading}
                                        onClick={() => executeBulkAction('iot_stop')}
                                        className="px-2 py-1 rounded-md text-xs font-bold text-rose-400 hover:bg-rose-500/15 flex items-center gap-1 transition-colors disabled:opacity-50"
                                        title="Stop all IoT devices on selected nodes"
                                    >
                                        <Square size={10} className="fill-rose-400" />
                                        Stop
                                    </button>
                                </div>

                                {/* DEM Probes Group */}
                                <div className="inline-flex items-center rounded-lg bg-card/90 border border-border p-0.5">
                                    <span className="px-2 text-[10px] font-mono font-bold uppercase text-text-muted">Probes</span>
                                    <button
                                        type="button"
                                        disabled={!!bulkActionLoading}
                                        onClick={() => executeBulkAction('probes_resume')}
                                        className="px-2 py-1 rounded-md text-xs font-bold text-emerald-400 hover:bg-emerald-500/15 flex items-center gap-1 transition-colors disabled:opacity-50"
                                        title="Resume local DEM connectivity probes on selected nodes"
                                    >
                                        <Play size={11} className="fill-emerald-400" />
                                        Resume
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!!bulkActionLoading}
                                        onClick={() => executeBulkAction('probes_pause')}
                                        className="px-2 py-1 rounded-md text-xs font-bold text-amber-400 hover:bg-amber-500/15 flex items-center gap-1 transition-colors disabled:opacity-50"
                                        title="Pause local DEM connectivity probes (Standby mode) on selected nodes"
                                    >
                                        <Pause size={11} />
                                        Standby
                                    </button>
                                </div>

                                {/* Config Sync */}
                                <button
                                    type="button"
                                    disabled={!!bulkActionLoading}
                                    onClick={() => executeBulkAction('config_sync')}
                                    className="px-2.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                                    title="Force immediate configuration bundle push over WebSocket tunnel"
                                >
                                    <RefreshCw size={12} className={bulkActionLoading === 'config_sync' ? 'animate-spin' : ''} />
                                    Force Sync
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Execution Progress or Result Banner */}
                    {bulkActionLoading && (
                        <div className="flex items-center gap-2 text-xs font-mono text-blue-300 pt-1">
                            <RefreshCw size={13} className="animate-spin" />
                            <span>Dispatching bulk command ({bulkActionLoading}) across {selectedPeerIds.size} node(s)...</span>
                        </div>
                    )}

                    {bulkBanner && (
                        <div className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs font-mono ${
                            bulkBanner.ok
                                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                                : 'bg-amber-500/10 border-amber-500/25 text-amber-300'
                        }`}>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-bold">{bulkBanner.title}</span>
                                {bulkBanner.results && bulkBanner.results.map((r, idx) => (
                                    <span
                                        key={idx}
                                        className={`px-1.5 py-0.5 rounded text-[10px] border ${
                                            r.ok
                                                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                                                : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                                        }`}
                                        title={r.error || 'Success'}
                                    >
                                        {r.site}: {r.ok ? 'OK' : (r.error || 'ERR')}
                                    </span>
                                ))}
                            </div>
                            <button
                                type="button"
                                onClick={() => setBulkBanner(null)}
                                className="text-text-muted hover:text-text p-0.5"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Peers Table */}
            <div className="bg-card/60 backdrop-blur-md rounded-2xl border border-border overflow-visible shadow-xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-card-secondary border-b border-border text-[11px] uppercase font-mono tracking-wider text-text-muted">
                            <tr>
                                <th className="pl-4 pr-1 py-2.5 w-8">
                                    <input
                                        type="checkbox"
                                        checked={
                                            filteredInstances.length > 0 &&
                                            filteredInstances.every(i => selectedPeerIds.has(i.instance_id))
                                        }
                                        onChange={e => {
                                            if (e.target.checked) {
                                                setSelectedPeerIds(new Set(filteredInstances.map(i => i.instance_id)));
                                            } else {
                                                setSelectedPeerIds(new Set());
                                            }
                                        }}
                                        className="rounded border-border bg-background text-blue-600 focus:ring-blue-500 cursor-pointer"
                                        title="Select / Deselect all visible nodes"
                                    />
                                </th>
                                <th className="px-3.5 py-2.5">Site / Node</th>
                                <th className="px-3.5 py-2.5">Mesh Link</th>
                                <th className="px-3.5 py-2.5">Exp. Score</th>
                                <th className="px-3 py-2.5">Probes</th>
                                <th className="px-3.5 py-2.5">Traffic</th>
                                <th className="px-3 py-2.5">Voice</th>
                                <th className="px-3.5 py-2.5">Config</th>
                                <th className="px-3 py-2.5">Last Seen</th>
                                <th className="px-4 py-2.5 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {filteredInstances.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="p-6">
                                        {loading ? (
                                            <div className="space-y-2.5 shimmer">
                                                {[1, 2, 3, 4].map(i => (
                                                    <div key={i} className="h-12 bg-card-secondary/20 rounded-xl border border-border/40" />
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="text-center text-text-muted py-8 text-xs">No peer instances matching filter</div>
                                        )}
                                    </td>
                                </tr>
                            ) : (
                                filteredInstances.map(peer => {
                                    const siteName = peer.meta?.site || peer.instance_id;
                                    const isLeader = Boolean(peer.is_leader);
                                    const isRemoteLeader = !isLeader && (Boolean((peer as any).is_remote_leader) || peer.type === 'leader');
                                    const version = peer.meta?.version || '—';
                                    const isOnline = peer.status === 'online';

                                    const { rel, timeStr } = formatLastSeen(peer.last_seen_seconds_ago, peer.last_seen);
                                    
                                    // Management URL vs Traffic IP determination
                                    const mgmtUrl = peer.meta?.management_url 
                                        || (peer.meta?.management_ip ? `http://${peer.meta.management_ip}:8080` : null);
                                    const effectiveUrl = mgmtUrl || `http://${peer.ip_private}:8080`;

                                    const isOutbound = peer.tunnel_direction === 'outbound' || peer.tunnel_direction === 'outbound_dial';
                                    const srcEndpoint = isOutbound
                                        ? `${peer.tunnel_source_ip || 'Leader'}${peer.tunnel_source_port ? `:${peer.tunnel_source_port}` : ''}`
                                        : `${peer.tunnel_source_ip || peer.ip_private}${peer.tunnel_source_port ? `:${peer.tunnel_source_port}` : ''}`;
                                    const dstEndpoint = isOutbound
                                        ? `${peer.tunnel_dest_ip || peer.ip_private}${peer.tunnel_dest_port ? `:${peer.tunnel_dest_port}` : ''}`
                                        : `${peer.tunnel_dest_ip || 'Leader'}${peer.tunnel_dest_port ? `:${peer.tunnel_dest_port}` : ''}`;
                                    const {
                                        pathLabel,
                                        displayRtt: rtt,
                                        lastRtt,
                                        minRtt,
                                        maxRtt,
                                        jitter,
                                        rttColor
                                    } = evaluateTunnelPathAndRtt(peer);
                                    const isSelected = selectedPeerIds.has(peer.instance_id);

                                    return (
                                        <tr 
                                            key={peer.instance_id}
                                            onClick={() => {
                                                setOpenSections({ tunnel: false, probes: false, config: false, capabilities: false });
                                                setSelectedPeer(peer);
                                            }}
                                            className={`hover:bg-blue-500/5 transition-colors cursor-pointer group ${
                                                isSelected ? 'bg-blue-500/10' : isLeader ? 'bg-purple-950/10' : ''
                                            }`}
                                        >
                                            {/* 0. Bulk Selection Checkbox */}
                                            <td
                                                className="pl-4 pr-1 py-2.5 w-8"
                                                onClick={e => togglePeerSelection(e, peer.instance_id)}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => {}}
                                                    className="rounded border-border bg-background text-blue-600 focus:ring-blue-500 cursor-pointer"
                                                />
                                            </td>

                                            {/* 1. Site / Node (with integrated Online/Offline status dot, IP & Version) */}
                                            <td className="px-3.5 py-2.5">
                                                <div className="flex items-center gap-2.5">
                                                    <div
                                                        className={`relative w-8 h-8 rounded-lg border flex items-center justify-center font-bold text-xs transition-all shrink-0 ${
                                                            isLeader 
                                                                ? 'bg-purple-500/10 border-purple-500/30 text-purple-400' 
                                                                : isRemoteLeader
                                                                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                                                                : 'bg-card-secondary/80 border-border text-text-secondary group-hover:border-blue-500/40 group-hover:text-blue-400'
                                                        }`}
                                                        title={`${siteName} is ${isOnline ? 'Online' : 'Offline'}`}
                                                    >
                                                        {isLeader || isRemoteLeader ? '👑' : siteName.slice(0, 3).toUpperCase()}
                                                        <span
                                                            className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-card ${
                                                                isOnline ? 'bg-emerald-400' : 'bg-red-500'
                                                            }`}
                                                        />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="font-bold text-text flex items-center gap-1.5">
                                                            <span className="truncate max-w-[140px]" title={siteName}>{siteName}</span>
                                                            {isLeader && (
                                                                <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/20 whitespace-nowrap">
                                                                    Leader
                                                                </span>
                                                            )}
                                                            {isRemoteLeader && (
                                                                <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/25 whitespace-nowrap" title="This remote peer is currently configured as a Cluster Leader">
                                                                    Remote Leader
                                                                </span>
                                                            )}
                                                            {!isOnline && (
                                                                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-red-500/10 text-red-400 border border-red-500/20 whitespace-nowrap">
                                                                    Offline
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-[11px] text-text-muted font-mono flex items-center gap-1.5 mt-0.5 whitespace-nowrap">
                                                            <span 
                                                                onClick={(e) => handleCopy(e, peer.ip_private)}
                                                                className="hover:text-blue-400 flex items-center gap-1 cursor-copy"
                                                                title="Traffic IP (Click to copy)"
                                                            >
                                                                <span>{peer.ip_private}</span>
                                                                {copiedIp === peer.ip_private ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} className="opacity-40 hover:opacity-100" />}
                                                            </span>
                                                            <span className="opacity-40">·</span>
                                                            <span className="opacity-75">v{version.replace(/^v/, '')}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* 2. Mesh Link (1 compact line + Mouse-over popover for Src ➔ Dst) */}
                                            <td className="px-3.5 py-2.5 whitespace-nowrap">
                                                {isLeader ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                                        👑 Local Leader
                                                    </span>
                                                ) : isOnline ? (
                                                    peer.has_tunnel ? (
                                                        <div
                                                            className="relative group/mesh inline-flex items-center gap-1.5"
                                                            title={`Tunnel: ${srcEndpoint} ➔ ${dstEndpoint}${peer.tunnel_uptime_seconds !== undefined ? ` | Uptime: ${formatTunnelUptime(peer.tunnel_uptime_seconds)}` : ''}${rtt !== undefined ? ` | RTT: ${rtt}ms` : ''}`}
                                                        >
                                                            {isOutbound ? (
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 shadow-sm">
                                                                    ↗️ OUTBOUND WS
                                                                </span>
                                                            ) : (
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 shadow-sm">
                                                                    ↘️ INBOUND WS
                                                                </span>
                                                            )}
                                                            {rtt !== undefined && (
                                                                <span className={`text-[11px] font-mono font-bold ${rttColor}`}>
                                                                    {rtt}ms
                                                                </span>
                                                            )}
                                                            {peer.tunnel_uptime_seconds !== undefined && (
                                                                <span
                                                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                                                                        peer.tunnel_uptime_seconds < 300
                                                                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                                                                            : 'bg-card-secondary/80 text-text-secondary border-border/60'
                                                                    }`}
                                                                >
                                                                    <Clock size={9} className="opacity-75" />
                                                                    {formatUptime(peer.tunnel_uptime_seconds)}
                                                                </span>
                                                            )}
                                                            {(peer.tunnel_reconnect_count ?? 0) > 0 && (
                                                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                                                                    ↻ {peer.tunnel_reconnect_count}
                                                                </span>
                                                            )}

                                                            {/* Rich Mouse-Over Tooltip Card showing SRC ➔ DST + Adaptive Path KPIs */}
                                                            <div className="pointer-events-none invisible opacity-0 group-hover/mesh:visible group-hover/mesh:opacity-100 transition-all duration-150 absolute left-0 bottom-full mb-2 z-50 bg-neutral-950/95 text-white border border-neutral-700 rounded-xl px-3 py-2 shadow-2xl text-[11px] font-mono whitespace-nowrap">
                                                                <div className="flex items-center justify-between gap-3 text-[9px] uppercase tracking-wider text-neutral-400 font-sans font-bold mb-1">
                                                                    <span>{isOutbound ? 'Outbound WebSocket (Leader ➔ Peer)' : 'Inbound WebSocket (Peer ➔ Leader)'}</span>
                                                                    <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-200 border border-neutral-700">{pathLabel}</span>
                                                                </div>
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="text-neutral-400 text-[10px]">SRC:</span>
                                                                    <span className="text-emerald-300 font-bold">{srcEndpoint}</span>
                                                                    <span className="text-neutral-500">➔</span>
                                                                    <span className="text-neutral-400 text-[10px]">DST:</span>
                                                                    <span className="text-cyan-300 font-bold">{dstEndpoint}</span>
                                                                </div>
                                                                <div className="flex items-center gap-3 mt-1 pt-1 border-t border-neutral-800 text-[10px] text-neutral-300">
                                                                    {peer.tunnel_uptime_seconds !== undefined && (
                                                                        <span>Uptime: <b>{formatTunnelUptime(peer.tunnel_uptime_seconds)}</b></span>
                                                                    )}
                                                                    {rtt !== undefined && (
                                                                        <span>Avg RTT: <b className={rttColor}>{rtt}ms</b>{lastRtt !== undefined && lastRtt !== rtt ? ` (last ${lastRtt}ms)` : ''}</span>
                                                                    )}
                                                                    {jitter !== undefined && (
                                                                        <span>Jitter: <b>±{jitter}ms</b></span>
                                                                    )}
                                                                    {minRtt !== undefined && maxRtt !== undefined && (
                                                                        <span>Min/Max: <b>{minRtt}/{maxRtt}ms</b></span>
                                                                    )}
                                                                    {(peer.tunnel_reconnect_count ?? 0) > 0 && (
                                                                        <span className="text-amber-400">
                                                                            Reconnects: <b>{peer.tunnel_reconnect_count}</b>
                                                                            {peer.tunnel_last_disconnect_reason && (
                                                                                <span className="text-text-muted font-normal"> ({peer.tunnel_last_disconnect_reason})</span>
                                                                            )}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div
                                                            className="relative group/mesh inline-flex items-center gap-1.5"
                                                            title={`Direct HTTP: Leader ➔ ${peer.ip_private}:8080`}
                                                        >
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold text-text-muted bg-card-secondary/80 border border-border/60">
                                                                🌐 Direct HTTP
                                                            </span>
                                                            <div className="pointer-events-none invisible opacity-0 group-hover/mesh:visible group-hover/mesh:opacity-100 transition-all duration-150 absolute left-0 bottom-full mb-2 z-50 bg-neutral-950/95 text-white border border-neutral-700 rounded-xl px-3 py-2 shadow-2xl text-[11px] font-mono whitespace-nowrap">
                                                                <span className="text-neutral-400">SRC:</span> <span className="text-emerald-300 font-bold">Leader</span> <span className="text-neutral-500">➔</span> <span className="text-neutral-400">DST:</span> <span className="text-cyan-300 font-bold">{peer.ip_private}:8080</span>
                                                            </div>
                                                        </div>
                                                    )
                                                ) : (
                                                    <span className="text-xs text-text-muted font-mono">—</span>
                                                )}
                                            </td>

                                            {/* 3. Global Experience Score */}
                                            <td className="px-3.5 py-2.5 whitespace-nowrap">
                                                <ScoreMiniBadge 
                                                    score={peer.summary?.probes_global_health} 
                                                    isStale={peer.is_stale}
                                                    isOnline={isOnline}
                                                    isPaused={peer.summary?.probes_paused}
                                                />
                                            </td>

                                            {/* 4. Probes Summary */}
                                            <td className="px-3 py-2.5 whitespace-nowrap">
                                                {peer.is_stale || peer.summary?.probes_total === undefined ? (
                                                    <span className="text-xs text-text-muted font-mono">—</span>
                                                ) : peer.summary.probes_paused ? (
                                                    <div
                                                        className="text-xs font-mono text-text-muted cursor-help whitespace-nowrap"
                                                        title={`Local DEM probe execution is paused on this node (${peer.summary.probes_total} catalog probes synced)`}
                                                    >
                                                        <span className="text-amber-500/80 mr-1">⏸</span>
                                                        <span>({peer.summary.probes_total})</span>
                                                    </div>
                                                ) : (() => {
                                                    const total = peer.summary.probes_total;
                                                    const passing = peer.summary.probes_passing ?? total;
                                                    const failing = total - passing;
                                                    const isAllPassing = passing === total;
                                                    const tooltip = isAllPassing 
                                                        ? `${total} probes active (all 100% passing)`
                                                        : `${passing} passing / ${total} active (${failing} probe${failing > 1 ? 's' : ''} failing/unreachable)`;
                                                    return (
                                                        <div className="text-xs font-mono cursor-help whitespace-nowrap" title={tooltip}>
                                                            <span className="font-bold text-text">
                                                                {passing}/{total}
                                                            </span>
                                                            {isAllPassing ? (
                                                                <span className="ml-1 text-emerald-400">✅</span>
                                                            ) : (
                                                                <span className="ml-1 text-amber-400">⚠️</span>
                                                            )}
                                                        </div>
                                                    );
                                                })()}
                                            </td>

                                            {/* 5. Traffic State & Active IoT */}
                                            <td className="px-3.5 py-2.5 whitespace-nowrap">
                                                <div className="flex items-center gap-1.5">
                                                    {peer.is_stale || !peer.summary?.traffic_state ? (
                                                        <span className="text-xs text-text-muted font-mono">—</span>
                                                    ) : peer.summary.traffic_state === 'RUNNING' ? (
                                                        <div className="flex items-center gap-1 text-xs font-mono whitespace-nowrap">
                                                            {peer.summary.traffic_tx_mbps !== undefined && peer.summary.traffic_rx_mbps !== undefined ? (
                                                                <span className="inline-flex items-center gap-1 font-bold">
                                                                    <span className="text-emerald-400" title={`Transmitted: ${peer.summary.traffic_tx_mbps} Mbps`}>
                                                                        ▲ {peer.summary.traffic_tx_mbps}
                                                                    </span>
                                                                    <span className="text-text-muted font-normal">·</span>
                                                                    <span className={peer.summary.traffic_rx_mbps === 0 ? 'text-amber-600/90 dark:text-amber-400/90' : 'text-cyan-400'} title={`Received: ${peer.summary.traffic_rx_mbps} Mbps`}>
                                                                        ▼ {peer.summary.traffic_rx_mbps}
                                                                    </span>
                                                                    <span className="text-text-muted text-[10px] font-normal">Mbps</span>
                                                                </span>
                                                            ) : (
                                                                <>
                                                                    <span className="text-emerald-400">▶</span>
                                                                    <span className="text-emerald-400 font-bold">
                                                                        {peer.summary.traffic_rate_mbps && peer.summary.traffic_rate_mbps > 0 ? `${peer.summary.traffic_rate_mbps} Mbps` : 'Active'}
                                                                    </span>
                                                                </>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-1 text-xs text-text-muted font-mono">
                                                            <span>■</span>
                                                            <span>Stopped</span>
                                                        </div>
                                                    )}
                                                    {!peer.is_stale && peer.summary?.iot_active && (
                                                        <span
                                                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-teal-500/15 text-teal-400 border border-teal-500/30"
                                                            title={`IoT Emulation active (${peer.summary.iot_running_count ?? 1} device(s) running)`}
                                                        >
                                                            <Radio size={10} />
                                                            IoT{peer.summary.iot_running_count ? ` (${peer.summary.iot_running_count})` : ''}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* 6. Voice MOS */}
                                            <td className="px-3 py-2.5 whitespace-nowrap">
                                                {peer.is_stale || !peer.summary?.voice_mos ? (
                                                    <span className="text-xs text-text-muted font-mono">—</span>
                                                ) : (
                                                    <span className="text-xs font-bold font-mono text-cyan-400">
                                                        {peer.summary.voice_mos.toFixed(2)}
                                                    </span>
                                                )}
                                            </td>

                                            {/* 7. Config Sync Status (1-click sync on Behind badge) */}
                                            <td className="px-3.5 py-2.5 whitespace-nowrap">
                                                {peer.config_sync_status === 'synced' ? (
                                                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold font-mono whitespace-nowrap bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" title="All global config bundles match Leader">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                                                        Synced
                                                    </span>
                                                ) : peer.config_sync_status === 'behind' ? (
                                                    <button
                                                        type="button"
                                                        onClick={e => handleSinglePeerConfigSync(e, peer)}
                                                        disabled={syncingPeerId === peer.instance_id}
                                                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold font-mono whitespace-nowrap bg-amber-500/10 hover:bg-amber-500/25 text-amber-600 dark:text-amber-400 border border-amber-500/30 transition-colors cursor-pointer"
                                                        title={`${peer.behind_bundles_count || 1} bundle(s) behind Leader — Click to force immediate Config Sync`}
                                                    >
                                                        {syncingPeerId === peer.instance_id ? (
                                                            <RefreshCw size={10} className="animate-spin text-amber-400 shrink-0" />
                                                        ) : (
                                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
                                                        )}
                                                        <span>Behind ({peer.behind_bundles_count || '!'})</span>
                                                    </button>
                                                ) : (
                                                    <span className="text-xs font-mono text-text-muted">—</span>
                                                )}
                                            </td>

                                            {/* 8. Last Seen (1 single line, exact timestamp in tooltip, no duplicate RTT) */}
                                            <td
                                                className="px-3 py-2.5 text-xs font-mono text-text-muted whitespace-nowrap cursor-help"
                                                title={timeStr ? `Last telemetry at ${timeStr} (${peer.last_seen || ''})` : (peer.last_seen || '')}
                                            >
                                                <span className="font-bold text-text/80">{rel}</span>
                                            </td>

                                            {/* 9. Actions: Open Direct UI & Connect */}
                                            <td className="px-4 py-2.5 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                                                <div className="inline-flex items-center gap-1.5 justify-end">
                                                    <a
                                                        href={effectiveUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="p-1.5 rounded-lg text-xs font-bold bg-card-secondary hover:bg-card-hover text-text-muted hover:text-text-primary border border-border transition-all shadow-sm"
                                                        title={`Open Direct URL: ${effectiveUrl}`}
                                                    >
                                                        <ExternalLink size={13} />
                                                    </a>

                                                    {isLeader ? (
                                                        activePeerId === null ? (
                                                            <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold font-mono bg-purple-500/10 text-purple-400 border border-purple-500/20 whitespace-nowrap">
                                                                Local Leader
                                                            </span>
                                                        ) : (
                                                            <button
                                                                onClick={() => {
                                                                    setActivePeerId(null);
                                                                    _onNavigate?.('connectivity');
                                                                }}
                                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 hover:border-purple-500/50 transition-all shadow-sm active:scale-95 whitespace-nowrap"
                                                                title="Switch back to Local Leader context"
                                                            >
                                                                <Zap size={12} className="text-purple-400 fill-purple-400" />
                                                                <span>Return Local</span>
                                                            </button>
                                                        )
                                                    ) : (
                                                        <button
                                                            onClick={() => {
                                                                setActivePeerId(peer.instance_id);
                                                                _onNavigate?.('connectivity');
                                                            }}
                                                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95 whitespace-nowrap ${
                                                                activePeerId === peer.instance_id
                                                                    ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40 ring-1 ring-amber-500/30'
                                                                    : 'bg-amber-600/15 hover:bg-amber-500/25 text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:border-amber-500/50'
                                                            }`}
                                                            title={`Switch context to ${siteName} (${peer.instance_id})`}
                                                        >
                                                            <Zap size={12} className="text-amber-400 fill-amber-400" />
                                                            <span>{activePeerId === peer.instance_id ? 'Connected' : 'Connect'}</span>
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Compact Collapsible Peer Detail Modal */}
            {selectedPeer && (() => {
                const score = selectedPeer.summary?.probes_global_health;
                const scoreColor = score !== undefined && score !== null
                    ? score >= 80 ? 'text-emerald-400' : score >= 65 ? 'text-cyan-400' : score >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-400'
                    : 'text-text-muted';
                const label = score !== undefined && score !== null
                    ? score >= 80 ? 'Optimal' : score >= 65 ? 'Good' : score >= 50 ? 'Degraded' : 'Critical'
                    : 'N/A';

                const isOutbound = selectedPeer.tunnel_direction === 'outbound' || selectedPeer.tunnel_direction === 'outbound_dial';
                const srcEndpoint = isOutbound
                    ? `${selectedPeer.tunnel_source_ip || 'Leader'}${selectedPeer.tunnel_source_port ? `:${selectedPeer.tunnel_source_port}` : ''}`
                    : `${selectedPeer.tunnel_source_ip || selectedPeer.ip_private}${selectedPeer.tunnel_source_port ? `:${selectedPeer.tunnel_source_port}` : ''}`;
                const dstEndpoint = isOutbound
                    ? `${selectedPeer.tunnel_dest_ip || selectedPeer.ip_private}${selectedPeer.tunnel_dest_port ? `:${selectedPeer.tunnel_dest_port}` : ''}`
                    : `${selectedPeer.tunnel_dest_ip || 'Leader'}${selectedPeer.tunnel_dest_port ? `:${selectedPeer.tunnel_dest_port}` : ''}`;

                const {
                    pathLabel: modalPathLabel,
                    displayRtt: modalDisplayRtt,
                    lastRtt: modalLastRtt,
                    minRtt: modalMinRtt,
                    maxRtt: modalMaxRtt,
                    jitter: modalJitter,
                    optimalCeiling: modalOptimalCeiling,
                    rttColor: modalRttColor,
                    rttBadgeClass: modalRttBadgeClass
                } = evaluateTunnelPathAndRtt(selectedPeer);

                const directMgmtUrl = selectedPeer.meta?.management_url
                    || (selectedPeer.meta?.management_ip ? `http://${selectedPeer.meta.management_ip}:8080` : `http://${selectedPeer.ip_private}:8080`);

                const totalProbes = selectedPeer.summary?.probes_total ?? 0;
                const passingProbes = selectedPeer.summary?.probes_passing ?? totalProbes;
                const failingCount = Math.max(0, totalProbes - passingProbes);
                const enabledCapsCount = CAPABILITIES_CONFIG.filter(c => !!selectedPeer.capabilities?.[c.key]).length;

                return (
                    <div 
                        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
                        onClick={() => setSelectedPeer(null)}
                    >
                        <div 
                            className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[88vh] overflow-y-auto shadow-2xl p-5 space-y-3.5 animate-in fade-in zoom-in-95 duration-150"
                            onClick={e => e.stopPropagation()}
                        >
                            {/* 1. Compact Header + Inline Network Strip */}
                            <div className="flex items-start justify-between gap-3 border-b border-border pb-3.5">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-11 h-11 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 font-black text-base shrink-0">
                                        {(selectedPeer.meta?.site || selectedPeer.instance_id).slice(0, 3).toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h2 className="text-lg font-black text-text truncate">
                                                {selectedPeer.meta?.site || selectedPeer.instance_id}
                                            </h2>
                                            {selectedPeer.status === 'online' ? (
                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                    Online
                                                </span>
                                            ) : (
                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20">
                                                    Offline
                                                </span>
                                            )}
                                            {(selectedPeer.is_leader || selectedPeer.type === 'leader') && (
                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                                    Leader
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 flex-wrap text-xs text-text-muted font-mono mt-1">
                                            <span>v{(selectedPeer.meta?.version || '—').replace(/^v/, '')}</span>
                                            <span>·</span>
                                            <button
                                                onClick={(e) => handleCopy(e, selectedPeer.ip_private)}
                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-card-secondary hover:bg-card-hover text-text border border-border/70 transition-colors"
                                                title="Traffic IP (Click to copy)"
                                            >
                                                <span className="text-[10px] uppercase text-text-muted font-sans font-bold">IP:</span>
                                                <span className="font-bold">{selectedPeer.ip_private}</span>
                                                {copiedIp === selectedPeer.ip_private ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} className="opacity-60" />}
                                            </button>
                                            <a
                                                href={directMgmtUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-card-secondary hover:bg-card-hover text-blue-400 border border-border/70 transition-colors"
                                                title={`Open Direct Management UI: ${directMgmtUrl}`}
                                            >
                                                <span className="text-[10px] uppercase text-text-muted font-sans font-bold">UI:</span>
                                                <span className="truncate max-w-[180px]">{directMgmtUrl.replace(/^https?:\/\//, '')}</span>
                                                <ExternalLink size={11} />
                                            </a>
                                        </div>
                                    </div>
                                </div>

                                <button 
                                    onClick={() => setSelectedPeer(null)}
                                    className="w-8 h-8 rounded-lg bg-card-secondary hover:bg-card-hover flex items-center justify-center text-text-muted hover:text-text-primary transition-colors shrink-0"
                                >
                                    <X size={16} />
                                </button>
                            </div>

                            {/* 2. Top Telemetry KPI Strip (Always Visible) */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-card-secondary/40 p-3 rounded-xl border border-border">
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Global Exp.</div>
                                    <div className="mt-0.5 font-mono text-sm font-bold flex items-baseline gap-1 whitespace-nowrap">
                                        {selectedPeer.summary?.probes_paused ? (
                                            <span className="text-amber-600 dark:text-amber-400 text-xs font-bold uppercase tracking-wider">⏸ Standby</span>
                                        ) : (
                                            <>
                                                <span className={`text-base font-black ${scoreColor}`}>{score ?? '—'}</span>
                                                <span className="text-xs text-text-muted">/100</span>
                                                <span className={`text-[10px] font-bold uppercase ${scoreColor}`}>· {label}</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Traffic</div>
                                    <div className="mt-0.5 font-mono text-xs font-bold whitespace-nowrap">
                                        {selectedPeer.summary?.traffic_state === 'RUNNING' ? (
                                            <div className="flex flex-col">
                                                <span className="text-emerald-400">▶ Active</span>
                                                {selectedPeer.summary.traffic_tx_mbps !== undefined && selectedPeer.summary.traffic_rx_mbps !== undefined && (
                                                    <span className="text-[11px] font-normal text-text-secondary">
                                                        ▲ {selectedPeer.summary.traffic_tx_mbps} · ▼ {selectedPeer.summary.traffic_rx_mbps} Mbps
                                                    </span>
                                                )}
                                            </div>
                                        ) : (
                                            <span className="text-text-muted">■ Stopped</span>
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Voice MOS</div>
                                    <div className="mt-0.5 font-mono text-sm font-bold text-cyan-400 whitespace-nowrap">
                                        {selectedPeer.summary?.voice_mos ? selectedPeer.summary.voice_mos.toFixed(2) : '—'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Node Uptime</div>
                                    <div className="mt-0.5 font-mono text-sm font-bold text-text">
                                        {formatUptime(selectedPeer.summary?.uptime_seconds)}
                                    </div>
                                </div>
                            </div>

                            {/* 3. Collapsible Section: Mesh Tunnel Control Plane */}
                            {(selectedPeer.has_tunnel || selectedPeer.tunnel_source_ip || selectedPeer.tunnel_dest_ip) && (
                                <div className="rounded-xl border border-border bg-card/60 overflow-hidden">
                                    <button
                                        type="button"
                                        onClick={() => toggleSection('tunnel')}
                                        className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 hover:bg-card-secondary/50 transition-colors text-left"
                                    >
                                        <div className="flex items-center gap-2">
                                            {openSections.tunnel ? <ChevronDown size={15} className="text-text-muted" /> : <ChevronRight size={15} className="text-text-muted" />}
                                            <span className="text-xs uppercase font-mono tracking-wider text-text font-bold">
                                                Mesh Tunnel Control Plane
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                            <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-card-secondary text-text-secondary border border-border/80">
                                                {modalPathLabel}
                                            </span>
                                            {isOutbound ? (
                                                <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                                                    ↗️ OUTBOUND WS
                                                </span>
                                            ) : (
                                                <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                                    ↘️ INBOUND WS
                                                </span>
                                            )}
                                            {modalDisplayRtt !== undefined && (
                                                <span
                                                    className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded border ${modalRttBadgeClass}`}
                                                    title={`Smoothed EWMA RTT: ${modalDisplayRtt}ms${modalLastRtt !== undefined ? ` | Last Sample: ${modalLastRtt}ms` : ''} | Auto-Calibrated Target: ≤${modalOptimalCeiling}ms`}
                                                >
                                                    {modalDisplayRtt} ms
                                                </span>
                                            )}
                                            {selectedPeer.tunnel_uptime_seconds !== undefined && (
                                                <span className="text-[11px] font-mono font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20 inline-flex items-center gap-1">
                                                    <Clock size={10} />
                                                    {formatTunnelUptime(selectedPeer.tunnel_uptime_seconds)}
                                                </span>
                                            )}
                                            {(selectedPeer.tunnel_reconnect_count ?? 0) > 0 && (
                                                <span className="text-[11px] font-mono font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                                                    ↻ {selectedPeer.tunnel_reconnect_count}
                                                </span>
                                            )}
                                        </div>
                                    </button>

                                    {openSections.tunnel && (
                                        <div className="px-3.5 pb-3.5 pt-2 border-t border-border/60 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs font-mono">
                                            <div className="bg-card-secondary/70 p-2.5 rounded-lg border border-border/50">
                                                <div className="text-[10px] uppercase font-sans font-bold text-text-muted">Initiator (Source)</div>
                                                <div className="text-xs font-bold text-text mt-0.5 truncate">{srcEndpoint}</div>
                                            </div>
                                            <div className="bg-card-secondary/70 p-2.5 rounded-lg border border-border/50">
                                                <div className="text-[10px] uppercase font-sans font-bold text-text-muted">Receiver (Destination)</div>
                                                <div className="text-xs font-bold text-text mt-0.5 truncate">{dstEndpoint}</div>
                                            </div>
                                            <div className="bg-card-secondary/70 p-2.5 rounded-lg border border-border/50 flex items-center justify-between">
                                                <div className="min-w-0">
                                                    <div className="text-[10px] uppercase font-sans font-bold text-text-muted">
                                                        Control Plane RTT ({modalPathLabel})
                                                    </div>
                                                    <div className={`text-xs font-bold mt-0.5 ${modalRttColor}`}>
                                                        {modalDisplayRtt !== undefined ? `${modalDisplayRtt} ms avg` : '—'}
                                                        {modalLastRtt !== undefined && modalLastRtt !== modalDisplayRtt && (
                                                            <span className="text-[10px] font-normal text-text-muted ml-1.5">
                                                                (last: {modalLastRtt} ms)
                                                            </span>
                                                        )}
                                                        <span className="text-[10px] font-normal text-text-muted ml-1.5">
                                                            · SLA ≤{modalOptimalCeiling}ms
                                                        </span>
                                                    </div>
                                                </div>
                                                <Gauge size={14} className="text-text-muted opacity-60 shrink-0" />
                                            </div>
                                            <div className="bg-card-secondary/70 p-2.5 rounded-lg border border-border/50 flex items-center justify-between">
                                                <div className="min-w-0">
                                                    <div className="text-[10px] uppercase font-sans font-bold text-text-muted">WS Jitter & Floor/Peak</div>
                                                    <div className="text-xs font-bold text-cyan-400 mt-0.5 truncate">
                                                        {modalJitter !== undefined ? `±${modalJitter} ms jitter` : '—'}
                                                        {(modalMinRtt !== undefined || modalMaxRtt !== undefined) && (
                                                            <span className="text-[10px] font-normal text-text-muted ml-1.5">
                                                                (min {modalMinRtt ?? '—'} / max {modalMaxRtt ?? '—'} ms)
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <Zap size={14} className="text-text-muted opacity-60 shrink-0" />
                                            </div>
                                            <div className="bg-card-secondary/70 p-2.5 rounded-lg border border-border/50 flex items-center justify-between">
                                                <div>
                                                    <div className="text-[10px] uppercase font-sans font-bold text-text-muted">WS Session Uptime</div>
                                                    <div className="text-xs font-bold text-emerald-400 mt-0.5">
                                                        {formatTunnelUptime(selectedPeer.tunnel_uptime_seconds)}
                                                        {selectedPeer.tunnel_connected_at && (
                                                            <span className="text-[10px] font-normal text-text-muted ml-1.5">
                                                                (since {new Date(selectedPeer.tunnel_connected_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <Clock size={14} className="text-text-muted opacity-60" />
                                            </div>
                                            <div className="bg-card-secondary/70 p-2.5 rounded-lg border border-border/50 flex items-start justify-between">
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-[10px] uppercase font-sans font-bold text-text-muted">Session Stability</div>
                                                    {(selectedPeer.tunnel_reconnect_count ?? 0) === 0 ? (
                                                        <div className="text-xs font-bold text-emerald-400 mt-0.5">0 reconnects (Stable)</div>
                                                    ) : (
                                                        <div className="mt-0.5 space-y-1">
                                                            <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5 flex-wrap">
                                                                <span>↻ {selectedPeer.tunnel_reconnect_count} reconnect{selectedPeer.tunnel_reconnect_count === 1 ? '' : 's'}</span>
                                                                {selectedPeer.tunnel_last_disconnected_at && (
                                                                    <span className="text-[10px] font-mono font-normal text-text-muted">
                                                                        ({new Date(selectedPeer.tunnel_last_disconnected_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {selectedPeer.tunnel_last_disconnect_reason && (
                                                                <div
                                                                    className="text-[10px] font-mono text-text-secondary bg-card/70 px-2 py-0.5 rounded border border-border/40 select-all inline-block"
                                                                    title="Underlying WebSocket disconnect reason"
                                                                >
                                                                    <span className="text-text-muted uppercase text-[9px] tracking-wider font-sans font-bold mr-1">Reason:</span>
                                                                    <span className="text-amber-300 font-semibold">{selectedPeer.tunnel_last_disconnect_reason}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                                <RefreshCw size={13} className="text-text-muted opacity-60 shrink-0 mt-0.5 ml-2" />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* 4. Collapsible Section: Connectivity Probes */}
                            <div className="rounded-xl border border-border bg-card/60 overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => toggleSection('probes')}
                                    className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 hover:bg-card-secondary/50 transition-colors text-left"
                                >
                                    <div className="flex items-center gap-2">
                                        {openSections.probes ? <ChevronDown size={15} className="text-text-muted" /> : <ChevronRight size={15} className="text-text-muted" />}
                                        <span className="text-xs uppercase font-mono tracking-wider text-text font-bold">
                                            Connectivity Probes
                                        </span>
                                    </div>
                                    <div className="text-xs font-mono flex items-center gap-2">
                                        {selectedPeer.summary?.probes_paused ? (
                                            <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[11px] font-bold">
                                                ⏸ Standby ({totalProbes})
                                            </span>
                                        ) : failingCount > 0 ? (
                                            <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[11px] font-bold">
                                                ⚠️ {passingProbes}/{totalProbes} Passing · {failingCount} Failing
                                            </span>
                                        ) : (
                                            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-bold">
                                                ✅ {passingProbes}/{totalProbes} Passing
                                            </span>
                                        )}
                                    </div>
                                </button>

                                {openSections.probes && (
                                    <div className="px-3.5 pb-3.5 pt-2 border-t border-border/60">
                                        {selectedPeer.summary?.probes_paused ? (
                                            <div className="p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs font-mono text-amber-400 flex items-center gap-2">
                                                <span>⏸</span>
                                                <span>Local probe execution is paused on this node.</span>
                                            </div>
                                        ) : selectedPeer.summary?.failing_probes && selectedPeer.summary.failing_probes.length > 0 ? (
                                            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                                                {selectedPeer.summary.failing_probes.map((p, idx) => (
                                                    <div key={idx} className="px-2.5 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs font-mono flex items-center justify-between gap-2">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <span className="text-amber-400 shrink-0">⚠️</span>
                                                            <span className="font-bold text-text truncate">{p.name}</span>
                                                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-card-secondary text-text-muted uppercase font-black shrink-0">{p.type}</span>
                                                            {p.target && <span className="text-text-muted text-[11px] truncate">{p.target}</span>}
                                                        </div>
                                                        <div className="text-amber-400 text-right text-[11px] font-semibold shrink-0">
                                                            {p.error}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-xs font-mono text-emerald-400 flex items-center gap-2">
                                                <CheckCircle2 size={15} />
                                                <span>All {totalProbes} synthetic probes are passing (100% reliable)</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* 5. Collapsible Section: Configuration Provisioning */}
                            <div className="rounded-xl border border-border bg-card/60 overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => toggleSection('config')}
                                    className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 hover:bg-card-secondary/50 transition-colors text-left"
                                >
                                    <div className="flex items-center gap-2">
                                        {openSections.config ? <ChevronDown size={15} className="text-text-muted" /> : <ChevronRight size={15} className="text-text-muted" />}
                                        <span className="text-xs uppercase font-mono tracking-wider text-text font-bold">
                                            Configuration Provisioning
                                        </span>
                                    </div>
                                    <div>
                                        {selectedPeer.config_sync_status === 'synced' ? (
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                                All Synced
                                            </span>
                                        ) : selectedPeer.config_sync_status === 'behind' ? (
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                                Behind ({selectedPeer.behind_bundles_count || 1})
                                            </span>
                                        ) : (
                                            <span className="text-xs font-mono text-text-muted">Standalone</span>
                                        )}
                                    </div>
                                </button>

                                {openSections.config && (
                                    <div className="px-3.5 pb-3.5 pt-2 border-t border-border/60">
                                        {selectedPeer.provisioning_status?.appliedRevisions && Object.keys(selectedPeer.provisioning_status.appliedRevisions).length > 0 ? (
                                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                                {Object.entries(selectedPeer.provisioning_status.appliedRevisions).map(([bundle, revObj]) => {
                                                    const rev = typeof revObj === 'object' ? revObj.revision : revObj;
                                                    const leaderRevObj = data?.leader_revisions?.[bundle];
                                                    const leaderRev = typeof leaderRevObj === 'object' ? leaderRevObj?.revision : leaderRevObj;
                                                    const isBundleSynced = selectedPeer.is_leader || !leaderRev || rev >= leaderRev;
                                                    return (
                                                        <div key={bundle} className={`p-2 rounded-lg border text-xs font-mono flex items-center justify-between ${
                                                            isBundleSynced ? 'bg-card-secondary/50 border-border' : 'bg-amber-500/5 border-amber-500/20'
                                                        }`}>
                                                            <span className="text-text-muted capitalize truncate">{bundle.replace(/[-_]/g, ' ')}</span>
                                                            <span className={`font-bold flex items-center gap-1 ${isBundleSynced ? 'text-blue-400' : 'text-amber-400'}`}>
                                                                r{String(rev)}
                                                                {isBundleSynced ? <Check size={12} className="text-emerald-400" /> : <AlertTriangle size={12} className="text-amber-400" />}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="text-xs text-text-muted font-mono">No bundle revisions reported yet.</div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* 6. Collapsible Section: Enabled Capabilities */}
                            <div className="rounded-xl border border-border bg-card/60 overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => toggleSection('capabilities')}
                                    className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 hover:bg-card-secondary/50 transition-colors text-left"
                                >
                                    <div className="flex items-center gap-2">
                                        {openSections.capabilities ? <ChevronDown size={15} className="text-text-muted" /> : <ChevronRight size={15} className="text-text-muted" />}
                                        <span className="text-xs uppercase font-mono tracking-wider text-text font-bold">
                                            Enabled Capabilities
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="flex items-center gap-1">
                                            {CAPABILITIES_CONFIG.map(cap => {
                                                const enabled = !!selectedPeer.capabilities?.[cap.key];
                                                return (
                                                    <span
                                                        key={cap.key}
                                                        title={`${cap.label}: ${enabled ? 'Enabled' : 'Disabled'}`}
                                                        className={`w-2 h-2 rounded-full ${enabled ? cap.dotClass : 'bg-neutral-700'}`}
                                                    />
                                                );
                                            })}
                                        </div>
                                        <span className="text-xs font-mono text-text-muted font-bold">
                                            {enabledCapsCount}/{CAPABILITIES_CONFIG.length}
                                        </span>
                                    </div>
                                </button>

                                {openSections.capabilities && (
                                    <div className="px-3.5 pb-3.5 pt-2 border-t border-border/60 flex flex-wrap gap-2">
                                        {CAPABILITIES_CONFIG.map(cap => {
                                            const enabled = !!selectedPeer.capabilities?.[cap.key];
                                            return (
                                                <span 
                                                    key={cap.key}
                                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border flex items-center gap-1.5 ${
                                                        enabled 
                                                            ? cap.activeClass 
                                                            : 'bg-card-secondary text-text-muted border-border opacity-50'
                                                    }`}
                                                >
                                                    <span className={`w-2 h-2 rounded-full ${enabled ? cap.dotClass : 'bg-neutral-600'}`} />
                                                    {cap.label}
                                                </span>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* 7. Action Footer */}
                            <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
                                <span className="text-[11px] font-mono text-text-muted flex items-center gap-1.5">
                                    <Clock size={12} />
                                    Last telemetry: {selectedPeer.last_seen ? new Date(selectedPeer.last_seen).toLocaleTimeString() : '—'}
                                </span>
                                <div className="flex items-center gap-2">
                                    <a
                                        href={directMgmtUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-3 py-1.5 rounded-xl bg-card-secondary hover:bg-card-hover text-text-secondary font-bold text-xs flex items-center gap-1.5 transition-all border border-border"
                                        title="Open direct URL in new tab"
                                    >
                                        <span>Direct UI</span>
                                        <ExternalLink size={13} />
                                    </a>

                                    {!(selectedPeer.is_leader || selectedPeer.type === 'leader') && (
                                        <button
                                            onClick={() => {
                                                setActivePeerId(selectedPeer.instance_id);
                                                setSelectedPeer(null);
                                                _onNavigate?.('connectivity');
                                            }}
                                            className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-lg active:scale-95"
                                        >
                                            <Zap size={13} className="fill-white" />
                                            <span>Connect via Remote View</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Right-Side Slide-Over Drawer: Fleet Live Event Timeline (Proposition 4) */}
            {timelineOpen && (() => {
                const uniqueSites = Array.from(new Set([
                    ...(data?.instances || []).map(i => i.meta?.site || i.instance_id),
                    ...timelineEvents.map(e => e.site)
                ].filter(Boolean)));

                const filteredTimeline = timelineEvents.filter(ev => {
                    if (timelineCategory !== 'all' && ev.category !== timelineCategory) return false;
                    if (timelineSite !== 'all' && ev.site.toLowerCase() !== timelineSite.toLowerCase()) return false;
                    return true;
                });

                const categoryPills: Array<{ id: 'all' | FleetEventCategory; label: string }> = [
                    { id: 'all', label: 'All' },
                    { id: 'tunnel', label: '🔗 Tunnels' },
                    { id: 'config', label: '🔄 Config' },
                    { id: 'sla', label: '🛡️ SLA & Probes' },
                    { id: 'engine', label: '⚡ Engines' }
                ];

                return (
                    <div
                        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex justify-end"
                        onClick={() => setTimelineOpen(false)}
                    >
                        <div
                            className="w-full max-w-lg bg-card border-l border-border h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200"
                            onClick={e => e.stopPropagation()}
                        >
                            {/* Drawer Header */}
                            <div className="p-4 border-b border-border flex items-center justify-between gap-3 bg-card-secondary/40">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
                                        <Activity size={18} />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <h2 className="text-base font-black text-text truncate">Fleet Live Timeline</h2>
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-500/15 text-blue-400 border border-blue-500/25">
                                                {filteredTimeline.length}
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-text-muted truncate">
                                            Control plane tunnels, config revisions, SLA probes & engines
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                        type="button"
                                        onClick={fetchTimelineEvents}
                                        disabled={timelineLoading}
                                        className="p-1.5 rounded-lg bg-card-secondary hover:bg-card-hover text-text-secondary border border-border transition-colors"
                                        title="Refresh Timeline"
                                    >
                                        <RefreshCw size={14} className={timelineLoading ? 'animate-spin' : ''} />
                                    </button>
                                    {timelineEvents.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={clearTimelineEvents}
                                            className="p-1.5 rounded-lg bg-card-secondary hover:bg-rose-500/15 text-text-muted hover:text-rose-400 border border-border transition-colors"
                                            title="Clear Timeline History"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setTimelineOpen(false)}
                                        className="p-1.5 rounded-lg bg-card-secondary hover:bg-card-hover text-text-muted hover:text-text border border-border transition-colors"
                                    >
                                        <X size={15} />
                                    </button>
                                </div>
                            </div>

                            {/* Filter Strip */}
                            <div className="p-3 border-b border-border bg-card/80 space-y-2.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {categoryPills.map(cat => (
                                        <button
                                            key={cat.id}
                                            type="button"
                                            onClick={() => setTimelineCategory(cat.id)}
                                            className={cn(
                                                "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all",
                                                timelineCategory === cat.id
                                                    ? "bg-blue-600 text-white shadow-xs"
                                                    : "bg-card-secondary text-text-muted hover:text-text border border-border/60"
                                            )}
                                        >
                                            {cat.label}
                                        </button>
                                    ))}
                                </div>

                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider">Filter Site:</span>
                                    <select
                                        value={timelineSite}
                                        onChange={e => setTimelineSite(e.target.value)}
                                        className="bg-background border border-border rounded-lg px-2.5 py-1 text-xs font-mono text-text focus:outline-none focus:border-blue-500"
                                    >
                                        <option value="all">All Sites ({uniqueSites.length})</option>
                                        {uniqueSites.map(s => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Chronological Event Feed */}
                            <div className="flex-1 overflow-y-auto p-4">
                                {timelineLoading && timelineEvents.length === 0 ? (
                                    <div className="py-12 text-center text-xs font-mono text-text-muted">
                                        Loading fleet timeline...
                                    </div>
                                ) : filteredTimeline.length === 0 ? (
                                    <div className="py-12 text-center space-y-2">
                                        <div className="text-xs font-bold text-text-secondary">No fleet events recorded yet</div>
                                        <div className="text-[11px] text-text-muted max-w-xs mx-auto">
                                            State transitions across WebSocket tunnels, config sync, SLA probes, and traffic/voice/IoT engines appear here automatically.
                                        </div>
                                    </div>
                                ) : (
                                    <div className="relative pl-4 border-l border-border space-y-3">
                                        {filteredTimeline.map(ev => {
                                            const dotClass = ev.severity === 'critical'
                                                ? 'bg-rose-500 ring-rose-500/20'
                                                : ev.severity === 'warning'
                                                ? 'bg-amber-400 ring-amber-400/20'
                                                : ev.severity === 'success'
                                                ? 'bg-emerald-400 ring-emerald-400/20'
                                                : 'bg-blue-400 ring-blue-400/20';

                                            const cardBorder = ev.severity === 'critical'
                                                ? 'border-rose-500/30 bg-rose-500/5'
                                                : ev.severity === 'warning'
                                                ? 'border-amber-500/30 bg-amber-500/5'
                                                : ev.severity === 'success'
                                                ? 'border-emerald-500/25 bg-emerald-500/5'
                                                : 'border-border bg-card-secondary/40';

                                            const catBadge = ev.category === 'tunnel'
                                                ? 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20'
                                                : ev.category === 'config'
                                                ? 'text-purple-400 bg-purple-500/10 border-purple-500/20'
                                                : ev.category === 'sla'
                                                ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                                                : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';

                                            const timeStr = new Date(ev.epochMs || ev.epoch_ms || ev.timestamp).toLocaleTimeString([], {
                                                hour: '2-digit',
                                                minute: '2-digit',
                                                second: '2-digit'
                                            });
                                            const evInstanceId = ev.instanceId || ev.instance_id;
                                            const detailText = ev.details || ev.detail;

                                            const matchedPeer = data?.instances.find(
                                                i => (evInstanceId && i.instance_id === evInstanceId) || (i.meta?.site || '').toLowerCase() === ev.site.toLowerCase()
                                            );

                                            return (
                                                <div key={ev.id} className="relative group">
                                                    <span
                                                        className={`absolute -left-[21px] top-3 w-2.5 h-2.5 rounded-full ring-4 ${dotClass}`}
                                                    />
                                                    <div className={`p-3 rounded-xl border transition-colors ${cardBorder}`}>
                                                        <div className="flex items-center justify-between gap-2 mb-1">
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <span className="font-mono text-[11px] text-text-muted">
                                                                    {timeStr}
                                                                </span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        if (matchedPeer) {
                                                                            setOpenSections({ tunnel: false, probes: false, config: false, capabilities: false });
                                                                            setSelectedPeer(matchedPeer);
                                                                        }
                                                                    }}
                                                                    className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold border ${
                                                                        matchedPeer
                                                                            ? 'bg-card hover:bg-blue-500/15 text-text hover:text-blue-400 border-border cursor-pointer'
                                                                            : 'bg-card-secondary text-text-secondary border-border cursor-default'
                                                                    }`}
                                                                    title={matchedPeer ? `Inspect ${ev.site}` : ev.site}
                                                                >
                                                                    {ev.site}
                                                                </button>
                                                                <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono uppercase font-bold border ${catBadge}`}>
                                                                    {ev.category}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div className="text-xs font-bold text-text">
                                                            {ev.title}
                                                        </div>
                                                        {detailText && (
                                                            <div className="text-[11px] font-mono text-text-muted mt-0.5 break-words">
                                                                {detailText}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
