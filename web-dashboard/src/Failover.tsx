import React, { useState, useEffect, useMemo } from 'react';
import { AreaChart, Area, ResponsiveContainer, YAxis, XAxis, Tooltip } from 'recharts';
import { Activity, Clock, Calendar, Shield, Search, ChevronRight, BarChart3, AlertCircle, Info, Play, Pause, Trash2, Zap, Server, Globe, Hash, Plus, Target, X, Square, ArrowRightLeft, RotateCw, ZoomIn, Rewind, Camera } from 'lucide-react';
import { toPng } from 'html-to-image';
import { isValidIpOrFqdn } from './utils/validation';

interface FailoverProps {
    token: string;
    externalStatus?: any[];
}

export default function Failover(props: FailoverProps) {
    const { token, externalStatus } = props;
    const [endpoints, setEndpoints] = useState<any[]>([]);
    const [thresholds, setThresholds] = useState({ good: 1000, degraded: 5000, critical: 10000 });
    const [showAddModal, setShowAddModal] = useState(false);
    const [newTarget, setNewTarget] = useState({ label: '', target: '', port: 6200 });
    const [convergenceTargets, setConvergenceTargets] = useState<any[]>([]);
    const [reachability, setReachability] = useState<Record<string, boolean | 'loading'>>({});
    const [searchQuery, setSearchQuery] = useState('');
    const [historySearch, setHistorySearch] = useState('');
    const [nowTs, setNowTs] = useState(Date.now());
    const [exportingPocId, setExportingPocId] = useState<string | null>(null);

    const allTargets = useMemo(() => {
        const combined = [...endpoints];
        convergenceTargets.forEach(ct => {
            if (!combined.some(e => e.target === ct.host)) {
                combined.push({
                    id: ct.id,
                    label: ct.name,
                    target: ct.host,
                    port: ct.port || 6200,
                    isRegistry: true
                });
            }
        });
        return combined;
    }, [endpoints, convergenceTargets]);

    const [rate, setRate] = useState(50);
    const [selectedEndpoints, setSelectedEndpoints] = useState<string[]>([]);
    const [activeTests, setActiveTests] = useState<any[]>(props.externalStatus || []);
    const [activeInterfaces, setActiveInterfaces] = useState<string[]>([]);
    const [history, setHistory] = useState<any[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(true);
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>({ key: 'timestamp', direction: 'desc' });
    const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
    const [isStarting, setIsStarting] = useState(false);
    const [isStopping, setIsStopping] = useState(false);
    const [refreshingPathId, setRefreshingPathId] = useState<string | null>(null);
    const [liveMetricsSeries, setLiveMetricsSeries] = useState<Record<string, any[]>>({});
    const [liveZoomWindows, setLiveZoomWindows] = useState<Record<string, '1m' | '5m' | '15m' | 'all'>>({});
    const [liveScrubPositions, setLiveScrubPositions] = useState<Record<string, number>>({});
    const [livePaths, setLivePaths] = useState<Record<string, {
        loading?: boolean;
        found?: boolean;
        egress_path?: string | null;
        path_history?: Array<{ path: string; time?: string; timestamp?: string }>;
        path_evolution?: string | null;
        path_type?: string | null;
        site_name?: string | null;
        message?: string | null;
        error?: string | null;
        timestamp?: string;
    }>>({});

    // Live 1-second ticker for smooth countdown timers and chronos
    useEffect(() => {
        const intv = setInterval(() => setNowTs(Date.now()), 1000);
        return () => clearInterval(intv);
    }, []);

    const authHeaders = () => ({ 'Authorization': `Bearer ${token}` });

    const fetchEndpoints = async () => {
        try {
            const res = await fetch('/api/convergence/endpoints', { headers: authHeaders() });
            const data = await res.json();
            setEndpoints(data);

            const ifaceRes = await fetch('/api/config/interfaces', { headers: authHeaders() });
            const ifaceData = await ifaceRes.json();
            setActiveInterfaces(ifaceData);
        } catch (e) { }
    };

    const fetchStatus = async () => {
        try {
            const res = await fetch('/api/convergence/status', { headers: authHeaders() });
            const data = await res.json();
            setActiveTests(data.filter((t: any) => t.running !== false));
        } catch (e) { }
    };

    const fetchHistory = async () => {
        try {
            const res = await fetch('/api/convergence/history', { headers: authHeaders() });
            const data = await res.json();
            setHistory(data);
        } catch (e) { } finally {
            setLoadingHistory(false);
        }
    };

    useEffect(() => {
        if (externalStatus) {
            setActiveTests(externalStatus.filter((t: any) => t.running !== false));
        }
    }, [externalStatus]);

    useEffect(() => {
        setLiveMetricsSeries(prev => {
            const next = { ...prev };
            activeTests.forEach(t => {
                const arr = next[t.testId] || [];
                const rtt = typeof t.current_rtt_ms === 'number' ? t.current_rtt_ms : (t.avg_rtt_ms || 0);
                const jitter = typeof t.jitter_ms === 'number' ? t.jitter_ms : 0;
                const loss = typeof t.live_loss_pct === 'number' ? t.live_loss_pct : (typeof t.loss_pct === 'number' ? t.loss_pct : 0);
                
                const now = new Date();
                const timeLabel = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                
                let elapsedSec = 0;
                if (typeof t.duration_s === 'number') {
                    elapsedSec = Math.round(t.duration_s);
                } else if (t.start_time) {
                    const startTs = typeof t.start_time === 'number'
                        ? (t.start_time > 1e11 ? t.start_time : t.start_time * 1000)
                        : new Date(t.start_time).getTime();
                    elapsedSec = Math.max(0, Math.round((Date.now() - startTs) / 1000));
                } else {
                    elapsedSec = arr.length;
                }
                
                const em = Math.floor(elapsedSec / 60);
                const es = elapsedSec % 60;
                const elapsedLabel = `${String(em).padStart(2, '0')}:${String(es).padStart(2, '0')}`;

                const newPoint = {
                    time: timeLabel,
                    timeLabel,
                    elapsedLabel,
                    elapsedSec,
                    ts: Date.now(),
                    rtt,
                    jitter,
                    loss
                };

                const newArr = [...arr, newPoint];
                if (newArr.length > 3600) newArr.shift(); // Keep up to 1 hour of live history
                next[t.testId] = newArr;
            });
            return next;
        });
    }, [activeTests]);

    useEffect(() => {
        fetchEndpoints();
        fetchHistory();
        // Fetch Thresholds
        const fetchThresholds = async () => {
            try {
                const res = await fetch('/api/config/convergence', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json();
                if (data && typeof data === 'object' && 'good' in data) {
                    setThresholds({
                        good: (data.good || 1) * 1000,
                        degraded: (data.degraded || 5) * 1000,
                        critical: (data.critical || 10) * 1000
                    });
                }
            } catch (e) { }
        };
        fetchThresholds();

        // Fetch shared targets with convergence capability
        fetch('/api/targets', { headers: authHeaders() })
            .then(r => r.json())
            .then(data => setConvergenceTargets((Array.isArray(data) ? data : []).filter((t: any) => t.enabled && t.capabilities?.convergence)))
            .catch(() => { });
        // Poll endpoints every 5s. Always poll history to pick up async enrichments (egress path).
        const interval = setInterval(() => {
            fetchEndpoints();
            fetchHistory();
            fetchThresholds();
        }, 5000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const checkReachability = async () => {
            if (allTargets.length === 0) return;
            await Promise.all(allTargets.map(async (target) => {
                setReachability(prev => ({ ...prev, [target.id]: 'loading' }));
                let isReachable = false;
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        const res = await fetch('/api/convergence/reachability', {
                            method: 'POST',
                            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                            body: JSON.stringify({ target: target.target, port: target.port })
                        });
                        if (res.ok) {
                            const data = await res.json();
                            if (data.reachable) {
                                isReachable = true;
                                break;
                            }
                        }
                    } catch {}
                    if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
                }
                setReachability(prev => ({ ...prev, [target.id]: isReachable }));
            }));
        };
        
        checkReachability();
        const intv = setInterval(checkReachability, 10000);
        return () => clearInterval(intv);
    }, [allTargets]);

    const addEndpoint = async () => {
        if (!newTarget.label || !newTarget.target) return;
        if (!isValidIpOrFqdn(newTarget.target)) return alert("Invalid Target IP/FQDN format");
        try {
            const res = await fetch('/api/convergence/endpoints', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(newTarget)
            });
            if (res.ok) {
                fetchEndpoints();
                setShowAddModal(false);
                setNewTarget({ label: '', target: '', port: 6100 });
            }
        } catch (e) { }
    };

    const deleteEndpoint = async (id: string) => {
        if (!confirm('Are you sure you want to delete this target?')) return;
        try {
            await fetch(`/api/convergence/endpoints/${id}`, { method: 'DELETE', headers: authHeaders() });
            fetchEndpoints();
            // Fix selection counter: remove from selected if deleted
            setSelectedEndpoints(prev => prev.filter(eId => eId !== id));
        } catch (e) { }
    };

    const startTest = async (endpointIds: string[]) => {
        const targets = allTargets.filter(e => endpointIds.includes(e.id));
        setIsStarting(true);
        try {
            await Promise.all(targets.map(endpoint =>
                fetch('/api/convergence/start', {
                    method: 'POST',
                    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        target: endpoint.target,
                        port: endpoint.port,
                        rate,
                        label: endpoint.label
                    })
                })
            ));
            fetchStatus();
            setSelectedEndpoints([]);
        } catch (e) { } finally {
            setIsStarting(false);
        }
    };

    const handleExportPocCard = async (elementId: string, filename: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        const el = document.getElementById(elementId);
        if (!el) return;
        setExportingPocId(elementId);
        try {
            const dataUrl = await toPng(el, {
                backgroundColor: '#0b0f19',
                pixelRatio: 2,
                filter: (node) => {
                    if (node instanceof HTMLElement && node.dataset.noExport === 'true') return false;
                    return true;
                }
            });
            const link = document.createElement('a');
            link.download = `${filename}.png`;
            link.href = dataUrl;
            link.click();
        } catch (err: any) {
            console.error('Failed to export PoC card image:', err);
        } finally {
            setExportingPocId(null);
        }
    };

    const stopTest = async (testId?: string) => {
        setIsStopping(true);
        try {
            // Save metrics time series to server for historical curve rendering
            if (testId && liveMetricsSeries[testId]?.length > 0) {
                fetch('/api/convergence/history/save-metrics', {
                    method: 'POST',
                    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        testId,
                        metrics_series: liveMetricsSeries[testId]
                    })
                }).catch(() => {});
            } else if (!testId) {
                activeTests.forEach(t => {
                    const s = liveMetricsSeries[t.testId];
                    if (s && s.length > 0) {
                        fetch('/api/convergence/history/save-metrics', {
                            method: 'POST',
                            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                testId: t.testId,
                                metrics_series: s
                            })
                        }).catch(() => {});
                    }
                });
            }

            await fetch('/api/convergence/stop', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ testId })
            });
            fetchStatus();
            fetchHistory();
        } catch (e) { } finally {
            setIsStopping(false);
        }
    };

    const resetIds = async () => {
        if (!confirm('This will reset the CONV-XXXX counter to CONV-0000. Continue?')) return;
        try {
            await fetch('/api/convergence/counter', {
                method: 'DELETE',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' }
            });
        } catch (e) { }
    };

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const formatTestDate = (ts?: number | string) => {
        if (!ts) return null;
        const d = typeof ts === 'number' ? new Date(ts > 1e11 ? ts : ts * 1000) : new Date(ts);
        if (isNaN(d.getTime())) return null;
        const dateStr = d.toLocaleDateString([], { month: '2-digit', day: '2-digit' });
        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const fullStr = d.toLocaleString();
        return { dateStr, timeStr, fullStr, display: `${dateStr} ${timeStr}` };
    };

    const filteredHistory = React.useMemo(() => {
        if (!historySearch.trim()) return history;
        const q = historySearch.toLowerCase().trim();
        return history.filter(t => {
            const convId = t.test_id?.match(/CONV-\d+/)?.[0] || t.test_id || '';
            const label = t.label || t.test_id?.split(' (')[0] || '';
            const target = t.target || '';
            const port = String(t.port || '');
            const srcPort = String(t.source_port || getSourcePort(t.test_id || ''));
            const verdict = getVerdict(t.max_blackout_ms || 0).label;
            const egress = t.egress_path || t.path_evolution || '';
            const dateInfo = formatTestDate(t.timestamp || t.start_time);
            const dateStr = dateInfo ? `${dateInfo.display} ${dateInfo.fullStr}` : '';
            
            return convId.toLowerCase().includes(q) ||
                   label.toLowerCase().includes(q) ||
                   target.toLowerCase().includes(q) ||
                   port.includes(q) ||
                   srcPort.includes(q) ||
                   verdict.toLowerCase().includes(q) ||
                   egress.toLowerCase().includes(q) ||
                   dateStr.toLowerCase().includes(q);
        });
    }, [history, historySearch]);

    const sortedHistory = React.useMemo(() => {
        if (!sortConfig) return filteredHistory;
        return [...filteredHistory].sort((a, b) => {
            const aVal = a[sortConfig.key];
            const bVal = b[sortConfig.key];
            if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [filteredHistory, sortConfig]);

    const getVerdict = (maxBlackout: number) => {
        if (maxBlackout === 0) return { label: 'PERFECT', color: 'text-green-400', bg: 'bg-green-400/10', desc: 'No packet loss detected.' };
        if (maxBlackout < thresholds.good) return { label: 'GOOD', color: 'text-green-400', bg: 'bg-green-400/10', desc: 'Typical SD-WAN failover range. Sessions usually stay up.' };
        if (maxBlackout < thresholds.degraded) return { label: 'DEGRADED', color: 'text-yellow-400', bg: 'bg-yellow-400/10', desc: 'Noticeable outage. Video freeze and voice drops expected.' };
        if (maxBlackout < thresholds.critical) return { label: 'BAD', color: 'text-orange-400', bg: 'bg-orange-400/10', desc: 'High failover time. Application health impacted.' };
        return { label: 'CRITICAL', color: 'text-red-400', bg: 'bg-red-400/10', desc: 'Major blackout. Application sessions will disconnect.' };
    };

    const formatMs = (ms: number) => {
        if (ms === 0) return '0ms';
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(2)}s`;
    };

    const formatChrono = (startTime: number) => {
        if (!startTime) return '00:00';
        const seconds = Math.floor(Date.now() / 1000 - startTime);
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const selectedCount = allTargets.filter(e => selectedEndpoints.includes(e.id)).length;

    const getSourcePort = (testId: string): string => {
        try {
            const match = testId?.match(/CONV-(\d+)/);
            if (match && match[1]) {
                const num = parseInt(match[1], 10);
                // Cyclic mapping 0..9999 -> 30000..39999
                return (30000 + (num % 10000)).toString();
            }
        } catch (e) {
            return '????';
        }
        return '????';
    };


    const handleCheckLivePath = async (testIdKey: string, dstIp: string, sourcePortStr?: string) => {
        if (!testIdKey && !sourcePortStr) return;
        const testId = testIdKey.match(/(CONV-\d+)/)?.[1] || testIdKey;
        const sourcePort = sourcePortStr && sourcePortStr !== '????' ? parseInt(sourcePortStr, 10) : undefined;

        setLivePaths(prev => ({
            ...prev,
            [testIdKey]: { ...prev[testIdKey], loading: true, error: undefined, message: undefined }
        }));

        try {
            const res = await fetch('/api/convergence/live-path', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    testId,
                    sourcePort,
                    dstIp
                })
            });

            const data = await res.json();
            if (res.ok && data.success) {
                setLivePaths(prev => ({
                    ...prev,
                    [testIdKey]: {
                        loading: false,
                        found: data.found,
                        egress_path: data.egress_path,
                        path_history: data.path_history,
                        path_evolution: data.path_evolution,
                        path_type: data.path_type,
                        site_name: data.site_name,
                        message: data.message,
                        timestamp: data.timestamp || new Date().toISOString()
                    }
                }));
            } else {
                setLivePaths(prev => ({
                    ...prev,
                    [testIdKey]: {
                        loading: false,
                        found: false,
                        error: data.error || 'Failed to query Prisma SD-WAN path',
                        timestamp: new Date().toISOString()
                    }
                }));
            }
        } catch (e: any) {
            setLivePaths(prev => ({
                ...prev,
                [testIdKey]: {
                    loading: false,
                    found: false,
                    error: e.message || 'Network error querying path',
                    timestamp: new Date().toISOString()
                }
            }));
        }
    };

    const handleRefreshHistoryPath = async (testItem: any) => {
        const rawId = testItem.test_id || testItem.testId || '';
        const testId = rawId.match(/(CONV-\d+)/)?.[1] || rawId;
        if (!testId) return;

        setRefreshingPathId(testId);
        try {
            const rawPort = testItem.source_port || getSourcePort(rawId);
            const sourcePort = rawPort && rawPort !== '????' ? parseInt(rawPort, 10) : undefined;
            const dstIp = testItem.target || testItem.destination_ip || testItem.dest_ip;
            const res = await fetch('/api/convergence/history/refresh-path', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    testId,
                    sourcePort,
                    dstIp,
                    minutes: 240
                })
            });

            const data = await res.json();
            if (res.ok && data.success && data.found) {
                // Update local history state immediately
                setHistory(prev => prev.map(item => {
                    const itemId = item.test_id || item.testId || '';
                    if (itemId === rawId || itemId.startsWith(testId)) {
                        return {
                            ...item,
                            egress_path: data.egress_path,
                            path_history: data.path_history,
                            path_evolution: data.path_evolution,
                            path_type: data.path_type || item.path_type
                        };
                    }
                    return item;
                }));
            } else if (data.message || data.error) {
                alert(data.message || data.error);
            }
        } catch (e: any) {
            alert(`Error refreshing path: ${e.message}`);
        } finally {
            setRefreshingPathId(null);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-12">
            {/* Header Controls */}
            <div className="bg-card/50 backdrop-blur-sm border border-border p-6 rounded-2xl shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-xl transition-all ${activeTests.length > 0 ? 'bg-blue-600 animate-pulse shadow-lg shadow-blue-500/20' : 'bg-card-secondary border border-border'}`}>
                            <Zap size={24} className={activeTests.length > 0 ? 'text-white' : 'text-text-muted'} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-text-primary tracking-tight">Failover Lab</h2>
                            <div className="flex items-center gap-2 mt-1">
                                <p className="text-sm text-text-muted">Manage multiple failover targets for specialized test plans</p>
                                {activeInterfaces.length > 0 && (
                                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/20">
                                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                        <span className="text-[10px] font-bold text-green-400 uppercase tracking-tighter">
                                            {activeInterfaces.join(' + ')} ACTIVE
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        {activeTests.length > 0 && (
                            <button
                                onClick={() => stopTest()}
                                disabled={isStopping}
                                className="flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded-lg text-sm font-bold transition-all border border-red-500/30 shadow-lg shadow-red-900/20 group disabled:opacity-50"
                            >
                                {isStopping ? <Activity size={16} className="animate-spin" /> : <Square size={16} fill="currentColor" className="group-hover:animate-pulse" />}
                                {isStopping ? 'STOPPING...' : 'STOP ALL PROBES'}
                            </button>
                        )}
                        {selectedCount > 0 && (
                            <button
                                onClick={() => startTest(selectedEndpoints)}
                                disabled={isStarting}
                                className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-bold transition-all shadow-lg shadow-blue-900/40 border border-blue-400/30 disabled:opacity-50"
                            >
                                {isStarting ? <Activity size={18} className="animate-spin" /> : <Play size={18} fill="currentColor" />}
                                {isStarting ? 'STARTING...' : `START ${selectedCount} ${selectedCount === 1 ? 'TEST' : 'TESTS'}`}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-3 animate-in slide-in-from-bottom-4 mt-6">
                <div className="flex items-center justify-between px-1 mb-2">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <Server size={14} className="text-text-muted" />
                            <h3 className="text-sm font-bold text-text-primary tracking-tight">Stigix Targets</h3>
                        </div>
                        <div className="relative">
                            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                            <input
                                type="text"
                                placeholder="Search targets..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-7 pr-3 py-1 bg-card border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 w-48 text-text-primary placeholder:text-text-muted"
                            />
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                            <label className="text-[10px] text-text-muted font-bold uppercase tracking-widest hidden sm:block">Precision Rate</label>
                            <select
                                value={rate}
                                onChange={(e) => setRate(parseInt(e.target.value))}
                                disabled={activeTests.length > 0}
                                className="bg-card border border-border rounded-lg px-2 py-1 text-xs font-bold text-text-primary focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 appearance-none shadow-sm cursor-pointer"
                            >
                                <option value="1">1 pps (1s)</option>
                                <option value="5">5 pps (200ms)</option>
                                <option value="10">10 pps (100ms)</option>
                                <option value="20">20 pps (50ms)</option>
                                <option value="50">50 pps (20ms)</option>
                                <option value="100">100 pps (10ms)</option>
                                <option value="200">200 pps (5ms)</option>
                                <option value="500">500 pps (2ms)</option>
                                <option value="1000">1000 pps (1ms)</option>
                            </select>
                        </div>
                        <button
                            onClick={() => setShowAddModal(true)}
                            disabled={activeTests.length > 0}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest bg-card hover:bg-card-hover text-text-muted hover:text-text-primary rounded-lg transition-all border border-border disabled:opacity-50 shadow-sm"
                        >
                            <Plus size={12} /> <span className="hidden sm:inline">Add Target</span>
                        </button>
                    </div>
                </div>
                <div className="flex flex-wrap gap-3 max-h-[360px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
                {(() => {
                    const filteredTargets = allTargets.filter(t => 
                        t.label.toLowerCase().includes(searchQuery.toLowerCase()) || 
                        t.target.toLowerCase().includes(searchQuery.toLowerCase())
                    );
                    
                    if (filteredTargets.length === 0) {
                        return (
                            <div className="w-full py-6 text-center bg-card-secondary/20 border border-dashed border-border rounded-2xl text-text-muted text-xs">
                                {allTargets.length === 0 ? "No targets available. Please ensure Stigix targets are connected or add one manually." : "No targets match your search."}
                            </div>
                        );
                    }

                    return filteredTargets.map((e) => {
                        const isSelected = selectedEndpoints.includes(e.id);
                        const status = reachability[e.id];
                        return (
                            <div
                                key={e.id}
                                onClick={() => {
                                    if (isSelected) setSelectedEndpoints(selectedEndpoints.filter(id => id !== e.id));
                                    else setSelectedEndpoints([...selectedEndpoints, e.id]);
                                }}
                                className={`bg-card border px-3 py-2 rounded-xl group cursor-pointer transition-all flex items-center gap-3 shadow-sm hover:shadow-md ${isSelected ? 'border-blue-500 bg-blue-600/5 shadow-blue-500/10' : 'border-border'}`}
                            >
                                <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-all shrink-0 ${isSelected ? 'bg-blue-600 border-blue-500' : 'bg-card-secondary border-border'}`}>
                                    {isSelected && <Zap size={8} className="text-white" fill="currentColor" />}
                                </div>

                                {/* Reachability Dot */}
                                <div className="shrink-0 flex items-center justify-center w-4">
                                    {status === 'loading' || status === undefined ? (
                                        <div className="w-1.5 h-1.5 rounded-full bg-border animate-pulse" title="Checking reachability..." />
                                    ) : status ? (
                                        <div className="relative flex h-2 w-2 items-center justify-center shrink-0" title="Reachable">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" style={{ animationDuration: '3s' }}></span>
                                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
                                        </div>
                                    ) : (
                                        <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" title="Unreachable" />
                                    )}
                                </div>

                                <div className="flex flex-col flex-1 min-w-0">
                                    <h4 className={`text-xs font-bold transition-colors tracking-tight truncate ${isSelected ? 'text-blue-500' : 'text-text-primary'}`}>{e.label}</h4>
                                    <p className="text-[9px] text-text-muted font-mono mt-0.5 truncate">{e.target}:{e.port}</p>
                                </div>
                                <div className="flex items-center gap-1.5 ml-2 border-l border-border/50 pl-3">
                                    {!e.isRegistry && (
                                        <button
                                            onClick={(e_stop) => { e_stop.stopPropagation(); deleteEndpoint(e.id); }}
                                            className="text-text-muted hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    )}
                                    {(() => {
                                        const activeTestForTarget = activeTests.find(t => t.target === e.target && String(t.port || 6100) === String(e.port || 6100));
                                        const isTesting = !!activeTestForTarget;

                                        return (
                                            <>
                                                <button
                                                    onClick={(e_play) => { e_play.stopPropagation(); startTest([e.id]); }}
                                                    disabled={isStarting || isTesting}
                                                    className={`ml-2 p-1.5 rounded-md transition-colors border shadow-sm ${
                                                        isTesting 
                                                            ? 'bg-card-secondary text-text-muted border-transparent opacity-50 cursor-not-allowed' 
                                                            : 'bg-blue-500/10 text-blue-500 hover:bg-blue-600 hover:text-white border-blue-500/20 hover:border-blue-600 disabled:opacity-50 disabled:cursor-not-allowed'
                                                    }`}
                                                    title={isTesting ? "Test already running" : "Launch Failover Test"}
                                                >
                                                    <Play size={10} fill="currentColor" />
                                                </button>
                                                <button
                                                    onClick={(e_stop_test) => { e_stop_test.stopPropagation(); stopTest(activeTestForTarget?.testId); }}
                                                    disabled={!isTesting}
                                                    className={`p-1.5 rounded-md transition-all border shadow-sm ${
                                                        isTesting
                                                            ? 'bg-red-500 text-white hover:bg-red-600 border-red-500 shadow-red-500/40 cursor-pointer scale-110'
                                                            : 'bg-card-secondary text-text-muted border-transparent opacity-30 cursor-not-allowed'
                                                    }`}
                                                    title={isTesting ? "Stop this test" : "No active test to stop"}
                                                >
                                                    <Square size={10} fill="currentColor" />
                                                </button>
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>
                        );
                    });
                })()}
                </div>
            </div>

            {/* Active Tests Section */}
            <div className="space-y-4">
                {activeTests.map((test) => (
                    <div key={test.testId} id={`active-test-card-${test.testId}`} className="bg-card border border-border rounded-2xl overflow-hidden shadow-xl flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-border">
                        {/* Outage Stats */}
                        <div className="bg-card-secondary/30 p-4 md:w-56 shrink-0 flex flex-col justify-center items-center text-center space-y-4">
                            <div className="space-y-1">
                                <div className="flex items-center gap-1.5 justify-center mb-1">
                                    <Activity size={12} className="text-blue-500" />
                                    <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest">Current Outage</span>
                                </div>
                                <div className={`text-3xl font-black font-mono tracking-tighter transition-all duration-300 ${test.current_blackout_ms > 0 ? 'text-red-500 animate-pulse' : 'text-text-primary'}`} style={test.current_blackout_ms > 0 ? { textShadow: '0 0 20px rgba(239, 68, 68, 0.4)' } : {}}>
                                    {formatMs(test.current_blackout_ms || 0)}
                                </div>
                            </div>
                            <div className="w-full h-px bg-border/50"></div>
                            <div className="flex justify-between w-full px-2 gap-2">
                                <div className="space-y-1 flex-1 text-center">
                                    <div className="text-[9px] font-bold text-text-muted uppercase tracking-widest">Max Blackout</div>
                                    <div className="text-lg font-bold text-orange-500 font-mono tracking-tighter">
                                        {formatMs(test.max_blackout_ms || 0)}
                                    </div>
                                </div>
                                <div className="w-px bg-border/50"></div>
                                <div className="space-y-1 flex flex-col items-center flex-1">
                                    <div className="text-[9px] font-bold text-text-muted uppercase tracking-widest">QoE Score</div>
                                    {(() => {
                                        // Synthetic QoE Score: Starts at 100, drops for live loss, jitter, and high RTT.
                                        const currentLoss = typeof test.live_loss_pct === 'number' ? test.live_loss_pct : (test.loss_pct || 0);
                                        let qoe = 100 - (currentLoss * 2) - ((test.jitter_ms || 0) * 0.5) - ((test.avg_rtt_ms > 50 ? test.avg_rtt_ms - 50 : 0) * 0.1);
                                        qoe = Math.max(0, Math.min(100, Math.round(qoe)));
                                        let color = qoe >= 90 ? 'text-green-400 font-bold' : qoe >= 70 ? 'text-amber-500 font-bold' : 'text-red-500 font-bold animate-pulse';
                                        let glow = qoe >= 90 ? '0 0 10px rgba(74, 222, 128, 0.3)' : qoe >= 70 ? '0 0 10px rgba(245, 158, 11, 0.3)' : '0 0 15px rgba(239, 68, 68, 0.4)';
                                        return <div className={`text-lg font-mono tracking-tighter ${color}`} style={{ textShadow: glow }}>{qoe}/100</div>;
                                    })()}
                                </div>
                            </div>
                        </div>

                        {/* Timeline & Details */}
                        {(() => {
                            const testKey = test.test_id || test.testId || '';
                            const livePath = livePaths[testKey] || livePaths[test.testId] || livePaths[test.test_id];
                            const sourcePort = getSourcePort(test.test_id || test.testId);

                            return (
                                <div className="flex-1 p-6 relative flex flex-col justify-between">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-3">
                                                <span title={`Source Port: ${sourcePort}`} className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-600 text-white uppercase tracking-tighter shadow-lg shadow-blue-500/20 cursor-help">
                                                    {test.test_id?.match(/\((CONV-\d+)\)/)?.[1] || test.testId}
                                                </span>
                                                <span className="text-sm font-bold text-text-primary tracking-tight">
                                                    {test.label || test.test_id?.split(' (')[0] || 'Unknown Target'}
                                                </span>
                                                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-card-secondary border border-border">
                                                    <Clock size={10} className="text-blue-500 dark:text-blue-400" />
                                                    <span className="text-[10px] font-mono text-blue-500 dark:text-blue-400 font-bold">
                                                        {formatChrono(test.start_time)}
                                                    </span>
                                                </div>
                                            </div>
                                            <span className="text-[10px] text-text-muted font-mono mt-1.5 flex items-center gap-1">
                                                <Server size={10} /> {new Date().toLocaleDateString('en-CA')} {new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })} | Duration: {formatChrono(test.start_time)} | {test.target || '--'} | Source Port: {sourcePort} | {test.rate_pps || test.rate} pps
                                            </span>

                                            {/* Live SD-WAN Path Status & Inspector Bar */}
                                            <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                                                {!livePath?.egress_path && !livePath?.loading && !livePath?.error && !livePath?.message && (
                                                    <button
                                                        onClick={() => handleCheckLivePath(testKey, test.target, sourcePort)}
                                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 transition-all shadow-sm hover:shadow active:scale-95 group cursor-pointer"
                                                        title="Query Prisma SD-WAN Flow Browser via API to inspect active WAN paths and failover history for this UDP flow"
                                                    >
                                                        <Search size={11} className="group-hover:scale-110 transition-transform" />
                                                        <span>Inspect Live Path (Prisma SD-WAN)</span>
                                                    </button>
                                                )}

                                                {livePath?.loading && (
                                                    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 text-[11px] font-mono animate-pulse">
                                                        <RotateCw size={11} className="animate-spin text-blue-400" />
                                                        <span>Querying Prisma SASE Flow API (UDP port {sourcePort})...</span>
                                                    </div>
                                                )}

                                                {livePath?.egress_path && (
                                                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-500/40 text-xs shadow-[0_0_15px_rgba(16,185,129,0.15)] flex-wrap animate-in fade-in duration-300">
                                                        <div className="flex items-center gap-1.5 font-bold text-emerald-400 text-[11px]">
                                                            <ArrowRightLeft size={12} className="text-emerald-400" />
                                                            <span className="uppercase text-[9px] text-text-muted tracking-wider">
                                                                {livePath.path_history && livePath.path_history.length > 1 ? 'Failover Path Sequence:' : 'Active Egress Path:'}
                                                            </span>
                                                        </div>

                                                        {/* If multiple path decisions exist, show the clean sequential progression (Path 1 -> Path 2) */}
                                                        {livePath.path_history && livePath.path_history.length > 1 ? (
                                                            <div className="flex items-center gap-2 flex-wrap font-mono text-[11px]">
                                                                {livePath.path_history.map((histItem: any, hIdx: number, hArr: any[]) => {
                                                                    const isCurrent = hIdx === hArr.length - 1;
                                                                    return (
                                                                        <React.Fragment key={hIdx}>
                                                                            <div
                                                                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all ${
                                                                                    isCurrent
                                                                                        ? 'bg-emerald-950/80 border-emerald-400/80 text-emerald-200 font-bold shadow-[0_0_12px_rgba(16,185,129,0.35)]'
                                                                                        : 'bg-card-secondary/80 border-border/80 text-text-muted opacity-80'
                                                                                }`}
                                                                            >
                                                                                <span className={`text-[8px] font-mono px-1 py-0.2 rounded font-black tracking-tight ${
                                                                                    isCurrent ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-card border border-border text-text-muted'
                                                                                }`}>
                                                                                    {hIdx + 1}
                                                                                </span>
                                                                                <span className={`font-bold tracking-tight ${isCurrent ? 'text-text-primary' : 'line-through text-text-muted'}`}>
                                                                                    {histItem.path}
                                                                                </span>
                                                                                {isCurrent && (
                                                                                    <span className="text-[7px] bg-emerald-500 text-slate-950 font-black px-1.5 py-0.5 rounded uppercase tracking-wider ml-1">
                                                                                        ACTIVE
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                            {hIdx < hArr.length - 1 && (
                                                                                <span className="text-orange-400 font-bold text-xs">➔</span>
                                                                            )}
                                                                        </React.Fragment>
                                                                    );
                                                                })}
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-1 font-mono font-bold text-emerald-300 text-[11px]">
                                                                {livePath.egress_path.split(' → ').map((seg: string, idx: number, arr: string[]) => (
                                                                    <React.Fragment key={idx}>
                                                                        <span className="bg-emerald-900/60 px-1.5 py-0.5 rounded border border-emerald-500/30 text-emerald-200">
                                                                            {seg}
                                                                        </span>
                                                                        {idx < arr.length - 1 && <span className="text-emerald-500/60 text-[10px]">→</span>}
                                                                    </React.Fragment>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {livePath.path_type && (
                                                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-card-secondary text-text-muted font-mono uppercase border border-border">
                                                                {livePath.path_type}
                                                            </span>
                                                        )}
                                                        <button
                                                            onClick={() => handleCheckLivePath(testKey, test.target, sourcePort)}
                                                            disabled={livePath.loading}
                                                            className="p-1 hover:bg-emerald-500/20 rounded text-emerald-400/80 hover:text-emerald-300 transition-colors ml-1 cursor-pointer"
                                                            title={`Re-check path (last verified at ${new Date(livePath.timestamp || Date.now()).toLocaleTimeString()})`}
                                                        >
                                                            <RotateCw size={11} className={livePath.loading ? 'animate-spin' : ''} />
                                                        </button>
                                                    </div>
                                                )}

                                                {(livePath?.error || (livePath?.message && !livePath?.egress_path)) && !livePath?.loading && (
                                                    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[11px] animate-in fade-in">
                                                        <Info size={12} className="shrink-0" />
                                                        <span>{livePath.message || livePath.error}</span>
                                                        <button
                                                            onClick={() => handleCheckLivePath(testKey, test.target, sourcePort)}
                                                            className="underline font-bold text-amber-300 hover:text-amber-100 ml-1 flex items-center gap-1 cursor-pointer"
                                                        >
                                                            <RotateCw size={10} /> Retry
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                                            <div className="flex items-center gap-3">
                                                <button
                                                    data-no-export="true"
                                                    onClick={(e) => handleExportPocCard(`active-test-card-${test.testId}`, `stigix-poc-live-${test.testId}-${new Date().toISOString().slice(0, 10)}`, e)}
                                                    disabled={exportingPocId === `active-test-card-${test.testId}`}
                                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-card-secondary hover:bg-card-hover text-text-muted hover:text-text-primary border border-border transition-all cursor-pointer shadow-sm active:scale-95 disabled:opacity-50"
                                                    title="Export full test card as HD PNG screenshot for client PoC reports"
                                                >
                                                    {exportingPocId === `active-test-card-${test.testId}` ? (
                                                        <RotateCw size={11} className="animate-spin text-blue-400" />
                                                    ) : (
                                                        <Camera size={11} className="text-blue-400" />
                                                    )}
                                                    <span>{exportingPocId === `active-test-card-${test.testId}` ? 'Exporting...' : 'Export PoC Card'}</span>
                                                </button>
                                                <div className="flex gap-2">
                                                    <div className="flex flex-col items-end">
                                                        <span className="text-[9px] font-bold text-text-muted uppercase tracking-tighter">Packets Sent</span>
                                                        <span className="text-sm font-bold text-green-600 dark:text-green-400 font-mono">{test.sent}</span>
                                                    </div>
                                                    <div className="w-[1px] h-6 bg-border self-center mx-1" />
                                                    <div className="flex flex-col items-end">
                                                        <span className="text-[9px] font-bold text-text-muted uppercase tracking-tighter">Received</span>
                                                        <span className="text-sm font-bold text-blue-600 dark:text-blue-400 font-mono">{test.received}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                            {(() => {
                                const fullSeries = liveMetricsSeries[test.testId] || [];
                                const zoom = liveZoomWindows[test.testId] || '1m';
                                const scrubPos = liveScrubPositions[test.testId] ?? 100; // 100 = LIVE
                                const isLive = scrubPos >= 100;
                                const N = fullSeries.length;

                                const windowPoints = zoom === '1m' ? 60 : (zoom === '5m' ? 300 : (zoom === '15m' ? 900 : Math.max(60, N)));

                                let displaySeries: any[] = [];
                                let curScrubPoint: any = null;

                                if (N === 0) {
                                    displaySeries = [];
                                } else if (isLive) {
                                    displaySeries = fullSeries.slice(-windowPoints);
                                    curScrubPoint = fullSeries[N - 1];
                                } else {
                                    // Map scrubber 0..100% directly to index 0..N-1
                                    const targetIdx = Math.max(0, Math.min(N - 1, Math.round((scrubPos / 100) * (N - 1))));
                                    curScrubPoint = fullSeries[targetIdx];

                                    if (zoom === 'all') {
                                        displaySeries = fullSeries.slice(0, Math.max(5, targetIdx + 1));
                                    } else {
                                        const startIdx = Math.max(0, targetIdx - windowPoints + 1);
                                        const endIdx = targetIdx + 1;
                                        displaySeries = fullSeries.slice(startIdx, endIdx);
                                    }
                                }

                                const visibleStart = displaySeries[0]?.timeLabel || '00:00';
                                const visibleEnd = displaySeries[displaySeries.length - 1]?.timeLabel || '00:00';

                                return (
                                    <>
                                        {/* Interactive Timeline Scrubber & Window Controls */}
                                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 mb-3 bg-card-secondary/40 p-2 rounded-xl border border-border/50 text-[11px]">
                                            {/* Window Presets */}
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[9px] text-text-muted font-bold uppercase tracking-wider flex items-center gap-1">
                                                    <ZoomIn size={11} className="text-blue-400" /> Window:
                                                </span>
                                                {(['1m', '5m', '15m', 'all'] as const).map(w => (
                                                    <button
                                                        key={w}
                                                        onClick={() => setLiveZoomWindows(prev => ({ ...prev, [test.testId]: w }))}
                                                        className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase transition-all cursor-pointer ${
                                                            zoom === w
                                                                ? 'bg-blue-600 text-white shadow-sm'
                                                                : 'bg-card text-text-muted hover:text-text-primary border border-border hover:bg-card-secondary'
                                                        }`}
                                                    >
                                                        {w === 'all' ? 'ALL' : w}
                                                    </button>
                                                ))}
                                                {!isLive && (
                                                    <span className="text-[9px] font-mono text-amber-400 ml-2 font-semibold">
                                                        [{visibleStart} ➔ {visibleEnd}]
                                                    </span>
                                                )}
                                            </div>

                                            {/* Scrubber slider + Rewind info */}
                                            <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end flex-1 max-w-lg">
                                                <span className="text-[9px] font-mono text-text-muted shrink-0" title="Start of test">
                                                    {fullSeries[0]?.elapsedLabel || '00:00'}
                                                </span>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="100"
                                                    value={scrubPos}
                                                    onChange={(e) => {
                                                        const val = Number(e.target.value);
                                                        setLiveScrubPositions(prev => ({ ...prev, [test.testId]: val }));
                                                    }}
                                                    className="w-full h-2 bg-slate-700/60 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-all"
                                                    title={isLive ? 'LIVE Mode' : `Rewound to ${curScrubPoint?.timeLabel || ''} (${curScrubPoint?.elapsedLabel || ''})`}
                                                />
                                                <span className="text-[9px] font-mono text-text-muted shrink-0" title="Latest live metric">
                                                    {fullSeries[fullSeries.length - 1]?.elapsedLabel || '00:00'}
                                                </span>

                                                {isLive ? (
                                                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold text-[9px] uppercase tracking-wider shrink-0 shadow-sm">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                        <span>LIVE</span>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => setLiveScrubPositions(prev => ({ ...prev, [test.testId]: 100 }))}
                                                        className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-slate-950 border border-amber-500/40 font-bold text-[9px] uppercase tracking-wider transition-all shrink-0 cursor-pointer shadow-[0_0_10px_rgba(245,158,11,0.2)] animate-pulse"
                                                        title="Click to snap back to real-time live feed"
                                                    >
                                                        <Rewind size={10} className="rotate-180" />
                                                        <span>Jump to Live</span>
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-4">
                                            {/* Latency Chart */}
                                            <div>
                                                <div className="flex justify-between items-end mb-2">
                                                    <div className="text-[10px] text-text-muted font-bold uppercase tracking-widest flex items-center gap-2">
                                                        <Activity size={12} className="text-emerald-500 animate-pulse" /> Live Latency (RTT)
                                                    </div>
                                                    <div className="flex flex-col items-end">
                                                        <div className="text-lg font-bold text-emerald-400 font-mono tracking-tight shadow-sm">
                                                            {isLive ? (typeof test.current_rtt_ms === 'number' ? test.current_rtt_ms : test.avg_rtt_ms) : (curScrubPoint?.rtt ?? test.avg_rtt_ms)} <span className="text-[10px] text-text-muted ml-0.5">ms</span>
                                                        </div>
                                                        {!isLive && curScrubPoint && (
                                                            <span className="text-[8px] font-mono text-amber-400">@ {curScrubPoint.elapsedLabel}</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="h-[75px] w-full bg-card-secondary/10 rounded overflow-hidden">
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <AreaChart data={displaySeries} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                                                            <defs>
                                                                <linearGradient id="colorRtt" x1="0" y1="0" x2="0" y2="1">
                                                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.35}/>
                                                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                                                </linearGradient>
                                                            </defs>
                                                            <YAxis domain={[0, (dataMax: number) => Math.max(5, Math.ceil(dataMax * 1.15))]} hide />
                                                            <XAxis dataKey="time" stroke="#475569" tick={{ fontSize: 8, fill: '#64748b' }} minTickGap={30} tickLine={false} axisLine={{ stroke: '#334155' }} height={14} />
                                                            <Tooltip
                                                                content={({ active, payload }) => {
                                                                    if (active && payload && payload.length) {
                                                                        const d = payload[0].payload;
                                                                        return (
                                                                            <div className="bg-slate-950/95 border border-slate-700 p-1.5 rounded shadow-xl text-[10px] font-mono">
                                                                                <div className="text-slate-400 text-[8px]">{d.timeLabel} ({d.elapsedLabel})</div>
                                                                                <div className="text-emerald-400 font-bold">RTT: {d.rtt} ms</div>
                                                                            </div>
                                                                        );
                                                                    }
                                                                    return null;
                                                                }}
                                                            />
                                                            <Area type="monotone" dataKey="rtt" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorRtt)" isAnimationActive={false} />
                                                        </AreaChart>
                                                    </ResponsiveContainer>
                                                </div>
                                            </div>

                                            {/* Jitter Chart */}
                                            <div>
                                                <div className="flex justify-between items-end mb-2">
                                                    <div className="text-[10px] text-text-muted font-bold uppercase tracking-widest flex items-center gap-2">
                                                        <Activity size={12} className="text-amber-500 animate-pulse" /> Live Jitter
                                                    </div>
                                                    <div className="flex flex-col items-end">
                                                        <div className="text-lg font-bold text-amber-400 font-mono tracking-tight shadow-sm">
                                                            {isLive ? (test.jitter_ms || 0) : (curScrubPoint?.jitter ?? 0)} <span className="text-[10px] text-text-muted ml-0.5">ms</span>
                                                        </div>
                                                        {!isLive && curScrubPoint && (
                                                            <span className="text-[8px] font-mono text-amber-400">@ {curScrubPoint.elapsedLabel}</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="h-[75px] w-full bg-card-secondary/10 rounded overflow-hidden">
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <AreaChart data={displaySeries} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                                                            <defs>
                                                                <linearGradient id="colorJitter" x1="0" y1="0" x2="0" y2="1">
                                                                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35}/>
                                                                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                                                                </linearGradient>
                                                            </defs>
                                                            <YAxis domain={[0, (dataMax: number) => Math.max(5, Math.ceil(dataMax * 1.15))]} hide />
                                                            <XAxis dataKey="time" stroke="#475569" tick={{ fontSize: 8, fill: '#64748b' }} minTickGap={30} tickLine={false} axisLine={{ stroke: '#334155' }} height={14} />
                                                            <Tooltip
                                                                content={({ active, payload }) => {
                                                                    if (active && payload && payload.length) {
                                                                        const d = payload[0].payload;
                                                                        return (
                                                                            <div className="bg-slate-950/95 border border-slate-700 p-1.5 rounded shadow-xl text-[10px] font-mono">
                                                                                <div className="text-slate-400 text-[8px]">{d.timeLabel} ({d.elapsedLabel})</div>
                                                                                <div className="text-amber-400 font-bold">Jitter: {d.jitter} ms</div>
                                                                            </div>
                                                                        );
                                                                    }
                                                                    return null;
                                                                }}
                                                            />
                                                            <Area type="monotone" dataKey="jitter" stroke="#f59e0b" strokeWidth={2} fillOpacity={1} fill="url(#colorJitter)" isAnimationActive={false} />
                                                        </AreaChart>
                                                    </ResponsiveContainer>
                                                </div>
                                            </div>
                                            
                                            {/* Loss Chart */}
                                            <div>
                                                <div className="flex justify-between items-end mb-2">
                                                    <div className="text-[10px] text-text-muted font-bold uppercase tracking-widest flex items-center gap-2">
                                                        <Activity size={12} className="text-red-500 animate-pulse" /> Live Loss
                                                    </div>
                                                    <div className="flex flex-col items-end">
                                                        <div className={`text-lg font-bold font-mono tracking-tight shadow-sm ${(isLive ? (test.live_loss_pct ?? test.loss_pct ?? 0) : (curScrubPoint?.loss ?? 0)) > 0 ? 'text-red-500 animate-pulse' : 'text-emerald-400'}`}>
                                                            {isLive ? (test.live_loss_pct !== undefined ? test.live_loss_pct : (test.loss_pct || 0)) : (curScrubPoint?.loss ?? 0)} <span className="text-[10px] text-text-muted ml-0.5">%</span>
                                                        </div>
                                                        <div className="text-[9px] text-text-muted font-mono tracking-tighter">
                                                            Total: <span className={(test.total_loss_pct ?? test.loss_pct ?? 0) > 0 ? 'text-red-400 font-semibold' : 'text-text-secondary'}>{test.total_loss_pct !== undefined ? test.total_loss_pct : (test.loss_pct || 0)}%</span>
                                                            {test.sent && test.received !== undefined && (
                                                                <span className="ml-1 opacity-80">({Math.max(0, test.sent - test.received)} drops)</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="h-[75px] w-full bg-card-secondary/10 rounded overflow-hidden">
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <AreaChart data={displaySeries} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                                                            <defs>
                                                                <linearGradient id="colorLoss" x1="0" y1="0" x2="0" y2="1">
                                                                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.5}/>
                                                                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05}/>
                                                                </linearGradient>
                                                            </defs>
                                                            <YAxis domain={[0, (dataMax: number) => Math.max(10, Math.min(100, Math.ceil(dataMax * 1.5)))]} hide />
                                                            <XAxis dataKey="time" stroke="#475569" tick={{ fontSize: 8, fill: '#64748b' }} minTickGap={30} tickLine={false} axisLine={{ stroke: '#334155' }} height={14} />
                                                            <Tooltip
                                                                content={({ active, payload }) => {
                                                                    if (active && payload && payload.length) {
                                                                        const d = payload[0].payload;
                                                                        return (
                                                                            <div className="bg-slate-950/95 border border-slate-700 p-1.5 rounded shadow-xl text-[10px] font-mono">
                                                                                <div className="text-slate-400 text-[8px]">{d.timeLabel} ({d.elapsedLabel})</div>
                                                                                <div className="text-red-400 font-bold">Loss: {d.loss}%</div>
                                                                            </div>
                                                                        );
                                                                    }
                                                                    return null;
                                                                }}
                                                            />
                                                            <Area type="monotone" dataKey="loss" stroke="#ef4444" strokeWidth={2.5} fillOpacity={1} fill="url(#colorLoss)" isAnimationActive={false} />
                                                        </AreaChart>
                                                    </ResponsiveContainer>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="h-[44px] w-full flex flex-col justify-end relative rounded-lg overflow-hidden bg-card-secondary/30 border border-border/40 mb-6 p-1">
                                            {/* Blackout Overlay */}
                                            {isLive && test.current_blackout_ms > 0 && (
                                                <div className="absolute inset-0 z-20 bg-red-950/70 backdrop-blur-[2px] flex items-center justify-center animate-in fade-in">
                                                    <div className="bg-red-950/90 text-red-400 border border-red-500/60 px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 shadow-[0_0_25px_rgba(239,68,68,0.5)]">
                                                        <AlertCircle size={12} className="animate-pulse text-red-400" />
                                                        <span>NETWORK OUTAGE: {(test.current_blackout_ms / 1000).toFixed(1)}s — FAILOVER IN PROGRESS...</span>
                                                    </div>
                                                </div>
                                            )}
                                            <div className="w-full flex items-end gap-[1.5px] h-full">
                                                {(() => {
                                                    const rawHist = test.history || Array(100).fill(1);
                                                    let histToRender = rawHist;
                                                    if (!isLive && curScrubPoint) {
                                                        const dropCount = Math.round(((curScrubPoint.loss || 0) / 100) * 100);
                                                        histToRender = Array(100).fill(1);
                                                        for (let d = 0; d < dropCount; d++) {
                                                            histToRender[99 - d] = 0;
                                                        }
                                                    }
                                                    return histToRender.map((val: number, i: number) => {
                                                        const isLast = i === histToRender.length - 1;
                                                        const isDrop = val === 0;
                                                        return (
                                                            <div
                                                                key={i}
                                                                className={`flex-1 min-w-[2px] rounded-t-[1px] transition-all duration-150 ${isDrop
                                                                    ? 'bg-gradient-to-t from-red-600 via-rose-500 to-red-400 h-full shadow-[0_0_8px_rgba(239,68,68,0.85)] z-10 animate-pulse'
                                                                    : 'bg-gradient-to-t from-blue-700 via-blue-500 to-cyan-400 h-[75%] opacity-90 hover:h-[90%]'}`}
                                                                style={isLast ? (isDrop ? { background: '#ef4444', boxShadow: '0 0 12px #ef4444', height: '100%' } : { background: '#38bdf8', boxShadow: '0 0 10px #38bdf8', height: '100%' }) : {}}
                                                                title={isDrop ? `Packet #${i + 1}: DROPPED (Outage)` : `Packet #${i + 1}: Received OK`}
                                                            />
                                                        );
                                                    });
                                                })()}
                                            </div>
                                        </div>
                                    </>
                                );
                            })()}

                            <div className="flex justify-between items-center">
                                <span className="text-[9px] text-text-muted font-bold uppercase tracking-widest flex items-center gap-2">
                                    <Activity size={10} /> Live Sequence Monitoring
                                </span>
                                <button
                                    onClick={() => stopTest(test.testId)}
                                    disabled={isStopping}
                                    className="px-4 py-1.5 bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white rounded border border-red-500/20 text-[10px] font-bold transition-all flex items-center gap-2 shadow-lg shadow-red-900/10 disabled:opacity-50"
                                >
                                    {isStopping ? <Activity size={10} className="animate-spin" /> : <Square size={10} fill="currentColor" />}
                                    {isStopping ? 'STOPPING...' : 'STOP PROBE'}
                                </button>
                            </div>
                        </div>
                    );
                })()}
            </div>
        ))}
    </div>

            {/* Verdict Legend & Historical View */}
            <div className={`grid grid-cols-1 md:grid-cols-4 gap-6 ${activeTests.length > 0 ? 'opacity-50 grayscale transition-all' : ''}`}>
                <div className="md:col-span-3 bg-card border border-border rounded-2xl overflow-hidden shadow-sm order-2 md:order-1">
                    <div className="p-4 border-b border-border bg-card-secondary/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                            <h3 className="text-sm font-bold text-text-secondary uppercase tracking-widest flex items-center gap-2">
                                <Clock size={16} /> Test History
                            </h3>
                            {history.length > 0 && (
                                <span className="text-[10px] font-bold text-text-muted bg-card px-2 py-0.5 rounded border border-border uppercase tracking-wider">
                                    {historySearch.trim() ? `${sortedHistory.length} / ${history.length}` : history.length} Tests
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2.5 w-full sm:w-auto">
                            {/* Full Text Search Input */}
                            <div className="relative flex-1 sm:w-64">
                                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                                <input
                                    type="text"
                                    placeholder="Search ID, label, IP, verdict, path, time..."
                                    value={historySearch}
                                    onChange={(e) => setHistorySearch(e.target.value)}
                                    className="w-full pl-8 pr-7 py-1.5 bg-card text-xs text-text-primary rounded-lg border border-border focus:border-blue-500 focus:outline-none transition-colors placeholder:text-text-muted/60"
                                />
                                {historySearch && (
                                    <button
                                        onClick={() => setHistorySearch('')}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary p-0.5 cursor-pointer"
                                        title="Clear search"
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </div>
                            {activeTests.length === 0 && (
                                <button
                                    onClick={resetIds}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-widest text-orange-600 dark:text-orange-400 bg-orange-600/5 hover:bg-orange-600/10 border border-orange-500/20 rounded-lg transition-all shrink-0 cursor-pointer"
                                    title="Reset test counter"
                                >
                                    <Hash size={12} />
                                    RESET ID
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <thead className="bg-card-secondary/70 border-b border-border text-text-muted">
                                <tr>
                                    <th className="px-6 py-3 font-bold tracking-tight">Date / ID / Label</th>
                                    <th className="px-6 py-3 font-bold tracking-tight text-center">Verdict</th>
                                    <th className="px-6 py-3 font-bold tracking-tight text-center">Outcome / Duration</th>
                                    <th className="px-6 py-3 font-bold tracking-tight text-center">Packet Details</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {sortedHistory.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-8 text-center text-text-muted">
                                            {historySearch ? (
                                                <div className="flex flex-col items-center gap-2">
                                                    <Search size={20} className="text-text-muted/40" />
                                                    <p className="text-xs">No recorded tests matching <span className="text-text-secondary font-bold font-mono">"{historySearch}"</span></p>
                                                    <button
                                                        onClick={() => setHistorySearch('')}
                                                        className="text-[10px] text-blue-400 hover:underline font-bold cursor-pointer"
                                                    >
                                                        Clear filter
                                                    </button>
                                                </div>
                                            ) : (
                                                'No convergence tests recorded yet.'
                                            )}
                                        </td>
                                    </tr>
                                ) : (
                                    sortedHistory.map((test, idx) => {
                                        const verdict = getVerdict(test.max_blackout_ms);
                                        const isExpanded = expandedHistory === (test.test_id + test.timestamp);
                                        const dateInfo = formatTestDate(test.timestamp || test.start_time);
                                        return (
                                            <React.Fragment key={idx}>
                                                <tr
                                                    className={`hover:bg-card-secondary transition-colors cursor-pointer ${isExpanded ? 'bg-blue-600/5' : ''}`}
                                                    onClick={() => setExpandedHistory(isExpanded ? null : (test.test_id + test.timestamp))}
                                                >
                                                    <td className="px-6 py-4">
                                                        <div className="font-medium text-text-primary flex items-center gap-2">
                                                            <span title={`Source Port: ${getSourcePort(test.test_id || '')}`} className="bg-blue-600/10 text-blue-500 text-[9px] px-1.5 py-0.5 rounded font-bold border border-blue-500/20 cursor-help">
                                                                {test.test_id?.match(/CONV-\d+/)?.[0] || 'CONV-??'}
                                                            </span>
                                                            <span>{test.label || test.test_id?.split(' (')[0]}</span>
                                                            <ChevronRight size={14} className={`text-text-muted/50 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                                        </div>
                                                        <div className="text-[10px] text-text-muted mt-1 font-mono flex items-center gap-1.5 flex-wrap">
                                                            {dateInfo && (
                                                                <>
                                                                    <span className="text-blue-400 font-bold bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20 flex items-center gap-1" title={`Full date: ${dateInfo.fullStr}`}>
                                                                        <Calendar size={10} className="text-blue-400" />
                                                                        {dateInfo.display}
                                                                    </span>
                                                                    <span className="text-border">|</span>
                                                                </>
                                                            )}
                                                            <span className="font-bold text-text-secondary">Duration: {test.duration_s || '--'}s</span>
                                                            <span className="text-border">|</span>
                                                            <span>{test.target}:{test.port || '--'}</span>
                                                            <span className="text-border">|</span>
                                                            <span className="text-text-secondary">Source Port: {test.source_port || getSourcePort(test.test_id)}</span>
                                                            <span className="text-border">|</span>
                                                            <span>{test.rate_pps || test.rate || '--'} pps</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-center">
                                                        <span className={`inline-flex items-center px-3 py-1 rounded font-bold text-[9px] border ${verdict.bg.replace('400/10', '600/20')} ${verdict.color.replace('text-green-400', 'text-green-600 dark:text-green-400')} tracking-widest`}>
                                                            {verdict.label}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 text-center">
                                                        <div className="flex flex-col">
                                                            <span className={`font-mono text-sm font-bold ${test.max_blackout_ms > 0 ? 'text-orange-500' : 'text-text-muted'}`}>
                                                                {formatMs(test.max_blackout_ms || 0)}
                                                            </span>
                                                            <span className="text-[9px] font-bold text-text-muted uppercase">
                                                                Max Blackout {test.duration_s ? `(${test.duration_s}s)` : ''}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-center">
                                                        <div className="flex flex-col items-center">
                                                            <div className="flex gap-2 text-[10px] font-mono font-bold tracking-tight mb-0.5 opacity-90">
                                                                <span className={test.tx_loss_pct > 0 ? 'text-red-500' : 'text-text-muted/60'}>
                                                                    TX Loss: {test.tx_loss_pct ?? 0}% {test.tx_loss_ms > 0 && !test.sync_lost ? `(${test.tx_loss_ms} ms)` : ''}
                                                                </span>
                                                                <span className="text-border">|</span>
                                                                <span className={test.rx_loss_pct > 0 ? 'text-blue-500' : 'text-text-muted/60'}>
                                                                    RX Loss: {test.rx_loss_pct ?? 0}% {test.rx_loss_ms > 0 && !test.sync_lost ? `(${test.rx_loss_ms} ms)` : ''}
                                                                </span>
                                                            </div>
                                                            <div className="text-[9px] text-text-muted font-mono tracking-tighter whitespace-nowrap bg-card-secondary/50 px-2 py-0.5 rounded border border-border/30">
                                                                S: {test.sent} • Echo: {test.server_received ?? '-'} • R: {test.received}
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {isExpanded && (
                                                    <tr className="bg-background/80">
                                                        <td colSpan={5} className="px-6 py-4 border-l-2 border-blue-500">
                                                            {(() => {
                                                                const testKey = test.test_id || test.testId || '';
                                                                const convId = test.test_id?.match(/CONV-\d+/)?.[0] || testKey;
                                                                const series = test.metrics_series || liveMetricsSeries[testKey] || liveMetricsSeries[convId] || [];
                                                                const hasSeries = Array.isArray(series) && series.length > 0;
                                                                const cardDomId = `history-test-card-${convId}-${test.timestamp}`;

                                                                return (
                                                                    <div id={cardDomId} className="p-4 rounded-xl bg-card border border-border/80 space-y-4 shadow-inner">
                                                                        {/* Header with Title, Verdict, Legend and Export PoC Card Button */}
                                                                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-border/40 pb-3">
                                                                            <div className="flex items-center gap-3 flex-wrap">
                                                                                <h4 className="text-xs font-bold text-text-primary uppercase tracking-wider flex items-center gap-2">
                                                                                    <BarChart3 size={14} className="text-blue-400" /> PoC Test Analysis & Failover Curves
                                                                                </h4>
                                                                                <span className={`inline-flex items-center px-2 py-0.5 rounded font-bold text-[9px] border ${verdict.bg.replace('400/10', '600/20')} ${verdict.color.replace('text-green-400', 'text-green-600 dark:text-green-400')} tracking-widest`}>
                                                                                    {verdict.label}
                                                                                </span>
                                                                                {dateInfo && (
                                                                                    <span className="text-[10px] font-mono text-blue-400 font-bold bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 flex items-center gap-1" title={dateInfo.fullStr}>
                                                                                        <Calendar size={11} /> {dateInfo.fullStr}
                                                                                    </span>
                                                                                )}
                                                                                <span className="text-[10px] font-mono text-text-muted font-bold">
                                                                                    Max Outage: <span className={test.max_blackout_ms > 0 ? 'text-orange-400 font-bold' : 'text-text-secondary'}>{formatMs(test.max_blackout_ms || 0)}</span>
                                                                                </span>
                                                                                {test.duration_s && (
                                                                                    <span className="text-[10px] font-mono text-text-muted">
                                                                                        • Duration: <span className="text-text-secondary font-bold">{test.duration_s}s</span>
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        <div className="flex items-center gap-3" data-no-export="true">
                                                                            <div className="flex gap-2.5 text-[9px] font-bold">
                                                                                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-emerald-500" /> <span className="text-text-muted uppercase">RTT</span></div>
                                                                                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-amber-500" /> <span className="text-text-muted uppercase">Jitter</span></div>
                                                                                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-red-500" /> <span className="text-text-muted uppercase">Loss</span></div>
                                                                            </div>
                                                                            <button
                                                                                data-no-export="true"
                                                                                onClick={(e) => handleExportPocCard(cardDomId, `stigix-poc-history-${convId}-${test.timestamp}`, e)}
                                                                                disabled={exportingPocId === cardDomId}
                                                                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold bg-blue-600/10 hover:bg-blue-600 text-blue-400 hover:text-white border border-blue-500/30 transition-all cursor-pointer shadow-sm active:scale-95 disabled:opacity-50"
                                                                                title="Export high-resolution PoC card screenshot with charts for presentations & slides"
                                                                            >
                                                                                {exportingPocId === cardDomId ? (
                                                                                    <RotateCw size={11} className="animate-spin" />
                                                                                ) : (
                                                                                    <Camera size={11} />
                                                                                )}
                                                                                <span>{exportingPocId === cardDomId ? 'Exporting...' : 'Export PoC Card'}</span>
                                                                            </button>
                                                                        </div>
                                                                    </div>

                                                                    {/* Historical AreaCharts (if time-series exists) */}
                                                                    {hasSeries && (
                                                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                                            {/* Historical Latency Chart */}
                                                                            <div className="bg-card-secondary/20 p-2.5 rounded-xl border border-border/40">
                                                                                <div className="flex justify-between items-center mb-1.5">
                                                                                    <span className="text-[10px] text-text-muted font-bold uppercase tracking-wider flex items-center gap-1.5">
                                                                                        <Activity size={11} className="text-emerald-400" /> RTT Latency
                                                                                    </span>
                                                                                    <span className="text-xs font-mono font-bold text-emerald-400">
                                                                                        Avg: {test.avg_rtt_ms || 0}ms
                                                                                    </span>
                                                                                </div>
                                                                                <div className="h-[65px] w-full">
                                                                                    <ResponsiveContainer width="100%" height="100%">
                                                                                        <AreaChart data={series} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                                                                                            <defs>
                                                                                                <linearGradient id={`histRtt-${idx}`} x1="0" y1="0" x2="0" y2="1">
                                                                                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.35}/>
                                                                                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                                                                                </linearGradient>
                                                                                            </defs>
                                                                                            <YAxis domain={[0, (dataMax: number) => Math.max(5, Math.ceil(dataMax * 1.15))]} hide />
                                                                                            <XAxis dataKey="time" stroke="#475569" tick={{ fontSize: 7, fill: '#64748b' }} minTickGap={25} tickLine={false} axisLine={{ stroke: '#334155' }} height={12} />
                                                                                            <Tooltip
                                                                                                content={({ active, payload }) => {
                                                                                                    if (active && payload && payload.length) {
                                                                                                        const d = payload[0].payload;
                                                                                                        return (
                                                                                                            <div className="bg-slate-950/95 border border-slate-700 p-1.5 rounded shadow-xl text-[10px] font-mono">
                                                                                                                <div className="text-slate-400 text-[8px]">{d.timeLabel || d.time} ({d.elapsedLabel || ''})</div>
                                                                                                                <div className="text-emerald-400 font-bold">RTT: {d.rtt} ms</div>
                                                                                                            </div>
                                                                                                        );
                                                                                                    }
                                                                                                    return null;
                                                                                                }}
                                                                                            />
                                                                                            <Area type="monotone" dataKey="rtt" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill={`url(#histRtt-${idx})`} isAnimationActive={false} />
                                                                                        </AreaChart>
                                                                                    </ResponsiveContainer>
                                                                                </div>
                                                                            </div>

                                                                            {/* Historical Jitter Chart */}
                                                                            <div className="bg-card-secondary/20 p-2.5 rounded-xl border border-border/40">
                                                                                <div className="flex justify-between items-center mb-1.5">
                                                                                    <span className="text-[10px] text-text-muted font-bold uppercase tracking-wider flex items-center gap-1.5">
                                                                                        <Activity size={11} className="text-amber-400" /> Jitter
                                                                                    </span>
                                                                                    <span className="text-xs font-mono font-bold text-amber-400">
                                                                                        Avg: {test.jitter_ms || 0}ms
                                                                                    </span>
                                                                                </div>
                                                                                <div className="h-[65px] w-full">
                                                                                    <ResponsiveContainer width="100%" height="100%">
                                                                                        <AreaChart data={series} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                                                                                            <defs>
                                                                                                <linearGradient id={`histJitter-${idx}`} x1="0" y1="0" x2="0" y2="1">
                                                                                                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35}/>
                                                                                                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                                                                                                </linearGradient>
                                                                                            </defs>
                                                                                            <YAxis domain={[0, (dataMax: number) => Math.max(5, Math.ceil(dataMax * 1.15))]} hide />
                                                                                            <XAxis dataKey="time" stroke="#475569" tick={{ fontSize: 7, fill: '#64748b' }} minTickGap={25} tickLine={false} axisLine={{ stroke: '#334155' }} height={12} />
                                                                                            <Tooltip
                                                                                                content={({ active, payload }) => {
                                                                                                    if (active && payload && payload.length) {
                                                                                                        const d = payload[0].payload;
                                                                                                        return (
                                                                                                            <div className="bg-slate-950/95 border border-slate-700 p-1.5 rounded shadow-xl text-[10px] font-mono">
                                                                                                                <div className="text-slate-400 text-[8px]">{d.timeLabel || d.time} ({d.elapsedLabel || ''})</div>
                                                                                                                <div className="text-amber-400 font-bold">Jitter: {d.jitter} ms</div>
                                                                                                            </div>
                                                                                                        );
                                                                                                    }
                                                                                                    return null;
                                                                                                }}
                                                                                            />
                                                                                            <Area type="monotone" dataKey="jitter" stroke="#f59e0b" strokeWidth={2} fillOpacity={1} fill={`url(#histJitter-${idx})`} isAnimationActive={false} />
                                                                                        </AreaChart>
                                                                                    </ResponsiveContainer>
                                                                                </div>
                                                                            </div>

                                                                            {/* Historical Packet Loss Chart */}
                                                                            <div className="bg-card-secondary/20 p-2.5 rounded-xl border border-border/40">
                                                                                <div className="flex justify-between items-center mb-1.5">
                                                                                    <span className="text-[10px] text-text-muted font-bold uppercase tracking-wider flex items-center gap-1.5">
                                                                                        <Activity size={11} className="text-red-400" /> Packet Loss Spike
                                                                                    </span>
                                                                                    <span className="text-xs font-mono font-bold text-red-400">
                                                                                        Peak: {Math.max(...series.map((s: any) => s.loss || 0), 0)}%
                                                                                    </span>
                                                                                </div>
                                                                                <div className="h-[65px] w-full">
                                                                                    <ResponsiveContainer width="100%" height="100%">
                                                                                        <AreaChart data={series} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                                                                                            <defs>
                                                                                                <linearGradient id={`histLoss-${idx}`} x1="0" y1="0" x2="0" y2="1">
                                                                                                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.5}/>
                                                                                                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05}/>
                                                                                                </linearGradient>
                                                                                            </defs>
                                                                                            <YAxis domain={[0, (dataMax: number) => Math.max(10, Math.min(100, Math.ceil(dataMax * 1.5)))]} hide />
                                                                                            <XAxis dataKey="time" stroke="#475569" tick={{ fontSize: 7, fill: '#64748b' }} minTickGap={25} tickLine={false} axisLine={{ stroke: '#334155' }} height={12} />
                                                                                            <Tooltip
                                                                                                content={({ active, payload }) => {
                                                                                                    if (active && payload && payload.length) {
                                                                                                        const d = payload[0].payload;
                                                                                                        return (
                                                                                                            <div className="bg-slate-950/95 border border-slate-700 p-1.5 rounded shadow-xl text-[10px] font-mono">
                                                                                                                <div className="text-slate-400 text-[8px]">{d.timeLabel || d.time} ({d.elapsedLabel || ''})</div>
                                                                                                                <div className="text-red-400 font-bold">Loss: {d.loss}%</div>
                                                                                                            </div>
                                                                                                        );
                                                                                                    }
                                                                                                    return null;
                                                                                                }}
                                                                                            />
                                                                                            <Area type="monotone" dataKey="loss" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill={`url(#histLoss-${idx})`} isAnimationActive={false} />
                                                                                        </AreaChart>
                                                                                    </ResponsiveContainer>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {/* 100-Packet Sequence / Outage Bar */}
                                                                    <div className="space-y-1">
                                                                        <div className="flex justify-between items-center text-[9px] text-text-muted font-bold uppercase tracking-wider">
                                                                            <span>100-Packet Sequence / Outage Detection</span>
                                                                            <span className="font-mono">{test.sent ? `${test.received}/${test.sent} packets (${test.tx_loss_pct || 0}% tx loss)` : ''}</span>
                                                                        </div>
                                                                        <div className="h-3.5 w-full flex gap-0.5 rounded overflow-hidden bg-card-secondary/50 p-0.5 border border-border/30">
                                                                            {(test.history || Array(100).fill(1)).map((val: number, i: number) => (
                                                                                <div
                                                                                    key={i}
                                                                                    className={`flex-1 min-w-[1px] rounded-[0.5px] ${val === 1 ? 'bg-blue-600/50' : 'bg-gradient-to-t from-red-600 to-rose-400 shadow-md shadow-red-500/60'}`}
                                                                                    title={val === 1 ? `Packet #${i + 1}: Received OK` : `Packet #${i + 1}: DROPPED (Outage gap)`}
                                                                                />
                                                                            ))}
                                                                        </div>
                                                                    </div>

                                                                    {/* 5 Stat Cards + Dynamic SCM Countdown */}
                                                                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1">
                                                                        <div className="bg-card-secondary/70 p-2.5 rounded-xl border border-border">
                                                                            <div className="text-[8px] text-text-muted font-bold uppercase">Uplink Loss</div>
                                                                            <div className="text-xs font-mono font-bold text-red-500 mt-0.5">↑ {test.tx_loss_pct || 0}%</div>
                                                                        </div>
                                                                        <div className="bg-card-secondary/70 p-2.5 rounded-xl border border-border">
                                                                            <div className="text-[8px] text-text-muted font-bold uppercase">Downlink Loss</div>
                                                                            <div className="text-xs font-mono font-bold text-blue-500 mt-0.5">↓ {test.rx_loss_pct || 0}%</div>
                                                                        </div>
                                                                        <div className="bg-card-secondary/70 p-2.5 rounded-xl border border-border">
                                                                            <div className="text-[8px] text-text-muted font-bold uppercase">Avg Latency</div>
                                                                            <div className="text-xs font-mono font-bold text-text-secondary mt-0.5">{test.avg_rtt_ms || 0}ms</div>
                                                                        </div>
                                                                        <div className="bg-card-secondary/70 p-2.5 rounded-xl border border-border">
                                                                            <div className="text-[8px] text-text-muted font-bold uppercase">Jitter (ms)</div>
                                                                            <div className="text-xs font-mono font-bold text-text-secondary mt-0.5">{test.jitter_ms || 0}ms</div>
                                                                        </div>
                                                                        <div className="col-span-2 sm:col-span-1 bg-card-secondary/70 p-2.5 rounded-xl border border-border relative group/path">
                                                                            <div className="text-[8px] text-text-muted font-bold uppercase flex items-center justify-between">
                                                                                <div className="flex items-center gap-1">
                                                                                    <ArrowRightLeft size={8} className="shrink-0 animate-pulse text-blue-400" />
                                                                                    <span>{test.path_history && test.path_history.length > 1 ? 'Failover Path Sequence' : 'Egress Path'}</span>
                                                                                </div>
                                                                                <button
                                                                                    data-no-export="true"
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        handleRefreshHistoryPath(test);
                                                                                    }}
                                                                                    disabled={refreshingPathId === convId}
                                                                                    className="p-1 hover:bg-blue-500/20 rounded text-text-muted hover:text-blue-400 transition-all cursor-pointer opacity-80 group-hover/path:opacity-100 disabled:opacity-50"
                                                                                    title="Re-query Prisma SD-WAN Flow Browser to refresh and detect multi-path failovers for this test"
                                                                                >
                                                                                    <RotateCw
                                                                                        size={10}
                                                                                        className={refreshingPathId === convId ? 'animate-spin text-blue-400' : ''}
                                                                                    />
                                                                                </button>
                                                                            </div>
                                                                            {test.path_history && test.path_history.length > 1 ? (
                                                                                <div className="flex items-center gap-1.5 flex-wrap mt-1 font-mono text-[10px]">
                                                                                    {test.path_history.map((pItem: any, pIdx: number, pArr: any[]) => {
                                                                                        const isCurrent = pIdx === pArr.length - 1;
                                                                                        return (
                                                                                            <React.Fragment key={pIdx}>
                                                                                                <div
                                                                                                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded border transition-all ${
                                                                                                        isCurrent
                                                                                                            ? 'bg-blue-600/20 border-blue-500/50 text-blue-200 font-bold shadow-[0_0_10px_rgba(59,130,246,0.25)]'
                                                                                                            : 'bg-card-secondary/80 border-border text-text-muted opacity-80'
                                                                                                    }`}
                                                                                                >
                                                                                                    <span className={`text-[7px] font-mono px-1 py-0.2 rounded font-black tracking-tight ${
                                                                                                        isCurrent ? 'bg-blue-500/30 text-blue-200' : 'bg-card border border-border text-text-muted'
                                                                                                    }`}>
                                                                                                        {pIdx + 1}
                                                                                                    </span>
                                                                                                    <span className={`font-bold tracking-tight ${isCurrent ? 'text-text-primary' : 'line-through text-text-muted'}`}>
                                                                                                        {pItem.path}
                                                                                                    </span>
                                                                                                    {isCurrent && (
                                                                                                        <span className="text-[6px] bg-blue-500 text-white font-black px-1 py-0.2 rounded uppercase tracking-wider ml-0.5">
                                                                                                            ACTIVE
                                                                                                        </span>
                                                                                                    )}
                                                                                                </div>
                                                                                                {pIdx < pArr.length - 1 && (
                                                                                                    <span className="text-orange-400 font-bold text-xs">➔</span>
                                                                                                )}
                                                                                            </React.Fragment>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            ) : (test.path_evolution || test.egress_path) ? (
                                                                                <div className="text-xs font-mono font-bold text-blue-400 truncate flex items-center gap-1.5 mt-1" title={test.path_evolution || test.egress_path}>
                                                                                    {(test.path_evolution || test.egress_path).split(/ → | -> /).map((node: string, idx: number, arr: string[]) => (
                                                                                        <React.Fragment key={idx}>
                                                                                            {node}
                                                                                            {idx < arr.length - 1 && <span className="text-text-muted">⇢</span>}
                                                                                        </React.Fragment>
                                                                                    ))}
                                                                                </div>
                                                                            ) : (() => {
                                                                                const ageSec = Math.max(0, Math.floor((nowTs - (test.timestamp || 0)) / 1000));
                                                                                if (ageSec < 60) {
                                                                                    return (
                                                                                        <div className="text-[9px] text-blue-400 font-mono italic animate-pulse mt-1 flex items-center gap-1">
                                                                                            <RotateCw size={9} className="animate-spin text-blue-400" />
                                                                                            <span>SCM flow indexing ({60 - ageSec}s)</span>
                                                                                        </div>
                                                                                    );
                                                                                } else if (ageSec < 180) {
                                                                                    return (
                                                                                        <div className="text-[9px] text-amber-400 font-mono italic mt-1 flex items-center gap-1">
                                                                                            <RotateCw size={9} className="animate-spin text-amber-400" />
                                                                                            <span>2nd SCM check ({180 - ageSec}s)</span>
                                                                                        </div>
                                                                                    );
                                                                                } else {
                                                                                    return <div className="text-xs text-text-muted mt-1">—</div>;
                                                                                }
                                                                            })()}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })
                            )}
                        </tbody>
                        </table>
                    </div>
                </div>

                <div className="md:col-span-1 space-y-4 order-1 md:order-2">
                    <h3 className="text-sm font-bold text-text-muted uppercase tracking-widest flex items-center gap-2">
                        Failover Thresholds
                    </h3>
                    <div className="grid grid-cols-1 gap-3">
                        {[
                            { color: 'text-green-600 dark:text-green-400', label: 'GOOD', range: `< ${thresholds.good / 1000}s`, desc: 'Typical SD-WAN sub-second or near-second failover.' },
                            { color: 'text-yellow-500', label: 'DEGRADED', range: `${thresholds.good / 1000}s - ${thresholds.degraded / 1000}s`, desc: 'Noticeable outage. Video freeze and voice drops expected.' },
                            { color: 'text-orange-500', label: 'BAD', range: `${thresholds.degraded / 1000}s - ${thresholds.critical / 1000}s`, desc: 'High failover time. Application health impacted.' },
                            { color: 'text-red-500', label: 'CRITICAL', range: `> ${thresholds.critical / 1000}s`, desc: 'Major network blackout. Application session risk.' }
                        ].map(v => (
                            <div key={v.label} className="bg-card-secondary border border-border p-3 rounded-xl flex gap-3 shadow-sm">
                                <div className={`font-bold text-[10px] min-w-[60px] ${v.color}`}>{v.label}</div>
                                <div>
                                    <div className="text-[10px] font-bold text-text-primary">{v.range}</div>
                                    <div className="text-[9px] text-text-muted leading-tight mt-1">{v.desc}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="p-4 bg-blue-600/5 border border-blue-500/20 rounded-xl space-y-2">
                        <div className="flex items-center gap-2 text-blue-500 dark:text-blue-400">
                            <Info size={14} />
                            <span className="text-[10px] font-bold uppercase tracking-tight">Pro Tip</span>
                        </div>
                        <p className="text-[10px] text-text-muted leading-relaxed">
                            Click on any historical test row to view the detailed **Failover Timeline** chart and directional loss metrics.
                        </p>
                    </div>
                </div>
            </div>

            {/* Info Footer */}
            <div className="bg-blue-600/5 border border-blue-500/20 p-4 rounded-xl flex items-start gap-3">
                <Info size={18} className="text-blue-500 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                    <h4 className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">Under the hood</h4>
                    <p className="text-[11px] text-text-muted leading-relaxed italic">
                        This test sends high-frequency UDP packets (millisecond timestamps) to the target server.
                        It calculates failover duration based on <strong>packet sequence gaps</strong>.
                        Use this to validate SD-WAN steering policies and tunnel failover times during circuit failover events.
                        <span className="block mt-1 font-bold text-text-muted/60">Correlation tip: Use the TEST ID and Source Port displayed while the test is running to search for logs in your SD-WAN Orchestrator or firewall.</span>
                    </p>
                </div>
            </div>

            {/* Add Target Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
                    <div className="bg-card border border-border w-full max-w-md rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
                        <div className="p-6 border-b border-border flex items-center justify-between bg-card-secondary/50">
                            <h3 className="text-lg font-bold text-text-primary flex items-center gap-2">
                                <Target size={20} className="text-blue-500" /> Add Failover Target
                            </h3>
                            <button onClick={() => setShowAddModal(false)} className="text-text-muted hover:text-text-primary transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">

                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-text-muted uppercase tracking-widest pl-1">Target Label</label>
                                <input
                                    type="text"
                                    placeholder="e.g. DC1 - Primary"
                                    value={newTarget.label}
                                    onChange={(e) => setNewTarget({ ...newTarget, label: e.target.value })}
                                    className="w-full bg-card-secondary border border-border rounded-xl px-4 py-3 text-text-primary outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                                />
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div className="col-span-2 space-y-1.5">
                                    <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest pl-1">
                                        <span className="text-text-muted">IP / Hostname</span>
                                        {newTarget.target && !isValidIpOrFqdn(newTarget.target) && (
                                            <span className="text-[9px] text-red-500 font-black px-1.5 py-0.5 rounded border border-red-500/20 bg-red-500/10 tracking-widest">
                                                Invalid Format
                                            </span>
                                        )}
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="192.168.1.10"
                                        value={newTarget.target}
                                        onChange={(e) => setNewTarget({ ...newTarget, target: e.target.value })}
                                        className={`w-full bg-card-secondary border rounded-xl px-4 py-3 text-text-primary outline-none focus:ring-1 transition-all font-mono ${newTarget.target && !isValidIpOrFqdn(newTarget.target)
                                            ? 'border-red-500/50 focus:border-red-500 text-red-400 focus:ring-red-500/50'
                                            : 'border-border focus:ring-blue-500'
                                            }`}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest pl-1">Port</label>
                                    <input
                                        type="number"
                                        value={newTarget.port}
                                        onChange={(e) => setNewTarget({ ...newTarget, port: parseInt(e.target.value) })}
                                        disabled={true}
                                        className="w-full bg-card-secondary/50 border border-border rounded-xl px-4 py-3 text-text-muted outline-none cursor-not-allowed font-mono opacity-70"
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="p-6 border-t border-border bg-card-secondary/50 rounded-b-2xl flex gap-3">
                            <button
                                onClick={() => setShowAddModal(false)}
                                className="flex-1 px-4 py-3 rounded-xl bg-card-secondary hover:bg-card-hover text-text-muted font-bold transition-all text-sm border border-border"
                            >
                                CANCEL
                            </button>
                            <button
                                onClick={addEndpoint}
                                disabled={!newTarget.label || !newTarget.target || !isValidIpOrFqdn(newTarget.target)}
                                className="flex-1 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition-all shadow-lg shadow-blue-900/20 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                SAVE TARGET
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
