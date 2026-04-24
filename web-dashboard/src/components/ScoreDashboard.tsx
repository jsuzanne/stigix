import React, { useState } from 'react';
import { RefreshCw, Activity, GitCommit, Shield, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export interface ScoreDashboardProps {
    scores: any[];
    loading: boolean;
    urlBaseline: any;
    dnsBaseline: any;
    threatBaseline: any;
    handleSetBaseline: (runId: string, type: 'url' | 'dns' | 'threat') => void;
}

export const ScoreDashboard = ({ scores, loading, urlBaseline, dnsBaseline, threatBaseline, handleSetBaseline }: ScoreDashboardProps) => {
    const [timeRange, setTimeRange] = useState<'1h' | '6h' | '24h' | 'all'>('24h');
    const [changesOnly, setChangesOnly] = useState(false);

    if (loading && !scores.length) {
        return (
            <div className="flex items-center gap-2 p-4 text-text-muted text-xs">
                <RefreshCw size={14} className="animate-spin" /> Loading Score Dashboard...
            </div>
        );
    }

    const latestUrlScore = scores.find(s => s.type === 'url');
    const latestDnsScore = scores.find(s => s.type === 'dns');
    const latestThreatScore = scores.find(s => s.type === 'threat');

    // Prepare chart data
    const chartData = (() => {
        const chronological = [...scores].reverse();
        const lastDotTs: Record<string, number> = { url: 0, dns: 0, threat: 0 };
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
                    threatScore: s.scores?.threat ?? null,
                    runId: s.runId,
                    type: s.type,
                    trigger: s.trigger || 'manual',
                    showDot,
                    deltaUrl: null as number | null,
                    deltaDns: null as number | null,
                    deltaThreat: null as number | null,
                };
            });

        if (!changesOnly) return base;

        // Changes-only: keep only transition points.
        // URL and DNS are tracked independently but share the same timeline.
        // Each entry carries the latest known value for BOTH types, so a single
        // change event correctly positions both lines at the right y-value.
        let prevUrl: number | null = null;
        let prevDns: number | null = null;
        let prevThreat: number | null = null;
        const result: typeof base = [];
        for (const pt of base) {
            const urlChanged = pt.urlScore !== null && pt.urlScore !== prevUrl;
            const dnsChanged = pt.dnsScore !== null && pt.dnsScore !== prevDns;
            const threatChanged = pt.threatScore !== null && pt.threatScore !== prevThreat;
            if (result.length === 0 || urlChanged || dnsChanged || threatChanged) {
                result.push({
                    ...pt,
                    showDot: true,
                    timeLabel: new Date(pt.timestamp).toLocaleString([], {
                        month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                    }),
                    deltaUrl: urlChanged && prevUrl !== null ? Math.round((pt.urlScore! - prevUrl) * 10) / 10 : null,
                    deltaDns: dnsChanged && prevDns !== null ? Math.round((pt.dnsScore! - prevDns) * 10) / 10 : null,
                    deltaThreat: threatChanged && prevThreat !== null ? Math.round((pt.threatScore! - prevThreat) * 10) / 10 : null,
                });
            }
            if (pt.urlScore !== null) prevUrl = pt.urlScore;
            if (pt.dnsScore !== null) prevDns = pt.dnsScore;
            if (pt.threatScore !== null) prevThreat = pt.threatScore;
        }
        return result;
    })();

    // Dynamic dot radius — max in changesOnly (few points), scaled down for dense histories
    const dotRadius = changesOnly ? 5 : Math.max(2, Math.min(5, Math.round(5 - (chartData.length - 20) * (3 / 130))));

    // Min / max scores over the loaded history window
    const urlScores = scores.filter(s => s.scores?.url != null).map(s => s.scores.url as number);
    const dnsScores = scores.filter(s => s.scores?.dns != null).map(s => s.scores.dns as number);
    const threatScores = scores.filter(s => s.scores?.threat != null).map(s => s.scores.threat as number);
    const minUrlScore = urlScores.length ? Math.min(...urlScores) : null;
    const maxUrlScore = urlScores.length ? Math.max(...urlScores) : null;
    const minDnsScore = dnsScores.length ? Math.min(...dnsScores) : null;
    const maxDnsScore = dnsScores.length ? Math.max(...dnsScores) : null;
    const minThreatScore = threatScores.length ? Math.min(...threatScores) : null;
    const maxThreatScore = threatScores.length ? Math.max(...threatScores) : null;

    // Custom dot: show only on actual run points that pass the 5-min window filter
    // Radius is passed in dynamically so it responds to point density
    const CustomDot = (lineType: 'url' | 'dns' | 'threat', color: string, r: number) => (props: any) => {
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
                    <div style={{ fontWeight: 900, letterSpacing: '0.06em', marginBottom: 6, fontSize: 10, color: data?.type === 'url' ? '#8b5cf6' : data?.type === 'dns' ? '#0ea5e9' : '#ef4444', textTransform: 'uppercase' }}>
                        {data?.type?.toUpperCase()} Run · {data?.trigger === 'scheduled' ? '🕐 Scheduled' : '▶ Manual'}
                    </div>
                )}
                {payload.map((p: any) => p.value !== null && p.value !== undefined && (
                    <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: p.color, fontWeight: 700 }}>
                        <span>{p.name}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {p.value.toFixed(1)}
                            {changesOnly && (() => {
                                const delta = p.dataKey === 'urlScore' ? data?.deltaUrl : p.dataKey === 'dnsScore' ? data?.deltaDns : data?.deltaThreat;
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

    const renderGauge = (type: 'url' | 'dns' | 'threat', entry: any, baseline: any, minScore: number | null, maxScore: number | null) => {
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
                            <h3 className="text-[11px] font-black tracking-widest text-text-primary uppercase">{type === 'url' ? 'URL Filter' : type === 'dns' ? 'DNS Security' : 'Threat Prevention'}</h3>
                        </div>
                        <p className="text-[9px] text-text-muted opacity-60 leading-tight pl-0.5">
                            {type === 'url'
                                ? 'Weighted % of malicious URL categories correctly blocked by firewall'
                                : type === 'dns'
                                    ? 'Weighted % of malicious DNS domains correctly blocked or sinkholed'
                                    : 'Weighted % of EICAR files correctly blocked across all targets'}
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

    return (
        <div className="flex flex-col gap-6 w-full animate-fade-in mb-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <h2 className="text-xl font-black text-text-primary tracking-tight">Security Posture Score</h2>
                </div>
            </div>

            <div className="flex flex-col gap-6 w-full">
                {/* Gauges — Top row, horizontal */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
                    {renderGauge('url', latestUrlScore, urlBaseline, minUrlScore, maxUrlScore)}
                    {renderGauge('dns', latestDnsScore, dnsBaseline, minDnsScore, maxDnsScore)}
                    {renderGauge('threat', latestThreatScore, threatBaseline, minThreatScore, maxThreatScore)}
                </div>

                {/* Chart and Details */}
                <div className="flex flex-col gap-4 w-full">
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
                                    <span className="flex items-center gap-1"><span style={{display:'inline-block',width:8,height:8,borderRadius:'50%',background:'#ef4444'}}/> Threat</span>
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
                                        <Line type="monotone" dataKey="threatScore" name="Threat Score" stroke="#ef4444" strokeWidth={2} dot={CustomDot('threat', '#ef4444', dotRadius)} activeDot={{ r: dotRadius + 1 }} isAnimationActive={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="h-full flex items-center justify-center text-xs text-text-muted font-black tracking-widest opacity-50">NO HISTORY DATA</div>
                            )}
                        </div>
                    </div>


                </div>
            </div>
        </div>
    );
};
