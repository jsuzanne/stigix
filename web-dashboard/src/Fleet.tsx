import React, { useState, useEffect, useMemo } from 'react';
import { 
    Globe, RefreshCw, Search, Server, Gauge, 
    CheckCircle2, XCircle, ExternalLink, 
    Check, X, Filter, Copy, Clock, AlertTriangle, ShieldCheck,
    Zap
} from 'lucide-react';
import { cn } from './lib/utils';
import { usePeerContext } from './PeerContext';
import { FleetSkeleton } from './components/skeletons/FleetSkeleton';

interface FleetProps {
    token: string;
    onNavigate?: (view: any) => void;
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
    status: 'online' | 'offline';
    is_stale: boolean;
    last_seen_seconds_ago: number;
    last_seen?: string;
    rtt_ms?: number;
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
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold font-mono border whitespace-nowrap ${badgeClass}`}>
            <span className="text-sm font-black">{score}</span>
            <span className="text-[10px] uppercase tracking-wider opacity-85 whitespace-nowrap">/ 100 · {label}</span>
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
    const [lastRefreshTime, setLastRefreshTime] = useState<Date>(new Date());
    const [copiedIp, setCopiedIp] = useState<string | null>(null);

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
                        rtt_ms: matchedTunnel?.rttMs ?? inst.rtt_ms
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

            {/* Error Banner */}
            {error && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-3">
                    <AlertTriangle size={18} className="shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* Filter and Search Bar with Integrated Dynamic Badges */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-card/40 p-3.5 rounded-xl border border-border">
                <div className="relative w-full sm:w-80">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                    <input
                        type="text"
                        placeholder="Search by Site, Node ID, IP..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-1.5 bg-background border border-border rounded-lg text-xs text-text focus:outline-none focus:border-blue-500 transition-colors"
                    />
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

            {/* Peers Table */}
            <div className="bg-card/60 backdrop-blur-md rounded-2xl border border-border overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-card-secondary border-b border-border text-xs uppercase font-mono tracking-wider text-text-muted">
                            <tr>
                                <th className="px-6 py-3">Site / Node</th>
                                <th className="px-5 py-3">Status</th>
                                <th className="px-5 py-3">Mesh Link</th>
                                <th className="px-6 py-3">Global Exp. Score</th>
                                <th className="px-6 py-3">Probes</th>
                                <th className="px-6 py-3">Traffic</th>
                                <th className="px-6 py-3">Voice MOS</th>
                                <th className="px-6 py-3">Config</th>
                                <th className="px-6 py-3">Last Update</th>
                                <th className="px-6 py-3 text-right">Actions</th>
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
                                    const isLeader = peer.is_leader || peer.type === 'leader' || peer.instance_id.toLowerCase().includes('leader');
                                    const version = peer.meta?.version || '—';

                                    const { rel, timeStr } = formatLastSeen(peer.last_seen_seconds_ago, peer.last_seen);
                                    
                                    // Management URL vs Traffic IP determination
                                    const mgmtUrl = peer.meta?.management_url 
                                        || (peer.meta?.management_ip ? `http://${peer.meta.management_ip}:8080` : null);
                                    const effectiveUrl = mgmtUrl || `http://${peer.ip_private}:8080`;

                                    return (
                                        <tr 
                                            key={peer.instance_id}
                                            onClick={() => setSelectedPeer(peer)}
                                            className={`hover:bg-blue-500/5 transition-colors cursor-pointer group ${
                                                isLeader ? 'bg-purple-950/10' : ''
                                            }`}
                                        >
                                            {/* Site & ID: Compact 2 lines with inline capability dots (Option A) */}
                                            <td className="px-6 py-3">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-8 h-8 rounded-lg border flex items-center justify-center font-bold text-xs transition-all shrink-0 ${
                                                        isLeader 
                                                            ? 'bg-purple-500/10 border-purple-500/30 text-purple-400' 
                                                            : 'bg-card-secondary/80 border-border text-text-secondary group-hover:border-blue-500/40 group-hover:text-blue-400'
                                                    }`}>
                                                        {isLeader ? '👑' : siteName.slice(0, 3).toUpperCase()}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="font-bold text-text flex items-center gap-2">
                                                            <span className="truncate">{siteName}</span>
                                                            {isLeader && (
                                                                <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/20 whitespace-nowrap">
                                                                    Leader (This Node)
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-xs text-text-muted font-mono flex items-center gap-2 mt-0.5 whitespace-nowrap">
                                                            {/* Traffic IP with 1-click copy */}
                                                            <span 
                                                                onClick={(e) => handleCopy(e, peer.ip_private)}
                                                                className="hover:text-blue-400 flex items-center gap-1 cursor-copy"
                                                                title="Traffic IP (Click to copy)"
                                                            >
                                                                <span>{peer.ip_private}</span>
                                                                {copiedIp === peer.ip_private ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} className="opacity-40 hover:opacity-100" />}
                                                            </span>
                                                            <span>·</span>
                                                            <span className="text-[11px] opacity-75">{version}</span>
                                                            <span>·</span>
                                                            {/* Colored Capability Dots inline */}
                                                            <div className="flex items-center gap-1">
                                                                {CAPABILITIES_CONFIG.map(cap => {
                                                                    const enabled = !!peer.capabilities?.[cap.key];
                                                                    return (
                                                                        <span
                                                                            key={cap.key}
                                                                            title={`${cap.label}: ${enabled ? 'Enabled' : 'Disabled'}`}
                                                                            className={`w-1.5 h-1.5 rounded-full transition-all ${
                                                                                enabled ? cap.dotClass : 'bg-card-hover/40'
                                                                            }`}
                                                                        />
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Status Badge */}
                                            <td className="px-5 py-3 whitespace-nowrap">
                                                {peer.status === 'online' ? (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                                        Online
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/20 shadow-sm">
                                                        <XCircle size={12} />
                                                        Offline
                                                    </span>
                                                )}
                                            </td>

                                            {/* Mesh Link / Transport Mode */}
                                            <td className="px-5 py-3 whitespace-nowrap">
                                                {isLeader ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                                        👑 Local Leader
                                                    </span>
                                                ) : peer.status === 'online' ? (
                                                    peer.has_tunnel ? (
                                                        peer.tunnel_direction === 'outbound' || peer.tunnel_direction === 'outbound_dial' ? (
                                                            <div className="flex flex-col gap-1 items-start">
                                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 shadow-sm" title="Outbound WebSocket Tunnel (Initiator: Leader ➔ Receiver: Peer)">
                                                                        ↗️ OUTBOUND WS
                                                                    </span>
                                                                    {peer.rtt_ms !== undefined && (
                                                                        <span className="text-[10px] font-mono text-cyan-600 dark:text-cyan-400 font-semibold" title="Tunnel Round-Trip Time">{peer.rtt_ms}ms</span>
                                                                    )}
                                                                    {peer.tunnel_uptime_seconds !== undefined && (
                                                                        <span
                                                                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                                                                                peer.tunnel_uptime_seconds < 300
                                                                                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                                                                                    : 'bg-card-secondary/80 text-text-secondary border-border/60'
                                                                            }`}
                                                                            title={`WebSocket Tunnel Uptime: ${formatTunnelUptime(peer.tunnel_uptime_seconds)}${peer.tunnel_connected_at ? ` (Connected since ${new Date(peer.tunnel_connected_at).toLocaleString()})` : ''}`}
                                                                        >
                                                                            <Clock size={10} className="opacity-75" />
                                                                            {formatTunnelUptime(peer.tunnel_uptime_seconds)}
                                                                        </span>
                                                                    )}
                                                                    {(peer.tunnel_reconnect_count ?? 0) > 0 && (
                                                                        <span
                                                                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                                                                            title={`Tunnel reconnected ${peer.tunnel_reconnect_count} time(s) since Leader start${peer.tunnel_last_disconnected_at ? ` · Last drop: ${new Date(peer.tunnel_last_disconnected_at).toLocaleTimeString()}${peer.tunnel_last_disconnect_reason ? ` (${peer.tunnel_last_disconnect_reason})` : ''}` : ''}`}
                                                                        >
                                                                            ↻ {peer.tunnel_reconnect_count}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-1 text-[10px] font-mono" title={`Tunnel Path: Initiator ${peer.tunnel_source_ip || 'Leader'} connects to Receiver ${peer.tunnel_dest_ip || peer.ip_private}`}>
                                                                    <span className="text-text-muted font-sans font-bold text-[9px] uppercase tracking-wide">Src:</span>
                                                                    <span className="bg-card-secondary/80 px-1.5 py-0.5 rounded border border-border/50 text-text font-semibold">{peer.tunnel_source_ip || 'Leader'}{peer.tunnel_source_port ? `:${peer.tunnel_source_port}` : ''}</span>
                                                                    <span className="text-cyan-500 font-bold px-0.5">➔</span>
                                                                    <span className="text-text-muted font-sans font-bold text-[9px] uppercase tracking-wide">Dst:</span>
                                                                    <span className="bg-card-secondary/80 px-1.5 py-0.5 rounded border border-border/50 text-text font-semibold">{peer.tunnel_dest_ip || peer.ip_private}{peer.tunnel_dest_port ? `:${peer.tunnel_dest_port}` : ''}</span>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="flex flex-col gap-1 items-start">
                                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 shadow-sm" title="Inbound Reverse WebSocket Tunnel (Initiator: Peer ➔ Receiver: Leader, NAT Traversal)">
                                                                        ↘️ INBOUND WS
                                                                    </span>
                                                                    {peer.rtt_ms !== undefined && (
                                                                        <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-semibold" title="Tunnel Round-Trip Time">{peer.rtt_ms}ms</span>
                                                                    )}
                                                                    {peer.tunnel_uptime_seconds !== undefined && (
                                                                        <span
                                                                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                                                                                peer.tunnel_uptime_seconds < 300
                                                                                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                                                                                    : 'bg-card-secondary/80 text-text-secondary border-border/60'
                                                                            }`}
                                                                            title={`WebSocket Tunnel Uptime: ${formatTunnelUptime(peer.tunnel_uptime_seconds)}${peer.tunnel_connected_at ? ` (Connected since ${new Date(peer.tunnel_connected_at).toLocaleString()})` : ''}`}
                                                                        >
                                                                            <Clock size={10} className="opacity-75" />
                                                                            {formatTunnelUptime(peer.tunnel_uptime_seconds)}
                                                                        </span>
                                                                    )}
                                                                    {(peer.tunnel_reconnect_count ?? 0) > 0 && (
                                                                        <span
                                                                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                                                                            title={`Tunnel reconnected ${peer.tunnel_reconnect_count} time(s) since Leader start${peer.tunnel_last_disconnected_at ? ` · Last drop: ${new Date(peer.tunnel_last_disconnected_at).toLocaleTimeString()}${peer.tunnel_last_disconnect_reason ? ` (${peer.tunnel_last_disconnect_reason})` : ''}` : ''}`}
                                                                        >
                                                                            ↻ {peer.tunnel_reconnect_count}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-1 text-[10px] font-mono" title={`Tunnel Path: Initiator ${peer.tunnel_source_ip || peer.ip_private} connects to Receiver ${peer.tunnel_dest_ip || 'Leader'}`}>
                                                                    <span className="text-text-muted font-sans font-bold text-[9px] uppercase tracking-wide">Src:</span>
                                                                    <span className="bg-card-secondary/80 px-1.5 py-0.5 rounded border border-border/50 text-text font-semibold">{peer.tunnel_source_ip || peer.ip_private}{peer.tunnel_source_port ? `:${peer.tunnel_source_port}` : ''}</span>
                                                                    <span className="text-emerald-500 font-bold px-0.5">➔</span>
                                                                    <span className="text-text-muted font-sans font-bold text-[9px] uppercase tracking-wide">Dst:</span>
                                                                    <span className="bg-card-secondary/80 px-1.5 py-0.5 rounded border border-border/50 text-text font-semibold">{peer.tunnel_dest_ip || 'Leader'}{peer.tunnel_dest_port ? `:${peer.tunnel_dest_port}` : ''}</span>
                                                                </div>
                                                            </div>
                                                        )
                                                    ) : (
                                                        <div className="flex flex-col gap-1 items-start">
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold text-text-muted bg-card-secondary/80 border border-border/60" title="Direct LAN HTTP Connection">
                                                                🌐 Direct HTTP
                                                            </span>
                                                            <div className="flex items-center gap-1 text-[10px] font-mono">
                                                                <span className="text-text-muted font-sans font-bold text-[9px] uppercase tracking-wide">Src:</span>
                                                                <span className="bg-card-secondary/80 px-1.5 py-0.5 rounded border border-border/50 text-text font-semibold">Leader</span>
                                                                <span className="text-text-muted font-bold px-0.5">➔</span>
                                                                <span className="text-text-muted font-sans font-bold text-[9px] uppercase tracking-wide">Dst:</span>
                                                                <span className="bg-card-secondary/80 px-1.5 py-0.5 rounded border border-border/50 text-text font-semibold">{peer.ip_private}:8080</span>
                                                            </div>
                                                        </div>
                                                    )
                                                ) : (
                                                    <span className="text-xs text-text-muted font-mono">—</span>
                                                )}
                                            </td>

                                            {/* Global Experience Score (Single line, no wrap) */}
                                            <td className="px-6 py-3">
                                                <ScoreMiniBadge 
                                                    score={peer.summary?.probes_global_health} 
                                                    isStale={peer.is_stale}
                                                    isOnline={peer.status === 'online'}
                                                    isPaused={peer.summary?.probes_paused}
                                                />
                                            </td>

                                            {/* Probes Summary with descriptive tooltip */}
                                            <td className="px-6 py-3">
                                                {peer.is_stale || peer.summary?.probes_total === undefined ? (
                                                    <span className="text-xs text-text-muted font-mono">—</span>
                                                ) : peer.summary.probes_paused ? (
                                                    <div
                                                        className="text-xs font-mono text-text-muted cursor-help whitespace-nowrap"
                                                        title={`Local DEM probe execution is paused on this node (${peer.summary.probes_total} catalog probes synced)`}
                                                    >
                                                        <span className="text-amber-500/80 mr-1">⏸</span>
                                                        <span>Paused</span>
                                                        <span className="ml-1 opacity-60">({peer.summary.probes_total})</span>
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
                                                        <div className="text-xs font-mono cursor-help" title={tooltip}>
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

                                            {/* Traffic State */}
                                            <td className="px-6 py-3">
                                                {peer.is_stale || !peer.summary?.traffic_state ? (
                                                    <span className="text-xs text-text-muted font-mono">—</span>
                                                ) : peer.summary.traffic_state === 'RUNNING' ? (
                                                    <div className="flex items-center gap-1.5 text-xs font-mono whitespace-nowrap">
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
                                                    <div className="flex items-center gap-1.5 text-xs text-text-muted font-mono">
                                                        <span>■</span>
                                                        <span>Stopped</span>
                                                    </div>
                                                )}
                                            </td>

                                            {/* Voice MOS */}
                                            <td className="px-6 py-3">
                                                {peer.is_stale || !peer.summary?.voice_mos ? (
                                                    <span className="text-xs text-text-muted font-mono">—</span>
                                                ) : (
                                                    <span className="text-xs font-bold font-mono text-cyan-400">
                                                        {peer.summary.voice_mos.toFixed(2)}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Config Sync Status */}
                                            <td className="px-6 py-3">
                                                {peer.config_sync_status === 'synced' ? (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" title="All global config bundles match Leader">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                                        Synced
                                                    </span>
                                                ) : peer.config_sync_status === 'behind' ? (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20" title={`${peer.behind_bundles_count || 1} bundle(s) behind Leader`}>
                                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                                        Behind ({peer.behind_bundles_count || '!'})
                                                    </span>
                                                ) : (
                                                    <span className="text-xs font-mono text-text-muted">—</span>
                                                )}
                                            </td>

                                            {/* Last Update: Relative + Absolute Timestamp + RTT */}
                                            <td className="px-6 py-3 text-xs font-mono text-text-muted" title={peer.last_seen || ''}>
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <span className="font-bold text-text/80">{rel}</span>
                                                        {(() => {
                                                            const rtt = peer.meta?.rtt_ms ?? peer.rtt_ms;
                                                            if (rtt !== undefined && rtt !== null && !isLeader) {
                                                                const color = rtt < 50 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" :
                                                                    rtt < 150 ? "text-amber-400 bg-amber-500/10 border-amber-500/20" :
                                                                    "text-rose-400 bg-rose-500/10 border-rose-500/20";
                                                                return (
                                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${color}`} title={`Tunnel WebSocket RTT: ${rtt}ms`}>
                                                                        ⚡ {rtt}ms
                                                                    </span>
                                                                );
                                                            }
                                                            return null;
                                                        })()}
                                                    </div>
                                                    {timeStr && <span className="text-[11px] opacity-60">{timeStr}</span>}
                                                </div>
                                            </td>

                                            {/* Actions: Context Switcher Connect, Open Direct UI & Copy IP */}
                                            <td className="px-6 py-3 text-right" onClick={e => e.stopPropagation()}>
                                                <div className="inline-flex items-center gap-1.5 justify-end">
                                                    <button
                                                        onClick={(e) => handleCopy(e, peer.ip_private)}
                                                        className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-card-secondary hover:bg-card-hover text-text-secondary border border-border transition-all"
                                                        title="Copy Traffic IP"
                                                    >
                                                        {copiedIp === peer.ip_private ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                                    </button>

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
                                                            <span className="px-3 py-1.5 rounded-lg text-xs font-bold font-mono bg-purple-500/10 text-purple-400 border border-purple-500/20 whitespace-nowrap">
                                                                Local Leader
                                                            </span>
                                                        ) : (
                                                            <button
                                                                onClick={() => {
                                                                    setActivePeerId(null);
                                                                    _onNavigate?.('connectivity');
                                                                }}
                                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 hover:border-purple-500/50 transition-all shadow-sm active:scale-95 whitespace-nowrap"
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
                                                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95 whitespace-nowrap ${
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

            {/* Peer Detail Drawer / Modal (Aligning with PRD Screen 2 Mockup) */}
            {selectedPeer && (() => {
                const score = selectedPeer.summary?.probes_global_health;
                const scoreColor = score !== undefined && score !== null
                    ? score >= 80 ? 'text-emerald-400' : score >= 65 ? 'text-cyan-400' : score >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-400'
                    : 'text-text-muted';
                const label = score !== undefined && score !== null
                    ? score >= 80 ? 'Optimal' : score >= 65 ? 'Good' : score >= 50 ? 'Degraded' : 'Critical'
                    : 'N/A';

                return (
                    <div 
                        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
                        onClick={() => setSelectedPeer(null)}
                    >
                        <div 
                            className="bg-card border border-border rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-6 animate-in fade-in zoom-in-95 duration-150"
                            onClick={e => e.stopPropagation()}
                        >
                            {/* Modal Header */}
                            <div className="flex items-start justify-between border-b border-border pb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 font-black text-lg">
                                        {(selectedPeer.meta?.site || selectedPeer.instance_id).slice(0, 3).toUpperCase()}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h2 className="text-xl font-black text-text">
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
                                        <p className="text-xs text-text-muted font-mono mt-0.5">
                                            ID: {selectedPeer.instance_id} · Version: {selectedPeer.meta?.version || '—'}
                                        </p>
                                    </div>
                                </div>

                                <button 
                                    onClick={() => setSelectedPeer(null)}
                                    className="w-8 h-8 rounded-lg bg-card-secondary hover:bg-card-hover flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
                                >
                                    <X size={16} />
                                </button>
                            </div>

                            {/* Network & Access Addresses */}
                            <div className="space-y-2">
                                <h3 className="text-xs uppercase font-mono tracking-wider text-text-muted font-bold">
                                    Network & Management Addresses
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="p-3 rounded-xl bg-card/60 border border-border flex items-center justify-between">
                                        <div>
                                            <div className="text-[10px] uppercase font-bold text-text-muted">Traffic IP (Data Plane)</div>
                                            <div className="text-sm font-mono font-bold text-text mt-0.5">{selectedPeer.ip_private}</div>
                                        </div>
                                        <button
                                            onClick={(e) => handleCopy(e, selectedPeer.ip_private)}
                                            className="p-1.5 rounded-lg bg-card-secondary hover:bg-card-hover text-text-secondary"
                                            title="Copy IP"
                                        >
                                            {copiedIp === selectedPeer.ip_private ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                                        </button>
                                    </div>

                                    <div className="p-3 rounded-xl bg-card/60 border border-border flex items-center justify-between">
                                        <div>
                                            <div className="text-[10px] uppercase font-bold text-text-muted">Management URL</div>
                                            <div className="text-sm font-mono font-bold text-text mt-0.5 truncate max-w-[180px]">
                                                {selectedPeer.meta?.management_url 
                                                    || (selectedPeer.meta?.management_ip ? `http://${selectedPeer.meta.management_ip}:8080` : `http://${selectedPeer.ip_private}:8080`)}
                                            </div>
                                        </div>
                                        <a
                                            href={selectedPeer.meta?.management_url || (selectedPeer.meta?.management_ip ? `http://${selectedPeer.meta.management_ip}:8080` : `http://${selectedPeer.ip_private}:8080`)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="p-1.5 rounded-lg bg-card-secondary hover:bg-card-hover text-text-secondary"
                                            title="Open UI"
                                        >
                                            <ExternalLink size={14} />
                                        </a>
                                    </div>
                                </div>
                                <p className="text-[11px] text-text-muted italic">
                                    💡 Tip: The Traffic IP used for WAN packet generation can differ from the Management IP. You can set <code className="text-blue-400">STIGIX_MANAGEMENT_URL=http://&lt;mgmt-ip&gt;:8080</code> in the peer's environment to customize the direct UI link.
                                </p>
                            </div>

                            {/* WebSocket Control Plane Tunnel */}
                            {(selectedPeer.has_tunnel || selectedPeer.tunnel_source_ip || selectedPeer.tunnel_dest_ip) && (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between flex-wrap gap-2">
                                        <h3 className="text-xs uppercase font-mono tracking-wider text-text-muted font-bold">
                                            Mesh Tunnel Control Plane
                                        </h3>
                                        <div className="flex items-center gap-2">
                                            {selectedPeer.tunnel_uptime_seconds !== undefined && (
                                                <span
                                                    className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded border inline-flex items-center gap-1 ${
                                                        selectedPeer.tunnel_uptime_seconds < 300
                                                            ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25'
                                                            : 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20'
                                                    }`}
                                                >
                                                    <Clock size={11} />
                                                    WS Uptime: {formatTunnelUptime(selectedPeer.tunnel_uptime_seconds)}
                                                </span>
                                            )}
                                            {selectedPeer.rtt_ms !== undefined && (
                                                <span className="text-[11px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                                    RTT: {selectedPeer.rtt_ms} ms
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="p-3 rounded-xl bg-card/60 border border-border space-y-3">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-text-muted font-medium">Tunnel Direction</span>
                                            {selectedPeer.tunnel_direction === 'outbound' || selectedPeer.tunnel_direction === 'outbound_dial' ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                                                    ↗️ OUTBOUND WS (Leader ➔ Spoke)
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                                    ↘️ INBOUND WS (Spoke ➔ Leader, NAT Traversal)
                                                </span>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border/40">
                                            <div className="bg-card-secondary/70 p-2.5 rounded-lg border border-border/50">
                                                <div className="text-[10px] uppercase font-bold text-text-muted">Initiator (Source)</div>
                                                <div className="text-sm font-mono font-bold text-text mt-0.5 truncate">
                                                    {selectedPeer.tunnel_direction === 'outbound' || selectedPeer.tunnel_direction === 'outbound_dial'
                                                        ? `${selectedPeer.tunnel_source_ip || 'Leader'}${selectedPeer.tunnel_source_port ? `:${selectedPeer.tunnel_source_port}` : ''}`
                                                        : `${selectedPeer.tunnel_source_ip || selectedPeer.ip_private}${selectedPeer.tunnel_source_port ? `:${selectedPeer.tunnel_source_port}` : ''}`}
                                                </div>
                                            </div>
                                            <div className="bg-card-secondary/70 p-2.5 rounded-lg border border-border/50">
                                                <div className="text-[10px] uppercase font-bold text-text-muted">Receiver (Destination)</div>
                                                <div className="text-sm font-mono font-bold text-text mt-0.5 truncate">
                                                    {selectedPeer.tunnel_direction === 'outbound' || selectedPeer.tunnel_direction === 'outbound_dial'
                                                        ? `${selectedPeer.tunnel_dest_ip || selectedPeer.ip_private}${selectedPeer.tunnel_dest_port ? `:${selectedPeer.tunnel_dest_port}` : ''}`
                                                        : `${selectedPeer.tunnel_dest_ip || 'Leader'}${selectedPeer.tunnel_dest_port ? `:${selectedPeer.tunnel_dest_port}` : ''}`}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                                            <div className="bg-card-secondary/70 p-2.5 rounded-lg border border-border/50 flex items-center justify-between">
                                                <div>
                                                    <div className="text-[10px] uppercase font-bold text-text-muted">WS Session Uptime</div>
                                                    <div className="text-sm font-mono font-bold text-text mt-0.5 flex items-baseline gap-1.5">
                                                        <span className={selectedPeer.tunnel_uptime_seconds !== undefined && selectedPeer.tunnel_uptime_seconds < 300 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-400'}>
                                                            {formatTunnelUptime(selectedPeer.tunnel_uptime_seconds)}
                                                        </span>
                                                        {selectedPeer.tunnel_connected_at && (
                                                            <span className="text-[10px] font-normal text-text-muted">
                                                                since {new Date(selectedPeer.tunnel_connected_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <Clock size={15} className="text-text-muted opacity-60" />
                                            </div>
                                            <div className="bg-card-secondary/70 p-2.5 rounded-lg border border-border/50 flex items-center justify-between">
                                                <div className="min-w-0">
                                                    <div className="text-[10px] uppercase font-bold text-text-muted">Session Stability</div>
                                                    {(selectedPeer.tunnel_reconnect_count ?? 0) === 0 ? (
                                                        <div className="text-xs font-mono font-bold text-emerald-400 mt-0.5">
                                                            0 reconnects (Stable)
                                                        </div>
                                                    ) : (
                                                        <div className="text-xs font-mono font-bold text-amber-600 dark:text-amber-400 mt-0.5 truncate" title={selectedPeer.tunnel_last_disconnect_reason ? `Last reason: ${selectedPeer.tunnel_last_disconnect_reason}` : undefined}>
                                                            ↻ {selectedPeer.tunnel_reconnect_count} reconnect{selectedPeer.tunnel_reconnect_count === 1 ? '' : 's'}
                                                            {selectedPeer.tunnel_last_disconnected_at && (
                                                                <span className="text-[10px] font-normal text-text-muted ml-1">
                                                                    (last: {new Date(selectedPeer.tunnel_last_disconnected_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                                <RefreshCw size={14} className={(selectedPeer.tunnel_reconnect_count ?? 0) > 0 ? 'text-amber-400 opacity-80' : 'text-emerald-400 opacity-50'} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Top Telemetry Highlight (Clean typography, no wrap, proportional widths) */}
                            <div className="grid grid-cols-2 sm:grid-cols-[1.3fr_1.4fr_0.7fr_0.6fr] gap-3 bg-card-secondary/40 p-4 rounded-xl border border-border">
                                <div>
                                    <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold">Global Exp.</div>
                                    <div className="mt-1 font-mono text-sm font-bold flex items-baseline gap-1 whitespace-nowrap">
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
                                    <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold">Traffic</div>
                                    <div className="mt-1 font-mono text-sm font-bold whitespace-nowrap">
                                        {selectedPeer.summary?.traffic_state === 'RUNNING' ? (
                                            <span className="text-emerald-400 inline-flex items-center gap-1.5 flex-wrap">
                                                <span>▶ Active</span>
                                                {selectedPeer.summary.traffic_tx_mbps !== undefined && selectedPeer.summary.traffic_rx_mbps !== undefined ? (
                                                    <span className="text-xs font-normal opacity-90 text-text-secondary">
                                                        (▲ {selectedPeer.summary.traffic_tx_mbps} TX · ▼ {selectedPeer.summary.traffic_rx_mbps} RX Mbps)
                                                    </span>
                                                ) : selectedPeer.summary.traffic_rate_mbps && selectedPeer.summary.traffic_rate_mbps > 0 ? (
                                                    <span className="text-xs font-normal opacity-90">({selectedPeer.summary.traffic_rate_mbps} Mbps)</span>
                                                ) : null}
                                            </span>
                                        ) : (
                                            <span className="text-text-muted">■ Stopped</span>
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold">Voice MOS</div>
                                    <div className="mt-1 font-mono text-sm font-bold text-cyan-400 whitespace-nowrap">
                                        {selectedPeer.summary?.voice_mos ? selectedPeer.summary.voice_mos.toFixed(2) : '—'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold" title="Node / Container Uptime">Node Uptime</div>
                                    <div className="mt-1 font-mono text-sm font-bold text-text">
                                        {formatUptime(selectedPeer.summary?.uptime_seconds)}
                                    </div>
                                </div>
                            </div>

                            {/* Node Capabilities matching standard Stigix color coding */}
                            <div className="space-y-2">
                                <h3 className="text-xs uppercase font-mono tracking-wider text-text-muted font-bold">
                                    Enabled Capabilities
                                </h3>
                                <div className="flex flex-wrap gap-2">
                                    {CAPABILITIES_CONFIG.map(cap => {
                                        const enabled = !!selectedPeer.capabilities?.[cap.key];
                                        return (
                                            <span 
                                                key={cap.key}
                                                className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-2 transition-all shadow-sm ${
                                                    enabled 
                                                        ? cap.activeClass 
                                                        : 'bg-card-secondary text-text-muted border-border'
                                                }`}
                                            >
                                                <span className={`w-2 h-2 rounded-full ${enabled ? cap.dotClass : 'bg-neutral-600'}`} />
                                                {cap.label}
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Connectivity Probes Breakdown (from PRD Mockup) */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-xs uppercase font-mono tracking-wider text-text-muted font-bold">
                                        Connectivity Probes
                                    </h3>
                                    {selectedPeer.summary?.probes_paused ? (
                                        <div className="text-xs font-mono text-amber-600 dark:text-amber-400">
                                            ⏸ Standby ({selectedPeer.summary?.probes_total ?? 0} catalog probes)
                                        </div>
                                    ) : (
                                        <div className="text-xs font-mono">
                                            <span className="text-text-muted">Total: </span>
                                            <span className="font-bold text-text">{selectedPeer.summary?.probes_total ?? 0}</span>
                                            <span className="text-text-muted"> | Passing: </span>
                                            <span className="font-bold text-emerald-400">{selectedPeer.summary?.probes_passing ?? 0}</span>
                                            <span className="text-text-muted"> | Failing: </span>
                                            <span className={`font-bold ${(selectedPeer.summary?.probes_total ?? 0) - (selectedPeer.summary?.probes_passing ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-text-muted'}`}>
                                                {Math.max(0, (selectedPeer.summary?.probes_total ?? 0) - (selectedPeer.summary?.probes_passing ?? 0))}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {selectedPeer.summary?.probes_paused ? (
                                    <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs font-mono text-amber-600 dark:text-amber-400 flex items-center gap-2">
                                        <span>⏸</span>
                                        <span>Local probe execution is paused on this node. Catalog changes remain synced across the fleet.</span>
                                    </div>
                                ) : selectedPeer.summary?.failing_probes && selectedPeer.summary.failing_probes.length > 0 ? (
                                    <div className="space-y-1.5">
                                        {selectedPeer.summary.failing_probes.map((p, idx) => (
                                            <div key={idx} className="p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs font-mono flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-amber-600 dark:text-amber-400">⚠️</span>
                                                    <span className="font-bold text-text">{p.name}</span>
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-card-secondary text-text-muted uppercase font-black">{p.type}</span>
                                                    {p.target && <span className="text-text-muted text-[11px]">{p.target}</span>}
                                                </div>
                                                <div className="text-amber-600 dark:text-amber-400 text-right text-[11px] font-semibold">
                                                    {p.error} {p.reliability !== undefined && p.reliability > 0 ? `(${p.reliability}%)` : ''}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-xs font-mono text-emerald-400 flex items-center gap-2">
                                        <CheckCircle2 size={16} />
                                        <span>All active synthetic probes are passing and 100% reliable</span>
                                    </div>
                                )}
                            </div>

                            {/* Configuration Provisioning Sync Status (from PRD Mockup) */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-xs uppercase font-mono tracking-wider text-text-muted font-bold">
                                        Configuration Provisioning
                                    </h3>
                                    <div>
                                        {selectedPeer.config_sync_status === 'synced' ? (
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                                All Synced (Matches Leader)
                                            </span>
                                        ) : selectedPeer.config_sync_status === 'behind' ? (
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                                Behind Leader ({selectedPeer.behind_bundles_count || 1} bundle(s) out of date)
                                            </span>
                                        ) : (
                                            <span className="text-xs font-mono text-text-muted">Standalone / No Bundles</span>
                                        )}
                                    </div>
                                </div>

                                {selectedPeer.provisioning_status?.appliedRevisions && Object.keys(selectedPeer.provisioning_status.appliedRevisions).length > 0 && (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        {Object.entries(selectedPeer.provisioning_status.appliedRevisions).map(([bundle, revObj]) => {
                                            const rev = typeof revObj === 'object' ? revObj.revision : revObj;
                                            const leaderRevObj = data?.leader_revisions?.[bundle];
                                            const leaderRev = typeof leaderRevObj === 'object' ? leaderRevObj?.revision : leaderRevObj;
                                            const isBundleSynced = selectedPeer.is_leader || !leaderRev || rev >= leaderRev;
                                            return (
                                                <div key={bundle} className={`p-2.5 rounded-xl border text-xs font-mono flex items-center justify-between ${
                                                    isBundleSynced ? 'bg-card-secondary/50 border-border' : 'bg-amber-500/5 border-amber-500/20'
                                                }`}>
                                                    <span className="text-text-muted capitalize">{bundle.replace(/_/g, ' ')}</span>
                                                    <span className={`font-bold flex items-center gap-1.5 ${isBundleSynced ? 'text-blue-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                                        r{String(rev)}
                                                        {isBundleSynced ? <Check size={12} className="text-emerald-400" /> : <AlertTriangle size={12} className="text-amber-600 dark:text-amber-400" />}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Direct Action Footer */}
                            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-border">
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-xs font-mono text-text-muted flex items-center gap-1.5">
                                        <Clock size={12} />
                                        Last telemetry: {selectedPeer.last_seen ? new Date(selectedPeer.last_seen).toLocaleString() : '—'}
                                    </span>
                                    {(selectedPeer.rtt_ms ?? selectedPeer.meta?.rtt_ms) !== undefined && (
                                        <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                                            <Zap size={11} className="text-emerald-400" />
                                            Tunnel RTT: {selectedPeer.rtt_ms ?? selectedPeer.meta?.rtt_ms} ms (Active Heartbeat)
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <a
                                        href={selectedPeer.meta?.management_url || (selectedPeer.meta?.management_ip ? `http://${selectedPeer.meta.management_ip}:8080` : `http://${selectedPeer.ip_private}:8080`)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-3 py-2 rounded-xl bg-card-secondary hover:bg-card-hover text-text-secondary font-bold text-xs flex items-center gap-1.5 transition-all border border-neutral-700"
                                        title="Open direct URL in new tab"
                                    >
                                        <span>Direct URL</span>
                                        <ExternalLink size={13} />
                                    </a>

                                    {!(selectedPeer.is_leader || selectedPeer.type === 'leader') && (
                                        <button
                                            onClick={() => {
                                                setActivePeerId(selectedPeer.instance_id);
                                                setSelectedPeer(null);
                                                _onNavigate?.('connectivity');
                                            }}
                                            className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-2 transition-all shadow-lg active:scale-95"
                                        >
                                            <Zap size={14} className="fill-white" />
                                            <span>Connect via Remote View</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
