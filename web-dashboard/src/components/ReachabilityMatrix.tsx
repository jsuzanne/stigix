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
    target_id: string;
    target_name: string;
    forward: {
        reachable: boolean;
        latency_ms: number;
        jitter_ms: number;
        loss_pct: number;
        score: number;
        last_tested?: number;
        type?: string;
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

export function ReachabilityMatrix({ token }: { token?: string }) {
    const { gFetch, activePeer } = usePeerContext();
    const [data, setData] = useState<MatrixData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [asymmetryOnly, setAsymmetryOnly] = useState(false);
    const [selectedType, setSelectedType] = useState('ALL');
    const [selectedPair, setSelectedPair] = useState<MatrixPair | null>(null);

    const authHeaders = useCallback((): Record<string, string> => {
        const t = token || (typeof window !== 'undefined' ? localStorage.getItem('token') : null);
        return t ? { Authorization: `Bearer ${t}` } : {};
    }, [token]);

    const fetchMatrix = useCallback(async () => {
        try {
            setLoading(true);
            const params = new URLSearchParams();
            if (selectedType !== 'ALL') params.set('type', selectedType);
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
    }, [gFetch, selectedType, asymmetryOnly, authHeaders]);

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

            {/* Filter & Action Strip */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-card-secondary/40 p-4 rounded-xl border border-border shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-text-muted flex items-center gap-1.5 mr-2">
                        <Filter size={14} /> Probe Type:
                    </span>
                    {['ALL', 'PRISMA SDWAN', 'PING', 'HTTP', 'TCP'].map(t => (
                        <button
                            key={t}
                            onClick={() => setSelectedType(t)}
                            className={twMerge(
                                "px-3 py-1 rounded-md text-xs font-bold uppercase tracking-tight transition-all",
                                selectedType === t 
                                    ? "bg-blue-600 text-white shadow-md shadow-blue-500/20" 
                                    : "bg-card-secondary/80 text-text-muted hover:text-text-primary border border-border"
                            )}
                        >
                            {t === 'PRISMA SDWAN' ? 'PRISMA SD-WAN' : t}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                    <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-bold text-text-muted hover:text-text-primary">
                        <input
                            type="checkbox"
                            checked={asymmetryOnly}
                            onChange={(e) => setAsymmetryOnly(e.target.checked)}
                            className="rounded border-border text-blue-600 focus:ring-blue-500"
                        />
                        <span>Asymmetric Only</span>
                    </label>

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

                                            const cellBg = isOpt 
                                                ? "bg-emerald-500/5 hover:bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                                : isDeg 
                                                ? "bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-400"
                                                : "bg-red-500/10 hover:bg-red-500/20 border-red-500/30 text-red-400";

                                            return (
                                                <td
                                                    key={targetNode.id}
                                                    onClick={() => setSelectedPair(pair)}
                                                    className={twMerge(
                                                        "p-2.5 text-center border-r border-border/50 cursor-pointer transition-all border",
                                                        cellBg
                                                    )}
                                                >
                                                    <div className="flex flex-col gap-1">
                                                        {/* Forward */}
                                                        <div className="flex items-center justify-between text-[11px] font-mono px-1">
                                                            <span className="flex items-center gap-0.5 text-text-muted text-[10px]">
                                                                <ArrowUpRight size={11} className="text-blue-400" /> Fwd:
                                                            </span>
                                                            <span className={forward.reachable ? "font-bold text-text-primary" : "font-black text-red-400"}>
                                                                {forward.reachable ? `${forward.latency_ms}ms` : 'DOWN'}
                                                            </span>
                                                        </div>

                                                        {/* Reverse */}
                                                        <div className="flex items-center justify-between text-[11px] font-mono px-1">
                                                            <span className="flex items-center gap-0.5 text-text-muted text-[10px]">
                                                                <ArrowDownLeft size={11} className="text-purple-400" /> Rev:
                                                            </span>
                                                            <span className={reverse.reachable ? "font-bold text-text-primary" : "font-black text-red-400"}>
                                                                {reverse.has_data ? (reverse.reachable ? `${reverse.latency_ms}ms` : 'DOWN') : 'Pending'}
                                                            </span>
                                                        </div>

                                                        {/* Asymmetry Badge */}
                                                        {asymmetry.is_asymmetric && (
                                                            <div className="mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 truncate">
                                                                Δ {asymmetry.latency_delta_ms}ms
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
                    <div className="bg-card border border-border rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-6">
                        <div className="flex items-center justify-between border-b border-border pb-4">
                            <div className="flex items-center gap-2">
                                <ArrowRightLeft className="text-blue-500" size={20} />
                                <h3 className="text-base font-bold text-text-primary font-mono">
                                    {selectedPair.source_name} ⇄ {selectedPair.target_name}
                                </h3>
                            </div>
                            <button
                                onClick={() => setSelectedPair(null)}
                                className="text-text-muted hover:text-text-primary p-1 rounded-lg hover:bg-card-secondary"
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
                                <div className="text-xs font-bold text-blue-400 flex items-center gap-1.5 uppercase tracking-wider">
                                    <ArrowUpRight size={14} /> Forward Path
                                </div>
                                <div className="text-[11px] text-text-muted font-mono truncate">
                                    {selectedPair.source_name} ➔ {selectedPair.target_name}
                                </div>
                                <div className="space-y-1.5 text-xs font-mono">
                                    <div className="flex justify-between">
                                        <span className="text-text-muted">Status:</span>
                                        <span className={selectedPair.forward.reachable ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
                                            {selectedPair.forward.reachable ? 'ONLINE' : 'DOWN'}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-text-muted">Latency:</span>
                                        <span className="font-bold text-text-primary">{selectedPair.forward.latency_ms} ms</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-text-muted">Jitter:</span>
                                        <span className="font-bold text-text-primary">{selectedPair.forward.jitter_ms} ms</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-text-muted">Score:</span>
                                        <span className="font-bold text-text-primary">{selectedPair.forward.score}/100</span>
                                    </div>
                                </div>
                            </div>

                            {/* Return */}
                            <div className="bg-card-secondary/60 border border-border p-4 rounded-xl space-y-3">
                                <div className="text-xs font-bold text-purple-400 flex items-center gap-1.5 uppercase tracking-wider">
                                    <ArrowDownLeft size={14} /> Return Path
                                </div>
                                <div className="text-[11px] text-text-muted font-mono truncate">
                                    {selectedPair.target_name} ➔ {selectedPair.source_name}
                                </div>
                                <div className="space-y-1.5 text-xs font-mono">
                                    <div className="flex justify-between">
                                        <span className="text-text-muted">Status:</span>
                                        <span className={selectedPair.reverse.has_data ? (selectedPair.reverse.reachable ? "text-emerald-400 font-bold" : "text-red-400 font-bold") : "text-text-muted"}>
                                            {selectedPair.reverse.has_data ? (selectedPair.reverse.reachable ? 'ONLINE' : 'DOWN') : 'Pending Telemetry'}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-text-muted">Latency:</span>
                                        <span className="font-bold text-text-primary">
                                            {selectedPair.reverse.has_data ? `${selectedPair.reverse.latency_ms} ms` : '—'}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-text-muted">Jitter:</span>
                                        <span className="font-bold text-text-primary">
                                            {selectedPair.reverse.has_data ? `${selectedPair.reverse.jitter_ms} ms` : '—'}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-text-muted">Score:</span>
                                        <span className="font-bold text-text-primary">
                                            {selectedPair.reverse.has_data ? `${selectedPair.reverse.score}/100` : '—'}
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
