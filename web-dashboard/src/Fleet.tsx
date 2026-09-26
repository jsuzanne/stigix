import React, { useState, useEffect, useMemo } from 'react';
import { 
    Globe, RefreshCw, Search, Server, Gauge, 
    CheckCircle2, XCircle, ExternalLink, 
    Check, X, Filter, Copy, Clock, AlertTriangle, ShieldCheck
} from 'lucide-react';

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
    status: 'online' | 'offline';
    is_stale: boolean;
    last_seen_seconds_ago: number;
    last_seen?: string;
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
function ScoreMiniBadge({ score, isStale, isOnline }: { score?: number | null; isStale?: boolean; isOnline?: boolean }) {
    if (isStale || !isOnline) {
        return (
            <span className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-neutral-800 text-neutral-500 border border-neutral-700 whitespace-nowrap">
                — Offline
            </span>
        );
    }

    if (score === undefined || score === null) {
        return (
            <span className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-neutral-800/80 text-neutral-400 border border-neutral-700/60 whitespace-nowrap" title="No probe telemetry reported">
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
        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
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
            const res = await fetch('/api/fleet/overview', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) {
                if (res.status === 403) {
                    throw new Error('This instance is not in Leader mode. Fleet Overview is only accessible on the Leader.');
                }
                throw new Error(`Failed to fetch fleet overview (${res.status})`);
            }
            const json: FleetOverviewResponse = await res.json();
            setData(json);
            setError(null);
            setLastRefreshTime(new Date());

            // If a peer modal is open, refresh its data reference
            if (selectedPeer) {
                const refreshed = json.instances.find(i => i.instance_id === selectedPeer.instance_id);
                if (refreshed) setSelectedPeer(refreshed);
            }
        } catch (err: any) {
            setError(err.message || 'Error contacting Fleet API');
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

    return (
        <div className="space-y-6">
            {/* Top Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card/60 backdrop-blur-md p-6 rounded-2xl border border-border shadow-xl">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shadow-inner">
                        <Globe size={26} />
                    </div>
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-black tracking-tight text-text">Fleet Control Plane</h1>
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
                                <ShieldCheck size={12} />
                                Leader Active
                            </span>
                        </div>
                        <p className="text-sm text-text-muted mt-0.5">
                            Centralized observability & telemetry aggregation across all distributed Stigix peers
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setAutoRefresh(prev => !prev)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 ${
                            autoRefresh 
                                ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' 
                                : 'bg-neutral-800 text-neutral-400 border-neutral-700 hover:text-neutral-200'
                        }`}
                        title="Toggle 15s auto-refresh"
                    >
                        <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-blue-400 animate-pulse' : 'bg-neutral-600'}`} />
                        Auto-Refresh (15s)
                    </button>

                    <span className="text-[11px] font-mono text-text-muted hidden md:inline">
                        Updated {lastRefreshTime.toLocaleTimeString()}
                    </span>

                    <button
                        onClick={() => fetchFleetOverview(true)}
                        disabled={loading}
                        className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-2 transition-all shadow-md active:scale-95 disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
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

            {/* KPI Metrics Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-card/50 backdrop-blur-md p-4 rounded-xl border border-border flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-neutral-800 flex items-center justify-center text-neutral-400">
                        <Server size={20} />
                    </div>
                    <div>
                        <div className="text-xs text-text-muted font-bold uppercase tracking-wider">Total Nodes</div>
                        <div className="text-2xl font-black text-text">{data?.total_instances ?? '—'}</div>
                    </div>
                </div>

                <div className="bg-card/50 backdrop-blur-md p-4 rounded-xl border border-border flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                        <CheckCircle2 size={20} />
                    </div>
                    <div>
                        <div className="text-xs text-emerald-400/80 font-bold uppercase tracking-wider">Online</div>
                        <div className="text-2xl font-black text-emerald-400">{data?.online_count ?? '—'}</div>
                    </div>
                </div>

                <div className="bg-card/50 backdrop-blur-md p-4 rounded-xl border border-border flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400">
                        <XCircle size={20} />
                    </div>
                    <div>
                        <div className="text-xs text-red-400/80 font-bold uppercase tracking-wider">Offline</div>
                        <div className="text-2xl font-black text-red-400">{data?.offline_count ?? '—'}</div>
                    </div>
                </div>

                <div className="bg-gradient-to-br from-blue-950/20 to-indigo-950/20 backdrop-blur-md p-4 rounded-xl border border-blue-500/20 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
                        <Gauge size={20} />
                    </div>
                    <div>
                        <div className="text-xs text-blue-400/80 font-bold uppercase tracking-wider">Fleet Global Exp.</div>
                        <div className="text-2xl font-black text-blue-400">
                            {data?.avg_global_experience !== null && data?.avg_global_experience !== undefined 
                                ? `${data.avg_global_experience}%` 
                                : '—'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Filter and Search Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-card/40 p-4 rounded-xl border border-border">
                <div className="relative w-full sm:w-80">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                    <input
                        type="text"
                        placeholder="Search by Site, Node ID, IP..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-lg text-sm text-text focus:outline-none focus:border-blue-500 transition-colors"
                    />
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
                    <span className="text-xs text-text-muted flex items-center gap-1 mr-1">
                        <Filter size={12} /> Status:
                    </span>
                    {(['all', 'online', 'offline'] as const).map(f => (
                        <button
                            key={f}
                            onClick={() => setStatusFilter(f)}
                            className={`px-3 py-1 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${
                                statusFilter === f
                                    ? 'bg-blue-600 text-white shadow-sm'
                                    : 'bg-neutral-800/60 text-text-muted hover:text-text hover:bg-neutral-800'
                            }`}
                        >
                            {f}
                        </button>
                    ))}
                </div>
            </div>

            {/* Peers Table */}
            <div className="bg-card/60 backdrop-blur-md rounded-2xl border border-border overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-neutral-900/60 border-b border-border text-xs uppercase font-mono tracking-wider text-text-muted">
                            <tr>
                                <th className="px-6 py-4">Site / Node</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4">Global Exp. Score</th>
                                <th className="px-6 py-4">Probes</th>
                                <th className="px-6 py-4">Traffic</th>
                                <th className="px-6 py-4">Voice MOS</th>
                                <th className="px-6 py-4">Config</th>
                                <th className="px-6 py-4">Last Update</th>
                                <th className="px-6 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {filteredInstances.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="px-6 py-12 text-center text-text-muted">
                                        {loading ? (
                                            <div className="flex items-center justify-center gap-2">
                                                <RefreshCw size={16} className="animate-spin text-blue-400" />
                                                <span>Loading fleet instances...</span>
                                            </div>
                                        ) : (
                                            <span>No peer instances matching filter</span>
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
                                            {/* Site & ID with capability indicator dots */}
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-9 h-9 rounded-lg border flex items-center justify-center font-bold transition-all ${
                                                        isLeader 
                                                            ? 'bg-purple-500/10 border-purple-500/30 text-purple-400' 
                                                            : 'bg-neutral-800/80 border-neutral-700 text-neutral-300 group-hover:border-blue-500/40 group-hover:text-blue-400'
                                                    }`}>
                                                        {isLeader ? '👑' : siteName.slice(0, 3).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <div className="font-bold text-text flex items-center gap-2">
                                                            {siteName}
                                                            {isLeader && (
                                                                <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                                                    Leader (This Node)
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-xs text-text-muted font-mono flex items-center gap-2 mt-0.5">
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
                                                        </div>

                                                        {/* Colored Capability Dots (Voice, Failover, Custom Apps, Speedtest, Security, Connectivity) */}
                                                        <div className="flex items-center gap-1.5 mt-1.5">
                                                            {CAPABILITIES_CONFIG.map(cap => {
                                                                const enabled = !!peer.capabilities?.[cap.key];
                                                                return (
                                                                    <span
                                                                        key={cap.key}
                                                                        title={`${cap.label}: ${enabled ? 'Enabled' : 'Disabled'}`}
                                                                        className={`w-2 h-2 rounded-full transition-all ${
                                                                            enabled ? cap.dotClass : 'bg-neutral-700/40'
                                                                        }`}
                                                                    />
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Status Badge (Pure Online / Offline) */}
                                            <td className="px-6 py-4">
                                                {peer.status === 'online' ? (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                                        Online
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/20">
                                                        <XCircle size={12} />
                                                        Offline
                                                    </span>
                                                )}
                                            </td>

                                            {/* Global Experience Score (Single line, no wrap) */}
                                            <td className="px-6 py-4">
                                                <ScoreMiniBadge 
                                                    score={peer.summary?.probes_global_health} 
                                                    isStale={peer.is_stale}
                                                    isOnline={peer.status === 'online'}
                                                />
                                            </td>

                                            {/* Probes Summary with descriptive tooltip */}
                                            <td className="px-6 py-4">
                                                {peer.is_stale || peer.summary?.probes_total === undefined ? (
                                                    <span className="text-xs text-neutral-500 font-mono">—</span>
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
                                            <td className="px-6 py-4">
                                                {peer.is_stale || !peer.summary?.traffic_state ? (
                                                    <span className="text-xs text-neutral-500 font-mono">—</span>
                                                ) : peer.summary.traffic_state === 'RUNNING' ? (
                                                    <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-bold font-mono">
                                                        <span>▶</span>
                                                        <span>{peer.summary.traffic_rate_mbps && peer.summary.traffic_rate_mbps > 0 ? `${peer.summary.traffic_rate_mbps} Mbps` : 'Active'}</span>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-1.5 text-xs text-neutral-400 font-mono">
                                                        <span>■</span>
                                                        <span>Stopped</span>
                                                    </div>
                                                )}
                                            </td>

                                            {/* Voice MOS */}
                                            <td className="px-6 py-4">
                                                {peer.is_stale || !peer.summary?.voice_mos ? (
                                                    <span className="text-xs text-neutral-500 font-mono">—</span>
                                                ) : (
                                                    <span className="text-xs font-bold font-mono text-cyan-400">
                                                        {peer.summary.voice_mos.toFixed(2)}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Config Sync Status */}
                                            <td className="px-6 py-4">
                                                {peer.config_sync_status === 'synced' ? (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" title="All global config bundles match Leader">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                                        Synced
                                                    </span>
                                                ) : peer.config_sync_status === 'behind' ? (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20" title={`${peer.behind_bundles_count || 1} bundle(s) behind Leader`}>
                                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                                        Behind ({peer.behind_bundles_count || '!'})
                                                    </span>
                                                ) : (
                                                    <span className="text-xs font-mono text-neutral-500">—</span>
                                                )}
                                            </td>

                                            {/* Last Update: Relative + Absolute Timestamp */}
                                            <td className="px-6 py-4 text-xs font-mono text-text-muted" title={peer.last_seen || ''}>
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-text/80">{rel}</span>
                                                    {timeStr && <span className="text-[11px] opacity-60">{timeStr}</span>}
                                                </div>
                                            </td>

                                            {/* Actions: Open UI & Copy IP */}
                                            <td className="px-6 py-4 text-right" onClick={e => e.stopPropagation()}>
                                                <div className="inline-flex items-center gap-1.5">
                                                    <button
                                                        onClick={(e) => handleCopy(e, peer.ip_private)}
                                                        className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 transition-all"
                                                        title="Copy Traffic IP"
                                                    >
                                                        {copiedIp === peer.ip_private ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                                    </button>

                                                    <a
                                                        href={effectiveUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 hover:border-neutral-600 transition-all shadow-sm"
                                                        title={`Open UI: ${effectiveUrl}`}
                                                    >
                                                        <span>Open UI</span>
                                                        <ExternalLink size={12} />
                                                    </a>
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
                    ? score >= 80 ? 'text-emerald-400' : score >= 65 ? 'text-cyan-400' : score >= 50 ? 'text-amber-400' : 'text-red-400'
                    : 'text-neutral-400';
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
                                    className="w-8 h-8 rounded-lg bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
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
                                    <div className="p-3 rounded-xl bg-neutral-900/60 border border-border flex items-center justify-between">
                                        <div>
                                            <div className="text-[10px] uppercase font-bold text-text-muted">Traffic IP (Data Plane)</div>
                                            <div className="text-sm font-mono font-bold text-text mt-0.5">{selectedPeer.ip_private}</div>
                                        </div>
                                        <button
                                            onClick={(e) => handleCopy(e, selectedPeer.ip_private)}
                                            className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                                            title="Copy IP"
                                        >
                                            {copiedIp === selectedPeer.ip_private ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                                        </button>
                                    </div>

                                    <div className="p-3 rounded-xl bg-neutral-900/60 border border-border flex items-center justify-between">
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
                                            className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
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

                            {/* Top Telemetry Highlight (Clean typography, no wrap, proportional widths) */}
                            <div className="grid grid-cols-2 sm:grid-cols-[1.3fr_1.4fr_0.7fr_0.6fr] gap-3 bg-neutral-900/40 p-4 rounded-xl border border-border">
                                <div>
                                    <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold">Global Exp.</div>
                                    <div className="mt-1 font-mono text-sm font-bold flex items-baseline gap-1 whitespace-nowrap">
                                        <span className={`text-base font-black ${scoreColor}`}>{score ?? '—'}</span>
                                        <span className="text-xs text-text-muted">/100</span>
                                        <span className={`text-[10px] font-bold uppercase ${scoreColor}`}>· {label}</span>
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold">Traffic</div>
                                    <div className="mt-1 font-mono text-sm font-bold whitespace-nowrap">
                                        {selectedPeer.summary?.traffic_state === 'RUNNING' ? (
                                            <span className="text-emerald-400 inline-flex items-center gap-1.5">
                                                <span>▶ Active</span>
                                                {selectedPeer.summary.traffic_rate_mbps && selectedPeer.summary.traffic_rate_mbps > 0 ? (
                                                    <span className="text-xs font-normal opacity-90">({selectedPeer.summary.traffic_rate_mbps} Mbps)</span>
                                                ) : null}
                                            </span>
                                        ) : (
                                            <span className="text-neutral-400">■ Stopped</span>
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
                                    <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold">Uptime</div>
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
                                                        : 'bg-neutral-900/60 text-neutral-500 border-neutral-800'
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
                                    <div className="text-xs font-mono">
                                        <span className="text-text-muted">Total: </span>
                                        <span className="font-bold text-text">{selectedPeer.summary?.probes_total ?? 0}</span>
                                        <span className="text-text-muted"> | Passing: </span>
                                        <span className="font-bold text-emerald-400">{selectedPeer.summary?.probes_passing ?? 0}</span>
                                        <span className="text-text-muted"> | Failing: </span>
                                        <span className={`font-bold ${(selectedPeer.summary?.probes_total ?? 0) - (selectedPeer.summary?.probes_passing ?? 0) > 0 ? 'text-amber-400' : 'text-text-muted'}`}>
                                            {Math.max(0, (selectedPeer.summary?.probes_total ?? 0) - (selectedPeer.summary?.probes_passing ?? 0))}
                                        </span>
                                    </div>
                                </div>

                                {selectedPeer.summary?.failing_probes && selectedPeer.summary.failing_probes.length > 0 ? (
                                    <div className="space-y-1.5">
                                        {selectedPeer.summary.failing_probes.map((p, idx) => (
                                            <div key={idx} className="p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs font-mono flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-amber-400">⚠️</span>
                                                    <span className="font-bold text-text">{p.name}</span>
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 uppercase font-black">{p.type}</span>
                                                    {p.target && <span className="text-text-muted text-[11px]">{p.target}</span>}
                                                </div>
                                                <div className="text-amber-400 text-right text-[11px] font-semibold">
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
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">
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
                                                    isBundleSynced ? 'bg-neutral-900/50 border-neutral-800' : 'bg-amber-500/5 border-amber-500/20'
                                                }`}>
                                                    <span className="text-neutral-400 capitalize">{bundle.replace(/_/g, ' ')}</span>
                                                    <span className={`font-bold flex items-center gap-1.5 ${isBundleSynced ? 'text-blue-400' : 'text-amber-400'}`}>
                                                        r{String(rev)}
                                                        {isBundleSynced ? <Check size={12} className="text-emerald-400" /> : <AlertTriangle size={12} className="text-amber-400" />}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Direct Action Footer */}
                            <div className="flex items-center justify-between pt-4 border-t border-border">
                                <span className="text-xs font-mono text-text-muted flex items-center gap-1.5">
                                    <Clock size={12} />
                                    Last heartbeat received: {selectedPeer.last_seen ? new Date(selectedPeer.last_seen).toLocaleString() : '—'}
                                </span>
                                <a
                                    href={selectedPeer.meta?.management_url || (selectedPeer.meta?.management_ip ? `http://${selectedPeer.meta.management_ip}:8080` : `http://${selectedPeer.ip_private}:8080`)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-2 transition-all shadow-lg active:scale-95"
                                >
                                    <span>Open Full Node Dashboard</span>
                                    <ExternalLink size={14} />
                                </a>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
