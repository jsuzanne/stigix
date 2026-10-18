import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
    Camera, 
    GitCompare, 
    History, 
    CheckCircle, 
    AlertTriangle, 
    XCircle, 
    ArrowRight, 
    RefreshCw, 
    Trash2, 
    Eye, 
    Sparkles, 
    Network, 
    Activity, 
    ShieldCheck, 
    Clock, 
    Plus,
    X,
    TrendingDown,
    TrendingUp,
    FileJson
} from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from './lib/utils';

interface SnapshotMetadata {
    id: string;
    timestamp: number;
    iso_time: string;
    name: string;
    description: string;
    source: string;
    node: {
        hostname: string;
        site_name: string;
        role: string;
        stigix_version: string;
    };
    tunnels_count: number;
    tunnels_up: number;
    dem_probes_count: number;
    dem_healthy_count: number;
}

interface TunnelComparison {
    peer_id: string;
    baseline_status: string;
    current_status: string;
    status_changed: boolean;
    regression: boolean;
    improvement: boolean;
}

interface DemProbeComparison {
    target_id: string;
    target_label: string;
    baseline_latency_ms: number;
    current_latency_ms: number;
    latency_delta_ms: number;
    latency_delta_percent: number;
    baseline_loss_percent: number;
    current_loss_percent: number;
    loss_delta_percent: number;
    baseline_jitter_ms: number;
    current_jitter_ms: number;
    jitter_delta_ms: number;
    status_regression: boolean;
    status_improvement: boolean;
}

interface DiffReport {
    baseline_id: string;
    baseline_name: string;
    current_id: string;
    current_name: string;
    generated_at: string;
    score: number;
    verdict: 'GO' | 'WARNING' | 'NO_GO';
    tunnels: {
        total_baseline: number;
        total_current: number;
        down_now: number;
        regressed: number;
        improved: number;
        comparisons: TunnelComparison[];
    };
    dem: {
        total_probes: number;
        regressed_probes: number;
        improved_probes: number;
        average_latency_delta_ms: number;
        average_loss_delta_percent: number;
        probes: DemProbeComparison[];
    };
    critical_regressions: string[];
    improvements: string[];
}

interface ChangeGuardProps {
    token: string;
}

export default function ChangeGuard({ token }: ChangeGuardProps) {
    const [snapshots, setSnapshots] = useState<SnapshotMetadata[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [actionLoading, setActionLoading] = useState<boolean>(false);
    
    // Selection for Diff
    const [baselineId, setBaselineId] = useState<string>('');
    const [currentId, setCurrentId] = useState<string>('');
    const [diffReport, setDiffReport] = useState<DiffReport | null>(null);
    const [diffLoading, setDiffLoading] = useState<boolean>(false);

    // Modal state for taking snapshot
    const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
    const [newSnapshotName, setNewSnapshotName] = useState<string>('');
    const [newSnapshotDesc, setNewSnapshotDesc] = useState<string>('');

    // Modal state for inspecting JSON
    const [inspectData, setInspectData] = useState<any | null>(null);

    const authHeaders = useMemo(() => ({
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    }), [token]);

    const fetchSnapshots = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/snapshots', { headers: authHeaders });
            if (!res.ok) {
                if (res.status === 403) {
                    toast.error('ChangeGuard is disabled. Enable ENABLE_CHANGE_SNAPSHOTS=true in .env');
                } else {
                    toast.error('Failed to load snapshots');
                }
                return;
            }
            const data = await res.json();
            const list: SnapshotMetadata[] = data.snapshots || [];
            setSnapshots(list);

            // Auto-select latest two if none selected
            if (list.length >= 2) {
                if (!baselineId) setBaselineId(list[1].id);
                if (!currentId) setCurrentId(list[0].id);
            } else if (list.length === 1 && !baselineId) {
                setBaselineId(list[0].id);
            }
        } catch (err: any) {
            console.error('Failed to fetch snapshots:', err);
            toast.error('Network error loading snapshots');
        } finally {
            setLoading(false);
        }
    }, [authHeaders, baselineId, currentId]);

    useEffect(() => {
        fetchSnapshots();
    }, [fetchSnapshots]);

    const handleCreateSnapshot = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newSnapshotName.trim()) {
            toast.error('Snapshot name is required');
            return;
        }

        try {
            setActionLoading(true);
            const res = await fetch('/api/snapshots', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    name: newSnapshotName.trim(),
                    description: newSnapshotDesc.trim()
                })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                toast.error(errData.error || 'Failed to capture snapshot');
                return;
            }

            const data = await res.json();
            toast.success(`Snapshot "${data.snapshot.metadata.name}" captured!`);
            setShowCreateModal(false);
            setNewSnapshotName('');
            setNewSnapshotDesc('');
            await fetchSnapshots();
        } catch (err) {
            console.error('Error creating snapshot:', err);
            toast.error('Error creating snapshot');
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteSnapshot = async (id: string, name: string) => {
        if (!confirm(`Delete snapshot "${name}"? This action cannot be undone.`)) return;

        try {
            setActionLoading(true);
            const res = await fetch(`/api/snapshots/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: authHeaders
            });

            if (!res.ok) {
                toast.error('Failed to delete snapshot');
                return;
            }

            toast.success(`Snapshot "${name}" deleted`);
            if (baselineId === id) setBaselineId('');
            if (currentId === id) setCurrentId('');
            if (diffReport?.baseline_id === id || diffReport?.current_id === id) {
                setDiffReport(null);
            }
            await fetchSnapshots();
        } catch (err) {
            console.error('Delete error:', err);
            toast.error('Error deleting snapshot');
        } finally {
            setActionLoading(false);
        }
    };

    const handleRunDiff = async () => {
        if (!baselineId) {
            toast.error('Please select a Baseline snapshot');
            return;
        }

        try {
            setDiffLoading(true);
            const res = await fetch('/api/snapshots/diff', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    baseline_id: baselineId,
                    current_id: currentId || undefined
                })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                toast.error(errData.error || 'Failed to compute diff');
                return;
            }

            const data = await res.json();
            setDiffReport(data.diff);
            toast.success(`Diff calculated: Verdict ${data.diff.verdict} (${data.diff.score}/100)`);
        } catch (err) {
            console.error('Diff error:', err);
            toast.error('Error computing diff');
        } finally {
            setDiffLoading(false);
        }
    };

    const handleInspectSnapshot = async (id: string) => {
        try {
            setActionLoading(true);
            const res = await fetch(`/api/snapshots/${encodeURIComponent(id)}`, { headers: authHeaders });
            if (!res.ok) {
                toast.error('Failed to load snapshot details');
                return;
            }
            const data = await res.json();
            setInspectData(data.snapshot);
        } catch (err) {
            console.error('Inspect error:', err);
            toast.error('Failed to retrieve snapshot JSON');
        } finally {
            setActionLoading(false);
        }
    };

    return (
        <div className="w-full min-h-screen bg-slate-900 text-slate-100 p-6 space-y-6">
            {/* ── Top Header Banner ── */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
                <div className="space-y-1">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg border border-indigo-500/20">
                            <GitCompare className="w-6 h-6" />
                        </div>
                        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                            ChangeGuard
                            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                Pilot Engine
                            </span>
                        </h1>
                    </div>
                    <p className="text-sm text-slate-400">
                        Pre/post migration state capture, WireGuard tunnel verification & deterministic delta diffing.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={fetchSnapshots}
                        disabled={loading}
                        className="px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition flex items-center gap-1.5"
                    >
                        <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
                        Refresh
                    </button>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow-sm transition flex items-center gap-2"
                    >
                        <Camera className="w-4 h-4" />
                        Capture Snapshot
                    </button>
                </div>
            </div>

            {/* ── Section 1: Compare Before / After (Diff Control) ── */}
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 shadow-lg backdrop-blur-sm space-y-5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <GitCompare className="w-5 h-5 text-indigo-400" />
                        <h2 className="text-base font-semibold text-white">Delta Comparator (Before vs. After)</h2>
                    </div>
                    <span className="text-xs text-slate-400">
                        Select a baseline snapshot and compare against another snapshot or live state.
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                    {/* Baseline Selector */}
                    <div className="md:col-span-5 space-y-1.5">
                        <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-400" />
                            Baseline Snapshot (Before)
                        </label>
                        <select
                            value={baselineId}
                            onChange={(e) => setBaselineId(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="">-- Choose Baseline --</option>
                            {snapshots.map(s => (
                                <option key={s.id} value={s.id}>
                                    {s.name} ({s.node?.site_name || 'Node'} — {new Date(s.timestamp).toLocaleTimeString()})
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Arrow Divider */}
                    <div className="hidden md:flex md:col-span-1 justify-center items-center pb-2 text-slate-500">
                        <ArrowRight className="w-5 h-5" />
                    </div>

                    {/* Current / Target Selector */}
                    <div className="md:col-span-4 space-y-1.5">
                        <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-cyan-400" />
                            Target Snapshot (After / Live)
                        </label>
                        <select
                            value={currentId}
                            onChange={(e) => setCurrentId(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="">-- Live Node State (Current) --</option>
                            {snapshots.map(s => (
                                <option key={s.id} value={s.id}>
                                    {s.name} ({s.node?.site_name || 'Node'} — {new Date(s.timestamp).toLocaleTimeString()})
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Compare Button */}
                    <div className="md:col-span-2">
                        <button
                            onClick={handleRunDiff}
                            disabled={!baselineId || diffLoading}
                            className={cn(
                                "w-full py-2 px-4 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-2",
                                !baselineId || diffLoading
                                    ? "bg-slate-700 text-slate-400 cursor-not-allowed"
                                    : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-md hover:shadow-indigo-500/20"
                            )}
                        >
                            <RefreshCw className={cn("w-4 h-4", diffLoading && "animate-spin")} />
                            {diffLoading ? "Analyzing..." : "Compare Delta"}
                        </button>
                    </div>
                </div>

                {/* ── Diff Report Presentation ── */}
                {diffReport && (
                    <div className="pt-4 border-t border-slate-700/60 space-y-5 animate-in fade-in duration-200">
                        {/* Verdict Header Card */}
                        <div className={cn(
                            "p-5 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4",
                            diffReport.verdict === 'GO' && "bg-emerald-950/30 border-emerald-500/30 text-emerald-200",
                            diffReport.verdict === 'WARNING' && "bg-amber-950/30 border-amber-500/30 text-amber-200",
                            diffReport.verdict === 'NO_GO' && "bg-rose-950/30 border-rose-500/30 text-rose-200"
                        )}>
                            <div className="flex items-center gap-3.5">
                                {diffReport.verdict === 'GO' && <CheckCircle className="w-8 h-8 text-emerald-400 shrink-0" />}
                                {diffReport.verdict === 'WARNING' && <AlertTriangle className="w-8 h-8 text-amber-400 shrink-0" />}
                                {diffReport.verdict === 'NO_GO' && <XCircle className="w-8 h-8 text-rose-400 shrink-0" />}

                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xl font-bold tracking-tight">
                                            VERDICT: {diffReport.verdict}
                                        </span>
                                        <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-white/10 uppercase">
                                            Confidence Score: {diffReport.score} / 100
                                        </span>
                                    </div>
                                    <p className="text-xs opacity-90 mt-0.5">
                                        Comparison between <span className="font-semibold underline">{diffReport.baseline_name}</span> and <span className="font-semibold underline">{diffReport.current_name}</span>.
                                    </p>
                                </div>
                            </div>

                            {/* Score Bar */}
                            <div className="w-full md:w-48 bg-black/40 rounded-full h-3 border border-white/10 overflow-hidden">
                                <div 
                                    className={cn(
                                        "h-full transition-all duration-500",
                                        diffReport.score >= 80 ? "bg-emerald-500" : diffReport.score >= 50 ? "bg-amber-500" : "bg-rose-500"
                                    )}
                                    style={{ width: `${Math.max(5, diffReport.score)}%` }}
                                />
                            </div>
                        </div>

                        {/* Regressions or Improvements list */}
                        {(diffReport.critical_regressions.length > 0 || diffReport.improvements.length > 0) && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {diffReport.critical_regressions.length > 0 && (
                                    <div className="bg-rose-950/20 border border-rose-500/20 rounded-lg p-4 space-y-2">
                                        <div className="text-xs font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                                            <TrendingDown className="w-4 h-4" />
                                            Regressions Detected ({diffReport.critical_regressions.length})
                                        </div>
                                        <ul className="text-xs text-rose-300 space-y-1 pl-4 list-disc">
                                            {diffReport.critical_regressions.map((reg, idx) => (
                                                <li key={idx}>{reg}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {diffReport.improvements.length > 0 && (
                                    <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-lg p-4 space-y-2">
                                        <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                                            <TrendingUp className="w-4 h-4" />
                                            Improvements Detected ({diffReport.improvements.length})
                                        </div>
                                        <ul className="text-xs text-emerald-300 space-y-1 pl-4 list-disc">
                                            {diffReport.improvements.map((imp, idx) => (
                                                <li key={idx}>{imp}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Detailed Tabs: Tunnels and DEM probes */}
                        <div className="space-y-4">
                            {/* DEM Probes Table */}
                            <div className="bg-slate-900/80 border border-slate-700/80 rounded-lg overflow-hidden">
                                <div className="px-4 py-3 bg-slate-800/70 border-b border-slate-700 text-xs font-bold text-slate-200 flex items-center gap-2">
                                    <Activity className="w-4 h-4 text-cyan-400" />
                                    Digital Experience (DEM) Path Matrix Deltas ({diffReport.dem.total_probes} probes)
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs text-slate-300">
                                        <thead className="bg-slate-800/40 text-slate-400 font-semibold border-b border-slate-700/50">
                                            <tr>
                                                <th className="px-4 py-2.5">Probe Target</th>
                                                <th className="px-4 py-2.5">Baseline Latency</th>
                                                <th className="px-4 py-2.5">Target Latency</th>
                                                <th className="px-4 py-2.5">Δ Latency</th>
                                                <th className="px-4 py-2.5">Δ Packet Loss</th>
                                                <th className="px-4 py-2.5">Δ Jitter</th>
                                                <th className="px-4 py-2.5">Verdict</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800/60 font-mono">
                                            {diffReport.dem.probes.map(p => (
                                                <tr key={p.target_id} className={cn(
                                                    "hover:bg-slate-800/30 transition",
                                                    p.status_regression && "bg-rose-950/10 text-rose-200",
                                                    p.status_improvement && "bg-emerald-950/10 text-emerald-200"
                                                )}>
                                                    <td className="px-4 py-2 font-sans font-medium text-slate-200">{p.target_label}</td>
                                                    <td className="px-4 py-2">{p.baseline_latency_ms.toFixed(1)} ms</td>
                                                    <td className="px-4 py-2">{p.current_latency_ms.toFixed(1)} ms</td>
                                                    <td className={cn(
                                                        "px-4 py-2 font-bold",
                                                        p.latency_delta_ms > 5 ? "text-rose-400" : p.latency_delta_ms < -2 ? "text-emerald-400" : "text-slate-300"
                                                    )}>
                                                        {p.latency_delta_ms > 0 ? `+${p.latency_delta_ms.toFixed(1)}` : p.latency_delta_ms.toFixed(1)} ms
                                                        <span className="text-[10px] ml-1 opacity-70">({p.latency_delta_percent > 0 ? `+${p.latency_delta_percent.toFixed(0)}` : p.latency_delta_percent.toFixed(0)}%)</span>
                                                    </td>
                                                    <td className={cn(
                                                        "px-4 py-2",
                                                        p.loss_delta_percent > 0 ? "text-rose-400 font-bold" : "text-slate-400"
                                                    )}>
                                                        {p.loss_delta_percent > 0 ? `+${p.loss_delta_percent.toFixed(1)}%` : '0%'}
                                                    </td>
                                                    <td className="px-4 py-2 text-slate-400">
                                                        {p.jitter_delta_ms > 0 ? `+${p.jitter_delta_ms.toFixed(1)}` : p.jitter_delta_ms.toFixed(1)} ms
                                                    </td>
                                                    <td className="px-4 py-2 font-sans">
                                                        {p.status_regression ? (
                                                            <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-bold">DEGRADED</span>
                                                        ) : p.status_improvement ? (
                                                            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">IMPROVED</span>
                                                        ) : (
                                                            <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">UNCHANGED</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* WireGuard Overlay Tunnels Table */}
                            {diffReport.tunnels.comparisons.length > 0 && (
                                <div className="bg-slate-900/80 border border-slate-700/80 rounded-lg overflow-hidden">
                                    <div className="px-4 py-3 bg-slate-800/70 border-b border-slate-700 text-xs font-bold text-slate-200 flex items-center gap-2">
                                        <Network className="w-4 h-4 text-indigo-400" />
                                        WireGuard Overlay Mesh Tunnels ({diffReport.tunnels.comparisons.length} peers)
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs text-slate-300">
                                            <thead className="bg-slate-800/40 text-slate-400 font-semibold border-b border-slate-700/50">
                                                <tr>
                                                    <th className="px-4 py-2.5">Peer ID</th>
                                                    <th className="px-4 py-2.5">Baseline Status</th>
                                                    <th className="px-4 py-2.5">Target Status</th>
                                                    <th className="px-4 py-2.5">Delta</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-800/60 font-mono">
                                                {diffReport.tunnels.comparisons.map(t => (
                                                    <tr key={t.peer_id} className={cn(
                                                        "hover:bg-slate-800/30 transition",
                                                        t.regression && "bg-rose-950/20 text-rose-300"
                                                    )}>
                                                        <td className="px-4 py-2 font-sans font-medium text-slate-200">{t.peer_id}</td>
                                                        <td className="px-4 py-2">
                                                            <span className={cn(
                                                                "px-2 py-0.5 rounded text-[10px] font-bold",
                                                                t.baseline_status === 'up' ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                                                            )}>
                                                                {t.baseline_status.toUpperCase()}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-2">
                                                            <span className={cn(
                                                                "px-2 py-0.5 rounded text-[10px] font-bold",
                                                                t.current_status === 'up' ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                                                            )}>
                                                                {t.current_status.toUpperCase()}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-2 font-sans">
                                                            {t.regression ? (
                                                                <span className="text-rose-400 font-bold flex items-center gap-1">
                                                                    <XCircle className="w-3.5 h-3.5" /> CRITICAL: Tunnel went DOWN
                                                                </span>
                                                            ) : t.improvement ? (
                                                                <span className="text-emerald-400 font-bold flex items-center gap-1">
                                                                    <CheckCircle className="w-3.5 h-3.5" /> RECOVERED: Tunnel came UP
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-500">Unchanged</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* ── Section 2: Snapshot Repository & Timeline ── */}
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 shadow-lg backdrop-blur-sm space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <History className="w-5 h-5 text-indigo-400" />
                        <h2 className="text-base font-semibold text-white">Snapshot Catalog</h2>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 font-mono">
                            {snapshots.length} / 50
                        </span>
                    </div>
                </div>

                {snapshots.length === 0 ? (
                    <div className="py-12 text-center text-slate-500 border border-dashed border-slate-700 rounded-lg">
                        <Camera className="w-10 h-10 mx-auto text-slate-600 mb-2" />
                        <p className="text-sm font-medium text-slate-400">No snapshots captured yet.</p>
                        <p className="text-xs text-slate-500 mt-1">Capture a baseline snapshot before starting a network migration or maintenance task.</p>
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="mt-4 px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition"
                        >
                            Capture First Snapshot
                        </button>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs text-slate-300">
                            <thead className="bg-slate-900/60 text-slate-400 font-semibold border-b border-slate-700/80">
                                <tr>
                                    <th className="px-4 py-3">Snapshot Name</th>
                                    <th className="px-4 py-3">Site / Node</th>
                                    <th className="px-4 py-3">Captured At</th>
                                    <th className="px-4 py-3">WireGuard Tunnels</th>
                                    <th className="px-4 py-3">DEM Health</th>
                                    <th className="px-4 py-3">Source</th>
                                    <th className="px-4 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {snapshots.map(s => (
                                    <tr key={s.id} className="hover:bg-slate-700/30 transition">
                                        <td className="px-4 py-3">
                                            <div className="font-semibold text-slate-100">{s.name}</div>
                                            {s.description && (
                                                <div className="text-[11px] text-slate-400 mt-0.5">{s.description}</div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-slate-300">{s.node?.site_name || 'Node'}</div>
                                            <div className="text-[10px] text-slate-500 font-mono">{s.node?.hostname}</div>
                                        </td>
                                        <td className="px-4 py-3 text-slate-400 font-mono text-[11px]">
                                            {new Date(s.timestamp).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                                {s.tunnels_up} / {s.tunnels_count} UP
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                {s.dem_healthy_count} / {s.dem_probes_count} Healthy
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] uppercase font-mono">
                                                {s.source}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => {
                                                        setBaselineId(s.id);
                                                        toast.success(`Set "${s.name}" as Baseline`);
                                                    }}
                                                    title="Use as Baseline for diff"
                                                    className="px-2 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-indigo-300 rounded border border-slate-700"
                                                >
                                                    Use as Baseline
                                                </button>
                                                <button
                                                    onClick={() => handleInspectSnapshot(s.id)}
                                                    title="Inspect JSON"
                                                    className="p-1.5 text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700"
                                                >
                                                    <FileJson className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteSnapshot(s.id, s.name)}
                                                    title="Delete snapshot"
                                                    className="p-1.5 text-rose-400 hover:text-rose-300 bg-rose-950/20 hover:bg-rose-900/30 rounded border border-rose-500/30"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ── Modal: Capture Snapshot ── */}
            {showCreateModal && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                            <h3 className="text-base font-semibold text-white flex items-center gap-2">
                                <Camera className="w-4 h-4 text-indigo-400" />
                                Capture State Snapshot
                            </h3>
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="text-slate-400 hover:text-slate-200"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <form onSubmit={handleCreateSnapshot} className="space-y-4">
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-300">
                                    Snapshot Name <span className="text-rose-400">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. pre-fiber-cutover, baseline-clean"
                                    value={newSnapshotName}
                                    onChange={(e) => setNewSnapshotName(e.target.value)}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-300">
                                    Description / Maintenance Notes
                                </label>
                                <textarea
                                    rows={3}
                                    placeholder="e.g. Taken before switching uplink router on BR8"
                                    value={newSnapshotDesc}
                                    onChange={(e) => setNewSnapshotDesc(e.target.value)}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>

                            <div className="text-[11px] text-slate-400 bg-slate-800/60 p-3 rounded-lg border border-slate-700/60 space-y-1">
                                <span className="font-semibold text-slate-300">What will be captured:</span>
                                <ul className="list-disc pl-4 space-y-0.5 text-slate-400">
                                    <li>Node identity, site name, and Stigix version</li>
                                    <li>All active WireGuard overlay mesh tunnels & endpoints</li>
                                    <li>Complete DEM reachability matrix (latency, jitter, packet loss)</li>
                                </ul>
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowCreateModal(false)}
                                    className="px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 rounded-lg border border-slate-700 transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={actionLoading || !newSnapshotName.trim()}
                                    className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition flex items-center gap-2"
                                >
                                    {actionLoading ? "Capturing..." : "Save Snapshot"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── Modal: Inspect JSON ── */}
            {inspectData && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-3xl w-full p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                            <h3 className="text-base font-semibold text-white flex items-center gap-2">
                                <FileJson className="w-4 h-4 text-indigo-400" />
                                Snapshot Raw JSON ({inspectData.metadata?.name})
                            </h3>
                            <button
                                onClick={() => setInspectData(null)}
                                className="text-slate-400 hover:text-slate-200"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="overflow-y-auto flex-1 bg-black/50 border border-slate-800 rounded-lg p-4 font-mono text-xs text-emerald-400">
                            <pre>{JSON.stringify(inspectData, null, 2)}</pre>
                        </div>

                        <div className="flex justify-end pt-2">
                            <button
                                onClick={() => setInspectData(null)}
                                className="px-4 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700"
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
