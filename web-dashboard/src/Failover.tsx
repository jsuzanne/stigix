import React, { useState, useEffect } from 'react';
import { Activity, Clock, Shield, Search, ChevronRight, BarChart3, AlertCircle, Info, Play, Pause, Trash2, Zap, Server, Globe, Hash, Plus, Target, X, Square, ArrowRightLeft } from 'lucide-react';
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
            setActiveTests(data);
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
            setActiveTests(externalStatus);
        }
    }, [externalStatus]);

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
        const targets = endpoints.filter(e => endpointIds.includes(e.id));
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

    const stopTest = async (testId?: string) => {
        setIsStopping(true);
        try {
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

    const sortedHistory = React.useMemo(() => {
        if (!sortConfig) return history;
        return [...history].sort((a, b) => {
            const aVal = a[sortConfig.key];
            const bVal = b[sortConfig.key];
            if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [history, sortConfig]);

    const getVerdict = (maxBlackout: number) => {
        if (maxBlackout === 0) return { label: 'PERFECT', color: 'text-green-400', bg: 'bg-green-400/10', desc: 'No packet loss detected.' };
        if (maxBlackout < thresholds.good) return { label: 'GOOD', color: 'text-green-400', bg: 'bg-green-400/10', desc: 'Typical SD-WAN failover range. Sessions usually stay up.' };
        if (maxBlackout < thresholds.degraded) return { label: 'DEGRADED', color: 'text-yellow-400', bg: 'bg-yellow-400/10', desc: 'Noticeable outage. Video freeze and voice drops expected.' };
        if (maxBlackout < thresholds.critical) return { label: 'BAD', color: 'text-orange-400', bg: 'bg-orange-400/10', desc: 'High convergence time. Application health impacted.' };
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

    const selectedCount = endpoints.filter(e => selectedEndpoints.includes(e.id)).length;

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
                            <h2 className="text-xl font-bold text-text-primary tracking-tight">Convergence Lab</h2>
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
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-text-muted font-bold uppercase tracking-widest pl-1">Global Precision (Rate)</label>
                            <select
                                value={rate}
                                onChange={(e) => setRate(parseInt(e.target.value))}
                                disabled={activeTests.length > 0}
                                className="bg-card-secondary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 appearance-none"
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
                        <div className="flex items-center gap-4">
                            {activeTests.length > 0 && (
                                <button
                                    onClick={() => stopTest()}
                                    disabled={isStopping}
                                    className="mt-5 flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded-lg text-sm font-bold transition-all border border-red-500/30 shadow-lg shadow-red-900/20 group disabled:opacity-50"
                                >
                                    {isStopping ? <Activity size={16} className="animate-spin" /> : <Square size={16} fill="currentColor" className="group-hover:animate-pulse" />}
                                    {isStopping ? 'STOPPING...' : 'STOP ALL PROBES'}
                                </button>
                            )}
                            {selectedCount > 0 && (
                                <button
                                    onClick={() => startTest(selectedEndpoints)}
                                    disabled={isStarting}
                                    className="mt-5 flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-bold transition-all shadow-lg shadow-blue-900/40 border border-blue-400/30 disabled:opacity-50"
                                >
                                    {isStarting ? <Activity size={18} className="animate-spin" /> : <Play size={18} fill="currentColor" />}
                                    {isStarting ? 'STARTING...' : `START ${selectedCount} ${selectedCount === 1 ? 'TEST' : 'TESTS'}`}
                                </button>
                            )}
                            <button
                                onClick={() => setShowAddModal(true)}
                                disabled={activeTests.length > 0}
                                className="mt-5 flex items-center gap-2 px-4 py-2 bg-card-secondary hover:bg-card-hover text-text-primary rounded-lg text-sm font-bold transition-all border border-border disabled:opacity-50 shadow-sm"
                            >
                                <Plus size={18} /> ADD TARGET
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 animate-in slide-in-from-bottom-4">
                {endpoints.map((e) => {
                    const isSelected = selectedEndpoints.includes(e.id);
                    return (
                        <div
                            key={e.id}
                            onClick={() => {
                                if (isSelected) setSelectedEndpoints(selectedEndpoints.filter(id => id !== e.id));
                                else setSelectedEndpoints([...selectedEndpoints, e.id]);
                            }}
                            className={`bg-card border p-4 rounded-xl group cursor-pointer transition-all flex flex-col justify-between shadow-sm hover:shadow-md ${isSelected ? 'border-blue-500 bg-blue-600/5 shadow-blue-500/10' : 'border-border'}`}
                        >
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${isSelected ? 'bg-blue-600 border-blue-500' : 'bg-card-secondary border-border'}`}>
                                        {isSelected && <Zap size={12} className="text-white" fill="currentColor" />}
                                    </div>
                                    <div>
                                        <h4 className={`font-bold transition-colors tracking-tight ${isSelected ? 'text-blue-500' : 'text-text-primary'}`}>{e.label}</h4>
                                        <p className="text-[10px] text-text-muted font-mono mt-0.5">{e.target}:{e.port}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={(e_stop) => { e_stop.stopPropagation(); deleteEndpoint(e.id); }}
                                    className="text-text-muted hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                            <div className="w-full flex items-center justify-center gap-2 py-2 bg-card-secondary text-text-muted border border-border rounded-lg font-bold text-[10px] uppercase tracking-wider">
                                {isSelected ? 'READY TO START' : 'SELECT TARGET'}
                            </div>
                        </div>
                    );
                })}
                {endpoints.length === 0 && (
                    <div className="col-span-full py-12 text-center bg-card-secondary/20 border border-dashed border-border rounded-2xl text-text-muted text-sm">
                        No targets defined. Click "Add Target" to set up your test plan.
                    </div>
                )}
            </div>

            {/* Active Tests Section */}
            <div className="space-y-4">
                {activeTests.map((test) => (
                    <div key={test.testId} className="bg-card border border-border rounded-2xl overflow-hidden shadow-xl flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-border">
                        {/* Outage Stats */}
                        <div className="bg-card-secondary/30 p-6 md:w-1/3 flex flex-col justify-center items-center text-center space-y-4">
                            <div className="space-y-1">
                                <div className="flex items-center gap-2 justify-center mb-1">
                                    <Activity size={14} className="text-blue-500" />
                                    <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Current Outage</span>
                                </div>
                                <div className={`text-4xl font-black font-mono tracking-tighter transition-all duration-300 ${test.current_blackout_ms > 0 ? 'text-red-500 animate-pulse' : 'text-text-primary'}`} style={test.current_blackout_ms > 0 ? { textShadow: '0 0 20px rgba(2ef, 68, 68, 0.4)' } : {}}>
                                    {formatMs(test.current_blackout_ms || 0)}
                                </div>
                            </div>
                            <div className="flex justify-center gap-6 w-full">
                                <div className="space-y-1">
                                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Max Blackout</div>
                                    <div className="text-xl font-bold text-orange-500 font-mono">
                                        {formatMs(test.max_blackout_ms || 0)}
                                    </div>
                                </div>
                                <div className="w-px bg-border/50"></div>
                                <div className="space-y-1 flex flex-col items-center">
                                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest">QoE Score</div>
                                    {(() => {
                                        // Simple synthetic QoE Score: Starts at 100, drops for loss, jitter, and high RTT.
                                        let qoe = 100 - (test.loss_pct * 2) - ((test.jitter_ms || 0) * 0.5) - ((test.avg_rtt_ms > 50 ? test.avg_rtt_ms - 50 : 0) * 0.1);
                                        qoe = Math.max(0, Math.min(100, Math.round(qoe)));
                                        let color = qoe >= 90 ? 'text-green-400 font-bold' : qoe >= 70 ? 'text-amber-500 font-bold' : 'text-red-500 font-bold animate-pulse';
                                        let glow = qoe >= 90 ? '0 0 10px rgba(74, 222, 128, 0.3)' : qoe >= 70 ? '0 0 10px rgba(245, 158, 11, 0.3)' : '0 0 15px rgba(2ef, 68, 68, 0.4)';
                                        return <div className={`text-xl font-mono ${color}`} style={{ textShadow: glow }}>{qoe}/100</div>;
                                    })()}
                                </div>
                            </div>
                        </div>

                        {/* Timeline & Details */}
                        <div className="flex-1 p-6 relative flex flex-col justify-between">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex flex-col">
                                    <div className="flex items-center gap-3">
                                        <span title={`Source Port: ${getSourcePort(test.test_id || '')}`} className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-600 text-white uppercase tracking-tighter shadow-lg shadow-blue-500/20 cursor-help">
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
                                        <Server size={10} /> {new Date().toLocaleDateString('en-CA')} {new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })} | Duration: {formatChrono(test.start_time)} | {test.target || '--'} | Source Port: {getSourcePort(test.test_id)} | {test.rate_pps || test.rate} pps
                                    </span>
                                </div>
                                <div className="flex flex-col items-end gap-1.5">
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

                            <div className="h-[40px] w-full flex flex-col justify-end relative rounded overflow-hidden bg-card-secondary/20 mb-6">
                                {/* Blackout Overlay */}
                                {test.current_blackout_ms > 0 && (
                                    <div className="absolute inset-0 z-10 bg-red-900/40 backdrop-blur-[1px] flex items-center justify-center animate-in fade-in">
                                        <div className="bg-red-950/80 text-red-500 border border-red-500/50 px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 shadow-[0_0_20px_rgba(239,68,68,0.4)]">
                                            <AlertCircle size={12} className="animate-pulse" />
                                            NETWORK OUTAGE: {(test.current_blackout_ms / 1000).toFixed(1)}s - FAILOVER IN PROGRESS...
                                        </div>
                                    </div>
                                )}
                                <div className="w-full flex items-end gap-[1px] h-full px-1">
                                    {(test.history || Array(100).fill(1)).map((val: number, i: number) => {
                                        const isLast = i === (test.history || []).length - 1;
                                        return (
                                            <div
                                                key={i}
                                                className={`flex-1 min-w-[2px] rounded-t-[1px] transition-all duration-300 ${val === 1
                                                    ? 'bg-gradient-to-t from-blue-700 to-blue-400 h-[80%]'
                                                    : 'bg-red-500 h-[20%] opacity-80'}`}
                                                style={isLast && val === 1 ? { background: '#60a5fa', boxShadow: '0 0 10px #60a5fa', height: '100%' } : {}}
                                            />
                                        )
                                    })}
                                </div>
                            </div>

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
                    </div>
                ))}
            </div>

            {/* Verdict Legend & Historical View */}
            <div className={`grid grid-cols-1 md:grid-cols-4 gap-6 ${activeTests.length > 0 ? 'opacity-50 grayscale transition-all' : ''}`}>
                <div className="md:col-span-3 bg-card border border-border rounded-2xl overflow-hidden shadow-sm order-2 md:order-1">
                    <div className="p-4 border-b border-border bg-card-secondary/50 flex items-center justify-between">
                        <h3 className="text-sm font-bold text-text-secondary uppercase tracking-widest flex items-center gap-2">
                            <Clock size={16} /> Test History
                        </h3>
                        <div className="flex items-center gap-3">
                            {activeTests.length === 0 && (
                                <button
                                    onClick={resetIds}
                                    className="flex items-center gap-2 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-orange-600 dark:text-orange-400 bg-orange-600/5 hover:bg-orange-600/10 border border-orange-500/20 rounded-lg transition-all"
                                >
                                    <Hash size={12} />
                                    RESET ID
                                </button>
                            )}
                            {history.length > 0 && (
                                <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">{history.length} TESTS RECORDED</span>
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
                                {sortedHistory.map((test, idx) => {
                                    const verdict = getVerdict(test.max_blackout_ms);
                                    const isExpanded = expandedHistory === (test.test_id + test.timestamp);
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
                                                    <div className="text-[10px] text-text-muted mt-1 font-mono">
                                                        <span className="font-bold text-text-secondary">Duration: {test.duration_s || '--'}s</span> | {test.target}:{test.port || '--'} | <span className="text-text-secondary">Source Port: {test.source_port || getSourcePort(test.test_id)}</span> | {test.rate_pps || test.rate || '--'} pps
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
                                                        <div className="space-y-3">
                                                            <div className="flex items-center justify-between">
                                                                <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-2">
                                                                    <BarChart3 size={12} /> Historical Failover Timeline
                                                                </h4>
                                                                <div className="flex gap-3 text-[9px] font-bold">
                                                                    <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-blue-600" /> <span className="text-text-muted uppercase">Success</span></div>
                                                                    <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-red-500" /> <span className="text-text-muted uppercase">Drop / Outage</span></div>
                                                                </div>
                                                            </div>
                                                            <div className="h-4 w-full flex gap-0.5 rounded overflow-hidden">
                                                                {(test.history || Array(100).fill(1)).map((val: number, i: number) => (
                                                                    <div
                                                                        key={i}
                                                                        className={`flex-1 min-w-[1px] ${val === 1 ? 'bg-blue-600/40' : 'bg-red-500 shadow-lg shadow-red-500/50'}`}
                                                                    />
                                                                ))}
                                                            </div>
                                                            <div className="grid grid-cols-5 gap-3 pt-2">
                                                                <div className="bg-card-secondary p-2 rounded border border-border">
                                                                    <div className="text-[8px] text-text-muted font-bold uppercase">Uplink Loss</div>
                                                                    <div className="text-xs font-mono font-bold text-red-500">↑ {test.tx_loss_pct || 0}%</div>
                                                                </div>
                                                                <div className="bg-card-secondary p-2 rounded border border-border">
                                                                    <div className="text-[8px] text-text-muted font-bold uppercase">Downlink Loss</div>
                                                                    <div className="text-xs font-mono font-bold text-blue-500">↓ {test.rx_loss_pct || 0}%</div>
                                                                </div>
                                                                <div className="bg-card-secondary p-2 rounded border border-border">
                                                                    <div className="text-[8px] text-text-muted font-bold uppercase">Avg Latency</div>
                                                                    <div className="text-xs font-mono font-bold text-text-secondary">{test.avg_rtt_ms || 0}ms</div>
                                                                </div>
                                                                <div className="bg-card-secondary p-2 rounded border border-border">
                                                                    <div className="text-[8px] text-text-muted font-bold uppercase">Jitter (ms)</div>
                                                                    <div className="text-xs font-mono font-bold text-text-secondary">{test.jitter_ms || 0}ms</div>
                                                                </div>
                                                                <div className="bg-card-secondary p-2 rounded border border-border">
                                                                    <div className="text-[8px] text-text-muted font-bold uppercase flex items-center gap-1">
                                                                        <ArrowRightLeft size={7} className="shrink-0 animate-pulse text-blue-400" />
                                                                        Egress Path
                                                                    </div>
                                                                    {test.egress_path ? (
                                                                        <div className="text-xs font-mono font-bold text-blue-400 truncate flex items-center gap-1.5" title={test.egress_path}>
                                                                            {test.egress_path.split(' -> ').map((node: string, idx: number, arr: string[]) => (
                                                                                <React.Fragment key={idx}>
                                                                                    {node}
                                                                                    {idx < arr.length - 1 && <span className="text-text-muted">⇢</span>}
                                                                                </React.Fragment>
                                                                            ))}
                                                                        </div>
                                                                    ) : (Date.now() - (test.timestamp || 0)) < 3 * 60 * 1000 ? (
                                                                        <div className="text-[9px] text-text-muted italic">⏳ fetching...</div>
                                                                    ) : (
                                                                        <div className="text-xs text-text-muted">—</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                                {history.length === 0 && !loadingHistory && (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center text-text-muted italic border-t border-border bg-card/50">
                                            No failover tests recorded yet.
                                        </td>
                                    </tr>
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
                            { color: 'text-green-600 dark:text-green-400', label: 'GOOD', range: `< ${thresholds.good / 1000}s`, desc: 'Typical SD-WAN sub-second or near-second convergence.' },
                            { color: 'text-yellow-500', label: 'DEGRADED', range: `${thresholds.good / 1000}s - ${thresholds.degraded / 1000}s`, desc: 'Noticeable outage. Video freeze and voice drops expected.' },
                            { color: 'text-orange-500', label: 'BAD', range: `${thresholds.degraded / 1000}s - ${thresholds.critical / 1000}s`, desc: 'High convergence time. Application health impacted.' },
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
                        Use this to validate SD-WAN steering policies and tunnel convergence times during circuit failover events.
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
                            {/* Shared registry suggestions */}
                            {convergenceTargets.length > 0 && (
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest pl-1">From Registry (auto-fill)</label>
                                    <select
                                        onChange={e => {
                                            if (!e.target.value) return;
                                            const t = convergenceTargets.find((ct: any) => ct.id === e.target.value);
                                            if (t) setNewTarget({ label: t.name, target: t.host, port: t.ports?.convergence ?? 6200 });
                                        }}
                                        className="w-full bg-card-secondary border border-border rounded-xl px-4 py-3 text-text-primary outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                                        defaultValue=""
                                    >
                                        <option value="">-- Select from Targets Registry --</option>
                                        {convergenceTargets.filter((t: any) => !endpoints.some(e => e.target === t.host)).map((t: any) => (
                                            <option key={t.id} value={t.id}>{t.name} — {t.host}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
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
