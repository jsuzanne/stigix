import React, { useState, useEffect, useMemo } from 'react';
import { 
    Globe, RefreshCw, Search, Server, Gauge, 
    CheckCircle2, AlertTriangle, XCircle, ExternalLink, 
    Check, X, Filter
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
    status: 'online' | 'degraded' | 'offline';
    is_stale: boolean;
    last_seen_seconds_ago: number;
    last_seen?: string;
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
        [key: string]: any;
    };
    summary?: {
        probes_global_health?: number; // 0-100 Global Experience score
        probes_total?: number;
        probes_passing?: number;
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
        appliedRevisions?: Record<string, number>;
        lastReportedAt?: string;
        [key: string]: any;
    };
}

interface FleetOverviewResponse {
    total_instances: number;
    online_count: number;
    degraded_count: number;
    offline_count: number;
    avg_global_experience: number | null;
    instances: PeerInstance[];
    generated_at: string;
}

// Mini Gauge for Global Experience Score
function ScoreMiniBadge({ score, isStale }: { score?: number | null; isStale?: boolean }) {
    if (isStale || score === undefined || score === null) {
        return (
            <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-neutral-800 text-neutral-500 border border-neutral-700">
                — Stale
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
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold font-mono border ${badgeClass}`}>
            <span className="text-sm font-black">{score}</span>
            <span className="text-[10px] uppercase tracking-wider opacity-80">/100 · {label}</span>
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

function formatSecondsAgo(seconds: number) {
    if (seconds < 60) return `${seconds}s ago`;
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ago`;
}

export default function Fleet({ token, onNavigate: _onNavigate }: FleetProps) {
    const [data, setData] = useState<FleetOverviewResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'degraded' | 'offline'>('all');
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [selectedPeer, setSelectedPeer] = useState<PeerInstance | null>(null);
    const [lastRefreshTime, setLastRefreshTime] = useState<Date>(new Date());

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
                inst.ip_private.toLowerCase().includes(query);
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
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
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
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
                    <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400">
                        <AlertTriangle size={20} />
                    </div>
                    <div>
                        <div className="text-xs text-amber-400/80 font-bold uppercase tracking-wider">Degraded</div>
                        <div className="text-2xl font-black text-amber-400">{data?.degraded_count ?? '—'}</div>
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

                <div className="col-span-2 md:col-span-1 bg-gradient-to-br from-blue-950/20 to-indigo-950/20 backdrop-blur-md p-4 rounded-xl border border-blue-500/20 flex items-center gap-3">
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
                    {(['all', 'online', 'degraded', 'offline'] as const).map(f => (
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
                                <th className="px-6 py-4">Config Rev</th>
                                <th className="px-6 py-4">Last Seen</th>
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
                                    const isLeader = peer.type === 'leader' || peer.instance_id.includes('leader');
                                    const version = peer.meta?.version || '—';
                                    const revNumber = peer.provisioning_status?.appliedRevisions 
                                        ? Math.max(0, ...Object.values(peer.provisioning_status.appliedRevisions))
                                        : null;

                                    return (
                                        <tr 
                                            key={peer.instance_id}
                                            onClick={() => setSelectedPeer(peer)}
                                            className="hover:bg-blue-500/5 transition-colors cursor-pointer group"
                                        >
                                            {/* Site & ID */}
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 rounded-lg bg-neutral-800/80 border border-neutral-700 flex items-center justify-center text-neutral-300 font-bold group-hover:border-blue-500/40 group-hover:text-blue-400 transition-all">
                                                        {siteName.slice(0, 3).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <div className="font-bold text-text flex items-center gap-2">
                                                            {siteName}
                                                            {isLeader && (
                                                                <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                                                    Leader
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-xs text-text-muted font-mono flex items-center gap-2">
                                                            <span>{peer.ip_private}</span>
                                                            <span>·</span>
                                                            <span className="text-[11px] opacity-75">{version}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Status Badge */}
                                            <td className="px-6 py-4">
                                                {peer.status === 'online' ? (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                                        Online
                                                    </span>
                                                ) : peer.status === 'degraded' ? (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                                        <AlertTriangle size={12} />
                                                        Degraded
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/20">
                                                        <XCircle size={12} />
                                                        Offline
                                                    </span>
                                                )}
                                            </td>

                                            {/* Global Experience Score */}
                                            <td className="px-6 py-4">
                                                <ScoreMiniBadge 
                                                    score={peer.summary?.probes_global_health} 
                                                    isStale={peer.is_stale}
                                                />
                                            </td>

                                            {/* Probes Summary */}
                                            <td className="px-6 py-4">
                                                {peer.is_stale || peer.summary?.probes_total === undefined ? (
                                                    <span className="text-xs text-neutral-500 font-mono">—</span>
                                                ) : (
                                                    <div className="text-xs font-mono">
                                                        <span className="font-bold text-text">
                                                            {peer.summary.probes_passing ?? peer.summary.probes_total}/{peer.summary.probes_total}
                                                        </span>
                                                        {(peer.summary.probes_passing ?? peer.summary.probes_total) === peer.summary.probes_total ? (
                                                            <span className="ml-1 text-emerald-400">✅</span>
                                                        ) : (
                                                            <span className="ml-1 text-amber-400">⚠️</span>
                                                        )}
                                                    </div>
                                                )}
                                            </td>

                                            {/* Traffic State */}
                                            <td className="px-6 py-4">
                                                {peer.is_stale || !peer.summary?.traffic_state ? (
                                                    <span className="text-xs text-neutral-500 font-mono">—</span>
                                                ) : peer.summary.traffic_state === 'RUNNING' ? (
                                                    <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-bold font-mono">
                                                        <span>▶</span>
                                                        <span>{peer.summary.traffic_rate_mbps ? `${peer.summary.traffic_rate_mbps} Mbps` : 'Active'}</span>
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

                                            {/* Config Revision */}
                                            <td className="px-6 py-4">
                                                {revNumber !== null ? (
                                                    <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-neutral-800 text-neutral-300 border border-neutral-700">
                                                        r{revNumber}
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-neutral-500 font-mono">—</span>
                                                )}
                                            </td>

                                            {/* Last Seen */}
                                            <td className="px-6 py-4 text-xs font-mono text-text-muted">
                                                {formatSecondsAgo(peer.last_seen_seconds_ago)}
                                            </td>

                                            {/* Open Dashboard Link */}
                                            <td className="px-6 py-4 text-right" onClick={e => e.stopPropagation()}>
                                                <a
                                                    href={`http://${peer.ip_private}:8080`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 hover:border-neutral-600 transition-all shadow-sm"
                                                    title={`Open ${siteName} Dashboard`}
                                                >
                                                    <span>Open UI</span>
                                                    <ExternalLink size={12} />
                                                </a>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Peer Detail Drawer / Modal */}
            {selectedPeer && (
                <div 
                    className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setSelectedPeer(null)}
                >
                    <div 
                        className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-6 animate-in fade-in zoom-in-95 duration-150"
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
                                        ) : selectedPeer.status === 'degraded' ? (
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                                Degraded
                                            </span>
                                        ) : (
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20">
                                                Offline
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-text-muted font-mono mt-0.5">
                                        ID: {selectedPeer.instance_id} · IP: {selectedPeer.ip_private}
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

                        {/* Top Telemetry Highlight */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-neutral-900/40 p-4 rounded-xl border border-border">
                            <div>
                                <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold">Global Exp.</div>
                                <div className="mt-1">
                                    <ScoreMiniBadge 
                                        score={selectedPeer.summary?.probes_global_health} 
                                        isStale={selectedPeer.is_stale}
                                    />
                                </div>
                            </div>
                            <div>
                                <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold">Traffic</div>
                                <div className="mt-1 font-mono text-sm font-bold text-text">
                                    {selectedPeer.summary?.traffic_state === 'RUNNING' 
                                        ? `▶ ${selectedPeer.summary.traffic_rate_mbps || 0} Mbps` 
                                        : '■ Stopped'}
                                </div>
                            </div>
                            <div>
                                <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold">Voice MOS</div>
                                <div className="mt-1 font-mono text-sm font-bold text-cyan-400">
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

                        {/* Node Capabilities */}
                        <div className="space-y-2">
                            <h3 className="text-xs uppercase font-mono tracking-wider text-text-muted font-bold">
                                Enabled Capabilities
                            </h3>
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { key: 'connectivity', label: 'Probes (DEM)' },
                                    { key: 'voice', label: 'Voice Simulation' },
                                    { key: 'convergence', label: 'Convergence Failover' },
                                    { key: 'xfr', label: 'XFR Bandwidth' },
                                    { key: 'custom_app', label: 'Custom TCP/HTTP' },
                                    { key: 'security', label: 'Security Enforcement' }
                                ].map(cap => {
                                    const enabled = !!selectedPeer.capabilities?.[cap.key];
                                    return (
                                        <span 
                                            key={cap.key}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 ${
                                                enabled 
                                                    ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' 
                                                    : 'bg-neutral-800/40 text-neutral-500 border-neutral-800'
                                            }`}
                                        >
                                            {enabled ? <Check size={12} className="text-blue-400" /> : <X size={12} className="text-neutral-600" />}
                                            {cap.label}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Provisioning Revisions */}
                        {selectedPeer.provisioning_status?.appliedRevisions && (
                            <div className="space-y-2">
                                <h3 className="text-xs uppercase font-mono tracking-wider text-text-muted font-bold">
                                    Provisioned Configuration Revisions
                                </h3>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {Object.entries(selectedPeer.provisioning_status.appliedRevisions).map(([bundle, rev]) => (
                                        <div key={bundle} className="p-2.5 rounded-lg bg-neutral-900/50 border border-neutral-800 text-xs font-mono flex items-center justify-between">
                                            <span className="text-neutral-400">{bundle}</span>
                                            <span className="font-bold text-neutral-200">r{rev}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Direct Action Footer */}
                        <div className="flex items-center justify-between pt-4 border-t border-border">
                            <span className="text-xs font-mono text-text-muted">
                                Last seen {formatSecondsAgo(selectedPeer.last_seen_seconds_ago)}
                            </span>
                            <a
                                href={`http://${selectedPeer.ip_private}:8080`}
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
            )}
        </div>
    );
}
