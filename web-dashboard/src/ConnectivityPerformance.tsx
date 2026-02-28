import React, { useState, useEffect } from 'react';
import { Gauge, Activity, Clock, Filter, Download, Zap, Shield, Search, ChevronRight, BarChart3, AlertCircle, Info, ChevronUp, ChevronDown, Flame, Plus, XCircle, RefreshCw, Globe } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { twMerge } from 'tailwind-merge';

interface ConnectivityPerformanceProps {
    token: string;
    onManage?: () => void;
}

// Component for individual endpoint type graph
function EndpointTypeGraph({ type, results, color }: { type: string; results: any[]; color: string }) {
    // Filter successful results (reachable and score > 0)
    const successResults = results.filter(r => r.reachable && r.score > 0);

    // Calculate metrics
    const avgScore = successResults.length > 0
        ? Math.round(successResults.reduce((sum, r) => sum + r.score, 0) / successResults.length)
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

    if (results.length === 0) {
        return (
            <div className="bg-card border border-border p-4 rounded-xl shadow-sm">
                <div className="text-text-muted text-xs font-bold mb-2 tracking-wider">{type}</div>
                <div className="text-xs text-text-muted italic">No data available</div>
            </div>
        );
    }

    return (
        <div className="bg-card border border-border p-4 rounded-xl shadow-sm">
            <div className="text-text-muted text-xs font-bold mb-2 uppercase tracking-wider">{type}</div>
            <div className="flex items-center gap-4 mb-3 text-[10px] font-bold">
                <div className="flex items-center gap-1">
                    <span className="text-text-muted">Score:</span>
                    <span className={twMerge("font-black", avgScore >= 80 ? "text-green-600 dark:text-green-400" : avgScore >= 50 ? "text-orange-500" : "text-red-500")}>
                        {avgScore}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-text-muted">Latency:</span>
                    <span className="text-text-primary font-mono">{avgLatency}ms</span>
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-text-muted">Success:</span>
                    <span className={twMerge("font-black", successRate >= 95 ? "text-green-600 dark:text-green-400" : successRate >= 80 ? "text-orange-500" : "text-red-500")}>
                        {successRate}%
                    </span>
                </div>
            </div>
            <div className="h-[80px] w-full">
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
        </div>
    );
}


export default function ConnectivityPerformance({ token, onManage }: ConnectivityPerformanceProps) {
    const [results, setResults] = useState<any[]>([]);
    const [stats, setStats] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [timeRange, setTimeRange] = useState('24h');
    const [graphTimeRange, setGraphTimeRange] = useState('6h'); // Separate time range for graphs
    const [filterType, setFilterType] = useState('ALL');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedEndpoint, setSelectedEndpoint] = useState<any>(null);
    const [showDetailModal, setShowDetailModal] = useState(false);
    const [activeProbes, setActiveProbes] = useState<string[]>([]); // List of active endpoint IDs
    const [showDeleted, setShowDeleted] = useState(false);
    const [showInactive, setShowInactive] = useState(false);
    const [endpointConfigs, setEndpointConfigs] = useState<Map<string, any>>(new Map());

    // Sorting state
    const [sortField, setSortField] = useState<string>('name');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<any>(null);

    const authHeaders = () => ({ 'Authorization': `Bearer ${token}` });

    const formatMs = (val: number | undefined | null) => {
        if (val === undefined || val === null) return '0';
        return val < 10 ? val.toFixed(2) : val.toFixed(1);
    };

    const fetchData = async () => {
        try {
            const [statsRes, resultsRes, activeRes, configsRes] = await Promise.all([
                fetch(`/api/connectivity/stats?range=${timeRange}`, { headers: authHeaders() }),
                fetch(`/api/connectivity/results?timeRange=${timeRange}&limit=500`, { headers: authHeaders() }),
                fetch('/api/connectivity/active-probes', { headers: authHeaders() }),
                fetch('/api/connectivity/custom', { headers: authHeaders() })
            ]);

            const [statsData, resultsData, activeData, configsData] = await Promise.all([
                statsRes.json(),
                resultsRes.json(),
                activeRes.json(),
                configsRes.json()
            ]);

            setStats(statsData);
            setResults(resultsData.results || []);
            if (activeData.success) {
                setActiveProbes(activeData.probes.map((p: any) => p.id));
            }

            // Build map of endpoint configs by ID (matching server.ts line 1499)
            const configMap = new Map();
            if (Array.isArray(configsData)) {
                configsData.forEach((config: any) => {
                    const id = config.name.toLowerCase().replace(/\s+/g, '-');
                    configMap.set(id, config);
                });
            }
            setEndpointConfigs(configMap);
        } catch (e) {
            console.error("Failed to fetch connectivity data", e);
        } finally {
            setLoading(false);
        }
    };

    const syncDiscovery = async () => {
        setIsSyncing(true);
        setSyncResult(null);
        try {
            const res = await fetch('/api/probes/discovery/sync', { method: 'POST', headers: authHeaders() });
            const data = await res.json();
            setSyncResult(data);
            fetchData();
            setTimeout(() => setSyncResult(null), 5000);
        } catch (e) {
            console.error("Sync failed", e);
        } finally {
            setIsSyncing(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 60000); // Optimized: 60s instead of 30s
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

            return {
                id,
                name: last?.endpointName || 'Unknown',
                type: last?.endpointType || 'HTTP',
                lastScore: last?.score || 0,
                avgScore: reachable.length > 0 ? Math.round(reachable.reduce((acc, r) => acc + r.score, 0) / reachable.length) : 0,
                avgLatency: reachable.length > 0 ? Math.round(reachable.reduce((acc, r) => acc + r.metrics.total_ms, 0) / reachable.length) : 0,
                maxLatency: reachable.length > 0 ? Math.max(...reachable.map(r => r.metrics.total_ms)) : 0,
                checks: endpointResults.length,
                successRate: Math.round((reachable.length / endpointResults.length) * 100),
                lastResult: last,
                enabled,
                source: config?.source,
                stale: config?.stale
            };
        }).filter(e => {
            if (!showDeleted && activeProbes.length > 0 && !activeProbes.includes(e.id)) return false;
            if (!showInactive && !e.enabled) return false; // Filter out inactive if not showing
            if (filterType !== 'ALL' && e.type !== filterType) return false;
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
    }, [results, showDeleted, activeProbes, filterType, searchQuery, sortField, sortDirection, endpointConfigs, showInactive]);

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

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header Analytics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-card border border-border p-6 rounded-2xl flex flex-col items-center justify-center text-center shadow-sm">
                    <div className="text-text-muted text-xs font-bold mb-2 tracking-wider flex items-center gap-2">
                        <Gauge size={16} /> Global Experience
                    </div>
                    <div className={cn("text-4xl font-black mb-1 tracking-tighter", stats?.globalHealth >= 80 ? "text-green-600 dark:text-green-400" : stats?.globalHealth >= 50 ? "text-orange-500" : "text-red-500")}>
                        {stats?.globalHealth || 0}<span className="text-lg text-text-muted">/100</span>
                    </div>
                    <div className="text-[10px] text-text-muted font-bold tracking-tight opacity-70">Avg. Scoring across all probes</div>
                </div>

                <div className="bg-card border border-border p-6 rounded-2xl flex flex-col items-center justify-center text-center shadow-sm">
                    <div className="text-text-muted text-xs font-bold mb-2 tracking-wider flex items-center gap-2">
                        <Activity size={16} /> HTTP Coverage
                    </div>
                    <div className="text-3xl font-black text-blue-600 dark:text-blue-400 mb-1 tracking-tighter">
                        {stats?.httpEndpoints?.total || 0}
                    </div>
                    <div className="text-[10px] text-text-muted font-bold tracking-tight opacity-70">Active Synthetic Endpoints</div>
                </div>

                <div className="bg-card border border-border p-6 rounded-2xl flex flex-col shadow-sm">
                    <div className="text-text-muted text-[10px] font-bold mb-3 tracking-widest flex items-center gap-2">
                        <Flame size={14} className="text-orange-500" /> Flaky Endpoints
                    </div>
                    <div className="space-y-2">
                        {stats?.flakyEndpoints?.filter((e: any) => {
                            if (showDeleted) return true;
                            if (activeProbes.length > 0 && !activeProbes.includes(e.id)) return false;
                            return true;
                        }).length > 0 ? stats.flakyEndpoints
                            .filter((e: any) => {
                                if (showDeleted) return true;
                                if (activeProbes.length > 0 && !activeProbes.includes(e.id)) return false;
                                return true;
                            })
                            .map((e: any) => (
                                <div key={e.id} className="flex items-center justify-between gap-2 text-[11px] bg-red-500/5 border border-red-500/10 p-1.5 rounded">
                                    <span className="text-text-primary font-bold min-w-0 flex-1">{e.name}</span>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        <span className="text-red-600 dark:text-red-400 font-bold font-mono">{e.reliability}%</span>
                                        <div className="w-1 h-1 rounded-full bg-border" />
                                        <span className="text-text-muted font-mono">{e.avgScore}</span>
                                    </div>
                                </div>
                            )) : (
                            <div className="text-xs text-text-muted italic py-2">All probes stable</div>
                        )}
                    </div>
                </div>

                {/* Performance Trends by Endpoint Type */}
                <div className="md:col-span-4 bg-card-secondary/30 border border-border p-6 rounded-2xl shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <div className="text-text-muted text-xs font-bold tracking-wider flex items-center gap-2">
                            <BarChart3 size={16} /> Performance Trends by Type
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-text-muted font-bold uppercase">Time Range:</span>
                            {['1h', '6h', '24h', '7d'].map(range => (
                                <button
                                    key={range}
                                    onClick={() => setGraphTimeRange(range)}
                                    className={twMerge(
                                        "px-2 py-1 text-[10px] font-bold uppercase rounded transition-all",
                                        graphTimeRange === range
                                            ? "bg-blue-600 text-white"
                                            : "bg-card-secondary text-text-muted hover:bg-card-secondary/80"
                                    )}
                                >
                                    {range}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <EndpointTypeGraph type="HTTP/HTTPS" results={httpResults} color="#3b82f6" />
                        <EndpointTypeGraph type="PING" results={pingResults} color="#22c55e" />
                        <EndpointTypeGraph type="DNS" results={dnsResults} color="#a855f7" />
                        <EndpointTypeGraph type="UDP" results={udpResults} color="#f97316" />
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
                            <Clock size={10} /> Probes run automatically every 5 minutes.
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
                    <div className="flex p-1 bg-card-secondary rounded-lg border border-border">
                        {['ALL', 'HTTP', 'HTTPS', 'PING', 'TCP', 'UDP', 'DNS'].map(t => (
                            <button
                                key={t}
                                onClick={() => setFilterType(t)}
                                className={cn(
                                    "px-3 py-1 rounded-md text-[11px] font-bold transition-all uppercase tracking-tighter",
                                    filterType === t ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20" : "text-text-muted hover:text-text-primary"
                                )}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={() => setShowDeleted(!showDeleted)}
                        className={cn(
                            "px-3 py-2 rounded-lg text-[11px] font-bold border transition-all flex items-center gap-2 uppercase tracking-tight",
                            showDeleted
                                ? "bg-card-secondary text-text-primary border-border"
                                : "bg-card/40 text-text-muted border-border hover:border-text-muted/20"
                        )}
                    >
                        <Clock size={14} className={showDeleted ? "text-blue-600 dark:text-blue-400" : ""} />
                        {showDeleted ? "Hide Deleted" : "Show Deleted"}
                    </button>
                    <button
                        onClick={() => setShowInactive(!showInactive)}
                        className={cn(
                            "px-3 py-2 rounded-lg text-[11px] font-bold border transition-all flex items-center gap-2 uppercase tracking-tight",
                            showInactive
                                ? "bg-orange-500/10 text-orange-600 border-orange-500/20"
                                : "bg-card/40 text-text-muted border-border hover:border-text-muted/20"
                        )}
                    >
                        <XCircle size={14} className={showInactive ? "text-orange-600 dark:text-orange-400" : ""} />
                        {showInactive ? "Hide Inactive" : "Show Inactive"}
                    </button>
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

                    <button
                        onClick={syncDiscovery}
                        disabled={isSyncing}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all border",
                            isSyncing
                                ? "bg-card-secondary text-text-muted border-border cursor-not-allowed"
                                : "bg-card/40 text-blue-600 dark:text-blue-400 border-blue-500/20 hover:bg-blue-500/10 shadow-sm"
                        )}
                    >
                        <RefreshCw size={14} className={cn(isSyncing && "animate-spin")} />
                        {isSyncing ? "Syncing..." : "Sync Prisma SD-WAN"}
                    </button>

                    {onManage && (
                        <button
                            onClick={onManage}
                            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-lg shadow-blue-900/20"
                        >
                            <Plus size={14} /> Manage Endpoints
                        </button>
                    )}
                </div>
            </div>

            {syncResult && (
                <div className="bg-green-500/10 border border-green-500/20 p-3 rounded-xl flex items-center justify-between animate-in slide-in-from-top-2 duration-300">
                    <div className="flex items-center gap-3 text-xs font-bold text-green-600 dark:text-green-400 uppercase tracking-tight">
                        <Zap size={16} />
                        Discovery Sync Complete: {syncResult.created} created, {syncResult.updated} updated, {syncResult.staleMarked} stale.
                    </div>
                </div>
            )}

            {/* Metrics Table */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-xl shadow-black/5">
                <table className="w-full text-left">
                    <thead className="bg-card-secondary/50 border-b border-border">
                        <tr>
                            <th
                                className="px-6 py-4 text-[11px] font-bold text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-primary transition-colors"
                                onClick={() => handleSort('name')}
                            >
                                <div className="flex items-center">Endpoint <SortIndicator field="name" /></div>
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
                        {endpoints.map(e => (
                            <tr key={e.id} className={cn(
                                "hover:bg-card-secondary transition-colors group",
                                !e.enabled && "opacity-40"
                            )}>
                                <td className="px-6 py-4">
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-bold text-text-primary group-hover:text-blue-500 transition-colors uppercase tracking-tight">{e.name}</span>
                                            {e.source === 'discovery' && (
                                                <span className={cn(
                                                    "px-1.5 py-0.5 rounded-[4px] text-[8px] font-black uppercase tracking-widest flex items-center gap-1",
                                                    e.stale ? "bg-orange-500/20 text-orange-500" : "bg-blue-500/20 text-blue-500"
                                                )}>
                                                    <Globe size={10} /> {e.stale && "STALE"}
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-[10px] text-text-muted font-mono truncate max-w-[200px]">{e.lastResult.url}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-center">
                                    <span className={cn(
                                        "px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-tighter",
                                        e.type === 'HTTPS' ? "text-purple-600 dark:text-purple-400 bg-purple-500/10 border-purple-500/20" :
                                            e.type === 'HTTP' ? "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20" :
                                                "text-orange-500 bg-orange-500/10 border-orange-500/20"
                                    )}>
                                        {e.type}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-center">
                                    <span className={cn(
                                        "px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest",
                                        e.enabled
                                            ? "bg-green-500/10 text-green-600 dark:text-green-400"
                                            : "bg-gray-500/10 text-gray-500 dark:text-gray-400"
                                    )}>
                                        {e.enabled ? "Active" : "Inactive"}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-center">
                                    <div className={cn(
                                        "inline-flex items-center justify-center w-12 h-8 rounded-lg border font-black text-sm shadow-sm",
                                        getScoreColor(e.lastScore)
                                    )}>
                                        {e.lastScore}
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-center">
                                    <div className="flex flex-col items-center">
                                        <span className="text-sm font-bold text-text-secondary font-mono">{formatMs(e.avgLatency)}ms</span>
                                        <span className="text-[10px] text-text-muted font-bold opacity-60 uppercase">Max: {formatMs(e.maxLatency)}ms</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex flex-col items-center gap-1.5">
                                        <div className="w-24 h-1.5 bg-card-secondary rounded-full overflow-hidden border border-border">
                                            <div
                                                className={cn("h-full transition-all duration-1000", e.successRate > 95 ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : e.successRate > 80 ? "bg-orange-500" : "bg-red-500")}
                                                style={{ width: `${e.successRate}%` }}
                                            />
                                        </div>
                                        <span className="text-[10px] font-bold text-text-muted uppercase tracking-tighter">{e.successRate}% Uptime</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-right px-8">
                                    <button
                                        onClick={() => { setSelectedEndpoint(e); setShowDetailModal(true); }}
                                        className="p-2 hover:bg-card-hover rounded-lg text-text-muted hover:text-blue-500 transition-all border border-transparent hover:border-border"
                                    >
                                        <BarChart3 size={18} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {endpoints.length === 0 && (
                    <div className="p-12 text-center text-text-muted flex flex-col items-center gap-3 bg-card/40">
                        <Activity size={48} className="text-text-muted opacity-30" />
                        <div className="text-sm font-bold tracking-widest">No performance data captured yet</div>
                        <div className="text-[10px] max-w-xs leading-relaxed italic opacity-70">Synthetic checks run every 5 minutes and store metrics for the historical reporting.</div>
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
                                    <h3 className="text-xl font-black text-text-primary tracking-tight">{selectedEndpoint.name}</h3>
                                    <p className="text-[10px] text-text-muted font-mono font-bold uppercase tracking-widest">{selectedEndpoint.lastResult.url}</p>
                                </div>
                            </div>
                            <button onClick={() => setShowDetailModal(false)} className="p-2 hover:bg-card-secondary rounded-lg text-text-muted hover:text-text-primary transition-colors">
                                <XCircle size={24} />
                            </button>
                        </div>

                        <div className="p-8 space-y-8">
                            {/* Detailed Timing Breakdown (Stacked Area Chart) */}
                            {selectedEndpoint.type.includes('HTTP') && (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-xs font-black text-text-muted uppercase tracking-widest flex items-center gap-2">
                                            <Zap size={16} className="text-yellow-500" /> Timing Analysis (ms)
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
                                            <AreaChart data={results.filter(r => r.endpointId === selectedEndpoint.id).slice(0, 30).reverse().map(r => ({
                                                time: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                                                DNS: Math.round(r.metrics.dns_ms || 0),
                                                TCP: Math.round(r.metrics.tcp_ms || 0),
                                                TLS: Math.round(r.metrics.tls_ms || 0),
                                                TTFB: Math.round(r.metrics.ttfb_ms || 0)
                                            }))}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                                                <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={10} tickLine={false} axisLine={false} />
                                                <YAxis stroke="var(--text-muted)" fontSize={10} tickLine={false} axisLine={false} />
                                                <ReTooltip
                                                    contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                                    itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                                                />
                                                <Area type="monotone" dataKey="DNS" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.4} />
                                                <Area type="monotone" dataKey="TCP" stackId="1" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.4} />
                                                <Area type="monotone" dataKey="TLS" stackId="1" stroke="#a855f7" fill="#a855f7" fillOpacity={0.4} />
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

                            {/* Discovery Parameters */}
                            {(selectedEndpoint as any).source === 'discovery' && (
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

                            {/* Recent Checks Table */}
                            <div className="space-y-4">
                                <h4 className="text-xs font-black text-text-muted uppercase tracking-widest flex items-center gap-2">
                                    <Activity size={16} /> Recent Captures
                                </h4>
                                <div className="border border-border rounded-xl overflow-hidden bg-card-secondary/20 shadow-sm">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-card-secondary/50 border-b border-border">
                                            <tr>
                                                <th className="px-4 py-3 text-text-muted font-bold tracking-tight">Time</th>
                                                <th className="px-4 py-3 text-text-muted font-bold tracking-tight text-center">Score</th>
                                                <th className="px-4 py-3 text-text-muted font-bold tracking-tight text-center">Total</th>
                                                <th className="px-4 py-3 text-text-muted font-bold tracking-tight text-center">IP Address</th>
                                                <th className="px-4 py-3 text-text-muted font-bold tracking-tight text-right">HTTP Code</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {results.filter(r => r.endpointId === selectedEndpoint.id).slice(0, 10).map((r, i) => (
                                                <tr key={i} className="hover:bg-card-secondary transition-colors">
                                                    <td className="px-4 py-3 text-text-primary font-bold uppercase tracking-tighter">{formatTimestamp(r.timestamp)}</td>
                                                    <td className="px-4 py-3 text-center">
                                                        <span className={cn("font-black px-2 py-0.5 rounded text-[11px]", r.score >= 80 ? "text-green-600 dark:text-green-400" : "text-red-500")}>
                                                            {r.score}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-center font-mono text-text-secondary font-bold">{formatMs(r.metrics.total_ms)}ms</td>
                                                    <td className="px-4 py-3 text-center text-text-muted font-mono truncate max-w-[120px]">{r.remoteIp || '-'}</td>
                                                    <td className="px-4 py-3 text-right">
                                                        <span className={cn(
                                                            "px-2 py-0.5 rounded font-black",
                                                            r.httpCode === 200 ? "text-green-600 dark:text-green-400 bg-green-500/10" : "text-orange-500 bg-orange-500/10"
                                                        )}>
                                                            {r.httpCode || 'N/A'}
                                                        </span>
                                                    </td>
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
        </div>
    );
}

function cn(...inputs: any[]) {
    return inputs.filter(Boolean).join(' ');
}
