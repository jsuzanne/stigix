import React, { useState, useEffect, useCallback } from 'react';
import { usePeerContext } from '../PeerContext';
import { 
    Grid, Activity, AlertTriangle, CheckCircle2, XCircle, ArrowRightLeft, 
    RefreshCw, Filter, Shield, Info, ArrowUpRight, ArrowDownLeft, Clock,
    Layers, Zap, Globe, Sparkles, Sliders, Settings as SettingsIcon, Save, Check, Search
} from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { PageLoader } from './PageLoader';

interface MatrixNode {
    id: string;
    name: string;
    ip: string;
    site_type: 'HUB' | 'BRANCH' | 'CLOUD';
    is_local: boolean;
    last_seen?: string;
}

interface MatrixPair {
    source_id: string;
    source_name: string;
    source_ip?: string;
    target_id: string;
    target_name: string;
    target_ip?: string;
    forward: {
        reachable: boolean;
        latency_ms: number;
        jitter_ms: number;
        loss_pct: number;
        score: number;
        last_tested?: number;
        type?: string;
        source_ip?: string;
        target_ip?: string;
        target_url?: string;
        has_data: boolean;
    };
    reverse: {
        reachable: boolean;
        latency_ms: number;
        jitter_ms: number;
        loss_pct: number;
        score: number;
        last_tested?: number;
        type?: string;
        source_ip?: string;
        target_ip?: string;
        target_url?: string;
        has_data: boolean;
    };
    asymmetry: {
        is_asymmetric: boolean;
        latency_delta_ms: number;
        loss_delta_pct: number;
        reason?: string;
        status: 'OPTIMAL' | 'DEGRADED' | 'CRITICAL' | 'PARTIAL' | 'POLICY_EXCLUDED' | 'UNKNOWN';
    };
}

interface MatrixThresholdsConfig {
    latency_warning_ms: number;
    latency_critical_ms: number;
    asymmetry_warning_delta_ms: number;
    asymmetry_critical_delta_ms: number;
    loss_warning_pct: number;
    loss_critical_pct: number;
    jitter_warning_ms: number;
    jitter_critical_ms: number;
    mesh_topology?: 'full_mesh' | 'hub_and_spoke' | 'disabled';
}

interface MatrixData {
    timestamp: number;
    local_node_id: string;
    nodes: MatrixNode[];
    thresholds?: MatrixThresholdsConfig;
    topology?: 'full_mesh' | 'hub_and_spoke' | 'disabled';
    summary: {
        total_pairs: number;
        healthy_bidirectional: number;
        asymmetric_degraded: number;
        unidirectional_down: number;
        full_outage: number;
        partial_telemetry?: number;
        policy_excluded?: number;
    };
    matrix: MatrixPair[];
}

const formatNum = (val: number | undefined | null, decimals = 2): string => {
    if (val === undefined || val === null || isNaN(val)) return '0';
    const rounded = Math.round(val * Math.pow(10, decimals)) / Math.pow(10, decimals);
    return rounded.toLocaleString(undefined, { maximumFractionDigits: decimals });
};

export function ReachabilityMatrix({ token }: { token?: string }) {
    const { gFetch, activePeer } = usePeerContext();
    const [data, setData] = useState<MatrixData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [asymmetryOnly, setAsymmetryOnly] = useState(false);
    const [selectedPair, setSelectedPair] = useState<MatrixPair | null>(null);
    const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPTIMAL' | 'DEGRADED' | 'CRITICAL' | 'PARTIAL' | 'POLICY_EXCLUDED'>('ALL');
    const [latencyThreshold, setLatencyThreshold] = useState<number>(0);
    const [switchingTopology, setSwitchingTopology] = useState(false);
    
    // Flow Path Trace State (getflow.py / Prisma SD-WAN)
    const [tracingFlow, setTracingFlow] = useState(false);
    const [flowTraceData, setFlowTraceData] = useState<any | null>(null);
    const [flowTraceError, setFlowTraceError] = useState<string | null>(null);
    
    // SLA Thresholds Modal State
    const [showThresholdsModal, setShowThresholdsModal] = useState(false);
    const [thresholds, setThresholds] = useState<MatrixThresholdsConfig>({
        latency_warning_ms: 60,
        latency_critical_ms: 150,
        asymmetry_warning_delta_ms: 20,
        asymmetry_critical_delta_ms: 80,
        loss_warning_pct: 1.0,
        loss_critical_pct: 5.0,
        jitter_warning_ms: 10,
        jitter_critical_ms: 30,
        mesh_topology: 'hub_and_spoke'
    });
    const [savingThresholds, setSavingThresholds] = useState(false);
    const [thresholdsSaved, setThresholdsSaved] = useState(false);

    const authHeaders = useCallback((): Record<string, string> => {
        const t = token || (typeof window !== 'undefined' ? localStorage.getItem('token') : null);
        return t ? { Authorization: `Bearer ${t}` } : {};
    }, [token]);

    const handleTraceFlow = async (pair: MatrixPair) => {
        try {
            setTracingFlow(true);
            setFlowTraceError(null);
            setFlowTraceData(null);
            const res = await gFetch('/api/fleet/matrix/flow-trace', {
                method: 'POST',
                headers: {
                    ...authHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    source_id: pair.source_id,
                    source_name: pair.source_name,
                    source_ip: pair.forward.source_ip || pair.source_ip,
                    target_id: pair.target_id,
                    target_name: pair.target_name,
                    target_ip: pair.forward.target_ip || pair.target_ip
                })
            });
            const d = await res.json();
            if (res.ok && d.success) {
                setFlowTraceData(d);
            } else {
                setFlowTraceError(d.error || 'No active flow recorded or unable to contact Prisma SD-WAN API');
            }
        } catch (e: any) {
            setFlowTraceError(e.message || 'Failed to query getflow flow path');
        } finally {
            setTracingFlow(false);
        }
    };

    const handleSetTopology = async (newTopology: 'full_mesh' | 'hub_and_spoke' | 'disabled') => {
        try {
            setSwitchingTopology(true);
            const res = await gFetch('/api/fleet/matrix/topology', {
                method: 'POST',
                headers: {
                    ...authHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ topology: newTopology })
            });
            if (res.ok) {
                setThresholds(prev => ({ ...prev, mesh_topology: newTopology }));
                await fetchMatrix();
            }
        } catch (e) {
            console.error('Failed to change mesh topology:', e);
        } finally {
            setSwitchingTopology(false);
        }
    };

    const fetchThresholds = useCallback(async () => {
        try {
            const res = await gFetch('/api/fleet/matrix/thresholds', { headers: authHeaders() });
            if (res.ok) {
                const t = await res.json();
                setThresholds(t);
            }
        } catch {}
    }, [gFetch, authHeaders]);

    const handleSaveThresholds = async () => {
        try {
            setSavingThresholds(true);
            const res = await gFetch('/api/fleet/matrix/thresholds', {
                method: 'POST',
                headers: {
                    ...authHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(thresholds)
            });
            if (res.ok) {
                setThresholdsSaved(true);
                setTimeout(() => setThresholdsSaved(false), 2500);
                fetchMatrix();
            }
        } catch (e) {
            console.error('Failed to save thresholds:', e);
        } finally {
            setSavingThresholds(false);
        }
    };

    const applyPreset = (preset: 'strict' | 'standard' | 'relaxed') => {
        if (preset === 'strict') {
            setThresholds({
                latency_warning_ms: 25,
                latency_critical_ms: 60,
                asymmetry_warning_delta_ms: 10,
                asymmetry_critical_delta_ms: 30,
                loss_warning_pct: 0.5,
                loss_critical_pct: 2.0,
                jitter_warning_ms: 5,
                jitter_critical_ms: 15
            });
        } else if (preset === 'standard') {
            setThresholds({
                latency_warning_ms: 60,
                latency_critical_ms: 150,
                asymmetry_warning_delta_ms: 20,
                asymmetry_critical_delta_ms: 80,
                loss_warning_pct: 1.0,
                loss_critical_pct: 5.0,
                jitter_warning_ms: 10,
                jitter_critical_ms: 30
            });
        } else {
            setThresholds({
                latency_warning_ms: 120,
                latency_critical_ms: 250,
                asymmetry_warning_delta_ms: 40,
                asymmetry_critical_delta_ms: 120,
                loss_warning_pct: 2.5,
                loss_critical_pct: 10.0,
                jitter_warning_ms: 20,
                jitter_critical_ms: 60
            });
        }
    };

    const fetchMatrix = useCallback(async (isManualRefresh = false) => {
        try {
            if (isManualRefresh || !data) {
                setLoading(true);
            }
            const params = new URLSearchParams();
            if (asymmetryOnly) params.set('asymmetry_only', 'true');

            const res = await gFetch(`/api/fleet/matrix?${params.toString()}`, {
                headers: authHeaders()
            });
            if (!res.ok) {
                throw new Error(`Failed to load matrix (HTTP ${res.status})`);
            }
            const json: MatrixData = await res.json();
            if (json && Array.isArray(json.nodes)) {
                // If response is a single-node fallback but we already have multi-node data, keep existing data
                if (json.nodes.length > 1 || !data || (data.nodes && data.nodes.length <= 1)) {
                    setData(json);
                    try {
                        sessionStorage.setItem('stigix_fleet_matrix_cache', JSON.stringify(json));
                    } catch {}
                }
            }
            setError(null);
        } catch (err: any) {
            setError(err.message || 'Error fetching reachability matrix');
        } finally {
            setLoading(false);
        }
    }, [gFetch, asymmetryOnly, authHeaders, data]);

    useEffect(() => {
        // Load fast session cache on initial mount for instant 0ms rendering
        try {
            const cached = sessionStorage.getItem('stigix_fleet_matrix_cache');
            if (cached && !data) {
                const parsed = JSON.parse(cached);
                if (parsed && Array.isArray(parsed.nodes) && parsed.nodes.length > 1) {
                    setData(parsed);
                    setLoading(false);
                }
            }
        } catch {}

        fetchMatrix();
        const interval = setInterval(() => fetchMatrix(false), 10000); // 10s silent background auto-refresh
        return () => clearInterval(interval);
    }, [fetchMatrix]);

    const nodes = React.useMemo(() => {
        const raw = data?.nodes || [];
        return [...raw].sort((a, b) => {
            const isHubA = a.site_type === 'HUB' || a.name.toLowerCase().includes('dc') || a.name.toLowerCase().includes('hub');
            const isHubB = b.site_type === 'HUB' || b.name.toLowerCase().includes('dc') || b.name.toLowerCase().includes('hub');
            if (isHubA && !isHubB) return -1;
            if (!isHubA && isHubB) return 1;
            return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });
    }, [data?.nodes]);

    const matrix = data?.matrix || [];
    const summary = data?.summary || {
        total_pairs: 0,
        healthy_bidirectional: 0,
        asymmetric_degraded: 0,
        unidirectional_down: 0,
        full_outage: 0,
        partial_telemetry: 0
    };

    const getPair = (sourceId: string, targetId: string): MatrixPair | undefined => {
        return matrix.find(m => m.source_id === sourceId && m.target_id === targetId);
    };

    return (
        <div className="space-y-6">
            {/* Top Summary & Control Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
                <div className="bg-card-secondary/60 border border-border p-3.5 rounded-xl backdrop-blur-sm shadow-sm flex items-center gap-3">
                    <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <CheckCircle2 size={18} />
                    </div>
                    <div>
                        <div className="text-xl font-black font-mono text-text-primary">
                            {summary.healthy_bidirectional}
                        </div>
                        <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
                            Symmetric & Healthy
                        </div>
                    </div>
                </div>

                <div className="bg-card-secondary/60 border border-border p-3.5 rounded-xl backdrop-blur-sm shadow-sm flex items-center gap-3">
                    <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        <AlertTriangle size={18} />
                    </div>
                    <div>
                        <div className="text-xl font-black font-mono text-text-primary">
                            {summary.asymmetric_degraded}
                        </div>
                        <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
                            Asymmetric / Degraded
                        </div>
                    </div>
                </div>

                <div className="bg-card-secondary/60 border border-border p-3.5 rounded-xl backdrop-blur-sm shadow-sm flex items-center gap-3">
                    <div className="p-2.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20">
                        <ArrowRightLeft size={18} />
                    </div>
                    <div>
                        <div className="text-xl font-black font-mono text-text-primary">
                            {summary.unidirectional_down + (summary.full_outage || 0)}
                        </div>
                        <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
                            Critical / Blocked
                        </div>
                    </div>
                </div>

                <div className="bg-card-secondary/60 border border-border p-3.5 rounded-xl backdrop-blur-sm shadow-sm flex items-center gap-3">
                    <div className="p-2.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                        <Layers size={18} />
                    </div>
                    <div>
                        <div className="text-xl font-black font-mono text-text-primary">
                            {nodes.length}
                        </div>
                        <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
                            Active Fleet Nodes
                        </div>
                    </div>
                </div>

                <div className="bg-card-secondary/60 border border-border p-3.5 rounded-xl backdrop-blur-sm shadow-sm flex items-center gap-3">
                    <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
                        <Activity size={18} />
                    </div>
                    <div>
                        <div className="text-sm font-black font-mono text-purple-300 uppercase truncate">
                            {thresholds.mesh_topology === 'full_mesh' ? 'Full Mesh' : thresholds.mesh_topology === 'disabled' ? 'Manual' : 'Hub & Spoke'}
                        </div>
                        <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
                            Topology Policy
                        </div>
                    </div>
                </div>
            </div>

            {/* Action & Filter Strip */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-card-secondary/40 p-3.5 rounded-xl border border-border shadow-sm">
                {/* Left: Topology Switcher & Status Filter Chips */}
                <div className="flex items-center gap-3 flex-wrap">
                    {/* Topology Selector Toggle */}
                    <div className="flex items-center bg-card-secondary border border-border/80 rounded-lg p-0.5 shadow-inner">
                        <span className="text-[10px] font-black uppercase text-text-muted px-2 select-none">Topology:</span>
                        <button
                            type="button"
                            onClick={() => handleSetTopology('hub_and_spoke')}
                            disabled={switchingTopology}
                            className={twMerge(
                                "px-2.5 py-1 rounded-md text-[11px] font-bold transition-all flex items-center gap-1",
                                (thresholds.mesh_topology || 'hub_and_spoke') === 'hub_and_spoke'
                                    ? "bg-purple-600 text-white shadow-sm font-black"
                                    : "text-text-muted hover:text-text-primary hover:bg-white/5"
                            )}
                            title="Branches only probe Hubs (Hub-and-Spoke SD-WAN architecture)"
                        >
                            🏛️ Hub & Spoke
                        </button>
                        <button
                            type="button"
                            onClick={() => handleSetTopology('full_mesh')}
                            disabled={switchingTopology}
                            className={twMerge(
                                "px-2.5 py-1 rounded-md text-[11px] font-bold transition-all flex items-center gap-1.5",
                                thresholds.mesh_topology === 'full_mesh'
                                    ? "bg-blue-600 text-white shadow-sm font-black"
                                    : "text-text-muted hover:text-text-primary hover:bg-white/5"
                            )}
                            title="Every node probes every other node (Full-Mesh VPN architecture - Beta)"
                        >
                            <span>🌐 Full-Mesh</span>
                            <span className="text-[8px] font-black uppercase px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                BETA
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => handleSetTopology('disabled')}
                            disabled={switchingTopology}
                            className={twMerge(
                                "px-2.5 py-1 rounded-md text-[11px] font-bold transition-all flex items-center gap-1",
                                thresholds.mesh_topology === 'disabled'
                                    ? "bg-slate-700 text-white shadow-sm font-black"
                                    : "text-text-muted hover:text-text-primary hover:bg-white/5"
                            )}
                            title="Disable auto-mesh Fleet probes (manual probes only)"
                        >
                            ⚙️ Manual
                        </button>
                    </div>

                    <div className="h-4 w-[1px] bg-border/80 hidden sm:block"></div>

                    {/* Status Filter Chips */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                            onClick={() => setStatusFilter('ALL')}
                            className={twMerge(
                                "px-2.5 py-1 rounded-lg text-xs font-bold transition-all border",
                                statusFilter === 'ALL'
                                    ? "bg-blue-600 text-white border-blue-500 shadow-sm"
                                    : "bg-card-secondary text-text-muted border-border hover:bg-card-secondary/80 hover:text-text-primary"
                            )}
                        >
                            All ({summary.total_pairs})
                        </button>
                        <button
                            onClick={() => setStatusFilter('OPTIMAL')}
                            className={twMerge(
                                "px-2.5 py-1 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5",
                                statusFilter === 'OPTIMAL'
                                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-sm"
                                    : "bg-card-secondary text-emerald-400/70 border-border hover:bg-emerald-500/10 hover:text-emerald-300"
                            )}
                        >
                            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                            Optimal ({summary.healthy_bidirectional})
                        </button>
                        <button
                            onClick={() => setStatusFilter('DEGRADED')}
                            className={twMerge(
                                "px-2.5 py-1 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5",
                                statusFilter === 'DEGRADED'
                                    ? "bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm"
                                    : "bg-card-secondary text-amber-400/70 border-border hover:bg-amber-500/10 hover:text-amber-300"
                            )}
                        >
                            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                            Degraded ({summary.asymmetric_degraded})
                        </button>
                        <button
                            onClick={() => setStatusFilter('CRITICAL')}
                            className={twMerge(
                                "px-2.5 py-1 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5",
                                statusFilter === 'CRITICAL'
                                    ? "bg-red-500/20 text-red-300 border-red-500/50 shadow-sm"
                                    : "bg-card-secondary text-red-400/70 border-border hover:bg-red-500/10 hover:text-red-300"
                            )}
                        >
                            <span className="w-2 h-2 rounded-full bg-red-400"></span>
                            Critical ({summary.unidirectional_down + summary.full_outage})
                        </button>
                        {(summary.partial_telemetry || 0) > 0 && (
                            <button
                                onClick={() => setStatusFilter('PARTIAL')}
                                className={twMerge(
                                    "px-2.5 py-1 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5",
                                    statusFilter === 'PARTIAL'
                                        ? "bg-sky-500/20 text-sky-300 border-sky-500/50 shadow-sm"
                                        : "bg-card-secondary text-sky-400/70 border-border hover:bg-sky-500/10 hover:text-sky-300"
                                )}
                            >
                                <span className="w-2 h-2 rounded-full bg-sky-400"></span>
                                One-Way ({summary.partial_telemetry})
                            </button>
                        )}
                        {(summary.policy_excluded || 0) > 0 && (
                            <button
                                onClick={() => setStatusFilter('POLICY_EXCLUDED')}
                                className={twMerge(
                                    "px-2.5 py-1 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5",
                                    statusFilter === 'POLICY_EXCLUDED'
                                        ? "bg-purple-500/20 text-purple-300 border-purple-500/50 shadow-sm"
                                        : "bg-card-secondary text-purple-400/70 border-border hover:bg-purple-500/10 hover:text-purple-300"
                                )}
                            >
                                <span className="w-2 h-2 rounded-full bg-purple-400"></span>
                                H&S Policy ({summary.policy_excluded})
                            </button>
                        )}
                    </div>
                </div>

                {/* Right: Latency Filter & Refresh */}
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <label htmlFor="latency-filter" className="text-xs font-bold text-text-muted whitespace-nowrap">
                            Latency &gt;
                        </label>
                        <select
                            id="latency-filter"
                            value={latencyThreshold}
                            onChange={(e) => setLatencyThreshold(Number(e.target.value))}
                            className="bg-card-secondary border border-border text-text-primary text-xs rounded-lg px-2.5 py-1 font-mono font-bold focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                            <option value={0}>All</option>
                            <option value={15}>&gt; 15 ms</option>
                            <option value={30}>&gt; 30 ms</option>
                            <option value={50}>&gt; 50 ms</option>
                            <option value={100}>&gt; 100 ms</option>
                            <option value={200}>&gt; 200 ms</option>
                        </select>
                    </div>

                    <button
                        onClick={() => {
                            fetchThresholds();
                            setShowThresholdsModal(true);
                        }}
                        className="flex items-center gap-1.5 bg-card-secondary hover:bg-card-secondary/80 text-text-primary border border-border px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm"
                        title="Configure SLA Health Thresholds (Optimal / Degraded / Critical)"
                    >
                        <Sliders size={13} className="text-amber-400" />
                        <span>SLA Thresholds</span>
                    </button>

                    <button
                        onClick={() => fetchMatrix(true)}
                        disabled={loading}
                        className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm disabled:opacity-50"
                    >
                        <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
                        <span>Refresh</span>
                    </button>
                </div>
            </div>

            {/* Matrix Heatmap Table */}
            <div className="bg-card-secondary/50 border border-border rounded-xl shadow-md overflow-hidden">
                <div className="p-4 border-b border-border bg-card-secondary/80 flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                            <Grid size={16} className="text-blue-500" />
                            SD-WAN Bidirectional Reachability Grid ({nodes.length} × {nodes.length})
                        </h3>
                        <p className="text-xs text-text-muted mt-0.5">
                            Cross-correlating forward egress SLA (A → B) with return ingress telemetry (B → A) across Stigix nodes and SD-WAN gateway paths.
                        </p>
                    </div>
                    {data?.timestamp && (
                        <span className="text-[10px] font-mono text-text-muted flex items-center gap-1">
                            <Clock size={11} />
                            Updated {new Date(data.timestamp).toLocaleTimeString()}
                        </span>
                    )}
                </div>

                {error ? (
                    <div className="p-8 text-center text-red-400 text-sm">
                        <AlertTriangle size={24} className="mx-auto mb-2" />
                        {error}
                    </div>
                ) : loading && nodes.length === 0 ? (
                    <PageLoader
                        title="Computing Bidirectional SLA Matrix"
                        subtitle="Correlating forward and reverse path telemetry across all SD-WAN nodes..."
                        icon={Grid}
                        accentColor="cyan"
                    />
                ) : nodes.length === 0 ? (
                    <div className="p-12 text-center text-text-muted text-xs">
                        No active Stigix nodes or probes discovered yet.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[640px]">
                            <thead>
                                <tr className="border-b border-border bg-card-secondary/40 text-[11px] font-bold text-text-muted uppercase tracking-wider">
                                    <th className="p-3 w-44 border-r border-border bg-card-secondary/90 sticky left-0 z-10">
                                        Source (From) \ Target (To)
                                    </th>
                                    {nodes.map(node => (
                                        <th key={node.id} className="p-3 text-center border-r border-border/50 min-w-[145px]">
                                            <div className="flex flex-col items-center">
                                                <div className="flex items-center gap-1">
                                                    <span className="text-text-primary font-mono font-bold">{node.name}</span>
                                                    <span className={twMerge(
                                                        "text-[9px] px-1 py-0.2 rounded font-bold uppercase",
                                                        node.site_type === 'HUB' ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                                                    )}>
                                                        {node.site_type}
                                                    </span>
                                                </div>
                                                <span className="text-[9.5px] text-text-muted font-normal font-mono">Host: {node.ip}</span>
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {nodes.map(sourceNode => (
                                    <tr key={sourceNode.id} className="border-b border-border/50 hover:bg-white/[0.02] transition-colors">
                                        <td className="p-3 font-bold text-xs text-text-primary border-r border-border bg-card-secondary/90 sticky left-0 z-10">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <div className="flex items-center gap-1.5 font-mono">
                                                        <span>{sourceNode.name}</span>
                                                        <span className={twMerge(
                                                            "text-[9px] px-1 py-0.2 rounded font-bold uppercase",
                                                            sourceNode.site_type === 'HUB' ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                                                        )}>
                                                            {sourceNode.site_type}
                                                        </span>
                                                    </div>
                                                    <div className="text-[9.5px] text-text-muted font-normal font-mono">Host: {sourceNode.ip}</div>
                                                </div>
                                                {sourceNode.is_local && (
                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30 ml-2">
                                                        YOU
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        {nodes.map(targetNode => {
                                            if (sourceNode.id === targetNode.id) {
                                                return (
                                                    <td key={targetNode.id} className="p-3 text-center border-r border-border/50 bg-black/20 text-text-muted/40 font-mono text-xs select-none">
                                                        —
                                                    </td>
                                                );
                                            }

                                            const pair = getPair(sourceNode.id, targetNode.id);
                                            if (!pair) {
                                                return (
                                                    <td key={targetNode.id} className="p-3 text-center border-r border-border/50 text-text-muted/40 font-mono text-[11px]">
                                                        No Probe
                                                    </td>
                                                );
                                            }

                                            const { forward, reverse, asymmetry } = pair;
                                            const isPolicyExcluded = asymmetry.status === 'POLICY_EXCLUDED';
                                            const isOpt = asymmetry.status === 'OPTIMAL';
                                            const isDeg = asymmetry.status === 'DEGRADED';
                                            const isCrit = asymmetry.status === 'CRITICAL';
                                            const isPartial = asymmetry.status === 'PARTIAL';
                                            const isUnknown = asymmetry.status === 'UNKNOWN' || (!forward.has_data && !reverse.has_data);

                                            const maxLatency = Math.max(
                                                forward.has_data && forward.reachable ? forward.latency_ms : 0,
                                                reverse.has_data && reverse.reachable ? reverse.latency_ms : 0
                                            );

                                            // Filtering logic
                                            const matchesStatus = statusFilter === 'ALL' || asymmetry.status === statusFilter;
                                            const matchesLatency = latencyThreshold === 0 || maxLatency >= latencyThreshold;
                                            const isFaded = !matchesStatus || !matchesLatency;

                                            const cellBg = isPolicyExcluded
                                                ? "bg-slate-900/30 hover:bg-slate-800/40 border-slate-700/30 text-slate-400"
                                                : isOpt 
                                                ? "bg-emerald-950/20 hover:bg-emerald-900/35 border-emerald-500/30 text-emerald-300"
                                                : isDeg 
                                                ? "bg-amber-950/25 hover:bg-amber-900/40 border-amber-500/35 text-amber-300"
                                                : isCrit
                                                ? "bg-red-950/30 hover:bg-red-900/45 border-red-500/40 text-red-300"
                                                : isPartial
                                                ? "bg-sky-950/20 hover:bg-sky-900/35 border-sky-500/30 text-sky-200"
                                                : "bg-card-secondary/20 hover:bg-card-secondary/40 border-border/40 text-text-muted";

                                            return (
                                                <td
                                                    key={targetNode.id}
                                                    onClick={() => setSelectedPair(pair)}
                                                    className={twMerge(
                                                        "p-2.5 text-center border-r border-border/50 cursor-pointer transition-all border",
                                                        cellBg,
                                                        isFaded && "opacity-15 grayscale hover:opacity-100 hover:grayscale-0"
                                                    )}
                                                >
                                                    <div className="flex flex-col gap-1">
                                                        {isPolicyExcluded ? (
                                                            <div className="py-1">
                                                                <div className="text-[10.5px] font-mono text-slate-400 flex items-center justify-center gap-1 font-semibold">
                                                                    <span>🏛️ Hub & Spoke</span>
                                                                </div>
                                                                <div className="mt-0.5 px-1.5 py-0.5 rounded text-[8.5px] font-bold bg-purple-500/10 text-purple-300 border border-purple-500/20 truncate">
                                                                    Bypassed
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                {/* Forward */}
                                                                <div className="flex items-center justify-between text-[11px] font-mono px-1">
                                                                    <span className="flex items-center gap-0.5 text-text-muted text-[10px]">
                                                                        <ArrowUpRight size={11} className="text-blue-400" /> Fwd:
                                                                    </span>
                                                                    <span className={forward.has_data ? (forward.reachable ? (isOpt ? "font-bold text-emerald-300" : isDeg ? "font-bold text-amber-300" : isPartial ? "font-bold text-sky-300" : "font-black text-red-400") : "font-black text-red-400") : "text-text-muted text-[10px]"}>
                                                                        {forward.has_data ? (forward.reachable ? `${formatNum(forward.latency_ms)}ms` : 'DOWN') : 'Pending'}
                                                                    </span>
                                                                </div>

                                                                {/* Reverse */}
                                                                <div className="flex items-center justify-between text-[11px] font-mono px-1">
                                                                    <span className="flex items-center gap-0.5 text-text-muted text-[10px]">
                                                                        <ArrowDownLeft size={11} className="text-purple-400" /> Rev:
                                                                    </span>
                                                                    <span className={reverse.has_data ? (reverse.reachable ? (isOpt ? "font-bold text-emerald-300" : isDeg ? "font-bold text-amber-300" : isPartial ? "font-bold text-sky-300" : "font-black text-red-400") : "font-black text-red-400") : "text-text-muted text-[10px]"}>
                                                                        {reverse.has_data ? (reverse.reachable ? `${formatNum(reverse.latency_ms)}ms` : 'DOWN') : 'Pending'}
                                                                    </span>
                                                                </div>

                                                                {/* Status / Delta Badge */}
                                                                {isOpt && (
                                                                    <div className="mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 truncate">
                                                                        Optimal
                                                                    </div>
                                                                )}
                                                                {isDeg && (
                                                                    <div className="mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 truncate">
                                                                        {asymmetry.latency_delta_ms > 0 ? `Δ ${formatNum(asymmetry.latency_delta_ms)}ms` : 'Degraded'}
                                                                    </div>
                                                                )}
                                                                {isCrit && (
                                                                    <div className="mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/20 text-red-300 border border-red-500/30 truncate">
                                                                        {asymmetry.reason?.includes('DOWN') ? 'Path Down' : 'Critical'}
                                                                    </div>
                                                                )}
                                                                {isPartial && (
                                                                    <div className="mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-sky-500/15 text-sky-300 border border-sky-500/25 truncate">
                                                                        {forward.has_data ? 'One-Way (Fwd)' : 'One-Way (Rev)'}
                                                                    </div>
                                                                )}
                                                                {isUnknown && (
                                                                    <div className="mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-card-secondary text-text-muted border border-border/40 truncate">
                                                                        Pending
                                                                    </div>
                                                                )}
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Detailed Inspection Modal */}
            {selectedPair && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-card border border-border rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between border-b border-border pb-4">
                            <div className="flex items-center gap-2">
                                <ArrowRightLeft className="text-blue-500" size={20} />
                                <h3 className="text-base font-bold text-text-primary font-mono">
                                    {selectedPair.source_name} ⇄ {selectedPair.target_name}
                                </h3>
                            </div>
                            <button
                                onClick={() => setSelectedPair(null)}
                                className="text-text-muted hover:text-text-primary p-1 rounded-lg hover:bg-card-secondary transition-colors"
                            >
                                <XCircle size={20} />
                            </button>
                        </div>

                        {/* Asymmetry Summary Banner */}
                        <div className={twMerge(
                            "p-4 rounded-xl border flex items-start gap-3",
                            selectedPair.asymmetry.status === 'POLICY_EXCLUDED'
                                ? "bg-purple-500/10 border-purple-500/20 text-purple-300"
                                : selectedPair.asymmetry.status === 'OPTIMAL' 
                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                : selectedPair.asymmetry.status === 'DEGRADED'
                                ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                                : selectedPair.asymmetry.status === 'PARTIAL'
                                ? "bg-sky-500/10 border-sky-500/20 text-sky-400"
                                : "bg-red-500/10 border-red-500/20 text-red-400"
                        )}>
                            <Info size={20} className="flex-shrink-0 mt-0.5" />
                            <div>
                                <div className="text-xs font-black uppercase tracking-wider">
                                    Path Status: {selectedPair.asymmetry.status === 'POLICY_EXCLUDED' ? 'HUB & SPOKE POLICY (BYPASS)' : selectedPair.asymmetry.status === 'PARTIAL' ? 'ONE-WAY / PARTIAL TELEMETRY' : selectedPair.asymmetry.status}
                                </div>
                                <div className="text-xs mt-1 text-text-muted leading-relaxed">
                                    {selectedPair.asymmetry.reason || 'Normal symmetric routing.'}
                                </div>
                            </div>
                        </div>

                        {/* Side by Side Inspection */}
                        <div className="grid grid-cols-2 gap-4">
                            {/* Forward */}
                            <div className="bg-card-secondary/60 border border-border p-4 rounded-xl space-y-3">
                                <div className="text-xs font-bold text-blue-400 flex items-center justify-between uppercase tracking-wider">
                                    <div className="flex items-center gap-1.5">
                                        <ArrowUpRight size={14} /> Forward Path
                                    </div>
                                    {selectedPair.forward.type && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-mono font-bold">
                                            {selectedPair.forward.type}
                                        </span>
                                    )}
                                </div>
                                <div className="text-[11px] text-text-muted font-mono truncate">
                                    {selectedPair.source_name} ➔ {selectedPair.target_name}
                                </div>
                                <div className="space-y-2 text-xs font-mono">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-text-muted whitespace-nowrap">Source Node:</span>
                                        <span className="font-bold text-text-primary text-right">{selectedPair.source_name}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-text-muted whitespace-nowrap">Node Host IP:</span>
                                        <span className="font-mono text-text-secondary text-right">{selectedPair.forward.source_ip || selectedPair.source_ip || '—'}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-text-muted whitespace-nowrap">SD-WAN Probed IP:</span>
                                        <span className="font-bold font-mono text-blue-400 text-right">{selectedPair.forward.target_ip || selectedPair.target_ip || '—'}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-text-muted whitespace-nowrap">Status:</span>
                                        <span className={selectedPair.forward.reachable ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
                                            {selectedPair.forward.reachable ? 'ONLINE' : 'DOWN'}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-text-muted whitespace-nowrap">Latency:</span>
                                        <span className="font-bold text-text-primary">{formatNum(selectedPair.forward.latency_ms)} ms</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-text-muted whitespace-nowrap">Jitter:</span>
                                        <span className="font-bold text-text-primary">{formatNum(selectedPair.forward.jitter_ms)} ms</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-text-muted whitespace-nowrap">Score:</span>
                                        <span className="font-bold text-text-primary">{formatNum(selectedPair.forward.score)}/100</span>
                                    </div>
                                </div>
                            </div>

                            {/* Return */}
                            <div className="bg-card-secondary/60 border border-border p-4 rounded-xl space-y-3">
                                <div className="text-xs font-bold text-purple-400 flex items-center justify-between uppercase tracking-wider">
                                    <div className="flex items-center gap-1.5">
                                        <ArrowDownLeft size={14} /> Return Path
                                    </div>
                                    {selectedPair.reverse.type && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 font-mono font-bold">
                                            {selectedPair.reverse.type}
                                        </span>
                                    )}
                                </div>
                                <div className="text-[11px] text-text-muted font-mono truncate">
                                    {selectedPair.target_name} ➔ {selectedPair.source_name}
                                </div>
                                <div className="space-y-2 text-xs font-mono">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-text-muted whitespace-nowrap">Source Node:</span>
                                        <span className="font-bold text-text-primary text-right">{selectedPair.target_name}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-text-muted whitespace-nowrap">Node Host IP:</span>
                                        <span className="font-mono text-text-secondary text-right">{selectedPair.reverse.source_ip || selectedPair.target_ip || '—'}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-text-muted whitespace-nowrap">SD-WAN Probed IP:</span>
                                        <span className="font-bold font-mono text-purple-400 text-right">{selectedPair.reverse.has_data ? (selectedPair.reverse.target_ip || selectedPair.source_ip || '—') : '— (No probe)'}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-text-muted whitespace-nowrap">Status:</span>
                                        <span className={selectedPair.reverse.has_data ? (selectedPair.reverse.reachable ? "text-emerald-400 font-bold" : "text-red-400 font-bold") : "text-text-muted"}>
                                            {selectedPair.reverse.has_data ? (selectedPair.reverse.reachable ? 'ONLINE' : 'DOWN') : 'Pending Telemetry'}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-text-muted whitespace-nowrap">Latency:</span>
                                        <span className="font-bold text-text-primary">
                                            {selectedPair.reverse.has_data ? `${formatNum(selectedPair.reverse.latency_ms)} ms` : '—'}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-text-muted whitespace-nowrap">Jitter:</span>
                                        <span className="font-bold text-text-primary">
                                            {selectedPair.reverse.has_data ? `${formatNum(selectedPair.reverse.jitter_ms)} ms` : '—'}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-text-muted whitespace-nowrap">Score:</span>
                                        <span className="font-bold text-text-primary">
                                            {selectedPair.reverse.has_data ? `${formatNum(selectedPair.reverse.score)}/100` : '—'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* On-Demand Prisma SD-WAN Flow Path & Circuit Attribution */}
                        <div className="bg-card-secondary/50 border border-border rounded-xl p-4 space-y-3">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                                <div className="flex items-center gap-2">
                                    <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                        <Zap size={14} />
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-bold text-text-primary uppercase tracking-wider">
                                            SD-WAN Flow Path & Circuit Attribution (getflow)
                                        </h4>
                                        <p className="text-[10px] text-text-muted">
                                            Query live Prisma SD-WAN flow table to identify active physical WAN circuits (MPLS vs INET vs LTE) and failover history.
                                        </p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    disabled={tracingFlow}
                                    onClick={() => handleTraceFlow(selectedPair)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                                >
                                    {tracingFlow ? (
                                        <>
                                            <RefreshCw size={12} className="animate-spin" />
                                            <span>Querying getflow.py...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Search size={12} />
                                            <span>Trace Live Flow Path</span>
                                        </>
                                    )}
                                </button>
                            </div>

                            {flowTraceError && (
                                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs font-mono">
                                    ⚠️ {flowTraceError}
                                </div>
                            )}

                            {flowTraceData && (
                                <div className="space-y-3 animate-fade-in pt-1">
                                    <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                                        {/* Forward Circuit */}
                                        <div className="p-3 rounded-xl bg-card-secondary border border-border space-y-1.5 shadow-sm">
                                            <div className="text-text-muted text-[10px] uppercase font-bold flex items-center justify-between">
                                                <span className="flex items-center gap-1">
                                                    <ArrowUpRight size={11} className="text-blue-400" /> Forward WAN Circuit:
                                                </span>
                                                <span className="text-[9px] px-1 py-0.2 rounded bg-blue-500/10 text-blue-400 font-bold">
                                                    {flowTraceData.forward_flow?.path_type || 'VPN'}
                                                </span>
                                            </div>
                                            <div className="text-xs font-black text-blue-300">
                                                {flowTraceData.forward_flow?.egress_path || 'Direct Fabric'}
                                            </div>
                                            <div className="text-[10px] text-text-muted truncate">
                                                Policy: {flowTraceData.forward_flow?.policy_rule || 'Default-Fabric-Path'}
                                            </div>
                                        </div>

                                        {/* Return Circuit */}
                                        <div className="p-3 rounded-xl bg-card-secondary border border-border space-y-1.5 shadow-sm">
                                            <div className="text-text-muted text-[10px] uppercase font-bold flex items-center justify-between">
                                                <span className="flex items-center gap-1">
                                                    <ArrowDownLeft size={11} className="text-purple-400" /> Return WAN Circuit:
                                                </span>
                                                <span className="text-[9px] px-1 py-0.2 rounded bg-purple-500/10 text-purple-400 font-bold">
                                                    {flowTraceData.return_flow?.path_type || 'VPN'}
                                                </span>
                                            </div>
                                            <div className="text-xs font-black text-purple-300">
                                                {flowTraceData.return_flow?.egress_path || 'Direct Fabric'}
                                            </div>
                                            <div className="text-[10px] text-text-muted truncate">
                                                Policy: {flowTraceData.return_flow?.policy_rule || 'Default-Fabric-Path'}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Automated RCA Diagnosis */}
                                    <div className={twMerge(
                                        "p-3 rounded-xl border text-xs shadow-sm",
                                        flowTraceData.diagnosis?.is_asymmetric_circuit
                                            ? "bg-amber-500/10 border-amber-500/30 text-amber-200"
                                            : "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                                    )}>
                                        <div className="font-black flex items-center gap-1.5 mb-1">
                                            {flowTraceData.diagnosis?.is_asymmetric_circuit ? (
                                                <>
                                                    <AlertTriangle size={14} className="text-amber-400" />
                                                    <span>⚠️ Asymmetric Circuit Routing Detected</span>
                                                </>
                                            ) : (
                                                <>
                                                    <CheckCircle2 size={14} className="text-emerald-400" />
                                                    <span>✅ Symmetric Circuit Routing</span>
                                                </>
                                            )}
                                        </div>
                                        <div className="text-[11px] text-text-muted leading-relaxed">
                                            {flowTraceData.diagnosis?.summary}
                                        </div>
                                        {flowTraceData.diagnosis?.recommendation && (
                                            <div className="text-[10.5px] text-text-muted/80 mt-1 italic">
                                                💡 {flowTraceData.diagnosis?.recommendation}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end pt-2">
                            <button
                                onClick={() => {
                                    setSelectedPair(null);
                                    setFlowTraceData(null);
                                    setFlowTraceError(null);
                                }}
                                className="bg-card-secondary hover:bg-card-secondary/80 border border-border text-text-primary px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* SLA Health Thresholds Modal */}
            {showThresholdsModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
                    <div className="bg-card-secondary border border-border w-full max-w-2xl rounded-2xl p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between border-b border-border pb-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                    <Sliders size={20} />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-text-primary">
                                        SD-WAN SLA & Health Thresholds
                                    </h3>
                                    <p className="text-xs text-text-muted">
                                        Define SLA boundaries for Green (Optimal), Yellow (Degraded), and Red (Critical).
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowThresholdsModal(false)}
                                className="text-text-muted hover:text-text-primary p-1.5 rounded-lg hover:bg-card-secondary/60 transition-colors"
                            >
                                <XCircle size={20} />
                            </button>
                        </div>

                        {/* Presets Strip */}
                        <div className="bg-card-secondary/40 border border-border p-3.5 rounded-xl space-y-2">
                            <div className="text-xs font-bold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
                                <Sparkles size={13} className="text-blue-400" /> Quick Profile Presets
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                <button
                                    type="button"
                                    onClick={() => applyPreset('strict')}
                                    className="p-2.5 rounded-xl border border-border bg-card-secondary hover:border-emerald-500/50 hover:bg-emerald-500/10 text-left transition-all group"
                                >
                                    <div className="text-xs font-bold text-emerald-400 group-hover:text-emerald-300">Strict (DC / Campus)</div>
                                    <div className="text-[10px] text-text-muted">Warn &gt;25ms, Asym &gt;10ms</div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => applyPreset('standard')}
                                    className="p-2.5 rounded-xl border border-blue-500/40 bg-blue-500/10 text-left transition-all"
                                >
                                    <div className="text-xs font-bold text-blue-400">Standard (SD-WAN)</div>
                                    <div className="text-[10px] text-text-muted">Warn &gt;60ms, Asym &gt;20ms</div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => applyPreset('relaxed')}
                                    className="p-2.5 rounded-xl border border-border bg-card-secondary hover:border-purple-500/50 hover:bg-purple-500/10 text-left transition-all group"
                                >
                                    <div className="text-xs font-bold text-purple-400 group-hover:text-purple-300">Relaxed (Cloud / WAN)</div>
                                    <div className="text-[10px] text-text-muted">Warn &gt;120ms, Asym &gt;40ms</div>
                                </button>
                            </div>
                        </div>

                        {/* Status Legend / Rules Summary */}
                        <div className="grid grid-cols-3 gap-3 text-xs">
                            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 space-y-1">
                                <div className="font-bold flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span> 🟢 Optimal
                                </div>
                                <div className="text-[11px] text-emerald-300/80 leading-relaxed">
                                    Bidirectional UP, symmetric latency (Δ &lt; {thresholds.asymmetry_warning_delta_ms}ms), loss &lt; {thresholds.loss_warning_pct}%.
                                </div>
                            </div>
                            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 space-y-1">
                                <div className="font-bold flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-amber-400"></span> 🟡 Degraded
                                </div>
                                <div className="text-[11px] text-amber-300/80 leading-relaxed">
                                    Latency &gt; {thresholds.latency_warning_ms}ms, Δ &gt; {thresholds.asymmetry_warning_delta_ms}ms, or loss &gt; {thresholds.loss_warning_pct}%.
                                </div>
                            </div>
                            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 space-y-1">
                                <div className="font-bold flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-red-400"></span> 🔴 Critical
                                </div>
                                <div className="text-[11px] text-red-300/80 leading-relaxed">
                                    Unidirectional outage, latency &gt; {thresholds.latency_critical_ms}ms, loss &gt; {thresholds.loss_critical_pct}%, or severe Δ &gt; {thresholds.asymmetry_critical_delta_ms}ms.
                                </div>
                            </div>
                        </div>

                        {/* Threshold Inputs Grid */}
                        <div className="grid grid-cols-2 gap-4">
                            {/* Latency Thresholds */}
                            <div className="bg-card-secondary/40 border border-border p-4 rounded-xl space-y-3">
                                <div className="text-xs font-bold text-text-primary uppercase tracking-wider flex items-center gap-1.5">
                                    <Activity size={13} className="text-blue-400" /> Latency Thresholds (ms)
                                </div>
                                <div className="space-y-2.5">
                                    <div>
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-amber-400 font-semibold">Warning (Degraded):</span>
                                            <span className="font-mono font-bold text-text-primary">{thresholds.latency_warning_ms} ms</span>
                                        </div>
                                        <input
                                            type="number"
                                            value={thresholds.latency_warning_ms}
                                            onChange={(e) => setThresholds({ ...thresholds, latency_warning_ms: Number(e.target.value) })}
                                            className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-text-primary focus:outline-none focus:ring-1 focus:ring-amber-500"
                                            min={1}
                                            max={1000}
                                        />
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-red-400 font-semibold">Critical (Severe):</span>
                                            <span className="font-mono font-bold text-text-primary">{thresholds.latency_critical_ms} ms</span>
                                        </div>
                                        <input
                                            type="number"
                                            value={thresholds.latency_critical_ms}
                                            onChange={(e) => setThresholds({ ...thresholds, latency_critical_ms: Number(e.target.value) })}
                                            className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-text-primary focus:outline-none focus:ring-1 focus:ring-red-500"
                                            min={1}
                                            max={2000}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Asymmetry Delta Thresholds */}
                            <div className="bg-card-secondary/40 border border-border p-4 rounded-xl space-y-3">
                                <div className="text-xs font-bold text-text-primary uppercase tracking-wider flex items-center gap-1.5">
                                    <ArrowRightLeft size={13} className="text-purple-400" /> Asymmetry Delta (ms)
                                </div>
                                <div className="space-y-2.5">
                                    <div>
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-amber-400 font-semibold">Warning Delta (Δ):</span>
                                            <span className="font-mono font-bold text-text-primary">{thresholds.asymmetry_warning_delta_ms} ms</span>
                                        </div>
                                        <input
                                            type="number"
                                            value={thresholds.asymmetry_warning_delta_ms}
                                            onChange={(e) => setThresholds({ ...thresholds, asymmetry_warning_delta_ms: Number(e.target.value) })}
                                            className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-text-primary focus:outline-none focus:ring-1 focus:ring-amber-500"
                                            min={1}
                                            max={500}
                                        />
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-red-400 font-semibold">Critical Delta (Δ):</span>
                                            <span className="font-mono font-bold text-text-primary">{thresholds.asymmetry_critical_delta_ms} ms</span>
                                        </div>
                                        <input
                                            type="number"
                                            value={thresholds.asymmetry_critical_delta_ms}
                                            onChange={(e) => setThresholds({ ...thresholds, asymmetry_critical_delta_ms: Number(e.target.value) })}
                                            className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-text-primary focus:outline-none focus:ring-1 focus:ring-red-500"
                                            min={1}
                                            max={1000}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Packet Loss Thresholds */}
                            <div className="bg-card-secondary/40 border border-border p-4 rounded-xl space-y-3">
                                <div className="text-xs font-bold text-text-primary uppercase tracking-wider flex items-center gap-1.5">
                                    <Shield size={13} className="text-emerald-400" /> Packet Loss (%)
                                </div>
                                <div className="space-y-2.5">
                                    <div>
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-amber-400 font-semibold">Warning Loss:</span>
                                            <span className="font-mono font-bold text-text-primary">{thresholds.loss_warning_pct}%</span>
                                        </div>
                                        <input
                                            type="number"
                                            step="0.1"
                                            value={thresholds.loss_warning_pct}
                                            onChange={(e) => setThresholds({ ...thresholds, loss_warning_pct: Number(e.target.value) })}
                                            className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-text-primary focus:outline-none focus:ring-1 focus:ring-amber-500"
                                            min={0}
                                            max={100}
                                        />
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-red-400 font-semibold">Critical Loss:</span>
                                            <span className="font-mono font-bold text-text-primary">{thresholds.loss_critical_pct}%</span>
                                        </div>
                                        <input
                                            type="number"
                                            step="0.5"
                                            value={thresholds.loss_critical_pct}
                                            onChange={(e) => setThresholds({ ...thresholds, loss_critical_pct: Number(e.target.value) })}
                                            className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-text-primary focus:outline-none focus:ring-1 focus:ring-red-500"
                                            min={0}
                                            max={100}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Jitter Thresholds */}
                            <div className="bg-card-secondary/40 border border-border p-4 rounded-xl space-y-3">
                                <div className="text-xs font-bold text-text-primary uppercase tracking-wider flex items-center gap-1.5">
                                    <Zap size={13} className="text-amber-400" /> Jitter Thresholds (ms)
                                </div>
                                <div className="space-y-2.5">
                                    <div>
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-amber-400 font-semibold">Warning Jitter:</span>
                                            <span className="font-mono font-bold text-text-primary">{thresholds.jitter_warning_ms} ms</span>
                                        </div>
                                        <input
                                            type="number"
                                            value={thresholds.jitter_warning_ms}
                                            onChange={(e) => setThresholds({ ...thresholds, jitter_warning_ms: Number(e.target.value) })}
                                            className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-text-primary focus:outline-none focus:ring-1 focus:ring-amber-500"
                                            min={1}
                                            max={200}
                                        />
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-red-400 font-semibold">Critical Jitter:</span>
                                            <span className="font-mono font-bold text-text-primary">{thresholds.jitter_critical_ms} ms</span>
                                        </div>
                                        <input
                                            type="number"
                                            value={thresholds.jitter_critical_ms}
                                            onChange={(e) => setThresholds({ ...thresholds, jitter_critical_ms: Number(e.target.value) })}
                                            className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-text-primary focus:outline-none focus:ring-1 focus:ring-red-500"
                                            min={1}
                                            max={500}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Modal Action Buttons */}
                        <div className="flex items-center justify-between border-t border-border pt-4">
                            <button
                                type="button"
                                onClick={() => applyPreset('standard')}
                                className="text-xs text-text-muted hover:text-text-primary underline"
                            >
                                Reset to Defaults
                            </button>
                            <div className="flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowThresholdsModal(false)}
                                    className="bg-card-secondary hover:bg-card-secondary/80 border border-border text-text-primary px-4 py-2 rounded-xl text-xs font-bold transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSaveThresholds}
                                    disabled={savingThresholds}
                                    className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md disabled:opacity-50"
                                >
                                    {thresholdsSaved ? (
                                        <>
                                            <Check size={14} className="text-emerald-300" />
                                            <span>Saved!</span>
                                        </>
                                    ) : (
                                        <>
                                            <Save size={14} />
                                            <span>{savingThresholds ? 'Saving...' : 'Apply Thresholds'}</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
