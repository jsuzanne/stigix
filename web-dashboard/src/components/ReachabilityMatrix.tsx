import React, { useState, useEffect, useCallback } from 'react';
import { usePeerContext } from '../PeerContext';
import { 
    Grid, Activity, AlertTriangle, CheckCircle2, XCircle, ArrowRightLeft, 
    RefreshCw, Filter, Shield, Info, ArrowUpRight, ArrowDownLeft, Clock,
    Layers, Zap, Globe, Sparkles
} from 'lucide-react';
import { twMerge } from 'tailwind-merge';

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
        status: 'OPTIMAL' | 'DEGRADED' | 'CRITICAL' | 'UNKNOWN';
    };
}

interface MatrixData {
    timestamp: number;
    local_node_id: string;
    nodes: MatrixNode[];
    summary: {
        total_pairs: number;
        healthy_bidirectional: number;
        asymmetric_degraded: number;
        unidirectional_down: number;
        full_outage: number;
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
    const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPTIMAL' | 'DEGRADED' | 'CRITICAL'>('ALL');
    const [latencyThreshold, setLatencyThreshold] = useState<number>(0);

    const authHeaders = useCallback((): Record<string, string> => {
        const t = token || (typeof window !== 'undefined' ? localStorage.getItem('token') : null);
        return t ? { Authorization: `Bearer ${t}` } : {};
    }, [token]);

    const fetchMatrix = useCallback(async () => {
        try {
            setLoading(true);
            const params = new URLSearchParams();
            if (asymmetryOnly) params.set('asymmetry_only', 'true');

            const res = await gFetch(`/api/fleet/matrix?${params.toString()}`, {
                headers: authHeaders()
            });
            if (!res.ok) {
                throw new Error(`Failed to load matrix (HTTP ${res.status})`);
            }
            const json: MatrixData = await res.json();
            setData(json);
            setError(null);
        } catch (err: any) {
            setError(err.message || 'Error fetching reachability matrix');
        } finally {
            setLoading(false);
        }
    }, [gFetch, asymmetryOnly, authHeaders]);

    useEffect(() => {
        fetchMatrix();
        const interval = setInterval(fetchMatrix, 10000); // 10s auto-refresh
        return () => clearInterval(interval);
    }, [fetchMatrix]);

    const nodes = data?.nodes || [];
    const matrix = data?.matrix || [];
    const summary = data?.summary || {
        total_pairs: 0,
        healthy_bidirectional: 0,
        asymmetric_degraded: 0,
        unidirectional_down: 0,
        full_outage: 0
    };

    const getPair = (sourceId: string, targetId: string): MatrixPair | undefined => {
        return matrix.find(m => m.source_id === sourceId && m.target_id === targetId);
    };

    return (
        <div className="space-y-6">
            {/* Top Summary & Control Bar */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-card-secondary/60 border border-border p-4 rounded-xl backdrop-blur-sm shadow-sm flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <CheckCircle2 size={20} />
                    </div>
                    <div>
                        <div className="text-2xl font-black font-mono text-text-primary">
                            {summary.healthy_bidirectional}
                        </div>
                        <div className="text-[11px] font-bold text-text-muted uppercase tracking-wider">
                            Symmetric & Healthy
                        </div>
                    </div>
                </div>

                <div className="bg-card-secondary/60 border border-border p-4 rounded-xl backdrop-blur-sm shadow-sm flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        <AlertTriangle size={20} />
                    </div>
                    <div>
                        <div className="text-2xl font-black font-mono text-text-primary">
                            {summary.asymmetric_degraded}
                        </div>
                        <div className="text-[11px] font-bold text-text-muted uppercase tracking-wider">
                            Asymmetric / Degraded
                        </div>
                    </div>
                </div>

                <div className="bg-card-secondary/60 border border-border p-4 rounded-xl backdrop-blur-sm shadow-sm flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20">
                        <ArrowRightLeft size={20} />
                    </div>
                    <div>
                        <div className="text-2xl font-black font-mono text-text-primary">
                            {summary.unidirectional_down}
                        </div>
                        <div className="text-[11px] font-bold text-text-muted uppercase tracking-wider">
                            One-Way Blocked
                        </div>
                    </div>
                </div>

                <div className="bg-card-secondary/60 border border-border p-4 rounded-xl backdrop-blur-sm shadow-sm flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        <Layers size={20} />
                    </div>
                    <div>
                        <div className="text-2xl font-black font-mono text-text-primary">
                            {nodes.length}
                        </div>
                        <div className="text-[11px] font-bold text-text-muted uppercase tracking-wider">
                            Active Fleet Nodes
                        </div>
                    </div>
                </div>
            </div>

            {/* Action & Filter Strip */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-card-secondary/40 p-3.5 rounded-xl border border-border shadow-sm">
                {/* Left: Status Filter Chips */}
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider mr-1">Status:</span>
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
                        onClick={fetchMatrix}
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
                            Full-Mesh Bidirectional Reachability Grid (N × N)
                        </h3>
                        <p className="text-xs text-text-muted mt-0.5">
                            Cross-correlating forward egress SLA (A → B) with return ingress telemetry (B → A) across all SD-WAN endpoints.
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
                ) : nodes.length === 0 ? (
                    <div className="p-12 text-center text-text-muted text-xs">
                        No active Stigix nodes or probes discovered yet.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[640px]">
                            <thead>
                                <tr className="border-b border-border bg-card-secondary/40 text-[11px] font-bold text-text-muted uppercase tracking-wider">
                                    <th className="p-3 w-40 border-r border-border bg-card-secondary/90 sticky left-0 z-10">
                                        Source (From) \ Target (To)
                                    </th>
                                    {nodes.map(node => (
                                        <th key={node.id} className="p-3 text-center border-r border-border/50 min-w-[140px]">
                                            <div className="flex flex-col items-center">
                                                <span className="text-text-primary font-mono">{node.name}</span>
                                                <span className="text-[9.5px] text-text-muted font-normal font-mono">{node.ip}</span>
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
                                                    <div className="font-mono">{sourceNode.name}</div>
                                                    <div className="text-[9.5px] text-text-muted font-normal font-mono">{sourceNode.ip}</div>
                                                </div>
                                                {sourceNode.is_local && (
                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
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
                                            const isOpt = asymmetry.status === 'OPTIMAL';
                                            const isDeg = asymmetry.status === 'DEGRADED';
                                            const isCrit = asymmetry.status === 'CRITICAL';

                                            const maxLatency = Math.max(
                                                forward.reachable ? forward.latency_ms : 0,
                                                reverse.has_data && reverse.reachable ? reverse.latency_ms : 0
                                            );

                                            // Filtering logic
                                            const matchesStatus = statusFilter === 'ALL' || asymmetry.status === statusFilter;
                                            const matchesLatency = latencyThreshold === 0 || maxLatency >= latencyThreshold;
                                            const isFaded = !matchesStatus || !matchesLatency;

                                            const cellBg = isOpt 
                                                ? "bg-emerald-950/20 hover:bg-emerald-900/35 border-emerald-500/30 text-emerald-300"
                                                : isDeg 
                                                ? "bg-amber-950/25 hover:bg-amber-900/40 border-amber-500/35 text-amber-300"
                                                : "bg-red-950/30 hover:bg-red-900/45 border-red-500/40 text-red-300";

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
                                                        {/* Forward */}
                                                        <div className="flex items-center justify-between text-[11px] font-mono px-1">
                                                            <span className="flex items-center gap-0.5 text-text-muted text-[10px]">
                                                                <ArrowUpRight size={11} className="text-blue-400" /> Fwd:
                                                            </span>
                                                            <span className={forward.reachable ? (isOpt ? "font-bold text-emerald-300" : isDeg ? "font-bold text-amber-300" : "font-black text-red-400") : "font-black text-red-400"}>
                                                                {forward.reachable ? `${formatNum(forward.latency_ms)}ms` : 'DOWN'}
                                                            </span>
                                                        </div>

                                                        {/* Reverse */}
                                                        <div className="flex items-center justify-between text-[11px] font-mono px-1">
                                                            <span className="flex items-center gap-0.5 text-text-muted text-[10px]">
                                                                <ArrowDownLeft size={11} className="text-purple-400" /> Rev:
                                                            </span>
                                                            <span className={reverse.reachable ? (isOpt ? "font-bold text-emerald-300" : isDeg ? "font-bold text-amber-300" : "font-black text-red-400") : "font-black text-red-400"}>
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
                                                                Δ {formatNum(asymmetry.latency_delta_ms)}ms
                                                            </div>
                                                        )}
                                                        {isCrit && (
                                                            <div className="mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/20 text-red-300 border border-red-500/30 truncate">
                                                                {asymmetry.reason?.includes('DOWN') ? 'Path Down' : 'Critical'}
                                                            </div>
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
                    <div className="bg-card border border-border rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-6">
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
                            selectedPair.asymmetry.status === 'OPTIMAL' 
                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                : selectedPair.asymmetry.status === 'DEGRADED'
                                ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                                : "bg-red-500/10 border-red-500/20 text-red-400"
                        )}>
                            <Info size={20} className="flex-shrink-0 mt-0.5" />
                            <div>
                                <div className="text-xs font-black uppercase tracking-wider">
                                    Path Status: {selectedPair.asymmetry.status}
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
                                <div className="space-y-1.5 text-xs font-mono">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-text-muted whitespace-nowrap">Source IP:</span>
                                        <span className="font-bold text-text-primary text-right">{selectedPair.forward.source_ip || selectedPair.source_ip || '—'}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-text-muted whitespace-nowrap">Dest IP:</span>
                                        <span className="font-bold text-text-primary text-right">{selectedPair.forward.target_ip || selectedPair.target_ip || '—'}</span>
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
                                <div className="space-y-1.5 text-xs font-mono">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-text-muted whitespace-nowrap">Source IP:</span>
                                        <span className="font-bold text-text-primary text-right">{selectedPair.reverse.source_ip || selectedPair.target_ip || '—'}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-text-muted whitespace-nowrap">Dest IP:</span>
                                        <span className="font-bold text-text-primary text-right">{selectedPair.reverse.target_ip || selectedPair.source_ip || '—'}</span>
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

                        <div className="flex justify-end pt-2">
                            <button
                                onClick={() => setSelectedPair(null)}
                                className="bg-card-secondary hover:bg-card-secondary/80 border border-border text-text-primary px-4 py-2 rounded-xl text-xs font-bold transition-all"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
