import React, { useState, useEffect, useMemo } from 'react';
import { Shield, ShieldAlert, ShieldCheck, Activity, Target, ArrowUpRight, ArrowDownRight, Clock, RefreshCw, BarChart2, CheckCircle, AlertTriangle, GitCommit } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

export const ScoreDashboard = ({ token }: { token: string }) => {
    const [scores, setScores] = useState<any[]>([]);
    const [urlBaseline, setUrlBaseline] = useState<any>(null);
    const [dnsBaseline, setDnsBaseline] = useState<any>(null);
    const [urlDiff, setUrlDiff] = useState<any>(null);
    const [dnsDiff, setDnsDiff] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [expandLatest, setExpandLatest] = useState<Record<string, boolean>>({});
    const [expandGap, setExpandGap] = useState<Record<string, boolean>>({});
    const [timeRange, setTimeRange] = useState<'1h' | '6h' | '24h' | 'all'>('24h');
    const [changesOnly, setChangesOnly] = useState(false);
    const PREVIEW_LIMIT = 5;

    const authHeader = { 'Authorization': `Bearer ${token}` };

    const fetchData = async () => {
        try {
            const res = await fetch('/api/security/scores', { headers: authHeader });
            if (res.ok) {
                const data = await res.json();
                setScores(data);
            }

            const urlBaselineRes = await fetch('/api/security/scores/baseline?type=url', { headers: authHeader });
            if (urlBaselineRes.ok) setUrlBaseline(await urlBaselineRes.json());
            else setUrlBaseline(null);

            const dnsBaselineRes = await fetch('/api/security/scores/baseline?type=dns', { headers: authHeader });
            if (dnsBaselineRes.ok) setDnsBaseline(await dnsBaselineRes.json());
            else setDnsBaseline(null);

        } catch (e) {
            console.error('Failed to fetch score dashboard data', e);
        } finally {
            setLoading(false);
        }
    };

    const fetchDiff = async (type: 'url' | 'dns') => {
        if (!scores.length) return;
        const latest = scores[0];
        const baseline = type === 'url' ? urlBaseline : dnsBaseline;
        if (!baseline || !latest) return;

        try {
            const res = await fetch(`/api/security/scores/diff?type=${type}&from=${baseline.runId}&to=${latest.runId}`, { headers: authHeader });
            if (res.ok) {
                const data = await res.json();
                if (type === 'url') setUrlDiff(data);
                else setDnsDiff(data);
            }
        } catch(e) {}
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000);
        return () => clearInterval(interval);
    }, [token]);

    useEffect(() => {
        if (!loading && urlBaseline) fetchDiff('url');
        if (!loading && dnsBaseline) fetchDiff('dns');
    }, [scores, urlBaseline, dnsBaseline, loading]);

    const handleSetBaseline = async (runId: string, type: 'url' | 'dns') => {
        try {
            await fetch('/api/security/scores/baseline', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeader },
                body: JSON.stringify({ runId, type })
            });
            fetchData();
        } catch (e) {
            console.error('Failed to set baseline', e);
        }
    };

    if (loading && !scores.length) {
        return (
            <div className="flex items-center gap-2 p-4 text-text-muted text-xs">
                <RefreshCw size={14} className="animate-spin" /> Loading Score Dashboard...
            </div>
        );
    }

    const latestUrlScore = scores.find(s => s.type === 'url');
    const latestDnsScore = scores.find(s => s.type === 'dns');

    // Prepare chart data
    const chartData = (() => {
        const chronological = [...scores].reverse();
        const lastDotTs: Record<string, number> = { url: 0, dns: 0 };
        const DOT_WINDOW_MS = 5 * 60 * 1000;

        const cutoff = timeRange === 'all' ? 0
            : timeRange === '1h' ? Date.now() - 60 * 60 * 1000
            : timeRange === '6h' ? Date.now() - 6 * 60 * 60 * 1000
            : Date.now() - 24 * 60 * 60 * 1000;

        const base = chronological
            .filter(s => s.timestamp >= cutoff)
            .map(s => {
                const showDot = s.timestamp - lastDotTs[s.type] >= DOT_WINDOW_MS;
                if (showDot) lastDotTs[s.type] = s.timestamp;
                return {
                    timestamp: s.timestamp,
                    timeLabel: new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    fullTime: new Date(s.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                    urlScore: s.scores?.url ?? null,
                    dnsScore: s.scores?.dns ?? null,
                    runId: s.runId,
                    type: s.type,
                    trigger: s.trigger || 'manual',
                    showDot,
                    deltaUrl: null as number | null,
                    deltaDns: null as number | null,
                };
            });

        if (!changesOnly) return base;

        // Changes-only: keep only transition points.
        // URL and DNS are tracked independently but share the same timeline.
        // Each entry carries the latest known value for BOTH types, so a single
        // change event correctly positions both lines at the right y-value.
        let prevUrl: number | null = null;
        let prevDns: number | null = null;
        const result: typeof base = [];
        for (const pt of base) {
            const urlChanged = pt.urlScore !== null && pt.urlScore !== prevUrl;
            const dnsChanged = pt.dnsScore !== null && pt.dnsScore !== prevDns;
            if (result.length === 0 || urlChanged || dnsChanged) {
                result.push({
                    ...pt,
                    showDot: true,
                    timeLabel: new Date(pt.timestamp).toLocaleString([], {
                        month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                    }),
                    deltaUrl: urlChanged && prevUrl !== null ? Math.round((pt.urlScore! - prevUrl) * 10) / 10 : null,
                    deltaDns: dnsChanged && prevDns !== null ? Math.round((pt.dnsScore! - prevDns) * 10) / 10 : null,
                });
            }
            if (pt.urlScore !== null) prevUrl = pt.urlScore;
            if (pt.dnsScore !== null) prevDns = pt.dnsScore;
        }
        return result;
    })();

    // Dynamic dot radius — max in changesOnly (few points), scaled down for dense histories
    const dotRadius = changesOnly ? 5 : Math.max(2, Math.min(5, Math.round(5 - (chartData.length - 20) * (3 / 130))));

    // Latest Changes: diff between the two most recent runs of each type (client-side, no baseline needed)
    const computeLatestDiff = (type: 'url' | 'dns') => {
        const runs = scores.filter(s => s.type === type); // already newest-first
        if (runs.length < 2) return null;
        const latest = runs[0];
        const prev = runs[1];
        const latestBreakdown: Record<string, any> = latest.breakdown?.[type] || {};
        const prevBreakdown: Record<string, any> = prev.breakdown?.[type] || {};
        const changes: { category: string; before: string; after: string; weight: number }[] = [];
        for (const [cat, snap] of Object.entries(latestBreakdown)) {
            const prevSnap = prevBreakdown[cat];
            if (!prevSnap) continue;
            if (prevSnap.status !== (snap as any).status) {
                changes.push({ category: cat, before: prevSnap.status, after: (snap as any).status, weight: (snap as any).weight });
            }
        }
        return {
            changes,
            prevTime: new Date(prev.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
            latestTime: new Date(latest.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        };
    };

    const urlLatestDiff = computeLatestDiff('url');
    const dnsLatestDiff = computeLatestDiff('dns');

    // Min / max scores over the loaded history window
    const urlScores = scores.filter(s => s.scores?.url != null).map(s => s.scores.url as number);
    const dnsScores = scores.filter(s => s.scores?.dns != null).map(s => s.scores.dns as number);
    const minUrlScore = urlScores.length ? Math.min(...urlScores) : null;
    const maxUrlScore = urlScores.length ? Math.max(...urlScores) : null;
    const minDnsScore = dnsScores.length ? Math.min(...dnsScores) : null;
    const maxDnsScore = dnsScores.length ? Math.max(...dnsScores) : null;

    // Proper category label — capitalise acronyms and title-case the rest
    const formatCategory = (cat: string) =>
        cat.replace(/-/g, ' ')
           .replace(/\b(dns|url|ip|c2|dga|p2p|vpn|ips|edl|nxns|eicar)\b/gi, s => s.toUpperCase())
           .replace(/\b(\w)/g, c => c.toUpperCase());

    // Custom dot: show only on actual run points that pass the 5-min window filter
    // Radius is passed in dynamically so it responds to point density
    const CustomDot = (lineType: 'url' | 'dns', color: string, r: number) => (props: any) => {
        const { cx, cy, payload } = props;
        if (payload.type !== lineType || !payload.showDot) return null;
        return (
            <g>
                <circle cx={cx} cy={cy} r={r} fill={color} stroke="white" strokeWidth={1} opacity={0.9} />
                {payload.trigger === 'scheduled' && (
                    <circle cx={cx} cy={cy} r={r + 3} fill="none" stroke={color} strokeWidth={1} opacity={0.4} />
                )}
            </g>
        );
    };

    // Custom tooltip showing run details (+ delta in changesOnly mode)
    const CustomTooltip = ({ active, payload }: any) => {
        if (!active || !payload?.length) return null;
        const data = payload[0]?.payload;
        return (
            <div style={{ background: 'var(--color-bg-card, #1e1e2e)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '10px 14px', fontSize: '11px' }}>
                <div style={{ fontWeight: 900, letterSpacing: '0.08em', marginBottom: 6, opacity: 0.5, fontSize: 9, textTransform: 'uppercase' }}>
                    {data?.fullTime}
                </div>
                {!changesOnly && (
                    <div style={{ fontWeight: 900, letterSpacing: '0.06em', marginBottom: 6, fontSize: 10, color: data?.type === 'url' ? '#8b5cf6' : '#0ea5e9', textTransform: 'uppercase' }}>
                        {data?.type?.toUpperCase()} Run · {data?.trigger === 'scheduled' ? '🕐 Scheduled' : '▶ Manual'}
                    </div>
                )}
                {payload.map((p: any) => p.value !== null && p.value !== undefined && (
                    <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: p.color, fontWeight: 700 }}>
                        <span>{p.name}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {p.value.toFixed(1)}
                            {changesOnly && (() => {
                                const delta = p.dataKey === 'urlScore' ? data?.deltaUrl : data?.deltaDns;
                                if (delta === null || delta === undefined) return null;
                                const col = delta > 0 ? '#22c55e' : delta < 0 ? '#ef4444' : '#64748b';
                                return <span style={{ fontSize: 9, fontWeight: 900, color: col }}>{delta > 0 ? '+' : ''}{delta}</span>;
                            })()}
                        </span>
                    </div>
                ))}
            </div>
        );
    };

    const renderGauge = (type: 'url' | 'dns', entry: any, baseline: any, minScore: number | null, maxScore: number | null) => {
        if (!entry) return (
            <div className="flex flex-col items-center justify-center p-6 bg-card border border-border rounded-xl">
                <Shield size={24} className="text-text-muted mb-2 opacity-50" />
                <span className="text-xs text-text-muted font-bold tracking-widest uppercase">No {type.toUpperCase()} Data</span>
            </div>
        );

        const score = entry.scores?.[type] ?? 0;
        const color = score >= 90 ? 'text-green-500' : score >= 70 ? 'text-yellow-500' : 'text-red-500';

        return (
            <div className="flex flex-col gap-4 bg-card border border-border p-5 rounded-xl shadow-sm relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none transition-all group-hover:scale-110 group-hover:opacity-10">
                    <Shield size={100} />
                </div>
                
                <div className="flex items-center justify-between z-10">
                    <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                            <div className={`p-1.5 rounded-lg border ${score >= 90 ? 'bg-green-500/10 border-green-500/20 text-green-500' : 'bg-blue-500/10 border-blue-500/20 text-blue-500'}`}>
                                <Activity size={14} />
                            </div>
                            <h3 className="text-[11px] font-black tracking-widest text-text-primary uppercase">{type === 'url' ? 'URL Filter' : 'DNS Security'}</h3>
                        </div>
                        <p className="text-[9px] text-text-muted opacity-60 leading-tight pl-0.5">
                            {type === 'url'
                                ? 'Weighted % of malicious URL categories correctly blocked by firewall'
                                : 'Weighted % of malicious DNS domains correctly blocked or sinkholed'}
                        </p>
                    </div>
                </div>

                <div className="flex items-end gap-3 z-10">
                    <div className={`text-4xl font-black tabular-nums tracking-tighter ${color} drop-shadow-md`}>
                        {score.toFixed(1)} <span className="text-sm font-bold opacity-50 relative -top-3 left-0">/ 100</span>
                    </div>
                    {entry.delta !== null && entry.delta !== undefined && entry.delta !== 0 && (
                        <div className={`flex items-center text-[10px] font-bold pb-1.5 ${entry.delta > 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {entry.delta > 0 ? <ArrowUpRight size={12} className="mr-0.5" /> : <ArrowDownRight size={12} className="mr-0.5" />}
                            {Math.abs(entry.delta)}
                        </div>
                    )}
                </div>

                {/* Min / Max range */}
                {minScore !== null && maxScore !== null && (
                    <div className="flex items-center gap-1.5 text-[9px] font-bold text-text-muted z-10 -mt-2">
                        <span className="text-red-400 opacity-70">MIN {minScore.toFixed(1)}</span>
                        <span className="opacity-30">↔</span>
                        <span className="text-green-400 opacity-70">MAX {maxScore.toFixed(1)}</span>
                        <span className="opacity-30 ml-1">over loaded history</span>
                    </div>
                )}

                <div className="flex flex-col gap-2 z-10">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 group/baseline relative">
                            <span className="text-[10px] text-text-muted font-bold tracking-widest">BASELINE:</span>
                            <span className="text-text-muted opacity-40 cursor-help text-[9px]" title="Pin a reference run taken when your policy is in a known-good state. The Gap Alerts section will highlight any category that regressed since that snapshot — useful for detecting accidental rule changes.">ⓘ</span>
                        </div>
                        {baseline ? (
                            <span className="text-[10px] font-black tabular-nums text-text-primary">
                                {baseline.scores[type]} <span className="text-text-muted font-normal">({new Date(baseline.timestamp).toLocaleDateString()})</span>
                            </span>
                        ) : (
                            <span className="text-[10px] font-bold text-yellow-500">Not Set</span>
                        )}
                    </div>
                    
                    <button 
                        onClick={() => handleSetBaseline(entry.runId, type)}
                        className={`text-[9px] font-black tracking-widest w-full py-1.5 rounded-md border transition-all ${
                            entry.isBaseline ? 'bg-blue-500/10 border-blue-500/20 text-blue-500 cursor-default' : 'bg-card hover:bg-hover border-border text-text-muted hover:text-text-primary'
                        }`}
                        disabled={entry.isBaseline}
                    >
                        {entry.isBaseline ? 'CURRENT BASELINE' : 'SET AS BASELINE'}
                    </button>
                </div>
            </div>
        );
    };

    const renderGapAlerts = (diff: any, title: string) => {
        if (!diff) return null;
        const { regressions, improvements, scoreDelta } = diff;
        if (regressions.length === 0 && improvements.length === 0) return null;

        const key = title;
        const expanded = expandGap[key];
        const sortedReg = [...regressions].sort((a, b) => b.weight - a.weight);
        const sortedImp = [...improvements].sort((a, b) => b.weight - a.weight);
        const visibleReg = expanded ? sortedReg : sortedReg.slice(0, PREVIEW_LIMIT);
        const visibleImp = expanded ? sortedImp : sortedImp.slice(0, PREVIEW_LIMIT);
        const totalHidden = (sortedReg.length + sortedImp.length) - (visibleReg.length + visibleImp.length);

        return (
            <div className="mt-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between mb-3">
                    <h5 className="text-[10px] font-black tracking-widest text-text-muted flex items-center gap-1.5">
                        <BarChart2 size={11} /> BASELINE GAP ANALYSIS
                    </h5>
                    <div className="flex items-center gap-1.5">
                        {sortedReg.length > 0 && <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-red-500/10 border border-red-500/20 text-red-500">{sortedReg.length} ↓</span>}
                        {sortedImp.length > 0 && <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-green-500/10 border border-green-500/20 text-green-500">{sortedImp.length} ↑</span>}
                        {scoreDelta !== undefined && scoreDelta !== null && (
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-black border ${
                                scoreDelta < 0 ? 'bg-red-500/10 border-red-500/20 text-red-500' : 'bg-green-500/10 border-green-500/20 text-green-500'
                            }`}>{scoreDelta > 0 ? '+' : ''}{scoreDelta.toFixed(1)}</span>
                        )}
                    </div>
                </div>

                {sortedReg.length > 0 && (
                    <div className="mb-2">
                        <div className="flex items-center gap-1 text-[9px] font-black text-red-500 mb-1.5 tracking-widest">
                            <ShieldAlert size={10} /> POLICY REGRESSIONS
                        </div>
                        <div className="flex flex-col gap-1">
                            {visibleReg.map((r: any, idx: number) => (
                                <div key={idx} className="flex items-center justify-between text-xs p-2 bg-background rounded-lg border border-red-500/20">
                                    <span className="font-semibold text-text-primary">{formatCategory(r.category)}</span>
                                    <div className="flex items-center gap-1.5 text-[10px] font-black">
                                        <span className="text-[9px] text-text-muted font-bold">w:{r.weight}</span>
                                        <span className="text-green-500 line-through opacity-70">{r.before}</span>
                                        <span className="text-text-muted opacity-40">→</span>
                                        <span className="text-red-500">{r.after}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {sortedImp.length > 0 && (
                    <div>
                        <div className="flex items-center gap-1 text-[9px] font-black text-green-500 mb-1.5 tracking-widest">
                            <ShieldCheck size={10} /> POLICY IMPROVEMENTS
                        </div>
                        <div className="flex flex-col gap-1">
                            {visibleImp.map((r: any, idx: number) => (
                                <div key={idx} className="flex items-center justify-between text-xs p-2 bg-background rounded-lg border border-green-500/20">
                                    <span className="font-semibold text-text-primary">{formatCategory(r.category)}</span>
                                    <div className="flex items-center gap-1.5 text-[10px] font-black">
                                        <span className="text-[9px] text-text-muted font-bold">w:{r.weight}</span>
                                        <span className="text-red-400 line-through opacity-70">{r.before}</span>
                                        <span className="text-text-muted opacity-40">→</span>
                                        <span className="text-green-500">{r.after}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {totalHidden > 0 && (
                    <button onClick={() => setExpandGap(p => ({ ...p, [key]: true }))} className="mt-2 w-full text-[10px] font-black tracking-widest text-text-muted hover:text-text-primary py-1.5 border border-border rounded-lg hover:bg-hover transition-all">
                        + {totalHidden} more (sorted by weight)
                    </button>
                )}
                {expanded && (sortedReg.length + sortedImp.length) > PREVIEW_LIMIT && (
                    <button onClick={() => setExpandGap(p => ({ ...p, [key]: false }))} className="mt-1 w-full text-[10px] font-black tracking-widest text-text-muted hover:text-text-primary py-1 transition-all">
                        ↑ collapse
                    </button>
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-col gap-6 w-full animate-fade-in mb-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <h2 className="text-xl font-black text-text-primary tracking-tight">Security Posture Score</h2>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-4 items-start">
                {/* Gauges — left column, sticky so they stay top-aligned */}
                <div className="flex flex-col gap-4 w-full lg:w-80 shrink-0 lg:sticky lg:top-4">
                    {renderGauge('url', latestUrlScore, urlBaseline, minUrlScore, maxUrlScore)}
                    {renderGauge('dns', latestDnsScore, dnsBaseline, minDnsScore, maxDnsScore)}
                </div>

                {/* Charts & Gaps — right column, grows freely */}
                <div className="flex flex-col gap-4 flex-1 min-w-0">
                    <div className="h-56 bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-black tracking-widest text-text-muted uppercase flex items-center gap-1.5">
                                <Activity size={12} /> Score Trend
                            </span>
                            <div className="flex items-center gap-2">
                                {/* Time range selector */}
                                <div className="flex items-center gap-0.5 bg-background rounded-lg p-0.5 border border-border">
                                    {(['1h', '6h', '24h', 'all'] as const).map(r => (
                                        <button
                                            key={r}
                                            onClick={() => setTimeRange(r)}
                                            className={`text-[9px] font-black tracking-widest px-2 py-0.5 rounded-md transition-all ${
                                                timeRange === r
                                                    ? 'bg-card text-text-primary shadow-sm'
                                                    : 'text-text-muted hover:text-text-primary'
                                            }`}
                                        >
                                            {r === 'all' ? 'ALL' : r.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                                {/* Changes-only toggle */}
                                <button
                                    onClick={() => setChangesOnly(v => !v)}
                                    title="Show only score change events"
                                    className={`flex items-center gap-1 text-[9px] font-black tracking-widest px-2 py-0.5 rounded-md border transition-all ${
                                        changesOnly
                                            ? 'bg-violet-500/20 border-violet-500/40 text-violet-400'
                                            : 'bg-background border-border text-text-muted hover:text-text-primary'
                                    }`}
                                >
                                    <GitCommit size={9} /> Δ CHG
                                </button>
                                <div className="flex items-center gap-3 text-[9px] font-black tracking-widest text-text-muted opacity-60">
                                    <span className="flex items-center gap-1"><span style={{display:'inline-block',width:8,height:8,borderRadius:'50%',background:'#8b5cf6'}}/> URL</span>
                                    <span className="flex items-center gap-1"><span style={{display:'inline-block',width:8,height:8,borderRadius:'50%',background:'#0ea5e9'}}/> DNS</span>
                                    {!changesOnly && <span className="flex items-center gap-1"><span style={{display:'inline-block',width:8,height:8,borderRadius:'50%',border:'1.5px solid #aaa',background:'transparent'}}/> Scheduled</span>}
                                </div>
                            </div>
                        </div>
                        <div className="flex-1 min-h-0">
                            {chartData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={chartData} margin={{ top: 8, right: 5, left: -20, bottom: 0 }}>
                                        <XAxis dataKey="timeLabel" tick={{ fontSize: 9, fill: 'currentColor', opacity: 0.5 }} tickLine={false} axisLine={false} />
                                        <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: 'currentColor', opacity: 0.5 }} tickLine={false} axisLine={false} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Line type="monotone" dataKey="urlScore" name="URL Score" stroke="#8b5cf6" strokeWidth={2} dot={CustomDot('url', '#8b5cf6', dotRadius)} activeDot={{ r: dotRadius + 1 }} isAnimationActive={false} />
                                        <Line type="monotone" dataKey="dnsScore" name="DNS Score" stroke="#0ea5e9" strokeWidth={2} dot={CustomDot('dns', '#0ea5e9', dotRadius)} activeDot={{ r: dotRadius + 1 }} isAnimationActive={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="h-full flex items-center justify-center text-xs text-text-muted font-black tracking-widest opacity-50">NO HISTORY DATA</div>
                            )}
                        </div>
                    </div>

                    {/* Latest Changes + embedded Gap Analysis — one card per type */}
                    <div className="flex flex-col gap-3">
                        {(['url', 'dns'] as const).map(type => {
                            const diff = type === 'url' ? urlLatestDiff : dnsLatestDiff;
                            const gapDiff = type === 'url' ? urlDiff : dnsDiff;
                            const color = type === 'url' ? '#8b5cf6' : '#0ea5e9';

                            const hasChanges = diff && diff.changes.length > 0;
                            const hasGap = gapDiff && (gapDiff.regressions?.length > 0 || gapDiff.improvements?.length > 0);

                            // Skip entire card if nothing to show
                            if (!hasChanges && !hasGap) return null;

                            const allChanges = hasChanges ? [...diff.changes].sort((a, b) => b.weight - a.weight) : [];
                            const regressions = allChanges.filter(c => (c.before === 'blocked' || c.before === 'sinkholed') && c.after !== 'blocked' && c.after !== 'sinkholed');
                            const improvements = allChanges.filter(c => (c.after === 'blocked' || c.after === 'sinkholed') && c.before !== 'blocked' && c.before !== 'sinkholed');
                            const neutral = allChanges.filter(c => !regressions.includes(c) && !improvements.includes(c));
                            const sorted = [...regressions, ...improvements, ...neutral];

                            const expanded = expandLatest[type];
                            const visible = expanded ? sorted : sorted.slice(0, PREVIEW_LIMIT);
                            const hiddenCount = sorted.length - visible.length;

                            return (
                                <div key={type} className="p-4 bg-card border border-border rounded-xl">
                                    {/* Header */}
                                    <div className="flex items-center justify-between mb-3">
                                        <h4 className="text-[10px] font-black tracking-widest text-text-muted flex items-center gap-1.5">
                                            <Activity size={12} style={{color}} />
                                            <span style={{color}}>{type.toUpperCase()}</span> LATEST CHANGES
                                        </h4>
                                        <div className="flex items-center gap-2">
                                            {regressions.length > 0 && <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-red-500/10 border border-red-500/20 text-red-500">{regressions.length} ↓ GAP</span>}
                                            {improvements.length > 0 && <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-green-500/10 border border-green-500/20 text-green-500">{improvements.length} ↑ FIXED</span>}
                                            {neutral.length > 0 && <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-card border border-border text-text-muted">{neutral.length} CHG</span>}
                                            {diff && <span className="text-[9px] opacity-40">{diff.prevTime} → {diff.latestTime}</span>}
                                        </div>
                                    </div>

                                    {/* Changes list */}
                                    {hasChanges ? (
                                        <div className="flex flex-col gap-1.5">
                                            {visible.map((c, idx) => {
                                                const isReg = regressions.includes(c);
                                                const isImp = improvements.includes(c);
                                                return (
                                                    <div key={idx} className={`flex items-center justify-between text-xs p-2 rounded-lg border ${
                                                        isReg ? 'bg-red-500/5 border-red-500/20' : isImp ? 'bg-green-500/5 border-green-500/20' : 'bg-card border-border'
                                                    }`}>
                                                        <span className="font-semibold text-text-primary">{formatCategory(c.category)}</span>
                                                        <div className="flex items-center gap-1.5 text-[10px] font-black">
                                                            <span className={c.before === 'blocked' || c.before === 'sinkholed' ? 'text-green-500' : 'text-red-400'}>{c.before}</span>
                                                            <span className="text-text-muted opacity-40">→</span>
                                                            <span className={c.after === 'blocked' || c.after === 'sinkholed' ? 'text-green-500' : 'text-red-400'}>{c.after}</span>
                                                            <span className={`ml-1 px-1 py-0.5 rounded text-[8px] font-black tracking-widest border ${
                                                                isReg ? 'text-red-500 bg-red-500/10 border-red-500/20' : isImp ? 'text-green-500 bg-green-500/10 border-green-500/20' : 'text-text-muted border-border'
                                                            }`}>{isReg ? '↓ GAP' : isImp ? '↑ FIXED' : 'CHG'}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                            {hiddenCount > 0 && (
                                                <button onClick={() => setExpandLatest(p => ({ ...p, [type]: true }))} className="mt-1 w-full text-[10px] font-black tracking-widest text-text-muted hover:text-text-primary py-1.5 border border-border rounded-lg hover:bg-hover transition-all">
                                                    + {hiddenCount} more (sorted by weight)
                                                </button>
                                            )}
                                            {expanded && sorted.length > PREVIEW_LIMIT && (
                                                <button onClick={() => setExpandLatest(p => ({ ...p, [type]: false }))} className="mt-1 w-full text-[10px] font-black tracking-widest text-text-muted hover:text-text-primary py-1 transition-all">
                                                    ↑ collapse
                                                </button>
                                            )}
                                        </div>
                                    ) : (
                                        !hasGap && <div className="flex items-center gap-1.5 text-[10px] text-text-muted opacity-60"><CheckCircle size={11} /> No changes between last 2 runs</div>
                                    )}

                                    {/* Baseline Gap Analysis — embedded below, separated by a divider */}
                                    {renderGapAlerts(gapDiff, type.toUpperCase())}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};
