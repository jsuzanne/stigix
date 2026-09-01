import React, { useState, useEffect, useRef } from 'react';
import { Gauge, Activity, Clock, Filter, Download, Zap, Shield, Search, ChevronRight, BarChart3, AlertCircle, Info, ChevronUp, ChevronDown, Flame, Plus, XCircle, RefreshCw, Globe, Play, Pause, TrendingUp, Pencil } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, ResponsiveContainer, AreaChart, Area, ReferenceLine, ReferenceArea } from 'recharts';
import { twMerge } from 'tailwind-merge';

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

interface ConnectivityPerformanceProps {
    token: string;
    uiConfig?: { maxCaptures: number };
    onManage?: () => void;
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
                <div className="text-xs text-text-muted italic py-4">No data available</div>
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
        <div className="h-[130px] flex items-center justify-center text-text-muted text-xs italic opacity-60">No data for this period</div>
    );
    return (
        <div className="h-[130px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 8, bottom: 0, left: -28 }}>
                    <defs>
                        <linearGradient id="globalScoreGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} vertical={false} />
                    <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={9} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} stroke="var(--text-muted)" fontSize={9} tickLine={false} axisLine={false} width={32} />
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
                        stroke="#6366f1" 
                        strokeWidth={2} 
                        fillOpacity={1} 
                        fill="url(#globalScoreGrad)" 
                        dot={{ r: 3.5, stroke: '#6366f1', strokeWidth: 1.5, fill: 'var(--card)' }} 
                        activeDot={{ r: 6, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }} 
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

export default function ConnectivityPerformance({ token, uiConfig, onManage }: ConnectivityPerformanceProps) {
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

    // Edit Probe Modal state
    const [editingProbe, setEditingProbe] = useState<any>(null);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isSavingProbe, setIsSavingProbe] = useState(false);

    const formatDisplayUrl = (endpoint: any) => {
        const target = endpoint.lastResult?.url || '';
        if (endpoint.type !== 'CLOUD') return target;

        if (target.startsWith('advanced-custom#')) {
            try {
                const config = JSON.parse(target.split('#')[1]);
                const params = new URLSearchParams({ mode: config.mode, delay: config.delay.toString() });
                if (config.mode === 'large') params.set('size', config.size);
                if (config.mode === 'error') params.set('code', config.code.toString());
                const host = cloudScenarios[0]?.signedUrl ? new URL(cloudScenarios[0].signedUrl).host : 'stigix-target.stigix.com';
                return `${host}/advanced?${params.toString()}`;
            } catch {
                return target;
            }
        }

        const scenario = cloudScenarios.find(s => s.id === target || s.id === (endpoint.name || '').toLowerCase().replace(/\s+/g, '-'));
        if (scenario?.signedUrl) {
            try {
                const u = new URL(scenario.signedUrl);
                u.searchParams.delete('key');
                u.searchParams.delete('tsg');
                return u.toString().replace(/^https?:\/\//, '');
            } catch {}
        }
        return target || '---';
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

    const authHeaders = () => ({ 'Authorization': `Bearer ${token}` });

    const formatMs = (val: number | undefined | null) => {
        if (val === undefined || val === null) return '0';
        return val < 10 ? val.toFixed(2) : val.toFixed(1);
    };

    // Phase 1: Load probes config immediately (fast endpoints < 200ms)
    const fetchProbesConfig = async () => {
        try {
            const [activeRes, configsRes, scenariosRes] = await Promise.all([
                fetch('/api/connectivity/active-probes', { headers: authHeaders() }),
                fetch('/api/connectivity/custom', { headers: authHeaders() }),
                fetch('/api/target/scenarios', { headers: authHeaders() })
            ]);
            const [activeData, configsData, scenariosData] = await Promise.all([
                activeRes.json(),
                configsRes.json(),
                scenariosRes.json()
            ]);
            if (activeData.success) {
                setActiveProbes(activeData.probes.map((p: any) => p.id));
            }
            if (Array.isArray(scenariosData)) {
                setCloudScenarios(scenariosData);
            }
            const configMap = new Map();
            if (Array.isArray(configsData)) {
                configsData.forEach((config: any) => {
                    const id = config.name.toLowerCase().replace(/\s+/g, '-');
                    configMap.set(id, config);
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
            const dynamicLimit = timeRange === '15m' ? 300 : timeRange === '1h' ? 1500 : timeRange === '6h' ? 5000 : timeRange === '24h' ? 12000 : 30000;
            const [statsRes, resultsRes] = await Promise.all([
                fetch(`/api/connectivity/stats?range=${timeRange}`, { headers: authHeaders() }),
                fetch(`/api/connectivity/results?timeRange=${timeRange}&limit=${dynamicLimit}`, { headers: authHeaders() })
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
        await fetchProbesConfig();
        await fetchStatsAndResults();
    };

    const startEditProbe = (endpoint: any) => {
        const config = endpointConfigs.get(endpoint.id) || {};
        const type = (config.type || endpoint.type || 'HTTP').toUpperCase();
        const isHttp = type === 'HTTP' || type === 'HTTPS';
        
        setEditingProbe({
            _originalName: config.name || endpoint.name,
            name: config.name || endpoint.name || '',
            type,
            target: config.target || endpoint.target || '',
            timeout: config.timeout || (type === 'PING' ? 2000 : 5000),
            frequency: config.frequency || (isHttp ? 300 : 60),
            enabled: config.enabled ?? true,
            content_match: config.content_match ? { ...config.content_match } : { enabled: false, mode: 'contains', value: '', case_sensitive: false }
        });
        setIsEditModalOpen(true);
    };

    const handleSaveProbeEdit = async () => {
        if (!editingProbe || !editingProbe.name || !editingProbe.target) return;
        setIsSavingProbe(true);
        try {
            const res = await fetch('/api/connectivity/custom', { headers: authHeaders() });
            const allEndpoints = await res.json();
            
            const origName = (editingProbe._originalName || editingProbe.name).toLowerCase();
            const index = Array.isArray(allEndpoints) ? allEndpoints.findIndex((p: any) => (p.name || '').toLowerCase() === origName) : -1;
            
            let formattedTarget = editingProbe.target.trim();
            if ((editingProbe.type === 'HTTP' || editingProbe.type === 'HTTPS') && !formattedTarget.startsWith('http://') && !formattedTarget.startsWith('https://')) {
                formattedTarget = `${editingProbe.type.toLowerCase()}://${formattedTarget}`;
            }

            const updatedProbe = {
                name: editingProbe.name.trim(),
                type: editingProbe.type,
                target: formattedTarget,
                timeout: Number(editingProbe.timeout) || 5000,
                frequency: Number(editingProbe.frequency) || (['HTTP', 'HTTPS', 'CLOUD'].includes(editingProbe.type) ? 300 : 60),
                enabled: editingProbe.enabled ?? true,
                ...(editingProbe.content_match?.enabled ? { content_match: editingProbe.content_match } : { content_match: { enabled: false } })
            };

            let updatedList = Array.isArray(allEndpoints) ? [...allEndpoints] : [];
            if (index >= 0) {
                updatedList[index] = { ...updatedList[index], ...updatedProbe };
            } else {
                updatedList.push(updatedProbe);
            }

            await fetch('/api/connectivity/custom', {
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
        } catch (err) {
            console.error('Failed to update probe:', err);
        } finally {
            setIsSavingProbe(false);
        }
    };

    const toggleProbeStatus = async (endpoint: any, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            const res = await fetch('/api/connectivity/custom', { headers: authHeaders() });
            const allEndpoints = await res.json();

            const updatedEndpoints = allEndpoints.map((p: any) => {
                const pid = p.name.toLowerCase().replace(/\s+/g, '-');
                if (pid === endpoint.id) {
                    return { ...p, enabled: !endpoint.enabled };
                }
                return p;
            });

            await fetch('/api/connectivity/custom', {
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
        fetchProbesConfig();           // Phase 1: immediate
        fetchStatsAndResults();         // Phase 2: async
        const interval = setInterval(fetchData, 60000); // Refresh both every 60s
        return () => clearInterval(interval);
    }, [timeRange]);

    const getScoreColor = (score: number) => {
        if (score >= 80) return 'text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/20';
        if (score >= 50) return 'text-orange-500 dark:text-orange-400 bg-orange-500/10 border-orange-500/20';
        if (score > 0) return 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20';
        return 'text-text-muted bg-card-secondary border-border';
    };

    const formatTimestamp = (ts: number) => {
        return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    // Aggregate data for table - OPTIMIZED O(N) instead of O(N^2)
    const endpoints = React.useMemo(() => {
        // First pass: Group results by endpointId
        const groups: Record<string, any[]> = {};
        results.forEach(r => {
            if (!groups[r.endpointId]) groups[r.endpointId] = [];
            groups[r.endpointId].push(r);
        });

        return Object.entries(groups).map(([id, endpointResults]) => {
            const last = endpointResults[0];
            const reachable = endpointResults.filter(r => r.reachable);

            // Get enabled status from config
            const config = endpointConfigs.get(id);
            const enabled = config?.enabled !== false; // default true

            // Sparkline histories — up to 15 most recent, chronological order
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
                enabled,
                source: config?.source,
                stale: config?.stale,
                content_match: config?.content_match, // ← pass full content_match config to modal
                // Sparkline data arrays (chronological)
                scoreHistory: histSlice.map(r => r.score),
                latencyHistory: reachableSlice.map(r => Math.round(r.metrics.total_ms)),
            };
        }).filter(e => {
            if (activeProbes.length > 0 && !activeProbes.includes(e.id)) return false;
            if (!e.enabled) return false; // Filter out inactive if not showing
            
            // Filtering logic
            if (filterType === 'PRISMA SDWAN') {
                if (e.source !== 'discovery') return false;
            } else if (filterType !== 'ALL' && e.type !== filterType) {
                return false;
            }
            
            if (searchQuery && !e.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
            return true;
        }).sort((a: any, b: any) => {
            // First sort by enabled status (enabled first)
            if (a.enabled !== b.enabled) {
                return a.enabled ? -1 : 1;
            }

            let valA: any = a[sortField];
            let valB: any = b[sortField];

            // Custom mappings for special fields
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
    }, [results, activeProbes, filterType, searchQuery, sortField, sortDirection, endpointConfigs]);

    // Pending probes: configs that have no result yet — shown as "ghost" rows
    const pendingProbes = React.useMemo(() => {
        const idsWithResults = new Set(results.map(r => r.endpointId));
        const pending: any[] = [];
        endpointConfigs.forEach((config, id) => {
            if (!idsWithResults.has(id) && config.enabled !== false) {
                pending.push({
                    id,
                    name: config.name,
                    type: (config.type || 'HTTP').toUpperCase(),
                    target: config.target,
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
                    content_match: config.content_match,
                    scoreHistory: [],
                    latencyHistory: [],
                });
            }
        });
        return pending;
    }, [results, endpointConfigs]);

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

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header Analytics */}
            <div className="flex flex-col gap-4">
                
                {/* 1. Combined Top Panel (Score, Trend, Flaky) */}
                <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden flex flex-col xl:flex-row">
                    
                    {/* Left: Global Experience */}
                    <div className="flex flex-col border-b xl:border-b-0 xl:border-r border-border bg-card-secondary/10 w-full xl:w-[250px] shrink-0">
                        <div className="flex items-center justify-center px-6 py-3 border-b border-border bg-card-secondary/40 h-[49px]">
                            <div className="text-[10px] font-black text-text-muted uppercase tracking-widest flex items-center gap-2">
                                <Gauge size={14} className="text-blue-500" /> Global Experience
                            </div>
                        </div>
                        <div className="flex-1 p-6 flex flex-col items-center justify-center text-center">
                            {loadingStats ? (
                                <div className="h-12 w-24 bg-card-secondary animate-pulse rounded-lg mb-1" />
                            ) : (
                                <div className={cn("text-5xl font-black mb-1 tracking-tighter", stats?.globalHealth >= 80 ? "text-green-600 dark:text-green-400" : stats?.globalHealth >= 50 ? "text-orange-500" : "text-red-500")}>
                                    {stats?.globalHealth || 0}<span className="text-xl text-text-muted">/100</span>
                                </div>
                            )}
                            <div className="text-[10px] text-text-muted font-bold tracking-tight opacity-70 mt-1">Avg. Scoring across all probes</div>
                        </div>
                    </div>

                    {/* Middle: Trend Chart */}
                    <div className="flex-1 flex flex-col min-w-0 border-b xl:border-b-0 xl:border-r border-border">
                        <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card-secondary/40 h-[49px]">
                            <div className="text-[10px] font-black text-text-muted uppercase tracking-widest flex items-center gap-2">
                                <TrendingUp size={14} className="text-indigo-500" /> Score Trend
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
                        <div className="px-6 pt-4 pb-3 flex-1 flex flex-col justify-end">
                            {loadingStats ? (
                                <div className="h-[140px] flex items-center justify-center"><div className="w-full h-full bg-card-secondary animate-pulse rounded-xl" /></div>
                            ) : (
                                <div className="h-[140px] w-full">
                                    <GlobalScoreTrendChart results={results} timeRange={timeRange} />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right: Flaky Probes */}
                    <div className="w-full xl:w-[320px] shrink-0 flex flex-col min-w-0">
                        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-card-secondary/40 h-[49px]">
                            <div className="text-[10px] font-black text-text-muted uppercase tracking-widest flex items-center gap-2">
                                <Flame size={14} className="text-orange-500" /> Flaky Probes
                            </div>
                        </div>
                        <div className="p-5 space-y-2 overflow-y-auto flex-1 max-h-[250px] xl:max-h-none bg-card-secondary/5">
                            {loadingStats ? (
                                <>
                                    <div className="h-8 bg-card-secondary animate-pulse rounded border border-border" />
                                    <div className="h-8 bg-card-secondary animate-pulse rounded border border-border opacity-60" />
                                </>
                            ) : stats?.flakyEndpoints?.filter((e: any) => {
                                if (activeProbes.length > 0 && !activeProbes.includes(e.id)) return false;
                                return true;
                            }).length > 0 ? stats.flakyEndpoints
                                .filter((e: any) => {
                                    if (activeProbes.length > 0 && !activeProbes.includes(e.id)) return false;
                                    return true;
                                })
                                .map((e: any) => (
                                    <div key={e.id} className="flex items-center justify-between gap-2 text-[11px] bg-red-500/5 border border-red-500/20 p-2 rounded-lg transition-colors hover:bg-red-500/10">
                                        <span className="text-text-primary font-bold min-w-0 flex-1 truncate pr-2">{e.name}</span>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <span className="text-red-600 dark:text-red-400 font-black font-mono">{e.reliability}%</span>
                                        </div>
                                    </div>
                                )) : (
                                <div className="text-xs text-text-muted italic py-4 text-center">All probes stable</div>
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
                            {endpoints.length} active probes
                        </span>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                        <EndpointTypeGraph
                            type="HTTP/HTTPS"
                            results={httpResults}
                            color="#3b82f6"
                            count={endpoints.filter(e => e.type === 'HTTP' || e.type === 'HTTPS').length}
                        />
                        <EndpointTypeGraph
                            type="PING"
                            results={pingResults}
                            color="#22c55e"
                            count={endpoints.filter(e => e.type === 'PING').length}
                        />
                        <EndpointTypeGraph
                            type="DNS"
                            results={dnsResults}
                            color="#a855f7"
                            count={endpoints.filter(e => e.type === 'DNS').length}
                        />
                        <EndpointTypeGraph
                            type="UDP"
                            results={udpResults}
                            color="#f97316"
                            count={endpoints.filter(e => e.type === 'UDP').length}
                        />
                        <EndpointTypeGraph
                            type="STIGIX CLOUD"
                            results={cloudResults}
                            color="#6366f1"
                            count={endpoints.filter(e => e.type === 'CLOUD' || e.type === 'STIGIX CLOUD').length}
                        />
                    </div>
                </div>
            </div>

            {/* Filters & Export */}
            <div className="bg-blue-600/5 border border-blue-500/20 p-4 rounded-xl flex items-start gap-3 mb-2 shadow-sm">
                <Info size={18} className="text-blue-500 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                    <h4 className="text-xs font-bold text-blue-600 dark:text-blue-400 tracking-wider">How is the score calculated?</h4>
                    <p className="text-[11px] text-text-muted leading-relaxed italic">
                        The performance score (0-100) is a weighted calculation for SD-WAN path quality:
                        <span className="text-blue-600 dark:text-blue-400 font-bold ml-1">Total Latency</span>,
                        <span className="text-blue-600 dark:text-blue-400 font-bold ml-1">Jitter/Loss (UDP)</span>, and
                        <span className="text-blue-600 dark:text-blue-400 font-bold ml-1">TTFB (HTTP)</span>.
                        Errors/Timeouts result in a score of <span className="text-red-500 font-black">0</span>.
                        <span className="block mt-1 text-text-muted/60 font-bold flex items-center gap-1 uppercase tracking-tighter text-[9px]">
                            <Clock size={10} /> Probes run automatically every 1 minute.
                        </span>
                    </p>
                </div>
            </div>

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card-secondary/50 p-4 rounded-xl border border-border shadow-sm backdrop-blur-sm">
                <div className="flex items-center gap-3">
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
                        {['ALL', 'HTTP', 'HTTPS', 'PING', 'TCP', 'UDP', 'DNS', 'CLOUD', 'PRISMA SDWAN'].map(t => {
                            const count = t === 'ALL'
                                ? endpoints.length
                                : t === 'CLOUD'
                                    ? endpoints.filter(e => e.type === 'CLOUD' || e.type === 'STIGIX CLOUD').length
                                    : t === 'PRISMA SDWAN'
                                        ? endpoints.filter(e => e.type === 'PRISMA' || e.type === 'PRISMA SDWAN').length
                                        : endpoints.filter(e => e.type === t).length;
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
                    <div className="flex items-center gap-2 mr-4">
                        <Clock size={14} className="text-text-muted" />
                        <select
                            value={timeRange}
                            onChange={(e) => setTimeRange(e.target.value)}
                            className="bg-transparent border-none text-text-muted text-xs font-bold focus:ring-0 cursor-pointer hover:text-text-primary uppercase tracking-tight"
                        >
                            <option value="15m">15 Minutes</option>
                            <option value="1h">1 Hour</option>
                            <option value="6h">6 Hours</option>
                            <option value="24h">24 Hours</option>
                            <option value="7d">7 Days</option>
                        </select>
                    </div>


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
                        {/* Pending (ghost) probes — never run yet */}
                        {pendingProbes.filter(p => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase())).map(e => (
                            <tr key={`pending-${e.id}`} className="hover:bg-card-secondary/50 transition-colors group cursor-default animate-pulse-subtle">
                                <td className="px-6 py-4">
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-bold text-text-primary tracking-tight opacity-70">{e.name}</span>
                                            <span className="px-1.5 py-0.5 rounded-[4px] text-[8px] font-black uppercase tracking-widest bg-slate-500/10 text-slate-400 flex items-center gap-1">
                                                <Activity size={9} className="animate-spin" style={{animationDuration:'3s'}}/>
                                                pending
                                            </span>
                                        </div>
                                        <span className="text-[10px] text-text-muted font-mono opacity-60 leading-tight mt-0.5">{e.target}</span>
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
                                    <span className="px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest bg-blue-500/10 text-blue-400">Scheduled</span>
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
                                                startEditProbe(e);
                                            }}
                                            className="p-2 rounded-lg transition-all border border-transparent flex items-center justify-center text-text-muted hover:bg-blue-500/10 hover:text-blue-500 hover:border-blue-500/20"
                                            title="Edit Probe Parameters"
                                        >
                                            <Pencil size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {/* Normal probes with results */}
                        {endpoints.map(e => (
                            <tr key={e.id} 
                                onClick={(ev) => { ev.stopPropagation(); setSelectedEndpoint(e); setShowDetailModal(true); }}
                                className={cn(
                                "hover:bg-card-secondary transition-colors group cursor-pointer",
                                !e.enabled && "opacity-40"
                            )}>
                                <td className="px-6 py-4">
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-sm font-bold text-text-primary group-hover:text-blue-500 transition-colors tracking-tight">{e.name}</span>
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
                                        <span className="text-[10px] text-text-muted font-mono break-all opacity-80 leading-tight mt-0.5">
                                            {formatDisplayUrl(e)}
                                        </span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-center align-middle">
                                    <span className={cn(
                                        "px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-tighter",
                                        e.type === 'HTTPS' ? "text-purple-600 dark:text-purple-400 bg-purple-500/10 border-purple-500/20" :
                                            e.type === 'HTTP' ? "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20" :
                                                e.type === 'CLOUD' ? "text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20" :
                                                    "text-orange-500 bg-orange-500/10 border-orange-500/20"
                                    )}>
                                        {e.type === 'CLOUD' ? 'STIGIX CLOUD' : e.type}
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
                                                startEditProbe(e);
                                            }}
                                            className="p-2 rounded-lg transition-all border border-transparent flex items-center justify-center text-text-muted hover:bg-blue-500/10 hover:text-blue-500 hover:border-blue-500/20"
                                            title="Edit Probe Parameters"
                                        >
                                            <Pencil size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {endpoints.length === 0 && (
                <div className="p-12 text-center text-text-muted flex flex-col items-center gap-3 bg-card/40">
                        <Activity size={48} className="text-text-muted opacity-30" />
                        <div className="text-sm font-bold tracking-widest">No performance data captured yet</div>
                        <div className="text-[10px] max-w-xs leading-relaxed italic opacity-70">HTTP/HTTPS probes run every 5 min by default. PING/DNS/TCP probes run every 60s.</div>
                    </div>
                )}
            </div>

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
                                        {selectedEndpoint.name}
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
                                    <p className="text-[10px] text-text-muted font-mono font-bold break-all max-w-[700px] mt-1">{formatDisplayUrl(selectedEndpoint)}</p>
                                </div>
                            </div>
                            <button onClick={() => setShowDetailModal(false)} className="p-2 hover:bg-card-secondary rounded-lg text-text-muted hover:text-text-primary transition-colors">
                                <XCircle size={24} />
                            </button>
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

                            {/* Discovery Parameters - Hidden for Prisma SD-WAN probes */}
                            {false && (selectedEndpoint as any).source === 'discovery' && (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div className="bg-card-secondary/30 p-4 rounded-xl border border-border">
                                        <div className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-1">Site ID</div>
                                        <div className="text-xs font-bold text-text-primary">{(selectedEndpoint as any).site_id}</div>
                                    </div>
                                    <div className="bg-card-secondary/30 p-4 rounded-xl border border-border">
                                        <div className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-1">Interface</div>
                                        <div className="text-xs font-bold text-text-primary">
                                            {(selectedEndpoint as any).selected_interface_label || (selectedEndpoint as any).selected_interface_name}
                                        </div>
                                    </div>
                                    <div className="bg-card-secondary/30 p-4 rounded-xl border border-border">
                                        <div className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-1">Network</div>
                                        <div className="text-xs font-bold text-text-primary">{(selectedEndpoint as any).selected_network}</div>
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
                                            {selectedEndpointResults.slice(0, maxCaptures).map((r, i) => (
                                                <tr key={i} className="hover:bg-card-secondary transition-colors">
                                                    <td className="px-4 py-3 text-text-primary font-bold uppercase tracking-tighter whitespace-nowrap">{formatTimestamp(r.timestamp)}</td>
                                                    <td className="px-4 py-3 text-center">
                                                        <span className={cn("font-black px-2 py-0.5 rounded text-[11px]", r.score >= 80 ? "text-green-600 dark:text-green-400" : "text-red-500")}>
                                                            {r.score}
                                                        </span>
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
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
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
                                    <select
                                        className="w-full bg-card-secondary border border-border text-text-primary rounded-xl px-4 py-3 outline-none focus:ring-1 focus:ring-blue-500 text-[11px] font-black tracking-widest shadow-inner transition-all"
                                        value={editingProbe.type}
                                        onChange={e => {
                                            const t = e.target.value;
                                            const isHttp = t === 'HTTP' || t === 'HTTPS';
                                            const defaultFreq = isHttp ? 300 : 60;
                                            setEditingProbe({ ...editingProbe, type: t, timeout: t === 'PING' ? 2000 : 5000, frequency: defaultFreq });
                                        }}
                                    >
                                        <option value="HTTP">HTTP</option>
                                        <option value="HTTPS">HTTPS</option>
                                        <option value="PING">ICMP (Ping)</option>
                                        <option value="TCP">TCP Port</option>
                                        <option value="DNS">DNS Query</option>
                                        <option value="UDP">UDP Stream</option>
                                        <option value="CLOUD">Stigix Cloud</option>
                                    </select>
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
                                        value={editingProbe.timeout || 5000}
                                        onChange={e => {
                                            const val = parseInt(e.target.value);
                                            setEditingProbe({ ...editingProbe, timeout: isNaN(val) ? 5000 : Math.min(60000, Math.max(1000, val)) });
                                        }}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between ml-1 leading-none">
                                        <label className="text-[9px] font-black text-text-muted tracking-[0.2em] uppercase">Freq (s)</label>
                                        <span className="text-[8px] font-bold text-text-muted/50 tracking-wider">MIN 30 — MAX 3600 — default: HTTP/S=300 · other=60</span>
                                    </div>
                                    <input
                                        type="number"
                                        min="30"
                                        max="3600"
                                        step="10"
                                        className="w-full bg-card-secondary border border-border text-text-primary rounded-xl px-4 py-3 outline-none focus:ring-1 focus:ring-blue-500 text-[11px] font-black tracking-widest shadow-inner transition-all"
                                        value={editingProbe.frequency || 300}
                                        onChange={e => {
                                            const val = parseInt(e.target.value);
                                            setEditingProbe({ ...editingProbe, frequency: isNaN(val) ? 300 : Math.min(3600, Math.max(30, val)) });
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
                                                    <select
                                                        value={editingProbe.content_match?.mode ?? 'contains'}
                                                        onChange={e => setEditingProbe({
                                                            ...editingProbe,
                                                            content_match: { ...editingProbe.content_match!, mode: e.target.value as 'contains' | 'not_contains' }
                                                        })}
                                                        className="w-full bg-card-secondary border border-border text-text-primary rounded-xl px-3 py-2.5 outline-none focus:ring-1 focus:ring-blue-500 text-[10px] font-bold"
                                                    >
                                                        <option value="contains">contains</option>
                                                        <option value="not_contains">not_contains</option>
                                                    </select>
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

                            <div className="flex justify-end gap-3 pt-4 border-t border-border">
                                <button
                                    onClick={() => setIsEditModalOpen(false)}
                                    className="px-5 py-2.5 rounded-xl border border-border text-text-muted hover:text-text-primary hover:bg-card-secondary font-bold text-xs transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSaveProbeEdit}
                                    disabled={isSavingProbe || !editingProbe.name || !editingProbe.target}
                                    className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs uppercase tracking-wider transition-all disabled:opacity-50 shadow-lg shadow-blue-500/20"
                                >
                                    {isSavingProbe ? 'Saving...' : 'Save Parameters'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function cn(...inputs: any[]) {
    return inputs.filter(Boolean).join(' ');
}
