import React, { useState, useEffect, useRef } from 'react';
import { usePeerContext } from './PeerContext';
import { Gauge, Activity, Clock, Filter, Download, Zap, Shield, Search, ChevronRight, BarChart3, AlertCircle, Info, ChevronUp, ChevronDown, Flame, Plus, XCircle, CheckCircle, RefreshCw, Globe, Play, Pause, Square, TrendingUp, Pencil, Route, Grid, Trash2, Copy, Terminal, Check } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, ResponsiveContainer, AreaChart, Area, ReferenceLine, ReferenceArea } from 'recharts';
import { twMerge } from 'tailwind-merge';
import { TracerouteModal } from './components/TracerouteModal';
import { ReachabilityMatrix } from './components/ReachabilityMatrix';
import { DEMSkeleton } from './components/skeletons/DEMSkeleton';
import { ProbeScoreCard, InteractiveScoreBadge } from './components/health/ProbeScoreExplainer';
import { StigixSelect } from './components/common/StigixSelect';

// ── Inline SVG sparkline (no recharts dependency) ───────────────────────────
const Sparkline = ({ data, color, width = 80, height = 20 }: { data: number[]; color: string; width?: number; height?: number }) => {
    if (!data || data.length < 2) {
        return <svg width={width} height={height}><line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={color} strokeWidth={1.5} strokeOpacity={0.4} strokeDasharray="3 2" /></svg>;
    }
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const pts = data.map((v, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - ((v - min) / range) * (height - 2) - 1;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return (
        <svg width={width} height={height} style={{ overflow: 'visible' }}>
            <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
    );
};

// ── Tiny donut ring (SVG arc) ────────────────────────────────────────────────
const DonutRing = ({ pct, size = 34 }: { pct: number; size?: number }) => {
    const color = pct >= 95 ? '#22c55e' : pct >= 80 ? '#f97316' : '#ef4444';
    const stroke = 2.5;
    const r = (size - stroke) / 2;
    const circ = 2 * Math.PI * r;
    const dash = (pct / 100) * circ;
    const cx = size / 2;
    const cy = size / 2;
    return (
        <svg width={size} height={size}>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeOpacity={0.15} strokeWidth={stroke} />
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={stroke}
                strokeDasharray={`${dash.toFixed(2)} ${circ.toFixed(2)}`} strokeLinecap="round"
                transform={`rotate(-90 ${cx} ${cy})`} />
            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
                fontSize={size <= 36 ? 7 : 9} fontWeight="800" fill={color}>
                {pct}%
            </text>
        </svg>
    );
};

// ── Circular Score Gauge for Global Experience ────────────────────────────
const GlobalExperienceGauge = ({ score, isPaused = false, hasData = true }: { score: number; isPaused?: boolean; hasData?: boolean }) => {
    const showStandby = isPaused && !hasData;
    const showNoData = !isPaused && !hasData;
    const isOptimal = score >= 80;
    const isGood = score >= 65 && score < 80;
    const isDegraded = score >= 50 && score < 65;

    const strokeColor = showStandby
        ? '#f59e0b' // amber-500
        : showNoData
        ? '#64748b' // slate-500
        : isOptimal 
        ? '#10b981' // emerald-500
        : isGood 
        ? '#06b6d4' // cyan-500
        : isDegraded 
        ? '#f59e0b' // amber-500
        : '#ef4444'; // red-500

    const statusLabel = showStandby
        ? 'STANDBY'
        : showNoData
        ? 'AWAITING DATA'
        : isOptimal 
        ? 'OPTIMAL' 
        : isGood 
        ? 'GOOD' 
        : isDegraded 
        ? 'DEGRADED' 
        : 'CRITICAL';

    const statusBadgeClass = showStandby
        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
        : showNoData
        ? 'bg-slate-500/10 text-slate-400 border-slate-500/20'
        : isOptimal 
        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
        : isGood 
        ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' 
        : isDegraded 
        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' 
        : 'bg-red-500/10 text-red-400 border-red-500/20';

    const size = 132;
    const stroke = 9;
    const r = (size - stroke) / 2;
    const circ = 2 * Math.PI * r;
    const dash = (showStandby || showNoData) ? 0 : (Math.max(0, Math.min(100, score)) / 100) * circ;
    const cx = size / 2;
    const cy = size / 2;

    return (
        <div className="flex flex-col items-center justify-center my-auto py-1">
            <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
                <svg width={size} height={size} className="transform -rotate-90">
                    <circle
                        cx={cx}
                        cy={cy}
                        r={r}
                        fill="none"
                        stroke="rgba(255, 255, 255, 0.08)"
                        strokeWidth={stroke}
                    />
                    {!(showStandby || showNoData) && (
                        <circle
                            cx={cx}
                            cy={cy}
                            r={r}
                            fill="none"
                            stroke={strokeColor}
                            strokeWidth={stroke}
                            strokeDasharray={`${dash.toFixed(2)} ${circ.toFixed(2)}`}
                            strokeLinecap="round"
                            style={{
                                transition: 'stroke-dasharray 0.8s ease-in-out, stroke 0.4s ease',
                                filter: `drop-shadow(0 0 8px ${strokeColor}66)`
                            }}
                        />
                    )}
                </svg>

                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
                    {showStandby || showNoData ? (
                        <span className="text-3xl font-black font-mono tracking-normal text-text-muted opacity-50">
                            —
                        </span>
                    ) : (
                        <div className="flex items-baseline justify-center">
                            <span className="text-4xl font-black font-mono tracking-normal text-text-primary">
                                {score}
                            </span>
                            <span className="text-xs font-bold text-text-muted ml-1 opacity-60">/100</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="mt-3 flex items-center gap-1.5">
                <span className={cn("px-3 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border", statusBadgeClass)}>
                    {statusLabel}
                </span>
            </div>
        </div>
    );
};

interface ConnectivityPerformanceProps {
    token: string;
    uiConfig?: { maxCaptures: number };
    onManage?: () => void;
    isLeader?: boolean;
}

// Component for individual endpoint type graph
function EndpointTypeGraph({ type, results, color, count }: { type: string; results: any[]; color: string; count?: number }) {
    const successResults = results.filter(r => r.score > 0);
    const avgScore = results.length > 0
        ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length)
        : 0;
    const avgLatency = successResults.length > 0
        ? Math.round(successResults.reduce((sum, r) => sum + r.metrics.total_ms, 0) / successResults.length)
        : 0;
    const successRate = results.length > 0
        ? Math.round((successResults.length / results.length) * 100)
        : 0;

    // Prepare chart data (last 50 points, newest first)
    const chartData = results
        .slice(0, 50)
        .reverse()
        .map(r => ({
            time: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            score: r.score,
            latency: Math.round(r.metrics.total_ms)
        }));

    return (
        <div className="bg-card border border-border p-3 rounded-xl shadow-sm flex flex-col h-full">
            <div className="flex items-center justify-between text-text-muted text-[10px] font-bold mb-2 uppercase tracking-wider">
                <span className="truncate" title={type}>{type}</span>
                {typeof count === 'number' && (
                    <span className="px-1.5 py-0.5 rounded bg-card-secondary text-text-secondary font-mono text-[9px] border border-border">
                        {count} {count === 1 ? 'probe' : 'probes'}
                    </span>
                )}
            </div>

            {results.length === 0 ? (
                <div className="text-xs text-text-muted italic h-[68px] flex items-center">No data available</div>
            ) : (
                <>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2 text-[10px] font-bold leading-none">
                        <div className="flex items-center gap-1">
                            <span className="text-text-muted">Scr:</span>
                            <span className={twMerge("font-black", avgScore >= 80 ? "text-green-600 dark:text-green-400" : avgScore >= 50 ? "text-orange-500" : "text-red-500")}>
                                {avgScore}
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-text-muted">Lat:</span>
                            <span className="text-text-primary font-mono">{avgLatency}ms</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-text-muted">Suc:</span>
                            <span className={twMerge("font-black", successRate >= 95 ? "text-green-600 dark:text-green-400" : successRate >= 80 ? "text-orange-500" : "text-red-500")}>
                                {successRate}%
                            </span>
                        </div>
                    </div>
                    <div className="h-[50px] w-full mt-auto">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData}>
                                <defs>
                                    <linearGradient id={`color${type.replace(/[^a-zA-Z]/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                                        <stop offset="95%" stopColor={color} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <Area
                                    type="monotone"
                                    dataKey="score"
                                    stroke={color}
                                    fillOpacity={1}
                                    fill={`url(#color${type.replace(/[^a-zA-Z]/g, '')})`}
                                    isAnimationActive={false}
                                />
                                <ReTooltip
                                    contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                    itemStyle={{ color: 'var(--text-primary)', fontSize: '11px' }}
                                    labelStyle={{ color: 'var(--text-muted)', fontSize: '10px', fontWeight: 'bold', marginBottom: '4px' }}
                                    formatter={(value: any, name: string) => {
                                        if (name === 'score') return [value, 'Score'];
                                        return [value, name];
                                    }}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </>
            )}
        </div>
    );
}


// Buckets all probe results into time windows and computes the avg global score per bucket
function GlobalScoreTrendChart({ results, timeRange }: { results: any[]; timeRange: string }) {
    const chartData = React.useMemo(() => {
        if (!results.length) return [];
        const bucketMs =
            timeRange === '15m' ? 60 * 1000 :
            timeRange === '1h'  ? 5 * 60 * 1000 :
            timeRange === '6h'  ? 30 * 60 * 1000 :
            timeRange === '24h' ? 2 * 60 * 60 * 1000 :
                                  12 * 60 * 60 * 1000; // 7d
        const buckets: Record<number, number[]> = {};
        results.forEach(r => {
            const b = Math.floor(r.timestamp / bucketMs) * bucketMs;
            if (!buckets[b]) buckets[b] = [];
            buckets[b].push(r.score);
        });
        const fmt = timeRange === '7d'
            ? { month: 'short' as const, day: 'numeric' as const }
            : { hour: '2-digit' as const, minute: '2-digit' as const };
        return Object.entries(buckets)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([ts, scores]) => ({
                time: new Date(Number(ts)).toLocaleTimeString([], fmt),
                score: Math.round(scores.reduce((s, v) => s + v, 0) / scores.length),
                samples: scores.length,
            }));
    }, [results, timeRange]);

    const { minScore, maxScore } = React.useMemo(() => {
        if (!chartData.length) return { minScore: null, maxScore: null };
        const scores = chartData.map(d => d.score);
        return {
            minScore: Math.min(...scores),
            maxScore: Math.max(...scores)
        };
    }, [chartData]);

    if (!chartData.length) return (
        <div className="h-full min-h-[170px] flex-1 flex items-center justify-center text-text-muted text-xs italic opacity-60">No data for this period</div>
    );
    return (
        <div className="h-full w-full min-h-[170px] flex-1">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 12, right: 12, bottom: 0, left: -24 }}>
                    <defs>
                        <linearGradient id="globalScoreGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.45} />
                            <stop offset="60%" stopColor="#6366f1" stopOpacity={0.12} />
                            <stop offset="100%" stopColor="#6366f1" stopOpacity={0.0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} vertical={false} />
                    <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={9} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} stroke="var(--text-muted)" fontSize={9} tickLine={false} axisLine={false} width={30} />
                    <ReTooltip
                        contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.15)' }}
                        itemStyle={{ color: 'var(--text-primary)', fontSize: '11px', fontWeight: 'bold' }}
                        labelStyle={{ color: 'var(--text-muted)', fontSize: '10px', fontWeight: 'bold', marginBottom: '4px' }}
                        formatter={(value: any, name: string) => name === 'score' ? [`${value}/100`, 'Avg Score'] : [value, 'Samples']}
                    />
                    
                    {/* Visual Threshold Regions */}
                    <ReferenceArea y1={0} y2={50} fill="#ef4444" fillOpacity={0.03} />
                    <ReferenceArea y1={50} y2={80} fill="#f97316" fillOpacity={0.02} />
                    
                    {/* Warning & Critical Threshold Lines */}
                    <ReferenceLine y={80} stroke="#f97316" strokeDasharray="4 4" strokeOpacity={0.3} label={{ value: 'Warning (80)', position: 'insideBottomRight', fill: 'var(--text-muted)', fontSize: 7, opacity: 0.6 }} />
                    <ReferenceLine y={50} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.3} label={{ value: 'Critical (50)', position: 'insideBottomRight', fill: 'var(--text-muted)', fontSize: 7, opacity: 0.6 }} />

                    {/* Min/Max value indicators of the current period */}
                    {minScore !== null && minScore < 100 && (
                        <ReferenceLine 
                            y={minScore} 
                            stroke="#f43f5e" 
                            strokeDasharray="2 2" 
                            strokeOpacity={0.8}
                            strokeWidth={1.5}
                            label={{ value: `Min: ${minScore}%`, position: 'insideBottomLeft', fill: '#f43f5e', fontSize: 8, fontWeight: 'bold' }} 
                        />
                    )}
                    {maxScore !== null && maxScore > 0 && minScore !== maxScore && (
                        <ReferenceLine 
                            y={maxScore} 
                            stroke="#10b981" 
                            strokeDasharray="2 2" 
                            strokeOpacity={0.8}
                            strokeWidth={1.5}
                            label={{ value: `Max: ${maxScore}%`, position: 'insideTopLeft', fill: '#10b981', fontSize: 8, fontWeight: 'bold' }} 
                        />
                    )}

                    <Area 
                        type="monotone" 
                        dataKey="score" 
                        stroke="#818cf8" 
                        strokeWidth={2.5} 
                        fillOpacity={1} 
                        fill="url(#globalScoreGrad)" 
                        dot={{ r: 3.5, stroke: '#818cf8', strokeWidth: 1.5, fill: 'var(--card)' }} 
                        activeDot={{ r: 6, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }}
                        isAnimationActive={false}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}

// Per-probe score + latency dual-axis chart used inside the detail modal
function ProbeScoreChart({ results, range, probeType, data: externalData, syncId: syncIdProp }: {
    results: any[]; range: string; probeType: string;
    data?: any[];        // pre-computed shared data (for crosshair sync)
    syncId?: string;     // Recharts syncId for crosshair sync across charts
}) {
    const typeColor = probeType === 'PING' ? '#22c55e' : probeType === 'DNS' ? '#a855f7' : probeType === 'UDP' ? '#f97316' : probeType === 'CLOUD' ? '#6366f1' : '#3b82f6';
    const chartData = React.useMemo(() => {
        if (externalData) return externalData;
        const rangeMs = range === '1h' ? 60*60*1000 : range === '6h' ? 6*60*60*1000 : 24*60*60*1000;
        const cutoff = Date.now() - rangeMs;
        return results
            .filter(r => r.timestamp >= cutoff)
            .slice(0, 300)
            .reverse()
            .map(r => ({
                time: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                score: r.score,
                latency: Math.round(r.metrics?.total_ms || 0),
            }));
    }, [results, range, externalData]);

    if (!chartData.length) return (
        <div className="h-[140px] flex items-center justify-center text-text-muted text-xs italic opacity-60">No data for this period</div>
    );
    return (
        <div className="h-[140px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} syncId={syncIdProp} margin={{ top: 4, right: 44, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} vertical={false} />
                    <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={9} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="score" domain={[0, 100]} stroke={typeColor} fontSize={9} tickLine={false} axisLine={false} width={50} />
                    <YAxis yAxisId="latency" orientation="right" stroke="var(--text-muted)" fontSize={9} tickLine={false} axisLine={false} width={40} />
                    <ReTooltip
                        contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.15)' }}
                        itemStyle={{ fontSize: '11px', fontWeight: 'bold' }}
                        labelStyle={{ color: 'var(--text-muted)', fontSize: '10px', fontWeight: 'bold', marginBottom: '4px' }}
                        cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 2', strokeOpacity: 0.8 }}
                    />
                    <Line yAxisId="score" type="monotone" dataKey="score" stroke={typeColor} strokeWidth={2} dot={false} name="Score" activeDot={{ r: 4 }} />
                    <Line yAxisId="latency" type="monotone" dataKey="latency" stroke="#f97316" strokeWidth={1.5} dot={false} name="Latency (ms)" strokeDasharray="5 2" />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

export default function ConnectivityPerformance({ token, uiConfig, onManage, isLeader: propIsLeader }: ConnectivityPerformanceProps) {
    const maxCaptures = uiConfig?.maxCaptures || 10;
    const [results, setResults] = useState<any[]>([]);
    const [stats, setStats] = useState<any>(null);
    const [loading, setLoading] = useState(true);      // Phase 1: probes config (fast)
    const [loadingStats, setLoadingStats] = useState(true); // Phase 2: stats + results (slow)
    const [timeRange, setTimeRange] = useState('1h');
    const [filterType, setFilterType] = useState('ALL');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedEndpoint, setSelectedEndpoint] = useState<any>(null);
    const [showDetailModal, setShowDetailModal] = useState(false);
    const [activeProbes, setActiveProbes] = useState<string[]>([]); // List of active endpoint IDs
    const [endpointConfigs, setEndpointConfigs] = useState<Map<string, any>>(new Map());
    const [cloudScenarios, setCloudScenarios] = useState<any[]>([]);

    // Edit Probe Modal state & Leader state
    const [editingProbe, setEditingProbe] = useState<any>(null);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isSavingProbe, setIsSavingProbe] = useState(false);
    const [isDeletingProbe, setIsDeletingProbe] = useState(false);
    const [isLeader, setIsLeader] = useState<boolean>(propIsLeader ?? false);
    const [tracerouteTarget, setTracerouteTarget] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'catalog' | 'matrix'>('catalog');
    const [inspectedCapture, setInspectedCapture] = useState<any>(null);
    const [isProbeEngineEnabled, setIsProbeEngineEnabled] = useState<boolean>(true);
    const [isTogglingEngine, setIsTogglingEngine] = useState<boolean>(false);

    const toggleProbeEngine = async () => {
        const nextState = !isProbeEngineEnabled;
        setIsTogglingEngine(true);
        try {
            const res = await gFetch('/api/config/system-settings', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ auto_restart_probes: nextState })
            });
            if (res.ok) {
                setIsProbeEngineEnabled(nextState);
            }
        } catch (e) {
            console.error('Failed to toggle probe engine', e);
        } finally {
            setIsTogglingEngine(false);
        }
    };

    useEffect(() => {
        if (propIsLeader !== undefined) {
            setIsLeader(propIsLeader);
        } else {
            gFetch('/api/registry/status', { headers: authHeaders() })
                .then(r => r.json())
                .then(data => {
                    setIsLeader(data.mode === 'leader' || data.current_mode === 'leader' || data.local_registry_active === true);
                })
                .catch(() => {});
        }
    }, [propIsLeader]);

    const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
    const [copiedCurl, setCopiedCurl] = useState<string | null>(null);

    const handleCopyUrl = (url: string) => {
        if (!url || url === '---') return;
        navigator.clipboard.writeText(url);
        setCopiedUrl(url);
        setTimeout(() => setCopiedUrl(null), 2000);
    };

    const handleCopyCurl = (cmd: string) => {
        if (!cmd) return;
        navigator.clipboard.writeText(cmd);
        setCopiedCurl(cmd);
        setTimeout(() => setCopiedCurl(null), 2000);
    };

    const getResolvedFullUrl = (endpoint: any): string => {
        if (!endpoint) return '';

        // 1. If effectiveUrl is explicitly available, use it
        if (endpoint.effectiveUrl && typeof endpoint.effectiveUrl === 'string' && endpoint.effectiveUrl.startsWith('http')) {
            return endpoint.effectiveUrl;
        }

        // 2. If lastResult has an HTTP URL, use it
        if (endpoint.lastResult?.url && typeof endpoint.lastResult.url === 'string' && endpoint.lastResult.url.startsWith('http')) {
            return endpoint.lastResult.url;
        }

        const rawTarget = endpoint.target || endpoint.lastResult?.url || '';

        // Non-CLOUD probes (HTTP, HTTPS, PING, TCP, UDP, DNS)
        if (endpoint.type !== 'CLOUD') {
            return rawTarget || '---';
        }

        // Base domain resolution
        let baseOrigin = '';
        if (cloudScenarios.length > 0 && cloudScenarios[0]?.signedUrl) {
            try {
                const u = new URL(cloudScenarios[0].signedUrl);
                const hostParts = u.hostname.split('.');
                if (hostParts.length > 2 && ['info', 'slow', 'download', 'security', 'error'].includes(hostParts[0])) {
                    baseOrigin = `${u.protocol}//${hostParts.slice(1).join('.')}${u.port ? ':' + u.port : ''}`;
                } else {
                    baseOrigin = u.origin;
                }
            } catch { }
        }
        if (!baseOrigin) {
            baseOrigin = 'https://target.stigix.io';
        }

        let baseId = rawTarget;
        let overrides: any = {};
        if (rawTarget.includes('#')) {
            const parts = rawTarget.split('#');
            baseId = parts[0];
            try { overrides = JSON.parse(parts[1]); } catch { }
        }

        // Advanced custom scenario
        if (baseId === 'advanced-custom') {
            const params = new URLSearchParams();
            params.set('mode', overrides.mode || 'info');
            if (overrides.delay !== undefined && overrides.delay !== null) {
                params.set('delay', overrides.delay.toString());
            }
            if (overrides.mode === 'large') params.set('size', overrides.size || '5m');
            if (overrides.mode === 'error') params.set('code', (overrides.code || 500).toString());

            const qs = params.toString() ? `?${params.toString()}` : '';
            return `${baseOrigin}/advanced${qs}`;
        }

        // Predefined scenarios (e.g. saas-random, saas-slow, egress-info, etc.)
        const scenario = cloudScenarios.find(s => s.id === baseId || s.id === (endpoint.name || '').toLowerCase().replace(/\s+/g, '-'));
        if (scenario?.signedUrl) {
            try {
                const u = new URL(scenario.signedUrl);
                u.searchParams.delete('key');
                u.searchParams.delete('tsg');
                if (overrides.delay !== undefined) {
                    u.searchParams.set('delay', overrides.delay.toString());
                }
                return u.toString();
            } catch { }
        }

        // Direct path mapping fallback
        const pathMap: Record<string, string> = {
            'egress-info': '/saas/info',
            'saas-slow': '/saas/slow',
            'saas-flap': '/saas/flap',
            'saas-wave': '/saas/wave',
            'saas-random': '/saas/random',
            'download-large': '/download/large',
            'security-eicar': '/security/eicar'
        };

        const targetPath = pathMap[baseId] || (baseId.startsWith('saas-') ? `/${baseId.replace('-', '/')}` : `/${baseId}`);
        const params = new URLSearchParams();
        if (overrides.delay !== undefined) {
            params.set('delay', overrides.delay.toString());
        }
        const qs = params.toString() ? `?${params.toString()}` : '';
        return `${baseOrigin}${targetPath}${qs}`;
    };

    const formatDisplayUrl = (endpoint: any) => {
        return getResolvedFullUrl(endpoint);
    };

    // Sorting state
    const [sortField, setSortField] = useState<string>('name');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const [probeChartRange, setProbeChartRange] = useState('1h');

    // Crosshair sync: refs to measure DOM positions for connecting line
    const timingChartWrapRef  = useRef<HTMLDivElement>(null); // outer section wrapping timing chart
    const scoreChartWrapRef   = useRef<HTMLDivElement>(null); // outer section wrapping score chart
    const chartsRegionRef     = useRef<HTMLDivElement>(null); // parent containing both sections
    const [crosshair, setCrosshair] = useState<{ x: number; connTop: number; connH: number; visible: boolean }>(
        { x: 0, connTop: 0, connH: 0, visible: false }
    );

    const { gFetch, activePeerId } = usePeerContext();
    const authHeaders = () => ({ 'Authorization': `Bearer ${token}` });

    const formatMs = (val: number | undefined | null) => {
        if (val === undefined || val === null) return '0';
        return val < 10 ? val.toFixed(2) : val.toFixed(1);
    };

    const parseProbeDetails = (e: any) => {
        if (!e) return { title: '', subtitle: '' };
        if (e.source === 'discovery' || e.element_name || e.site_name) {
            const site = e.site_name || (e.name ? e.name.split(' - ')[0] : 'Probe');
            const router = e.element_name;
            let port = e.port_name || e.selected_interface_label || e.selected_interface_name;
            if (port && /^\d+(\.\d+)?$/.test(String(port).trim())) {
                port = `Port ${port}`;
            }
            const details: string[] = [];
            if (router && router.trim().toLowerCase() !== site.trim().toLowerCase()) {
                details.push(router);
            }
            if (port) {
                details.push(port);
            }
            return {
                title: site,
                subtitle: details.length > 0 ? `(${details.join(' · ')})` : ''
            };
        }
        return { title: e.name || e.id || '', subtitle: '' };
    };

    const getProbeDisplayName = (e: any): string => {
        const { title, subtitle } = parseProbeDetails(e);
        return subtitle ? `${title} ${subtitle}` : title;
    };

    const renderProbeTitle = (e: any, isPending = false) => {
        const { title, subtitle } = parseProbeDetails(e);
        return (
            <span className={cn(
                "text-sm tracking-tight flex items-baseline gap-1.5 flex-wrap",
                isPending ? "opacity-70" : ""
            )}>
                <span className="font-bold text-text-primary group-hover:text-blue-500 transition-colors">
                    {title}
                </span>
                {subtitle && (
                    <span className="text-xs font-normal text-text-muted">
                        {subtitle}
                    </span>
                )}
            </span>
        );
    };

    // Phase 1: Load probes config immediately (fast endpoints < 200ms)
    const fetchProbesConfig = async () => {
        try {
            const [activeRes, configsRes, scenariosRes] = await Promise.all([
                gFetch('/api/connectivity/active-probes', { headers: authHeaders() }),
                gFetch('/api/connectivity/custom', { headers: authHeaders() }),
                gFetch('/api/target/scenarios', { headers: authHeaders() })
            ]);
            const [activeData, configsData, scenariosData] = await Promise.all([
                activeRes.json(),
                configsRes.json(),
                scenariosRes.json()
            ]);
            if (activeData.success) {
                setActiveProbes(activeData.probes.map((p: any) => p.id));
                if (typeof activeData.engine_enabled === 'boolean') {
                    setIsProbeEngineEnabled(activeData.engine_enabled);
                }
            }
            if (Array.isArray(scenariosData)) {
                setCloudScenarios(scenariosData);
            }
            const configMap = new Map();
            if (activeData.success && Array.isArray(activeData.probes)) {
                activeData.probes.forEach((probe: any) => {
                    const id = (probe.name || probe.id || '').toLowerCase().replace(/\s+/g, '-');
                    configMap.set(id, probe);
                });
            }
            if (Array.isArray(configsData)) {
                configsData.forEach((config: any) => {
                    const id = config.name.toLowerCase().replace(/\s+/g, '-');
                    configMap.set(id, { ...configMap.get(id), ...config });
                });
            }
            setEndpointConfigs(configMap);
        } catch (e) {
            console.error('Failed to fetch probes config', e);
        } finally {
            setLoading(false); // Unblock UI after phase 1
        }
    };

    // Phase 2: Load heavy stats + results (may take several seconds on first load)
    const fetchStatsAndResults = async () => {
        setLoadingStats(true);
        try {
            const dynamicLimit = timeRange === '15m' ? 300 : timeRange === '1h' ? 1000 : timeRange === '6h' ? 3000 : timeRange === '24h' ? 6000 : 15000;
            const [statsRes, resultsRes] = await Promise.all([
                gFetch(`/api/connectivity/stats?range=${timeRange}`, { headers: authHeaders() }),
                gFetch(`/api/connectivity/results?timeRange=${timeRange}&limit=${dynamicLimit}`, { headers: authHeaders() })
            ]);
            const [statsData, resultsData] = await Promise.all([
                statsRes.json(),
                resultsRes.json()
            ]);
            setStats(statsData);
            setResults(resultsData.results || []);
        } catch (e) {
            console.error('Failed to fetch stats/results', e);
        } finally {
            setLoadingStats(false);
        }
    };

    const fetchData = async () => {
        await Promise.all([
            fetchProbesConfig(),
            fetchStatsAndResults()
        ]);
    };

    const startEditProbe = (endpoint: any) => {
        const config = endpointConfigs.get(endpoint.id) || {};
        const type = (config.type || endpoint.type || 'HTTP').toUpperCase();
        const isHttp = type === 'HTTP' || type === 'HTTPS';
        
        let initialCodes = config.expectedStatusCodes || config.expected_status_codes;
        if (!initialCodes || !Array.isArray(initialCodes)) {
            initialCodes = [200, 201, 202, 204, 301, 302, 304, 307, 308];
        }

        setEditingProbe({
            _originalName: config.name || endpoint.name,
            name: config.name || endpoint.name || '',
            type,
            target: config.target || endpoint.target || '',
            timeout: config.timeout || (type === 'PING' ? 2000 : 5000),
            frequency: config.frequency || (type === 'CLOUD' ? 600 : isHttp ? 300 : 60),
            enabled: config.enabled ?? true,
            expectedStatusCodes: initialCodes,
            expectedStatusCodesInput: initialCodes.join(', '),
            content_match: config.content_match ? { ...config.content_match } : { enabled: false, mode: 'contains', value: '', case_sensitive: false }
        });
        setIsEditModalOpen(true);
    };

    const handleQuickAddStatusCode = async (statusCode: number) => {
        if (!selectedEndpoint) return;
        try {
            const res = await gFetch('/api/connectivity/custom', { headers: authHeaders() });
            const allEndpoints = await res.json();
            const origName = (selectedEndpoint.name || '').toLowerCase();
            const index = Array.isArray(allEndpoints) ? allEndpoints.findIndex((p: any) => (p.name || '').toLowerCase() === origName) : -1;
            if (index >= 0) {
                const currentCodes: number[] = Array.isArray(allEndpoints[index].expectedStatusCodes)
                    ? allEndpoints[index].expectedStatusCodes
                    : (Array.isArray(allEndpoints[index].expected_status_codes)
                        ? allEndpoints[index].expected_status_codes
                        : [200, 201, 202, 204, 301, 302, 304, 307, 308]);
                if (!currentCodes.includes(statusCode)) {
                    allEndpoints[index].expectedStatusCodes = [...currentCodes, statusCode];
                    await gFetch('/api/connectivity/custom', {
                        method: 'POST',
                        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                        body: JSON.stringify({ endpoints: allEndpoints })
                    });
                    await fetchProbesConfig();
                    await fetchStatsAndResults();
                }
            }
        } catch (e) {
            console.error('Failed to quick-add status code', e);
        }
    };

    const handleSaveProbeEdit = async () => {
        if (!editingProbe || !editingProbe.name || !editingProbe.target) return;
        setIsSavingProbe(true);
        try {
            const res = await gFetch('/api/connectivity/custom', { headers: authHeaders() });
            const allEndpoints = await res.json();
            
            const origName = (editingProbe._originalName || editingProbe.name).toLowerCase();
            const index = Array.isArray(allEndpoints) ? allEndpoints.findIndex((p: any) => (p.name || '').toLowerCase() === origName) : -1;
            
            let formattedTarget = editingProbe.target.trim();
            if ((editingProbe.type === 'HTTP' || editingProbe.type === 'HTTPS') && !formattedTarget.startsWith('http://') && !formattedTarget.startsWith('https://')) {
                formattedTarget = `${editingProbe.type.toLowerCase()}://${formattedTarget}`;
            }

            const defaultFreq = editingProbe.type === 'CLOUD' ? 600 : ['HTTP', 'HTTPS'].includes(editingProbe.type) ? 300 : 60;
            const rawTimeout = parseInt(String(editingProbe.timeout));
            const rawFreq = parseInt(String(editingProbe.frequency));

            const updatedProbe: any = {
                name: editingProbe.name.trim(),
                type: editingProbe.type,
                target: formattedTarget,
                timeout: isNaN(rawTimeout) ? 5000 : Math.min(60000, Math.max(1000, rawTimeout)),
                frequency: isNaN(rawFreq) ? defaultFreq : Math.min(3600, Math.max(30, rawFreq)),
                enabled: editingProbe.enabled ?? true,
                ...(editingProbe.content_match?.enabled ? { content_match: editingProbe.content_match } : { content_match: { enabled: false } })
            };

            if (editingProbe.type === 'HTTP' || editingProbe.type === 'HTTPS') {
                if (typeof editingProbe.expectedStatusCodesInput === 'string') {
                    const parsed = editingProbe.expectedStatusCodesInput.split(',').map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n));
                    if (parsed.length > 0) {
                        updatedProbe.expectedStatusCodes = parsed;
                    }
                } else if (Array.isArray(editingProbe.expectedStatusCodes)) {
                    updatedProbe.expectedStatusCodes = editingProbe.expectedStatusCodes;
                }
            }

            let updatedList = Array.isArray(allEndpoints) ? [...allEndpoints] : [];
            if (index >= 0) {
                updatedList[index] = { ...updatedList[index], ...updatedProbe };
            } else {
                updatedList.push(updatedProbe);
            }

            await gFetch('/api/connectivity/custom', {
                method: 'POST',
                headers: {
                    ...authHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ endpoints: updatedList })
            });

            setIsEditModalOpen(false);
            setEditingProbe(null);
            await fetchProbesConfig();
            await fetchStatsAndResults();
            // Refresh again shortly after so the immediate backend probe execution result appears right away
            setTimeout(() => {
                fetchStatsAndResults();
            }, 2500);
        } catch (err) {
            console.error('Failed to update probe:', err);
        } finally {
            setIsSavingProbe(false);
        }
    };

    const handleDeleteProbe = async (probeToDelete?: any) => {
        const targetProbe = probeToDelete || editingProbe;
        if (!targetProbe || !targetProbe.name) return;
        if (!isLeader) {
            alert('Probes can only be deleted from the Leader node.');
            return;
        }
        const confirmDelete = window.confirm(`Are you sure you want to delete probe "${targetProbe.name}"?\nThis probe will be permanently deleted and synchronized across the fleet.`);
        if (!confirmDelete) return;

        setIsDeletingProbe(true);
        try {
            const probeNameEncoded = encodeURIComponent(targetProbe.name);
            const res = await gFetch(`/api/connectivity/custom/${probeNameEncoded}`, {
                method: 'DELETE',
                headers: authHeaders()
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${res.status}`);
            }

            setIsEditModalOpen(false);
            if (selectedEndpoint && (selectedEndpoint.name || '').toLowerCase() === (targetProbe.name || '').toLowerCase()) {
                setShowDetailModal(false);
                setSelectedEndpoint(null);
                setInspectedCapture(null);
            }
            await fetchProbesConfig();
            await fetchStatsAndResults();
        } catch (e: any) {
            console.error('Failed to delete probe', e);
            alert(`Failed to delete probe: ${e.message || 'Unknown error'}`);
        } finally {
            setIsDeletingProbe(false);
        }
    };

    const toggleProbeStatus = async (endpoint: any, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            const res = await gFetch('/api/connectivity/custom', { headers: authHeaders() });
            const allEndpoints = await res.json();

            const updatedEndpoints = allEndpoints.map((p: any) => {
                const pid = p.name.toLowerCase().replace(/\s+/g, '-');
                if (pid === endpoint.id) {
                    return { ...p, enabled: !endpoint.enabled };
                }
                return p;
            });

            await gFetch('/api/connectivity/custom', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoints: updatedEndpoints })
            });

            fetchData();
        } catch (err) {
            console.error('Failed to toggle probe status', err);
        }
    };


    useEffect(() => {
        fetchProbesConfig();           // Phase 1: immediate on peer change
    }, [activePeerId]);

    useEffect(() => {
        fetchStatsAndResults();         // Phase 2: async on timeRange or peer change
        const interval = setInterval(fetchData, 60000); // Refresh both every 60s
        return () => clearInterval(interval);
    }, [timeRange, activePeerId]);

    const getScoreColor = (score: number) => {
        if (score >= 80) return 'text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/20';
        if (score >= 50) return 'text-orange-500 dark:text-orange-400 bg-orange-500/10 border-orange-500/20';
        if (score > 0) return 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20';
        return 'text-text-muted bg-card-secondary border-border';
    };

    const formatTimestamp = (ts: number) => {
        return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const [showPausedTelemetry, setShowPausedTelemetry] = useState(false);
    const [showScoringInfo, setShowScoringInfo] = useState(false);

    // Helper to match a probe against filterType + searchQuery
    const matchesProbeFilter = React.useCallback((e: any) => {
        if (filterType === 'PRISMA SDWAN') {
            if (e.source !== 'discovery' && e.type !== 'PRISMA' && e.type !== 'PRISMA SDWAN') return false;
        } else if (filterType === 'STIGIX' || filterType === 'AUTOMESH') {
            if (e.source !== 'auto-mesh' && !(e.name && (e.name.startsWith('[Stigix]') || e.name.startsWith('[AutoMesh]')))) return false;
        } else if (filterType === 'CLOUD') {
            if (e.type !== 'CLOUD' && e.type !== 'STIGIX CLOUD') return false;
        } else if (filterType !== 'ALL' && e.type !== filterType) {
            return false;
        }

        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            const title = getProbeDisplayName(e).toLowerCase();
            const target = (e.target || '').toLowerCase();
            const site = (e.site_name || '').toLowerCase();
            const element = (e.element_name || '').toLowerCase();
            const port = (e.port_name || e.selected_interface_label || e.selected_interface_name || '').toLowerCase();
            if (!title.includes(q) && !target.includes(q) && !site.includes(q) && !element.includes(q) && !port.includes(q)) {
                return false;
            }
        }
        return true;
    }, [filterType, searchQuery]);

    // All enabled endpoints that have execution results (unfiltered by filterType/searchQuery so tab counts stay accurate)
    const allEvaluatedEndpoints = React.useMemo(() => {
        const groups: Record<string, any[]> = {};
        results.forEach(r => {
            if (!groups[r.endpointId]) groups[r.endpointId] = [];
            groups[r.endpointId].push(r);
        });

        const base = Object.entries(groups).map(([id, endpointResults]) => {
            const last = endpointResults[0];
            const reachable = endpointResults.filter(r => r.reachable);

            const config = endpointConfigs.get(id);
            const enabled = config?.enabled !== false;

            const histSlice = endpointResults.slice(0, 15).reverse();
            const reachableSlice = reachable.slice(0, 15).reverse();

            return {
                id,
                name: last?.endpointName || 'Unknown',
                type: last?.endpointType || 'HTTP',
                lastScore: last?.score || 0,
                avgScore: reachable.length > 0 ? Math.round(reachable.reduce((acc, r) => acc + r.score, 0) / reachable.length) : 0,
                minScore: reachable.length > 0 ? Math.min(...reachable.map(r => r.score)) : 0,
                maxScore: reachable.length > 0 ? Math.max(...reachable.map(r => r.score)) : 0,
                avgLatency: reachable.length > 0 ? Math.round(reachable.reduce((acc, r) => acc + r.metrics.total_ms, 0) / reachable.length) : 0,
                minLatency: reachable.length > 0 ? Math.round(Math.min(...reachable.map(r => r.metrics.total_ms))) : 0,
                maxLatency: reachable.length > 0 ? Math.round(reachable.reduce((max, r) => Math.max(max, r.metrics.total_ms), reachable[0].metrics.total_ms)) : 0,
                checks: endpointResults.length,
                successRate: Math.round((reachable.length / endpointResults.length) * 100),
                lastResult: last,
                target: config?.target || last?.url || '',
                effectiveUrl: config?.effectiveUrl || (last?.url && last.url.startsWith('http') ? last.url : undefined),
                enabled,
                source: config?.source,
                stale: config?.stale,
                site_id: config?.site_id,
                site_name: config?.site_name,
                element_name: config?.element_name,
                circuit_name: config?.circuit_name,
                port_name: config?.port_name,
                selected_interface_name: config?.selected_interface_name,
                selected_interface_label: config?.selected_interface_label,
                selected_network: config?.selected_network,
                content_match: config?.content_match,
                scoreHistory: histSlice.map(r => r.score),
                latencyHistory: reachableSlice.map(r => Math.round(r.metrics.total_ms)),
            };
        }).filter(e => {
            if (activeProbes.length > 0 && !activeProbes.includes(e.id)) return false;
            if (!e.enabled) return false;
            return true;
        });

        // Deduplicate endpoints sharing the same target IP (e.g. historical name changes)
        const seenTargets = new Map<string, any>();
        const deduped: any[] = [];
        for (const ep of base) {
            const target = (ep.target || '').trim();
            const key = target ? `${ep.type}:${target}` : ep.id;
            if (!seenTargets.has(key)) {
                seenTargets.set(key, ep);
                deduped.push(ep);
            } else {
                const existing = seenTargets.get(key);
                if (ep.source === 'discovery' && existing.source !== 'discovery') {
                    const idx = deduped.indexOf(existing);
                    if (idx !== -1) deduped[idx] = ep;
                    seenTargets.set(key, ep);
                } else if (ep.checks > existing.checks) {
                    const idx = deduped.indexOf(existing);
                    if (idx !== -1) deduped[idx] = ep;
                    seenTargets.set(key, ep);
                }
            }
        }
        return deduped;
    }, [results, activeProbes, endpointConfigs]);

    // Filtered & sorted endpoints with results
    const endpoints = React.useMemo(() => {
        return allEvaluatedEndpoints.filter(matchesProbeFilter).sort((a: any, b: any) => {
            if (a.enabled !== b.enabled) {
                return a.enabled ? -1 : 1;
            }

            let valA: any = a[sortField];
            let valB: any = b[sortField];

            if (sortField === 'reliability') {
                valA = a.successRate;
                valB = b.successRate;
            } else if (sortField === 'latency') {
                valA = a.avgLatency;
                valB = b.avgLatency;
            } else if (sortField === 'score') {
                valA = a.lastScore;
                valB = b.lastScore;
            }

            if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }, [allEvaluatedEndpoints, matchesProbeFilter, sortField, sortDirection]);

    // Pending probes: configs that have no result yet — shown as "standby" or "scheduled" rows
    const pendingProbes = React.useMemo(() => {
        const idsWithResults = new Set(results.map(r => r.endpointId));
        const activeTargets = new Set(allEvaluatedEndpoints.map(e => (e.target || '').trim()).filter(Boolean));
        const pending: any[] = [];
        endpointConfigs.forEach((config, id) => {
            const target = (config.target || '').trim();
            if (target && activeTargets.has(target)) return;
            if (!idsWithResults.has(id) && config.enabled !== false) {
                pending.push({
                    id,
                    name: config.name,
                    type: (config.type || 'HTTP').toUpperCase(),
                    target: config.target,
                    effectiveUrl: config.effectiveUrl,
                    pending: true,
                    lastScore: null,
                    avgScore: null,
                    successRate: null,
                    avgLatency: null,
                    minLatency: null,
                    maxLatency: null,
                    checks: 0,
                    enabled: true,
                    source: config.source,
                    stale: config.stale,
                    site_id: config.site_id,
                    site_name: config.site_name,
                    element_name: config.element_name,
                    circuit_name: config.circuit_name,
                    port_name: config.port_name,
                    selected_interface_name: config.selected_interface_name,
                    selected_interface_label: config.selected_interface_label,
                    selected_network: config.selected_network,
                    content_match: config.content_match,
                    scoreHistory: [],
                    latencyHistory: [],
                });
            }
        });
        return pending;
    }, [results, allEvaluatedEndpoints, endpointConfigs]);

    // Complete probe catalog (both evaluated and pending/standby probes) for accurate counters
    const allCatalogProbes = React.useMemo(() => {
        return [...allEvaluatedEndpoints, ...pendingProbes];
    }, [allEvaluatedEndpoints, pendingProbes]);

    // Filtered & sorted pending probes for the table
    const filteredPendingProbes = React.useMemo(() => {
        return pendingProbes.filter(matchesProbeFilter).sort((a: any, b: any) => {
            if (sortField === 'name') {
                const nameA = getProbeDisplayName(a).toLowerCase();
                const nameB = getProbeDisplayName(b).toLowerCase();
                return sortDirection === 'asc' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
            }
            if (sortField === 'type') {
                return sortDirection === 'asc' ? (a.type || '').localeCompare(b.type || '') : (b.type || '').localeCompare(a.type || '');
            }
            return 0;
        });
    }, [pendingProbes, matchesProbeFilter, sortField, sortDirection]);

    const handleSort = (field: string) => {
        if (sortField === field) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            // Default to descending for metrics (highest first), ascending for names/types
            const isMetric = ['score', 'reliability', 'latency'].includes(field);
            setSortDirection(isMetric ? 'desc' : 'asc');
        }
    };

    const SortIndicator = ({ field }: { field: string }) => {
        if (sortField !== field) return null;
        return sortDirection === 'asc' ? <ChevronUp size={12} className="ml-1" /> : <ChevronDown size={12} className="ml-1" />;
    };

    // Filter results by endpoint type for separate graphs
    const httpResults = React.useMemo(() => {
        return results.filter(r => r.endpointType === 'HTTP' || r.endpointType === 'HTTPS');
    }, [results]);

    const pingResults = React.useMemo(() => {
        return results.filter(r => r.endpointType === 'PING');
    }, [results]);

    const dnsResults = React.useMemo(() => {
        return results.filter(r => r.endpointType === 'DNS');
    }, [results]);

    const udpResults = React.useMemo(() => {
        return results.filter(r => r.endpointType === 'UDP');
    }, [results]);

    const cloudResults = React.useMemo(() => {
        return results.filter(r => r.endpointType === 'CLOUD');
    }, [results]);

    // Memoized results for the detail modal — avoids re-filtering on every parent render
    const selectedEndpointResults = React.useMemo(() => {
        if (!selectedEndpoint) return [];
        return results.filter(r => r.endpointId === selectedEndpoint.id);
    }, [results, selectedEndpoint]);

    // Shared chart data for the detail modal — BOTH charts use this so syncId works by identical indices
    const detailChartData = React.useMemo(() => {
        const rangeMs = probeChartRange === '1h' ? 60*60*1000 : probeChartRange === '6h' ? 6*60*60*1000 : 24*60*60*1000;
        const cutoff = Date.now() - rangeMs;
        return selectedEndpointResults
            .filter(r => r.timestamp >= cutoff)
            .slice(0, 300)
            .reverse()
            .map(r => ({
                time: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                score: r.score,
                latency: Math.round(r.metrics?.total_ms || 0),
                DNS:  Math.round(r.metrics?.dns_ms  || 0),
                TCP:  Math.round(r.metrics?.tcp_ms  || 0),
                TLS:  Math.round(r.metrics?.tls_ms  || 0),
                TTFB: Math.round(r.metrics?.ttfb_ms || 0),
            }));
    }, [selectedEndpointResults, probeChartRange]);

    const isPausedWithNoData = !isProbeEngineEnabled && results.length === 0;
    const shouldShowTelemetryCharts = !isPausedWithNoData || showPausedTelemetry;

    if ((loading || loadingStats) && !stats && allCatalogProbes.length === 0) {
        return <DEMSkeleton />;
    }

    return (
        <div className="space-y-5 animate-in fade-in duration-500">
            {/* Compact Standby Banner when local engine is suspended */}
            {!isProbeEngineEnabled && (
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/25 rounded-2xl text-xs shadow-sm animate-in fade-in">
                    <div className="flex items-center gap-2.5 text-amber-200 flex-wrap">
                        <span className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/30 text-amber-300 font-mono text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5">
                            <Pause size={11} className="text-amber-400" /> Standby
                        </span>
                        <span className="text-text-secondary">
                            Local probe execution is paused on this node. Catalog changes (<span className="font-mono font-bold text-text-primary">{allCatalogProbes.length}</span> probes) remain active and synced across the SD-WAN fleet.
                        </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {isPausedWithNoData && (
                            <button
                                onClick={() => setShowPausedTelemetry(v => !v)}
                                className="px-2.5 py-1.5 bg-card-secondary/80 hover:bg-card-secondary border border-border text-text-muted hover:text-text-primary font-bold rounded-lg text-[11px] transition-colors flex items-center gap-1.5 cursor-pointer"
                            >
                                <BarChart3 size={13} className="text-indigo-400" />
                                <span>{showPausedTelemetry ? 'Hide Telemetry Panels' : 'Show Telemetry Panels'}</span>
                                {showPausedTelemetry ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            </button>
                        )}
                        <button
                            onClick={toggleProbeEngine}
                            disabled={isTogglingEngine}
                            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg text-xs transition-colors shrink-0 shadow cursor-pointer flex items-center gap-1.5"
                        >
                            <Play size={12} className="fill-current" />
                            <span>{isTogglingEngine ? 'Resuming...' : 'Resume Local Engine'}</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Header Analytics (Auto-collapsed when paused with no local data) */}
            {shouldShowTelemetryCharts && (
            <div className="flex flex-col gap-4">
                
                {/* 1. Combined Top Panel (Score, Trend, Flaky) */}
                <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden flex flex-col xl:flex-row">
                    
                    {/* Left: Global Experience */}
                    <div className="flex flex-col border-b xl:border-b-0 xl:border-r border-border bg-card-secondary/10 w-full xl:w-[275px] shrink-0">
                        <div className="flex items-center justify-center px-6 py-3 border-b border-border bg-card-secondary/40 h-[49px]">
                            <div className="text-[10px] font-black text-text-muted uppercase tracking-widest flex items-center gap-2">
                                <Gauge size={14} className="text-blue-500" /> Global Experience
                            </div>
                        </div>
                        <div className="flex-1 p-5 flex flex-col items-center justify-center text-center">
                            {loadingStats && !stats ? (
                                <div className="h-[168px] flex items-center justify-center my-auto">
                                    <div className="h-32 w-32 rounded-full bg-card-secondary animate-pulse" />
                                </div>
                            ) : (
                                <GlobalExperienceGauge
                                    score={stats?.globalHealth || 0}
                                    isPaused={!isProbeEngineEnabled}
                                    hasData={results.length > 0}
                                />
                            )}
                            <div className="text-[10px] text-text-muted font-bold tracking-tight opacity-70 mt-2">
                                {!isProbeEngineEnabled && results.length === 0 ? 'Local probe engine on standby' : 'Avg. Scoring across all probes'}
                            </div>
                        </div>
                    </div>

                    {/* Middle: Trend Chart */}
                    <div className="flex-1 flex flex-col min-w-0 border-b xl:border-b-0 xl:border-r border-border">
                        <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card-secondary/40 h-[49px]">
                            <div className="text-[10px] font-black text-text-muted uppercase tracking-widest flex items-center gap-2">
                                <TrendingUp size={14} className="text-indigo-500" /> Score Trend
                                {loadingStats && stats && (
                                    <RefreshCw size={11} className="text-indigo-400 animate-spin opacity-70 ml-1" />
                                )}
                            </div>
                            <div className="flex p-0.5 bg-card-secondary rounded-lg border border-border">
                                {(['15m','1h','6h','24h','7d'] as const).map(r => (
                                    <button key={r} onClick={() => setTimeRange(r)}
                                        className={cn(
                                            "px-2.5 py-1 rounded-md text-[10px] font-bold transition-all uppercase tracking-tighter",
                                            timeRange === r ? "bg-indigo-600 text-white shadow" : "text-text-muted hover:text-text-primary"
                                        )}>{r}</button>
                                ))}
                            </div>
                        </div>
                        <div className="p-4 flex-1 flex flex-col min-h-[195px]">
                            {loadingStats && !stats ? (
                                <div className="flex-1 flex items-center justify-center"><div className="w-full h-full bg-card-secondary animate-pulse rounded-xl" /></div>
                            ) : (
                                <GlobalScoreTrendChart results={results} timeRange={timeRange} />
                            )}
                        </div>
                    </div>

                    {/* Right: Flaky Probes */}
                    <div className="w-full xl:w-[340px] shrink-0 flex flex-col min-w-0">
                        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-card-secondary/40 h-[49px]">
                            <div className="text-[10px] font-black text-text-muted uppercase tracking-widest flex items-center gap-2">
                                <Flame size={14} className="text-orange-500" /> Unstable & Down Probes
                            </div>
                            {stats?.flakyEndpoints?.length > 0 && (
                                <span className="px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 text-[9px] font-mono font-bold">
                                    {stats.flakyEndpoints.length}
                                </span>
                            )}
                        </div>
                        <div className="p-3 space-y-2 overflow-y-auto flex-1 max-h-[250px] xl:max-h-none bg-card-secondary/5 scrollbar-thin">
                            {loadingStats && !stats ? (
                                <>
                                    <div className="h-10 bg-card-secondary animate-pulse rounded-lg border border-border" />
                                    <div className="h-10 bg-card-secondary animate-pulse rounded-lg border border-border opacity-60" />
                                </>
                            ) : stats?.flakyEndpoints?.filter((e: any) => {
                                if (activeProbes.length > 0 && !activeProbes.includes(e.id)) return false;
                                return true;
                            }).length > 0 ? stats.flakyEndpoints
                                .filter((e: any) => {
                                    if (activeProbes.length > 0 && !activeProbes.includes(e.id)) return false;
                                    return true;
                                })
                                .map((e: any) => {
                                    const isOffline = e.reliability === 0 || e.isDown;
                                    const typeColor = e.type === 'PING' || e.type === 'ICMP' 
                                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' 
                                        : e.type === 'DNS' 
                                        ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' 
                                        : 'bg-blue-500/10 text-blue-400 border-blue-500/20';

                                    return (
                                        <div 
                                            key={e.id} 
                                            onClick={() => {
                                                const found = (allEvaluatedEndpoints || []).find((ep: any) => ep.id === e.id || ep.name === e.name);
                                                if (found) {
                                                    setSelectedEndpoint(found);
                                                    setInspectedCapture(null);
                                                    setShowDetailModal(true);
                                                }
                                            }}
                                            className={cn(
                                                "p-2.5 rounded-xl border transition-all cursor-pointer group flex flex-col gap-1.5 shadow-sm",
                                                isOffline 
                                                    ? "bg-card-secondary border-red-500/30 hover:border-red-500/50 hover:bg-red-500/8" 
                                                    : "bg-card-secondary border-amber-500/25 hover:border-amber-500/45 hover:bg-amber-500/8"
                                            )}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                                    <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border", typeColor)}>
                                                        {e.type || 'HTTP'}
                                                    </span>
                                                    <span className="text-text-primary font-bold text-xs truncate group-hover:text-blue-400 transition-colors">
                                                        {e.name}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                                    <span className={cn(
                                                        "px-1.5 py-0.5 rounded text-[9px] font-black font-mono uppercase tracking-wider border",
                                                        isOffline 
                                                            ? "bg-red-500/20 text-red-400 border-red-500/30" 
                                                            : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                                                    )}>
                                                        {isOffline ? 'DOWN (0%)' : `${e.reliability}%`}
                                                    </span>
                                                </div>
                                            </div>
                                            {e.lastError && (
                                                <div className="flex items-center gap-1 text-[10px] text-text-muted truncate font-mono pl-0.5">
                                                    <AlertCircle size={10} className={isOffline ? "text-red-400 flex-shrink-0" : "text-amber-400 flex-shrink-0"} />
                                                    <span className="truncate opacity-85">{e.lastError}</span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                }) : !isProbeEngineEnabled && results.length === 0 ? (
                                <div className="text-xs text-text-muted italic py-6 text-center flex flex-col items-center gap-2">
                                    <Pause size={20} className="text-amber-400 opacity-70" />
                                    <span className="text-[11px] font-medium text-amber-300/80">Local probe execution on standby</span>
                                </div>
                            ) : (
                                <div className="text-xs text-text-muted italic py-6 text-center flex flex-col items-center gap-2">
                                    <CheckCircle size={20} className="text-emerald-500 opacity-70" />
                                    <span className="text-[11px] font-medium text-emerald-400/80">All monitored probes stable</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* 3. Performance Trends by Endpoint Type */}
                <div className="xl:col-span-4 bg-card-secondary/30 border border-border p-5 rounded-2xl shadow-sm">
                    <div className="text-text-muted text-xs font-bold tracking-wider flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <BarChart3 size={16} /> Performance Trends by Type
                        </div>
                        <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono text-[10px]">
                            {allCatalogProbes.length} configured probes
                        </span>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                        <EndpointTypeGraph
                            type="HTTP/HTTPS"
                            results={httpResults}
                            color="#3b82f6"
                            count={allCatalogProbes.filter(e => e.type === 'HTTP' || e.type === 'HTTPS').length}
                        />
                        <EndpointTypeGraph
                            type="PING"
                            results={pingResults}
                            color="#22c55e"
                            count={allCatalogProbes.filter(e => e.type === 'PING').length}
                        />
                        <EndpointTypeGraph
                            type="DNS"
                            results={dnsResults}
                            color="#a855f7"
                            count={allCatalogProbes.filter(e => e.type === 'DNS').length}
                        />
                        <EndpointTypeGraph
                            type="UDP"
                            results={udpResults}
                            color="#f97316"
                            count={allCatalogProbes.filter(e => e.type === 'UDP').length}
                        />
                        <EndpointTypeGraph
                            type="STIGIX CLOUD"
                            results={cloudResults}
                            color="#6366f1"
                            count={allCatalogProbes.filter(e => e.type === 'CLOUD' || e.type === 'STIGIX CLOUD').length}
                        />
                    </div>
                </div>
            </div>
            )}

            {/* View Mode Switcher: Probes Catalog vs Full-Mesh Matrix */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-card-secondary/30 p-2.5 rounded-xl border border-border mb-2">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setViewMode('catalog')}
                        className={cn(
                            "px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2",
                            viewMode === 'catalog'
                                ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                                : "text-text-muted hover:text-text-primary hover:bg-card-secondary"
                        )}
                    >
                        <Activity size={15} /> Probes Catalog ({allCatalogProbes.length})
                    </button>
                    <button
                        onClick={() => setViewMode('matrix')}
                        className={cn(
                            "px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2",
                            viewMode === 'matrix'
                                ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                                : "text-text-muted hover:text-text-primary hover:bg-card-secondary"
                        )}
                    >
                        <Grid size={15} className="text-blue-500 dark:text-blue-400" />
                        <span>Full-Mesh Reachability Matrix</span>
                        <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/30 tracking-wider">
                            BETA
                        </span>
                    </button>
                </div>
                <div className="flex items-center gap-3 pr-2">
                    {viewMode === 'catalog' && (
                        <button
                            onClick={() => setShowScoringInfo(v => !v)}
                            className={cn(
                                "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1.5 border cursor-pointer",
                                showScoringInfo
                                    ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                                    : "bg-card-secondary/60 text-text-muted hover:text-text-primary border-border"
                            )}
                            title="How is the performance score calculated?"
                        >
                            <Info size={13} className="text-blue-400" />
                            <span>Scoring Formula</span>
                        </button>
                    )}
                    <div className="text-[11px] font-bold text-text-muted hidden md:flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>Bidirectional Cross-Instance Telemetry</span>
                    </div>
                </div>
            </div>

            {viewMode === 'matrix' ? (
                <ReachabilityMatrix token={token} />
            ) : (
                <>
            {/* Collapsible Scoring Info */}
            {showScoringInfo && (
                <div className="bg-blue-600/5 border border-blue-500/20 px-4 py-3 rounded-xl flex items-center justify-between gap-3 mb-2 shadow-sm animate-in fade-in">
                    <div className="flex items-center gap-2.5">
                        <Info size={16} className="text-blue-500 dark:text-blue-400 flex-shrink-0" />
                        <p className="text-[11px] text-text-muted leading-relaxed">
                            <strong className="text-blue-500 dark:text-blue-400 font-bold mr-1.5">Scoring Formula (0–100):</strong>
                            Weighted SD-WAN path quality combining
                            <span className="text-blue-600 dark:text-blue-400 font-bold mx-1">Total Latency</span>,
                            <span className="text-blue-600 dark:text-blue-400 font-bold mx-1">Jitter & Loss (UDP)</span>, and
                            <span className="text-blue-600 dark:text-blue-400 font-bold mx-1">TTFB (HTTP)</span>.
                            Timeouts or unreachable targets score <span className="text-red-500 font-black">0</span>.
                        </p>
                    </div>
                    <button onClick={() => setShowScoringInfo(false)} className="text-text-muted hover:text-text-primary text-xs font-bold px-2 py-0.5">✕</button>
                </div>
            )}

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card-secondary/50 p-4 rounded-xl border border-border shadow-sm backdrop-blur-sm">
                <div className="flex items-center gap-3 flex-wrap">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
                        <input
                            type="text"
                            placeholder="Search endpoint..."
                            className="bg-card-secondary border border-border text-text-primary pl-10 pr-4 py-2 rounded-lg text-sm w-full md:w-64 focus:ring-1 focus:ring-blue-500 transition-all outline-none"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <div className="flex p-1 bg-card-secondary rounded-lg border border-border flex-wrap gap-0.5">
                        {['ALL', 'HTTP', 'HTTPS', 'PING', 'TCP', 'UDP', 'DNS', 'CLOUD', 'PRISMA SDWAN', 'STIGIX'].map(t => {
                            const count = t === 'ALL'
                                ? allCatalogProbes.length
                                : t === 'CLOUD'
                                    ? allCatalogProbes.filter(e => e.type === 'CLOUD' || e.type === 'STIGIX CLOUD').length
                                    : t === 'PRISMA SDWAN'
                                        ? allCatalogProbes.filter(e => e.source === 'discovery' || e.type === 'PRISMA' || e.type === 'PRISMA SDWAN').length
                                        : (t === 'STIGIX' || t === 'AUTOMESH')
                                            ? allCatalogProbes.filter(e => e.source === 'auto-mesh' || (e.name && (e.name.startsWith('[Stigix]') || e.name.startsWith('[AutoMesh]')))).length
                                            : allCatalogProbes.filter(e => e.type === t).length;
                            return (
                                <button
                                    key={t}
                                    onClick={() => setFilterType(t)}
                                    className={cn(
                                        "px-3 py-1 rounded-md text-[11px] font-bold transition-all uppercase tracking-tighter flex items-center gap-1.5",
                                        filterType === t ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20" : "text-text-muted hover:text-text-primary"
                                    )}
                                >
                                    <span>{t === 'CLOUD' ? 'STIGIX CLOUD' : t}</span>
                                    <span className={cn(
                                        "px-1.5 py-0.2 rounded-full font-mono text-[9.5px]",
                                        filterType === t ? "bg-white/20 text-white" : "bg-card-secondary/80 text-text-muted"
                                    )}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 mr-2 bg-card-secondary/60 border border-border rounded-xl px-2.5 py-1">
                        <Clock size={13} className="text-text-muted shrink-0" />
                        <StigixSelect
                            value={timeRange}
                            onChange={(val) => setTimeRange(val)}
                            accent="blue"
                            uppercaseTrigger
                            triggerClassName="border-none bg-transparent px-1 py-0.5 text-xs font-bold"
                            menuMinWidth={150}
                            options={[
                                { value: '15m', label: '15 Minutes' },
                                { value: '1h', label: '1 Hour' },
                                { value: '6h', label: '6 Hours' },
                                { value: '24h', label: '24 Hours' },
                                { value: '7d', label: '7 Days' },
                            ]}
                        />
                    </div>


                    <button
                        onClick={toggleProbeEngine}
                        disabled={isTogglingEngine}
                        className={cn(
                            "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all shadow-sm border",
                            isProbeEngineEnabled
                                ? "bg-rose-500/10 hover:bg-rose-500/20 border-rose-500/30 text-rose-300"
                                : "bg-emerald-600 hover:bg-emerald-500 text-white border-transparent"
                        )}
                        title={isProbeEngineEnabled ? "Local probe execution is running on this node. Click to stop." : "Local probe execution is suspended. Click to start."}
                    >
                        {isProbeEngineEnabled ? (
                            <>
                                <Square size={12} className="fill-current text-rose-400" />
                                <span>Stop Engine</span>
                                <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 animate-pulse">Running</span>
                            </>
                        ) : (
                            <>
                                <Play size={12} className="fill-current" />
                                <span>Start Engine</span>
                                <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase bg-zinc-800 text-zinc-400 border border-zinc-700">Stopped</span>
                            </>
                        )}
                    </button>

                    <button
                        onClick={() => setTracerouteTarget('')}
                        className="flex items-center gap-1.5 bg-card-secondary hover:bg-card-secondary/80 border border-border text-text-muted hover:text-text-primary px-3 py-2 rounded-lg text-xs font-bold transition-all shadow-sm"
                        title="Trace network path (Layer-3 traceroute)"
                    >
                        <Route size={14} className="text-blue-500" /> Trace Path
                    </button>

                    {onManage && (
                        <button
                            onClick={onManage}
                            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-lg shadow-blue-900/20"
                        >
                            <Plus size={14} /> Manage Probes
                        </button>
                    )}
                </div>
            </div>


            {/* Metrics Table */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-xl shadow-black/5">
                <table className="w-full text-left">
                    <thead className="bg-card-secondary/50 border-b border-border">
                        <tr>
                            <th
                                className="px-6 py-4 text-[11px] font-bold text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-primary transition-colors"
                                onClick={() => handleSort('name')}
                            >
                                <div className="flex items-center">Probe <SortIndicator field="name" /></div>
                            </th>
                            <th
                                className="px-6 py-4 text-[11px] font-bold text-text-muted uppercase tracking-wider text-center cursor-pointer hover:text-text-primary transition-colors"
                                onClick={() => handleSort('type')}
                            >
                                <div className="flex items-center justify-center">Type <SortIndicator field="type" /></div>
                            </th>
                            <th className="px-6 py-4 text-[11px] font-bold text-text-muted uppercase tracking-wider text-center">
                                Status
                            </th>
                            <th
                                className="px-6 py-4 text-[11px] font-bold text-text-muted uppercase tracking-wider text-center cursor-pointer hover:text-text-primary transition-colors"
                                onClick={() => handleSort('score')}
                            >
                                <div className="flex items-center justify-center">Last Score <SortIndicator field="score" /></div>
                            </th>
                            <th
                                className="px-6 py-4 text-[11px] font-bold text-text-muted uppercase tracking-wider text-center cursor-pointer hover:text-text-primary transition-colors"
                                onClick={() => handleSort('latency')}
                            >
                                <div className="flex items-center justify-center">Avg Latency <SortIndicator field="latency" /></div>
                            </th>
                            <th
                                className="px-6 py-4 text-[11px] font-bold text-text-muted uppercase tracking-wider text-center cursor-pointer hover:text-text-primary transition-colors"
                                onClick={() => handleSort('reliability')}
                            >
                                <div className="flex items-center justify-center">Reliability <SortIndicator field="reliability" /></div>
                            </th>
                            <th className="px-6 py-4 text-[11px] font-bold text-text-muted tracking-wider text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {/* Pending / Standby probes — no execution results yet */}
                        {filteredPendingProbes.map(e => (
                            <tr key={`pending-${e.id}`} className={cn("hover:bg-card-secondary/50 transition-colors group cursor-default", isProbeEngineEnabled && "animate-pulse-subtle")}>
                                <td className="px-6 py-4">
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-2">
                                            {renderProbeTitle(e, false)}
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                            <span className="text-[10px] text-text-muted font-mono opacity-60 leading-tight">{formatDisplayUrl(e)}</span>
                                            <button
                                                onClick={(ev) => {
                                                    ev.stopPropagation();
                                                    handleCopyUrl(getResolvedFullUrl(e));
                                                }}
                                                className="p-1 rounded hover:bg-card-secondary text-text-muted hover:text-foreground transition-colors"
                                                title="Copy full target URL"
                                            >
                                                {copiedUrl === getResolvedFullUrl(e) ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
                                            </button>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-center align-middle">
                                    <span className={cn(
                                        "px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-tighter",
                                        e.type === 'HTTPS' ? "text-purple-600 dark:text-purple-400 bg-purple-500/10 border-purple-500/20" :
                                        e.type === 'HTTP' ? "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20" :
                                        "text-orange-500 bg-orange-500/10 border-orange-500/20"
                                    )}>{e.type}</span>
                                </td>
                                <td className="px-6 py-4 text-center align-middle">
                                    {isProbeEngineEnabled ? (
                                        <span className="px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest bg-blue-500/10 text-blue-400 border border-blue-500/20 inline-flex items-center gap-1">
                                            <Activity size={9} className="animate-spin" style={{animationDuration:'3s'}}/>
                                            Scheduled
                                        </span>
                                    ) : (
                                        <span className="px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                            Standby
                                        </span>
                                    )}
                                </td>
                                {/* Score — no data yet */}
                                <td className="px-4 py-2 text-center align-middle">
                                    <span className="text-text-muted text-[11px] font-bold opacity-50">—</span>
                                </td>
                                {/* Latency — no data yet */}
                                <td className="px-4 py-2 text-center align-middle">
                                    <span className="text-text-muted text-[11px] font-bold opacity-50">—</span>
                                </td>
                                {/* Reliability — no data yet */}
                                <td className="px-4 py-2 text-center align-middle">
                                    <span className="text-text-muted text-[11px] font-bold opacity-50">—</span>
                                </td>
                                <td className="px-6 py-4 px-8">
                                    <div className="flex justify-end items-center gap-2">
                                        <button
                                            onClick={(ev) => {
                                                ev.stopPropagation();
                                                setTracerouteTarget(e.target);
                                            }}
                                            className="p-2 rounded-lg transition-all border border-transparent flex items-center justify-center text-text-muted hover:bg-blue-500/10 hover:text-blue-500 hover:border-blue-500/20"
                                            title="Trace Path (Traceroute)"
                                        >
                                            <Route size={16} />
                                        </button>
                                        <button
                                            onClick={(ev) => {
                                                ev.stopPropagation();
                                                startEditProbe(e);
                                            }}
                                            className="p-2 rounded-lg transition-all border border-transparent flex items-center justify-center text-text-muted hover:bg-blue-500/10 hover:text-blue-500 hover:border-blue-500/20"
                                            title="Edit Probe Parameters"
                                        >
                                            <Pencil size={16} />
                                        </button>
                                        {isLeader && (
                                            <button
                                                onClick={(ev) => {
                                                    ev.stopPropagation();
                                                    handleDeleteProbe(e);
                                                }}
                                                className="p-2 rounded-lg transition-all border border-transparent flex items-center justify-center text-text-muted hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20"
                                                title="Delete Probe (Leader only)"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {/* Normal probes with results */}
                        {endpoints.map(e => (
                            <tr key={e.id} 
                                onClick={(ev) => { ev.stopPropagation(); setSelectedEndpoint(e); setInspectedCapture(null); setShowDetailModal(true); }}
                                className={cn(
                                "hover:bg-card-secondary transition-colors group cursor-pointer",
                                !e.enabled && "opacity-40"
                            )}>
                                <td className="px-6 py-4">
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {renderProbeTitle(e, false)}
                                            {(e as any)._source === 'global' && (
                                                <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm" title="Global provisioned probe from Leader">
                                                    🌐 Global
                                                </span>
                                            )}
                                            {(e as any)._source === 'overridden' && (
                                                <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm" title="Global probe with local field override">
                                                    ✏️ Overridden
                                                </span>
                                            )}
                                            {(e as any)._source === 'orphaned' && (
                                                <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-red-500/10 text-red-400 border border-red-500/20 shadow-sm" title="Global parent deleted on Leader">
                                                    ⚠️ Orphaned
                                                </span>
                                            )}
                                            <span className={cn(
                                                "px-1.5 py-0.5 rounded-[4px] text-[8px] font-black uppercase tracking-widest flex items-center gap-1",
                                                e.type === 'CLOUD'
                                                    ? "bg-purple-600/10 text-purple-600"
                                                    : e.source === 'discovery'
                                                        ? (e.stale ? "bg-orange-500/20 text-orange-500" : "bg-indigo-600/10 text-indigo-600")
                                                        : "bg-amber-600/10 text-amber-600"
                                            )}>
                                                {e.type === 'CLOUD' ? <Globe size={10} /> : e.source === 'discovery' ? <Shield size={10} /> : <Activity size={10} />}
                                                {e.stale && "STALE"}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                            <span className="text-[10px] text-text-muted font-mono break-all opacity-80 leading-tight">
                                                {formatDisplayUrl(e)}
                                            </span>
                                            <button
                                                onClick={(ev) => {
                                                    ev.stopPropagation();
                                                    handleCopyUrl(getResolvedFullUrl(e));
                                                }}
                                                className="p-1 rounded hover:bg-card-secondary text-text-muted hover:text-foreground transition-colors"
                                                title="Copy full target URL"
                                            >
                                                {copiedUrl === getResolvedFullUrl(e) ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
                                            </button>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-center align-middle">
                                    <span className={cn(
                                        "px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-tighter",
                                        (e.source === 'auto-mesh' || (e.name && (e.name.startsWith('[Stigix]') || e.name.startsWith('[AutoMesh]')))) ? "text-cyan-600 dark:text-cyan-400 bg-cyan-500/10 border-cyan-500/20" :
                                        (e.source === 'discovery' || e.type === 'PRISMA') ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20" :
                                        e.type === 'HTTPS' ? "text-purple-600 dark:text-purple-400 bg-purple-500/10 border-purple-500/20" :
                                            e.type === 'HTTP' ? "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20" :
                                                e.type === 'CLOUD' ? "text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20" :
                                                    "text-orange-500 bg-orange-500/10 border-orange-500/20"
                                    )}>
                                        {(e.source === 'auto-mesh' || (e.name && (e.name.startsWith('[Stigix]') || e.name.startsWith('[AutoMesh]')))) ? 'STIGIX' :
                                         (e.source === 'discovery' || e.type === 'PRISMA') ? 'PRISMA SDWAN' :
                                         (e.type === 'CLOUD' ? 'STIGIX CLOUD' : e.type)}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-center align-middle">
                                    <span className={cn(
                                        "px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest",
                                        e.enabled
                                            ? "bg-green-500/10 text-green-600 dark:text-green-400"
                                            : "bg-gray-500/10 text-gray-500 dark:text-gray-400"
                                    )}>
                                        {e.enabled ? "Active" : "Inactive"}
                                    </span>
                                </td>
                                {/* ── Score: single-line sparkline + badge + sub-stats ── */}
                                <td className="px-4 py-2 text-center align-middle">
                                    <div className="flex items-center justify-center gap-1.5">
                                        <Sparkline
                                            data={e.scoreHistory}
                                            color={e.lastScore >= 80 ? '#22c55e' : e.lastScore >= 50 ? '#f97316' : '#ef4444'}
                                            width={58}
                                            height={14}
                                        />
                                        <span className={cn(
                                            "inline-flex items-center justify-center rounded-full px-1.5 text-[10px] font-black min-w-[26px] border leading-5",
                                            getScoreColor(e.lastScore)
                                        )}>
                                            {e.lastScore}
                                        </span>
                                        <span className="text-[8px] text-text-secondary font-bold opacity-70 tracking-tight whitespace-nowrap hidden xl:inline">
                                            {e.avgScore}-{e.minScore}-{e.maxScore}
                                        </span>
                                    </div>
                                </td>
                                {/* ── Latency: single-line sparkline + badge + sub-stats ── */}
                                <td className="px-4 py-2 text-center align-middle">
                                    <div className="flex items-center justify-center gap-1.5">
                                        <Sparkline
                                            data={e.latencyHistory}
                                            color="#f59e0b"
                                            width={58}
                                            height={14}
                                        />
                                        <span className="inline-flex items-center justify-center rounded-full px-1.5 text-[10px] font-black min-w-[46px] border text-amber-500 dark:text-amber-400 bg-amber-500/10 border-amber-500/20 font-mono leading-5">
                                            {e.avgLatency}ms
                                        </span>
                                        <span className="text-[8px] text-text-secondary font-bold opacity-70 tracking-tight whitespace-nowrap hidden xl:inline">
                                            {e.minLatency}-{e.maxLatency}ms
                                        </span>
                                    </div>
                                </td>
                                {/* ── Reliability: compact donut ring ── */}
                                <td className="px-4 py-2 text-center align-middle">
                                    <div className="flex items-center justify-center">
                                        <DonutRing pct={e.successRate} size={32} />
                                    </div>
                                </td>
                                <td className="px-6 py-4 px-8">
                                    <div className="flex justify-end items-center gap-2">
                                        <button
                                            onClick={(ev) => {
                                                ev.stopPropagation();
                                                setTracerouteTarget(e.target || e.lastResult?.url || '');
                                            }}
                                            className="p-2 rounded-lg transition-all border border-transparent flex items-center justify-center text-text-muted hover:bg-blue-500/10 hover:text-blue-500 hover:border-blue-500/20"
                                            title="Trace Path (Traceroute)"
                                        >
                                            <Route size={16} />
                                        </button>
                                        <button
                                            onClick={(ev) => {
                                                ev.stopPropagation();
                                                startEditProbe(e);
                                            }}
                                            className="p-2 rounded-lg transition-all border border-transparent flex items-center justify-center text-text-muted hover:bg-blue-500/10 hover:text-blue-500 hover:border-blue-500/20"
                                            title="Edit Probe Parameters"
                                        >
                                            <Pencil size={16} />
                                        </button>
                                        {isLeader && (
                                            <button
                                                onClick={(ev) => {
                                                    ev.stopPropagation();
                                                    handleDeleteProbe(e);
                                                }}
                                                className="p-2 rounded-lg transition-all border border-transparent flex items-center justify-center text-text-muted hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20"
                                                title="Delete Probe (Leader only)"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {endpoints.length === 0 && filteredPendingProbes.length === 0 && (
                <div className="p-12 text-center text-text-muted flex flex-col items-center gap-3 bg-card/40">
                        <Activity size={48} className="text-text-muted opacity-30" />
                        <div className="text-sm font-bold tracking-widest">No matching probes in catalog</div>
                        <div className="text-[10px] max-w-xs leading-relaxed italic opacity-70">HTTP/HTTPS probes run every 5 min by default. PING/DNS/TCP probes run every 60s.</div>
                    </div>
                )}
            </div>
        </>
    )}

            {/* Detailed Modal */}
            {showDetailModal && selectedEndpoint && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-300" onClick={() => setShowDetailModal(false)}>
                    <div className="bg-card border border-border rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl shadow-blue-500/10" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-border flex items-center justify-between sticky top-0 bg-card/90 backdrop-blur-md z-10">
                            <div className="flex items-center gap-4">
                                <div className={cn("p-3 rounded-xl", getScoreColor(selectedEndpoint.lastScore))}>
                                    <Gauge size={24} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-black text-text-primary tracking-tight flex items-center gap-3">
                                        {getProbeDisplayName(selectedEndpoint)}
                                        <span className={cn(
                                            "px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-tighter align-middle",
                                            selectedEndpoint.type === 'HTTPS' ? "text-purple-600 dark:text-purple-400 bg-purple-500/10 border-purple-500/20" :
                                                selectedEndpoint.type === 'HTTP' ? "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20" :
                                                    selectedEndpoint.type === 'CLOUD' ? "text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20" :
                                                        "text-orange-500 bg-orange-500/10 border-orange-500/20"
                                        )}>
                                            {selectedEndpoint.type === 'CLOUD' ? 'STIGIX CLOUD' : selectedEndpoint.type}
                                        </span>
                                        {(selectedEndpoint as any).content_match?.enabled && (
                                            <span className="px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-tighter align-middle bg-violet-500/10 border-violet-500/30 text-violet-400">
                                                ✦ Content Match
                                            </span>
                                        )}
                                    </h3>
                                    <div className="flex items-center gap-2 mt-1">
                                        <p className="text-[11px] text-text-muted font-mono font-bold break-all max-w-[700px]">{formatDisplayUrl(selectedEndpoint)}</p>
                                        <button
                                            onClick={() => handleCopyUrl(getResolvedFullUrl(selectedEndpoint))}
                                            className="p-1 rounded hover:bg-card-secondary text-text-muted hover:text-foreground transition-colors flex-shrink-0"
                                            title="Copy full target URL"
                                        >
                                            {copiedUrl === getResolvedFullUrl(selectedEndpoint) ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => startEditProbe(selectedEndpoint)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card-secondary hover:bg-card-secondary/80 text-text-primary border border-border text-xs font-semibold transition-all"
                                    title="Edit probe parameters"
                                >
                                    <Pencil size={14} /> Edit
                                </button>
                                {isLeader && (
                                    <button
                                        onClick={() => handleDeleteProbe(selectedEndpoint)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold transition-all"
                                        title="Delete this probe (Leader only)"
                                    >
                                        <Trash2 size={14} /> Delete
                                    </button>
                                )}
                                <button
                                    onClick={() => setTracerouteTarget(selectedEndpoint.target || selectedEndpoint.lastResult?.url || '')}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 dark:text-blue-400 border border-blue-500/20 text-xs font-semibold transition-all"
                                    title="Trace path to this endpoint"
                                >
                                    <Route size={14} /> Trace Path
                                </button>
                                <button onClick={() => setShowDetailModal(false)} className="p-2 hover:bg-card-secondary rounded-lg text-text-muted hover:text-text-primary transition-colors">
                                    <XCircle size={24} />
                                </button>
                            </div>
                        </div>


                        {/* ── Content Match Info Banner (visible when enabled) ── */}
                        {(selectedEndpoint as any).content_match?.enabled && (() => {
                            const cm = (selectedEndpoint as any).content_match;
                            const lastResult = selectedEndpointResults[0];
                            const cmOk  = (lastResult as any)?.content_match_ok;
                            const cmRes = (lastResult as any)?.content_match_result;
                            const hasResult = cmRes !== undefined;
                            return (
                                <div className={cn(
                                    "mx-6 mt-0 mb-0 px-4 py-3 rounded-xl border flex items-start gap-3 text-[11px] font-bold",
                                    hasResult
                                        ? (cmOk ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-red-500/10 border-red-500/30 text-red-400")
                                        : "bg-violet-500/10 border-violet-500/30 text-violet-400"
                                )}>
                                    <span className="text-lg leading-none mt-0.5">{hasResult ? (cmOk ? '✓' : '✗') : '◆'}</span>
                                    <div className="flex flex-col gap-0.5">
                                        <span>
                                            <span className="opacity-60 font-bold uppercase tracking-widest text-[9px] mr-2">Content Match</span>
                                            <span className="font-mono">{cm.mode === 'not_contains' ? 'not_contains' : 'contains'}</span>
                                            <span className="opacity-50 mx-2">›</span>
                                            <span className="font-mono bg-black/20 px-2 py-0.5 rounded">&ldquo;{cm.value}&rdquo;</span>
                                            {cm.case_sensitive && <span className="ml-2 opacity-60 text-[9px] uppercase tracking-widest">case sensitive</span>}
                                        </span>
                                        {hasResult && (
                                            <span className="text-[10px] opacity-80">
                                                Last result: <strong>{cmRes}</strong>
                                                {!cmOk && <span className="ml-2 opacity-60">(score forced to 0)</span>}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}

                        <div className="p-8 space-y-8">
                            {/* ── Synchronized charts wrapper (relative for connecting line) ── */}
                            <div ref={chartsRegionRef} style={{ position: 'relative' }}>

                            {/* Detailed Timing Breakdown (Stacked Area Chart) */}
                            {(selectedEndpoint.type.includes('HTTP') || selectedEndpoint.type === 'CLOUD') && (
                                <div ref={timingChartWrapRef} className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-xs font-black text-text-muted uppercase tracking-widest flex items-center gap-2">
                                            <Zap size={16} className="text-yellow-500" /> Probe Performance
                                        </h4>
                                        <div className="flex gap-4">
                                            <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-500" /> <span className="text-[10px] text-text-muted font-bold uppercase tracking-tighter">DNS</span></div>
                                            <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-cyan-500" /> <span className="text-[10px] text-text-muted font-bold uppercase tracking-tighter">TCP</span></div>
                                            <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-purple-500" /> <span className="text-[10px] text-text-muted font-bold uppercase tracking-tighter">TLS</span></div>
                                            <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-orange-500" /> <span className="text-[10px] text-text-muted font-bold uppercase tracking-tighter">TTFB</span></div>
                                        </div>
                                    </div>
                                    <div className="h-[250px] w-full bg-card-secondary/20 p-4 rounded-xl border border-border shadow-inner">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart
                                                data={detailChartData}
                                                syncId="probe-detail-sync"
                                                onMouseMove={(e: any) => {
                                                    if (e?.activeCoordinate?.x !== undefined && timingChartWrapRef.current && scoreChartWrapRef.current && chartsRegionRef.current) {
                                                        const region  = chartsRegionRef.current.getBoundingClientRect();
                                                        const chart1  = timingChartWrapRef.current.getBoundingClientRect();
                                                        const chart2  = scoreChartWrapRef.current.getBoundingClientRect();
                                                        // x from left of region = container p-4 (16px) + recharts active coord
                                                        const x       = e.activeCoordinate.x + 16;
                                                        const connTop = chart1.bottom - region.top;
                                                        const connH   = chart2.top    - chart1.bottom;
                                                        setCrosshair({ x, connTop, connH, visible: connH > 0 });
                                                    }
                                                }}
                                                onMouseLeave={() => setCrosshair(c => ({ ...c, visible: false }))}
                                            >
                                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                                                <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={10} tickLine={false} axisLine={false} />
                                                <YAxis stroke="var(--text-muted)" fontSize={10} tickLine={false} axisLine={false} width={50} />
                                                <ReTooltip
                                                    contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                                    itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                                                    cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 2', strokeOpacity: 0.8 }}
                                                />
                                                <Area type="monotone" dataKey="DNS"  stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.4} />
                                                <Area type="monotone" dataKey="TCP"  stackId="1" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.4} />
                                                <Area type="monotone" dataKey="TLS"  stackId="1" stroke="#a855f7" fill="#a855f7" fillOpacity={0.4} />
                                                <Area type="monotone" dataKey="TTFB" stackId="1" stroke="#f97316" fill="#f97316" fillOpacity={0.4} />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                    <div className="bg-blue-600/5 border border-blue-500/20 p-4 rounded-xl flex items-start gap-3 shadow-sm">
                                        <Info className="text-blue-500 dark:text-blue-400 flex-shrink-0" size={18} />
                                        <p className="text-xs text-text-muted leading-relaxed italic">
                                            High **TLS** timing often indicates SASE inspection or poor network path quality. **TTFB** (Time to First Byte) reflects backend application responsiveness after the handshake.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Discovery & SD-WAN Topology Parameters */}
                            {((selectedEndpoint as any).source === 'discovery' || (selectedEndpoint as any).element_name || (selectedEndpoint as any).circuit_name || (selectedEndpoint as any).port_name) && (
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                    <div className="bg-card-secondary/30 p-3.5 rounded-xl border border-border">
                                        <div className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-1">Site</div>
                                        <div className="text-xs font-bold text-text-primary">{(selectedEndpoint as any).site_name || (selectedEndpoint as any).site_id || '—'}</div>
                                    </div>
                                    <div className="bg-card-secondary/30 p-3.5 rounded-xl border border-border">
                                        <div className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-1">Router (Element)</div>
                                        <div className="text-xs font-bold text-text-primary">{(selectedEndpoint as any).element_name || '—'}</div>
                                    </div>
                                    <div className="bg-card-secondary/30 p-3.5 rounded-xl border border-border">
                                        <div className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-1">LAN Port</div>
                                        <div className="text-xs font-bold text-text-primary">
                                            {(selectedEndpoint as any).port_name || (selectedEndpoint as any).selected_interface_label || (selectedEndpoint as any).selected_interface_name || '—'}
                                        </div>
                                    </div>
                                    <div className="bg-card-secondary/30 p-3.5 rounded-xl border border-border">
                                        <div className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-1">Network Subnet</div>
                                        <div className="text-xs font-bold text-text-primary">{(selectedEndpoint as any).selected_network || '—'}</div>
                                    </div>
                                </div>
                            )}

                            {/* Score Over Time Chart */}
                            <div ref={scoreChartWrapRef} className="space-y-3 mt-10">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-xs font-black text-text-muted uppercase tracking-widest flex items-center gap-2">
                                        <TrendingUp size={15} className="text-indigo-500" /> Score Trend
                                    </h4>
                                    <div className="flex items-center gap-2">
                                        <div className="flex items-center gap-1 text-[10px] font-bold text-text-muted">
                                            <span className="w-3 h-0.5 rounded" style={{ backgroundColor: selectedEndpoint.type === 'PING' ? '#22c55e' : selectedEndpoint.type === 'DNS' ? '#a855f7' : selectedEndpoint.type === 'UDP' ? '#f97316' : '#3b82f6', display: 'inline-block' }} /> Score
                                            <span className="w-4 border-t-2 border-dashed border-orange-500 mx-1 inline-block" /> Latency
                                        </div>
                                        <div className="flex p-0.5 bg-card-secondary rounded-lg border border-border">
                                            {(['1h','6h','24h'] as const).map(r => (
                                                <button key={r} onClick={() => setProbeChartRange(r)}
                                                    className={cn(
                                                        "px-2 py-0.5 rounded text-[10px] font-bold transition-all uppercase tracking-tighter",
                                                        probeChartRange === r ? "bg-indigo-600 text-white shadow" : "text-text-muted hover:text-text-primary"
                                                    )}>{r}</button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-card-secondary/20 rounded-xl border border-border p-3">
                                    <ProbeScoreChart
                                        results={selectedEndpointResults}
                                        range={probeChartRange}
                                        probeType={selectedEndpoint.type}
                                        data={detailChartData}
                                        syncId="probe-detail-sync"
                                    />
                                </div>
                            </div>

                            {/* Connecting vertical line between the two charts */}
                            {crosshair.visible && crosshair.connH > 0 && (
                                <div
                                    aria-hidden
                                    style={{
                                        position: 'absolute',
                                        left:   `${crosshair.x}px`,
                                        top:    `${crosshair.connTop}px`,
                                        height: `${crosshair.connH}px`,
                                        width:  '1px',
                                        background: 'linear-gradient(to bottom, rgba(99,102,241,0.5), rgba(99,102,241,0.1), rgba(99,102,241,0.5))',
                                        pointerEvents: 'none',
                                        zIndex: 10,
                                    }}
                                />
                            )}
                            </div>{/* end charts wrapper */}


                            {/* Recent Checks Table */}
                            <div className="space-y-4">
                                <h4 className="text-xs font-black text-text-muted uppercase tracking-widest flex items-center gap-2">
                                    <Activity size={16} /> Recent Captures
                                </h4>
                                <div className="border border-border rounded-xl overflow-hidden bg-card-secondary/20 shadow-sm">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-card-secondary/50 border-b border-border">
                                            <tr>
                                                <th className="px-4 py-3 text-text-muted font-bold tracking-tight whitespace-nowrap">Time</th>
                                                <th className="px-4 py-3 text-text-muted font-bold tracking-tight text-center">Score</th>
                                                {(selectedEndpoint.type.includes('HTTP') || selectedEndpoint.type === 'CLOUD') && (
                                                    <>
                                                        <th className="px-4 py-3 text-text-muted font-bold tracking-tight text-center hidden lg:table-cell">DNS</th>
                                                        <th className="px-4 py-3 text-text-muted font-bold tracking-tight text-center hidden lg:table-cell">TCP</th>
                                                        <th className="px-4 py-3 text-text-muted font-bold tracking-tight text-center hidden lg:table-cell">TLS</th>
                                                        <th className="px-4 py-3 text-text-muted font-bold tracking-tight text-center hidden lg:table-cell">TTFB</th>
                                                    </>
                                                )}
                                                <th className="px-4 py-3 text-text-muted font-bold tracking-tight text-center">Total</th>
                                                <th className="px-4 py-3 text-text-muted font-bold tracking-tight text-center hidden sm:table-cell">IP Address</th>
                                                {(selectedEndpoint.type.includes('HTTP') || selectedEndpoint.type === 'CLOUD') && (
                                                    <th className="px-4 py-3 text-text-muted font-bold tracking-tight text-right whitespace-nowrap">
                                                        {(selectedEndpoint as any).content_match?.enabled ? 'HTTP · Match' : 'HTTP Code'}
                                                    </th>
                                                )}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {selectedEndpointResults.slice(0, maxCaptures).map((r, i) => {
                                                const isSelected = inspectedCapture === r || (!inspectedCapture && i === 0);
                                                return (
                                                <tr 
                                                    key={i} 
                                                    onClick={() => setInspectedCapture(r)}
                                                    className={cn(
                                                        "transition-colors cursor-pointer",
                                                        isSelected ? "bg-indigo-500/10 hover:bg-indigo-500/15" : "hover:bg-card-secondary"
                                                    )}
                                                >
                                                    <td className="px-4 py-3 text-text-primary font-bold uppercase tracking-tighter whitespace-nowrap">
                                                        <div className="flex items-center gap-1.5">
                                                            {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse shrink-0" />}
                                                            {formatTimestamp(r.timestamp)}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-center" onClick={(e) => { e.stopPropagation(); setInspectedCapture(r); }}>
                                                        <InteractiveScoreBadge
                                                            score={r.score}
                                                            probe={selectedEndpoint}
                                                            result={r}
                                                            onClick={() => setInspectedCapture(r)}
                                                        />
                                                    </td>
                                                    {(selectedEndpoint.type.includes('HTTP') || selectedEndpoint.type === 'CLOUD') && (
                                                        <>
                                                            <td className="px-4 py-3 text-center hidden lg:table-cell text-text-muted font-mono">{r.metrics.dns_ms !== undefined ? `${formatMs(r.metrics.dns_ms)}ms` : '-'}</td>
                                                            <td className="px-4 py-3 text-center hidden lg:table-cell text-text-muted font-mono">{r.metrics.tcp_ms !== undefined ? `${formatMs(r.metrics.tcp_ms)}ms` : '-'}</td>
                                                            <td className="px-4 py-3 text-center hidden lg:table-cell text-text-muted font-mono">{r.metrics.tls_ms !== undefined ? `${formatMs(r.metrics.tls_ms)}ms` : '-'}</td>
                                                            <td className="px-4 py-3 text-center hidden lg:table-cell text-text-muted font-mono">{r.metrics.ttfb_ms !== undefined ? `${formatMs(r.metrics.ttfb_ms)}ms` : '-'}</td>
                                                        </>
                                                    )}
                                                    <td className="px-4 py-3 text-center font-mono text-text-secondary font-bold">{formatMs(r.metrics.total_ms)}ms</td>
                                                    <td className="px-4 py-3 text-center text-text-muted font-mono truncate max-w-[120px] hidden sm:table-cell">{r.remoteIp || '-'}</td>
                                                    {(selectedEndpoint.type.includes('HTTP') || selectedEndpoint.type === 'CLOUD') && (
                                                        <td className="px-4 py-3 text-right">
                                                            <div className="flex items-center justify-end gap-1.5 flex-nowrap">
                                                                {/* HTTP Code badge */}
                                                                <span className={cn(
                                                                    "px-2 py-0.5 rounded font-black text-[11px] shrink-0",
                                                                    r.httpCode === 200 ? "text-green-600 dark:text-green-400 bg-green-500/10" : "text-orange-500 bg-orange-500/10"
                                                                )}>
                                                                    {r.httpCode || 'N/A'}
                                                                </span>
                                                                {/* Inline match result — only when content_match enabled */}
                                                                {(selectedEndpoint as any).content_match?.enabled && (
                                                                    (r as any).content_match_result ? (
                                                                        <span className={cn(
                                                                            "text-[10px] font-bold whitespace-nowrap shrink-0",
                                                                            (r as any).content_match_ok ? "text-green-400" : "text-red-400"
                                                                        )}>
                                                                            {(r as any).content_match_ok ? '✓' : '✗'} {(r as any).content_match_result}
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-text-muted text-[10px] shrink-0">—</span>
                                                                    )
                                                                )}
                                                            </div>
                                                        </td>
                                                    )}
                                                </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* ── Dynamic DEM Score Breakdown & Explainer Card ── */}
                            <ProbeScoreCard
                                probe={selectedEndpoint}
                                result={inspectedCapture || selectedEndpointResults[0]}
                                onQuickFixStatus={handleQuickAddStatusCode}
                                onOpenEditModal={() => startEditProbe(selectedEndpoint)}
                            />

                            {/* ── Effective Target URL & CLI Command Card (placed at bottom) ── */}
                            {(() => {
                                const fullUrl = getResolvedFullUrl(selectedEndpoint);
                                const isHttpLike = selectedEndpoint.type === 'CLOUD' || ['HTTP', 'HTTPS'].includes((selectedEndpoint.type || '').toUpperCase());
                                const curlCommand = isHttpLike
                                    ? `curl -i -sS "${fullUrl}"`
                                    : selectedEndpoint.type === 'PING'
                                        ? `ping -c 4 ${selectedEndpoint.target}`
                                        : selectedEndpoint.type === 'TCP'
                                            ? `nc -zv ${(selectedEndpoint.target || '').split(':')[0]} ${(selectedEndpoint.target || '').split(':')[1] || 80}`
                                            : `nc -zvu ${(selectedEndpoint.target || '').split(':')[0]} ${(selectedEndpoint.target || '').split(':')[1] || 5201}`;

                                return (
                                    <div className="bg-card-secondary/40 border border-border rounded-xl p-4 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-black uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                                                <Globe size={13} className="text-blue-500" />
                                                Effective Test Target & Command
                                            </span>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => handleCopyUrl(fullUrl)}
                                                    className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-card border border-border hover:bg-card-secondary text-text-primary transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                                                    title="Copy full target URL"
                                                >
                                                    {copiedUrl === fullUrl ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                                    <span>{copiedUrl === fullUrl ? 'Copied URL' : 'Copy URL'}</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleCopyCurl(curlCommand)}
                                                    className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 text-blue-400 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                                                    title="Copy command for terminal testing"
                                                >
                                                    {copiedCurl === curlCommand ? <Check size={12} className="text-emerald-400" /> : <Terminal size={12} />}
                                                    <span>{copiedCurl === curlCommand ? 'Copied Command' : (isHttpLike ? 'Copy cURL' : 'Copy CLI')}</span>
                                                </button>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 gap-2">
                                            <div className="bg-background/80 border border-border/60 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-2 overflow-hidden flex-1 min-w-0">
                                                    <span className="text-[9px] font-black uppercase text-text-muted px-1.5 py-0.5 rounded bg-card border border-border flex-shrink-0">URL</span>
                                                    <span className="text-[11px] font-mono text-text-primary truncate select-all">{fullUrl}</span>
                                                </div>
                                            </div>
                                            <div className="bg-background/80 border border-border/60 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-2 overflow-hidden flex-1 min-w-0">
                                                    <span className="text-[9px] font-black uppercase text-blue-400 px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 flex-shrink-0">CLI</span>
                                                    <span className="text-[11px] font-mono text-blue-300 dark:text-blue-200 truncate select-all">{curlCommand}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Probe Parameters Modal */}
            {isEditModalOpen && editingProbe && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[100] p-4 animate-in fade-in duration-300" onClick={() => setIsEditModalOpen(false)}>
                    <div className="bg-card border border-amber-500/30 rounded-2xl w-full max-w-xl shadow-2xl transition-all duration-300 scale-in-center" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-border flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
                                    <Pencil size={20} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-text-primary tracking-tight">Edit Probe Parameters</h3>
                                    <p className="text-[10px] text-text-muted font-bold tracking-widest uppercase opacity-70">
                                        Modifying {editingProbe.name}
                                    </p>
                                </div>
                            </div>
                            <button onClick={() => setIsEditModalOpen(false)} className="p-2 hover:bg-card-secondary rounded-lg text-text-muted hover:text-text-primary transition-colors">
                                <XCircle size={24} />
                            </button>
                        </div>

                        <div className="p-8 space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-[9px] font-black text-text-muted tracking-[0.2em] ml-1 uppercase">Probe Name</label>
                                    <input
                                        type="text"
                                        className="w-full bg-card-secondary border border-border text-text-primary rounded-xl px-4 py-3 outline-none focus:ring-1 focus:ring-blue-500 text-[11px] font-black tracking-widest shadow-inner transition-all"
                                        value={editingProbe.name}
                                        onChange={e => setEditingProbe({ ...editingProbe, name: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[9px] font-black text-text-muted tracking-[0.2em] ml-1 uppercase">Protocol</label>
                                    <StigixSelect
                                        value={editingProbe.type}
                                        onChange={t => {
                                            const isHttp = t === 'HTTP' || t === 'HTTPS';
                                            const defaultFreq = t === 'CLOUD' ? 600 : isHttp ? 300 : 60;
                                            setEditingProbe({ ...editingProbe, type: t, timeout: t === 'PING' ? 2000 : 5000, frequency: defaultFreq });
                                        }}
                                        accent="blue"
                                        triggerClassName="bg-card-secondary rounded-xl px-4 py-3 text-[11px] font-black tracking-widest shadow-inner"
                                        options={[
                                            { value: 'HTTP', label: 'HTTP' },
                                            { value: 'HTTPS', label: 'HTTPS' },
                                            { value: 'PING', label: 'ICMP (Ping)' },
                                            { value: 'TCP', label: 'TCP Port' },
                                            { value: 'DNS', label: 'DNS Query' },
                                            { value: 'UDP', label: 'UDP Stream' },
                                            { value: 'CLOUD', label: 'Stigix Cloud' },
                                        ]}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between ml-1 leading-none">
                                        <label className="text-[9px] font-black text-text-muted tracking-[0.2em] uppercase">Timeout (ms)</label>
                                        <span className="text-[8px] font-bold text-text-muted/50 tracking-wider">MIN 1000 — MAX 60000</span>
                                    </div>
                                    <input
                                        type="number"
                                        min="1000"
                                        max="60000"
                                        step="1000"
                                        className="w-full bg-card-secondary border border-border text-text-primary rounded-xl px-4 py-3 outline-none focus:ring-1 focus:ring-blue-500 text-[11px] font-black tracking-widest shadow-inner transition-all"
                                        value={editingProbe.timeout ?? ''}
                                        onChange={e => {
                                            const raw = e.target.value;
                                            setEditingProbe({ ...editingProbe, timeout: raw === '' ? '' : parseInt(raw) });
                                        }}
                                        onBlur={() => {
                                            const val = parseInt(String(editingProbe.timeout));
                                            setEditingProbe({ ...editingProbe, timeout: isNaN(val) ? 5000 : Math.min(60000, Math.max(1000, val)) });
                                        }}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between ml-1 leading-none">
                                        <label className="text-[9px] font-black text-text-muted tracking-[0.2em] uppercase">Freq (s)</label>
                                        <span className="text-[8px] font-bold text-text-muted/50 tracking-wider">MIN 30 — MAX 3600 — default: Cloud=600 · HTTP/S=300 · other=60</span>
                                    </div>
                                    <input
                                        type="number"
                                        min="30"
                                        max="3600"
                                        step="10"
                                        className="w-full bg-card-secondary border border-border text-text-primary rounded-xl px-4 py-3 outline-none focus:ring-1 focus:ring-blue-500 text-[11px] font-black tracking-widest shadow-inner transition-all"
                                        value={editingProbe.frequency ?? ''}
                                        onChange={e => {
                                            const raw = e.target.value;
                                            setEditingProbe({ ...editingProbe, frequency: raw === '' ? '' : parseInt(raw) });
                                        }}
                                        onBlur={() => {
                                            const val = parseInt(String(editingProbe.frequency));
                                            const fallback = editingProbe.type === 'CLOUD' ? 600 : (['HTTP', 'HTTPS'].includes(editingProbe.type) ? 300 : 60);
                                            setEditingProbe({ ...editingProbe, frequency: isNaN(val) ? fallback : Math.min(3600, Math.max(30, val)) });
                                        }}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[9px] font-black text-text-muted tracking-[0.2em] ml-1 uppercase">Target URL / IP Address</label>
                                <input
                                    type="text"
                                    placeholder={
                                        editingProbe.type === 'DNS' ? '8.8.8.8' :
                                        editingProbe.type === 'TCP' ? '192.168.1.100:8080' :
                                        editingProbe.type === 'UDP' ? '192.168.1.100:5201' :
                                        'https://google.com'
                                    }
                                    className="w-full bg-card-secondary border border-border text-text-primary rounded-xl px-4 py-3 outline-none focus:ring-1 focus:ring-blue-500 text-[11px] font-black tracking-widest shadow-inner transition-all"
                                    value={editingProbe.target}
                                    onChange={e => setEditingProbe({ ...editingProbe, target: e.target.value })}
                                />
                                {editingProbe.type === 'CLOUD' && (
                                    <div className="flex items-center justify-between px-3 py-2 bg-purple-500/10 border border-purple-500/20 rounded-xl text-[10px] font-mono">
                                        <div className="flex items-center gap-1.5 overflow-hidden flex-1 min-w-0 mr-2">
                                            <span className="text-purple-400 font-bold flex-shrink-0">Resolved:</span>
                                            <span className="text-purple-300 truncate">{getResolvedFullUrl(editingProbe)}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleCopyUrl(getResolvedFullUrl(editingProbe))}
                                            className="flex items-center gap-1 text-purple-300 hover:text-white px-2 py-0.5 rounded bg-purple-500/20 transition-colors flex-shrink-0"
                                        >
                                            {copiedUrl === getResolvedFullUrl(editingProbe) ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                                            <span>Copy</span>
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Content Matching (HTTP/HTTPS only) */}
                            {(editingProbe.type === 'HTTP' || editingProbe.type === 'HTTPS') && (
                                <div className="border border-border rounded-xl p-4 space-y-3 bg-card-secondary/30">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                id="edit-cm-enabled"
                                                checked={editingProbe.content_match?.enabled ?? false}
                                                onChange={e => setEditingProbe({
                                                    ...editingProbe,
                                                    content_match: {
                                                        enabled: e.target.checked,
                                                        mode: editingProbe.content_match?.mode ?? 'contains',
                                                        value: editingProbe.content_match?.value ?? '',
                                                        case_sensitive: editingProbe.content_match?.case_sensitive ?? false
                                                    }
                                                })}
                                                className="accent-blue-500 w-3.5 h-3.5 cursor-pointer"
                                            />
                                            <label htmlFor="edit-cm-enabled" className="text-[10px] font-black uppercase tracking-widest text-text-primary cursor-pointer select-none">Enable content matching</label>
                                        </div>
                                        <span className="text-[9px] text-text-muted opacity-50 font-bold uppercase tracking-widest">HTTP / HTTPS only</span>
                                    </div>
                                    {editingProbe.content_match?.enabled && (
                                        <div className="space-y-3 pt-1">
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-[9px] font-black text-text-muted uppercase tracking-widest mb-1.5">Match mode</label>
                                                    <StigixSelect
                                                        value={editingProbe.content_match?.mode ?? 'contains'}
                                                        onChange={val => setEditingProbe({
                                                            ...editingProbe,
                                                            content_match: { ...editingProbe.content_match!, mode: val as 'contains' | 'not_contains' }
                                                        })}
                                                        accent="blue"
                                                        triggerClassName="bg-card-secondary rounded-xl px-3 py-2.5 text-[10px] font-bold"
                                                        options={[
                                                            { value: 'contains', label: 'contains' },
                                                            { value: 'not_contains', label: 'not_contains' },
                                                        ]}
                                                    />
                                                </div>
                                                <div className="flex items-end">
                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={editingProbe.content_match?.case_sensitive ?? false}
                                                            onChange={e => setEditingProbe({
                                                                ...editingProbe,
                                                                content_match: { ...editingProbe.content_match!, case_sensitive: e.target.checked }
                                                            })}
                                                            className="accent-blue-500 w-3.5 h-3.5 cursor-pointer"
                                                        />
                                                        <span className="text-[10px] font-black uppercase tracking-widest text-text-muted select-none">Case sensitive</span>
                                                    </label>
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-[9px] font-black text-text-muted uppercase tracking-widest mb-1.5">Expected text</label>
                                                <input
                                                    type="text"
                                                    placeholder="e.g. Welcome, 200 OK, healthy"
                                                    value={editingProbe.content_match?.value ?? ''}
                                                    onChange={e => setEditingProbe({
                                                        ...editingProbe,
                                                        content_match: { ...editingProbe.content_match!, value: e.target.value }
                                                    })}
                                                    className="w-full bg-card-secondary border border-border text-text-primary rounded-xl px-4 py-3 outline-none focus:ring-1 focus:ring-blue-500 text-[11px] font-mono shadow-inner transition-all"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Expected HTTP Status Codes (HTTP/HTTPS only) */}
                            {(editingProbe.type === 'HTTP' || editingProbe.type === 'HTTPS') && (
                                <div className="border border-border rounded-xl p-4 space-y-3 bg-card-secondary/30">
                                    <div className="flex items-center justify-between">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-text-primary">
                                            Expected HTTP Status Codes (Valid SLA)
                                        </label>
                                        <span className="text-[9px] text-text-muted opacity-60 font-bold uppercase tracking-widest">
                                            Any other 4xx/5xx status code will cap score at 20
                                        </span>
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="e.g.: 200, 201, 204, 301, 302, 429"
                                        className="w-full bg-card-secondary border border-border text-text-primary rounded-xl px-4 py-3 outline-none focus:ring-1 focus:ring-blue-500 text-[11px] font-mono shadow-inner transition-all"
                                        value={editingProbe.expectedStatusCodesInput ?? (Array.isArray(editingProbe.expectedStatusCodes) ? editingProbe.expectedStatusCodes.join(', ') : '200, 201, 202, 204, 301, 302, 304, 307, 308')}
                                        onChange={e => setEditingProbe({ ...editingProbe, expectedStatusCodesInput: e.target.value })}
                                    />
                                    {/* Preset quick buttons */}
                                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                                        <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider mr-1">Presets:</span>
                                        {[
                                            { label: 'Standard (200-308)', codes: '200, 201, 202, 204, 301, 302, 304, 307, 308' },
                                            { label: '+ 429 (Rate-Limit)', addCode: '429' },
                                            { label: '+ 401/403 (Auth)', addCode: '401, 403' },
                                            { label: '200 Strict', codes: '200' },
                                        ].map((preset, pIdx) => (
                                            <button
                                                key={pIdx}
                                                type="button"
                                                onClick={() => {
                                                    if (preset.codes) {
                                                        setEditingProbe({ ...editingProbe, expectedStatusCodesInput: preset.codes });
                                                    } else if (preset.addCode) {
                                                        const current = editingProbe.expectedStatusCodesInput || (Array.isArray(editingProbe.expectedStatusCodes) ? editingProbe.expectedStatusCodes.join(', ') : '200, 204');
                                                        const parts = current.split(',').map((s: string) => s.trim()).filter(Boolean);
                                                        const toAdd = preset.addCode.split(',').map((s: string) => s.trim()).filter(Boolean);
                                                        const merged = Array.from(new Set([...parts, ...toAdd])).join(', ');
                                                        setEditingProbe({ ...editingProbe, expectedStatusCodesInput: merged });
                                                    }
                                                }}
                                                className="px-2 py-0.5 rounded text-[9px] font-bold border border-border bg-card-secondary/70 hover:bg-card-secondary text-text-secondary hover:text-text-primary transition-all cursor-pointer"
                                            >
                                                {preset.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="flex items-center justify-between gap-3 pt-4 border-t border-border">
                                {isLeader ? (
                                    <button
                                        type="button"
                                        onClick={() => handleDeleteProbe()}
                                        disabled={isDeletingProbe}
                                        className="px-4 py-2.5 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm cursor-pointer disabled:opacity-50"
                                        title="Delete this probe (Leader only)"
                                    >
                                        <Trash2 size={14} />
                                        {isDeletingProbe ? 'Deleting...' : 'Delete Probe'}
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-1.5 text-[11px] text-text-muted/60 select-none">
                                        <Shield size={13} className="text-amber-400/80" />
                                        <span>Deletion managed on Leader</span>
                                    </div>
                                )}
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setIsEditModalOpen(false)}
                                        className="px-5 py-2.5 rounded-xl border border-border text-text-muted hover:text-text-primary hover:bg-card-secondary font-bold text-xs transition-all cursor-pointer"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSaveProbeEdit}
                                        disabled={isSavingProbe || !editingProbe.name || !editingProbe.target}
                                        className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs uppercase tracking-wider transition-all disabled:opacity-50 shadow-lg shadow-blue-500/20 cursor-pointer"
                                    >
                                        {isSavingProbe ? 'Saving...' : 'Save Parameters'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Traceroute Modal */}
            <TracerouteModal
                isOpen={tracerouteTarget !== null}
                onClose={() => setTracerouteTarget(null)}
                initialTarget={tracerouteTarget || ''}
                token={token}
                title="Network Path Trace"
            />
        </div>
    );
}

function cn(...inputs: any[]) {
    return inputs.filter(Boolean).join(' ');
}
