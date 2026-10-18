import React, { useState } from 'react';
import { RefreshCw, Activity, GitCommit, Shield, ArrowUpRight, ArrowDownRight, Trash2, Clock, Pin } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export interface ScoreDashboardProps {
    scores: any[];
    loading: boolean;
    urlBaseline: any;
    dnsBaseline: any;
    threatBaseline: any;
    handleSetBaseline: (runId: string, type: 'url' | 'dns' | 'threat') => void;
    statistics?: {
        total_tests_run: number;
        url_tests_blocked: number;
        url_tests_allowed: number;
        dns_tests_blocked: number;
        dns_tests_sinkholed?: number;
        dns_tests_allowed?: number;
        threat_tests_blocked: number;
        threat_tests_allowed: number;
        last_test_time: number | string | null;
    };
    onResetCounters?: () => void;
    activeSection?: string;
    onSelectSection?: (section: 'url' | 'dns' | 'threat') => void;
}

export const ScoreDashboard = ({
    scores,
    loading,
    urlBaseline,
    dnsBaseline,
    threatBaseline,
    handleSetBaseline,
    statistics,
    onResetCounters,
    activeSection,
    onSelectSection,
}: ScoreDashboardProps) => {
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

    const formatCount = (n: number | undefined | null): string => {
        if (n === null || n === undefined) return '0';
        if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        return n.toLocaleString();
    };

    const renderCounters = (type: 'url' | 'dns' | 'threat') => {
        if (!statistics) return null;
        if (type === 'url') {
            return (
                <div className="flex flex-col items-end">
                    <span className="text-[7.5px] font-black tracking-widest text-text-muted/60 uppercase mb-0.5" title="Resets daily at 00:00 — raw test history preserved">Today</span>
                    <div className="flex items-center gap-3 bg-background/60 border border-border/60 rounded-lg px-2.5 py-1.5">
                        <div className="text-right">
                            <div className="text-sm font-black text-red-500 tabular-nums leading-none" title={`${statistics.url_tests_blocked?.toLocaleString() ?? 0} blocked`}>
                                {formatCount(statistics.url_tests_blocked)}
                            </div>
                            <div className="text-[8px] font-black text-text-muted uppercase tracking-wider opacity-60 mt-0.5">Blocked</div>
                        </div>
                        <div className="w-px h-5 bg-border/60" />
                        <div className="text-right">
                            <div className="text-sm font-black text-green-500 tabular-nums leading-none" title={`${statistics.url_tests_allowed?.toLocaleString() ?? 0} allowed`}>
                                {formatCount(statistics.url_tests_allowed)}
                            </div>
                            <div className="text-[8px] font-black text-text-muted uppercase tracking-wider opacity-60 mt-0.5">Allowed</div>
                        </div>
                    </div>
                </div>
            );
        }
        if (type === 'dns') {
            return (
                <div className="flex flex-col items-end">
                    <span className="text-[7.5px] font-black tracking-widest text-text-muted/60 uppercase mb-0.5" title="Resets daily at 00:00 — raw test history preserved">Today</span>
                    <div className="flex items-center gap-2.5 bg-background/60 border border-border/60 rounded-lg px-2.5 py-1.5">
                        <div className="text-right">
                            <div className="text-sm font-black text-orange-500 tabular-nums leading-none" title={`${statistics.dns_tests_blocked?.toLocaleString() ?? 0} blocked`}>
                                {formatCount(statistics.dns_tests_blocked)}
                            </div>
                            <div className="text-[8px] font-black text-text-muted uppercase tracking-wider opacity-60 mt-0.5">Blocked</div>
                        </div>
                        <div className="w-px h-5 bg-border/60" />
                        <div className="text-right">
                            <div className="text-sm font-black text-yellow-500 tabular-nums leading-none" title={`${(statistics.dns_tests_sinkholed || 0)?.toLocaleString()} sinkholed`}>
                                {formatCount(statistics.dns_tests_sinkholed || 0)}
                            </div>
                            <div className="text-[8px] font-black text-text-muted uppercase tracking-wider opacity-60 mt-0.5">Sinkhole</div>
                        </div>
                        <div className="w-px h-5 bg-border/60" />
                        <div className="text-right">
                            <div className="text-sm font-black text-green-500 tabular-nums leading-none" title={`${(statistics.dns_tests_allowed || 0)?.toLocaleString()} allowed`}>
                                {formatCount(statistics.dns_tests_allowed || 0)}
                            </div>
                            <div className="text-[8px] font-black text-text-muted uppercase tracking-wider opacity-60 mt-0.5">Allowed</div>
                        </div>
                    </div>
                </div>
            );
        }
        return (
            <div className="flex flex-col items-end">
                <span className="text-[7.5px] font-black tracking-widest text-text-muted/60 uppercase mb-0.5" title="Resets daily at 00:00 — raw test history preserved">Today</span>
                <div className="flex items-center gap-3 bg-background/60 border border-border/60 rounded-lg px-2.5 py-1.5">
                    <div className="text-right">
                        <div className="text-sm font-black text-purple-500 tabular-nums leading-none" title={`${statistics.threat_tests_blocked?.toLocaleString() ?? 0} blocked`}>
                            {formatCount(statistics.threat_tests_blocked)}
                        </div>
                        <div className="text-[8px] font-black text-text-muted uppercase tracking-wider opacity-60 mt-0.5">Blocked</div>
                    </div>
                    <div className="w-px h-5 bg-border/60" />
                    <div className="text-right">
                        <div className="text-sm font-black text-green-500 tabular-nums leading-none" title={`${statistics.threat_tests_allowed?.toLocaleString() ?? 0} allowed`}>
                            {formatCount(statistics.threat_tests_allowed)}
                        </div>
                        <div className="text-[8px] font-black text-text-muted uppercase tracking-wider opacity-60 mt-0.5">Allowed</div>
                    </div>
                </div>
            </div>
        );
    };

    const renderGauge = (type: 'url' | 'dns' | 'threat', entry: any, baseline: any, minScore: number | null, maxScore: number | null) => {
        const isSelected = activeSection === type;
        const title = type === 'url' ? 'URL Filter' : type === 'dns' ? 'DNS Security' : 'Threat Prevention';
        const description = type === 'url'
            ? 'Weighted % of malicious URL categories correctly blocked by firewall'
            : type === 'dns'
                ? 'Weighted % of malicious DNS domains correctly blocked or sinkholed'
                : 'Weighted % of EICAR files correctly blocked across all targets';

        if (!entry) return (
            <div
                onClick={() => onSelectSection?.(type)}
                className={`flex flex-col justify-between gap-3 p-4 bg-card border rounded-xl transition-all ${
                    onSelectSection ? 'cursor-pointer hover:border-blue-500/40' : ''
                } ${isSelected ? 'border-blue-500 ring-1 ring-blue-500/20' : 'border-border'}`}
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Shield size={16} className="text-text-muted opacity-50" />
                        <span className="text-[11px] text-text-primary font-black tracking-widest uppercase">{title}</span>
                    </div>
                    {renderCounters(type)}
                </div>
                <div className="text-xs text-text-muted font-bold tracking-widest uppercase opacity-50 py-2">No Score History Yet</div>
            </div>
        );

        const score = entry.scores?.[type] ?? 0;
        const color = score >= 90 ? 'text-green-500' : score >= 70 ? 'text-yellow-500' : 'text-red-500';

        return (
            <div
                onClick={() => onSelectSection?.(type)}
                className={`flex flex-col justify-between gap-3 bg-card border p-4 rounded-xl shadow-sm relative overflow-hidden group transition-all ${
                    onSelectSection ? 'cursor-pointer hover:border-blue-500/40 hover:shadow-md' : ''
                } ${isSelected ? 'border-blue-500 ring-1 ring-blue-500/25' : 'border-border'}`}
            >
                <div className="absolute top-0 right-0 p-3 opacity-5 pointer-events-none transition-all group-hover:scale-110 group-hover:opacity-10">
                    <Shield size={84} />
                </div>

                {/* Top Row: Title + Info Tooltip */}
                <div className="flex items-center justify-between z-10">
                    <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-lg border ${score >= 90 ? 'bg-green-500/10 border-green-500/20 text-green-500' : 'bg-blue-500/10 border-blue-500/20 text-blue-500'}`}>
                            <Activity size={13} />
                        </div>
                        <h3 className="text-[11px] font-black tracking-widest text-text-primary uppercase">{title}</h3>
                        <span
                            className="text-text-muted opacity-40 hover:opacity-80 cursor-help text-[10px]"
                            title={description}
                            onClick={(e) => e.stopPropagation()}
                        >
                            ⓘ
                        </span>
                    </div>
                    {isSelected && (
                        <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            Filtered
                        </span>
                    )}
                </div>

                {/* Middle Row: Score on Left, Live Counters on Right */}
                <div className="flex items-center justify-between gap-2 z-10 my-0.5">
                    <div className="flex items-end gap-2">
                        <div className={`text-3xl font-black tabular-nums tracking-tighter ${color} drop-shadow-sm leading-none`}>
                            {score.toFixed(1)} <span className="text-xs font-bold opacity-50">/ 100</span>
                        </div>
                        {entry.delta !== null && entry.delta !== undefined && entry.delta !== 0 && (
                            <div className={`flex items-center text-[10px] font-bold pb-0.5 ${entry.delta > 0 ? 'text-green-500' : 'text-red-500'}`}>
                                {entry.delta > 0 ? <ArrowUpRight size={12} className="mr-0.5" /> : <ArrowDownRight size={12} className="mr-0.5" />}
                                {Math.abs(entry.delta)}
                            </div>
                        )}
                    </div>
                    {renderCounters(type)}
                </div>

                {/* Compact Footer Row: Min/Max on Left, Baseline Action on Right */}
                <div className="flex items-center justify-between pt-2.5 border-t border-border/50 z-10 text-[9px] font-bold">
                    {minScore !== null && maxScore !== null ? (
                        <div className="flex items-center gap-1 text-text-muted">
                            <span className="text-red-400/80">MIN {minScore.toFixed(1)}</span>
                            <span className="opacity-30">↔</span>
                            <span className="text-green-400/80">MAX {maxScore.toFixed(1)}</span>
                        </div>
                    ) : (
                        <span className="text-text-muted opacity-40">—</span>
                    )}

                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {baseline && !entry.isBaseline && (
                            <span
                                className="text-text-muted opacity-75 tabular-nums"
                                title={`Baseline set on ${new Date(baseline.timestamp).toLocaleDateString()}`}
                            >
                                Base: <strong className="text-text-primary">{baseline.scores[type]}</strong>
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={() => handleSetBaseline(entry.runId, type)}
                            disabled={entry.isBaseline}
                            title={
                                entry.isBaseline
                                    ? `Current run is pinned as baseline (${new Date(entry.timestamp).toLocaleDateString()})`
                                    : 'Pin this run as reference baseline to detect policy regressions'
                            }
                            className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[9px] font-black tracking-wider uppercase transition-all ${
                                entry.isBaseline
                                    ? 'bg-blue-500/10 border-blue-500/25 text-blue-400 cursor-default'
                                    : 'bg-card-secondary hover:bg-hover border-border text-text-muted hover:text-text-primary cursor-pointer'
                            }`}
                        >
                            <Pin size={9} className={entry.isBaseline ? 'fill-current' : ''} />
                            {entry.isBaseline ? `Baseline (${baseline?.scores?.[type] ?? score.toFixed(1)})` : baseline ? 'Update' : 'Set Baseline'}
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col gap-4 w-full animate-fade-in mb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                    <h2 className="text-lg font-black text-text-primary tracking-tight">Security Posture & Efficacy</h2>
                    {onSelectSection && (
                        <span className="text-[10px] text-text-muted font-medium hidden sm:inline">
                            · Click a card to filter section
                        </span>
                    )}
                </div>
                {statistics && (
                    <div className="flex items-center gap-3 text-[11px]">
                        <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-2.5 py-1 text-text-muted font-bold">
                            <span>Total Tests: <strong className="text-text-primary tabular-nums">{statistics.total_tests_run}</strong></span>
                            <span className="opacity-30">·</span>
                            <span className="flex items-center gap-1 text-[10px]">
                                <Clock size={11} className="opacity-60" />
                                {statistics.last_test_time ? new Date(statistics.last_test_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never'}
                            </span>
                        </div>
                        {onResetCounters && (
                            <button
                                type="button"
                                onClick={onResetCounters}
                                title="Reset Blocked/Allowed counters"
                                className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-black tracking-wider uppercase text-red-500 hover:bg-red-500/10 border border-red-500/20 rounded-lg transition-all cursor-pointer"
                            >
                                <Trash2 size={12} />
                                Reset Counters
                            </button>
                        )}
                    </div>
                )}
            </div>

            <div className="flex flex-col gap-4 w-full">
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
