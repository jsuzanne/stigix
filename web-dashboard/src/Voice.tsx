import React, { useState, useEffect } from 'react';
import { Phone, Play, Pause, Server, BarChart2, Save, Plus, Trash2, Clock, Activity, Wifi, Search, CheckSquare, AlertCircle, Hash, Download, Upload } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import toast from 'react-hot-toast';
import { isValidIpOrFqdn } from './utils/validation';


function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

// Helper logic to match rtp.py port mapping
// CALL-0000 -> 30000
// CALL-9999 -> 39999
const deriveSourcePort = (callId: string): string => {
    if (callId && callId.startsWith('CALL-')) {
        const num = parseInt(callId.substring(5), 10);
        if (!isNaN(num)) {
            const port = 30000 + (num % 10000);
            return port.toString();
        }
    }
    return '?';
};

interface VoiceProps {
    token: string;
    externalStatus?: any;
}

interface VoiceCall {
    timestamp: string;
    event: 'start' | 'end' | 'session_start' | 'skipped';
    call_id: string;
    pid: number;
    target: string;
    codec: string;
    duration: number;
    session_id?: string;
    loss_pct?: number;
    avg_rtt_ms?: number;
    jitter_ms?: number;
    mos_score?: number;
}

interface VoiceControl {
    enabled: boolean;
    max_simultaneous_calls: number;
    sleep_between_calls: number;
    interface: string;
}

export default function Voice(props: VoiceProps) {
    const { token, externalStatus } = props;
    const [enabled, setEnabled] = useState(false);
    const [config, setConfig] = useState<VoiceControl | null>(null);
    const [rawServers, setRawServers] = useState("");
    const [calls, setCalls] = useState<VoiceCall[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<'status' | 'config'>('status');
    const [searchTerm, setSearchTerm] = useState('');
    const [qualityFilter, setQualityFilter] = useState<'all' | 'excellent' | 'fair' | 'poor'>('all');
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>({ key: 'timestamp', direction: 'desc' });
    const [isStartingV, setIsStartingV] = useState(false);
    const [isStoppingV, setIsStoppingV] = useState(false);
    const [isDirty, setIsDirty] = useState(false);

    // New Guided Editor State
    const [newProbe, setNewProbe] = useState({
        host: '',
        port: '6100',
        codec: 'G.711-ulaw',
        weight: '50',
        duration: '30'
    });
    const [showGuided, setShowGuided] = useState(true);

    useEffect(() => {
        if (externalStatus) {
            // Stats always update
            if (externalStatus.stats) {
                setCalls(externalStatus.stats);
            }

            // Configuration only updates if the user hasn't touched the UI (isDirty is false)
            if (externalStatus.control && !isDirty) {
                setEnabled(externalStatus.control.enabled);
                setConfig(prev => ({ ...prev, ...externalStatus.control }));
            }
        }
    }, [externalStatus, isDirty]);

    useEffect(() => {
        fetchConfig();
        // Config doesn't change much, poll every 30s
        const interval = setInterval(fetchConfig, 30000);
        return () => clearInterval(interval);
    }, [token]);

    const fetchStatus = async () => {
        try {
            const r = await fetch('/api/voice/status', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await r.json();
            if (data.success) {
                setEnabled(data.enabled);
                setConfig(data);
            }
        } catch (e) { }
    };

    const fetchConfig = async () => {
        try {
            const r = await fetch('/api/voice/config', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await r.json();
            if (data.success) {
                // ONLY update if we don't have unsaved changes
                if (!isDirty) {
                    setRawServers(data.servers);
                }
                setLoading(false);
            }
        } catch (e) {
            setLoading(false);
        }
    };

    const fetchStats = async () => {
        try {
            const r = await fetch('/api/voice/stats', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await r.json();
            if (data.success) {
                setCalls(data.stats);
            }
        } catch (e) { }
    };

    const handleExport = async () => {
        try {
            const r = await fetch('/api/voice/config/export', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const blob = await r.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `voice-config-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (e) { }
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const config = JSON.parse(text);

            const r = await fetch('/api/voice/config/import', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ config })
            });

            const data = await r.json();
            if (r.ok && data.success) {
                fetchConfig();
                toast.success('✓ Voice configuration imported');
            } else {
                toast.error(`❌ Import failed: ${data.error || 'Server error'}`);
            }
        } catch (e: any) {
            toast.error(`❌ Import failed: ${e.message}`);
        }
    };

    const handleToggle = async () => {
        const targetState = !enabled;
        if (targetState) setIsStartingV(true);
        else setIsStoppingV(true);

        try {
            const r = await fetch('/api/voice/control', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ enabled: targetState })
            });
            const data = await r.json();
            if (data.success) {
                setEnabled(data.enabled);
            }
        } catch (e) { } finally {
            setIsStartingV(false);
            setIsStoppingV(false);
        }
    };

    const resetIds = async () => {
        if (!confirm('This will reset the CALL-XXXX counter to CALL-0000 for the next call. Continue?')) return;
        try {
            await fetch('/api/voice/counter', {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        } catch (e) { }
    };

    const resetLogs = async () => {
        if (!confirm('Are you sure you want to reset all voice call history?')) return;
        try {
            const res = await fetch('/api/voice/stats', {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                // Next poll will clear it
            }
        } catch (e) { }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const r = await fetch('/api/voice/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ servers: rawServers, control: config })
            });
            if (r.ok) {
                setIsDirty(false); // Reset dirty flag on successful save
            }
        } catch (e) { }
        setSaving(false);
    };

    const handleResetToCurrent = () => {
        setIsDirty(false);
        // Next poll will restore current state
    };

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const sortedCalls = React.useMemo(() => {
        if (!sortConfig) return calls;
        return [...calls].sort((a: any, b: any) => {
            const aVal = a[sortConfig.key];
            const bVal = b[sortConfig.key];
            if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [calls, sortConfig]);

    const addProbeFromForm = () => {
        const { host, port, codec, weight, duration } = newProbe;
        if (!host || !port) return alert("Host and Port are required");
        if (!isValidIpOrFqdn(host)) return alert("Invalid Target Host/IP format");

        const newLine = `${host}:${port}|${codec}|${weight}|${duration}`;
        setIsDirty(true);
        setRawServers(prev => {
            const trimmed = prev.trim();
            return trimmed ? `${trimmed}\n${newLine}` : newLine;
        });
        setNewProbe({ ...newProbe, host: '' }); // Clear host for next entry
    };

    const removeProbeAt = (lineIndex: number) => {
        const lines = rawServers.split('\n');
        const newLines = lines.filter((_, i) => i !== lineIndex);
        setIsDirty(true);
        setRawServers(newLines.join('\n'));
    };

    const parsedProbes = React.useMemo(() => {
        return rawServers.split('\n')
            .map((line, index) => ({ line, index }))
            .filter(item => item.line.trim() && !item.line.trim().startsWith('#'))
            .map(item => {
                const parts = item.line.trim().split('|');
                const targetParts = parts[0]?.split(':') || [];
                return {
                    id: item.index,
                    target: parts[0],
                    host: targetParts[0],
                    port: targetParts[1],
                    codec: parts[1] || 'default',
                    weight: parts[2] || '—',
                    duration: parts[3] ? `${parts[3]}s` : '—',
                    raw: item.line
                };
            });
    }, [rawServers]);

    // Calculate metrics
    const activeCalls = React.useMemo(() => {
        const active: VoiceCall[] = [];
        const endedIds = new Set(calls.filter(c => c.event === 'end').map(c => c.call_id));

        calls.forEach(c => {
            if (c.event === 'start' && !endedIds.has(c.call_id)) {
                active.push(c);
            }
        });
        return active;
    }, [calls]);

    // Calculate history metrics (Summary)
    const qosSummary = React.useMemo(() => {
        const finishedCalls = calls.filter(c => c.event === 'end' && c.loss_pct !== undefined);
        if (finishedCalls.length === 0) return null;

        const totalLoss = finishedCalls.reduce((acc, c) => acc + (c.loss_pct || 0), 0);
        const rtts = finishedCalls.map(c => c.avg_rtt_ms || 0).filter(v => v > 0);
        const jitters = finishedCalls.map(c => c.jitter_ms || 0).filter(v => v > 0);
        const mosScores = finishedCalls.map(c => c.mos_score || 0).filter(v => v > 0);

        return {
            totalCalls: finishedCalls.length,
            avgLoss: (totalLoss / finishedCalls.length).toFixed(1),
            avgRtt: rtts.length > 0 ? (rtts.reduce((a, b) => a + b, 0) / rtts.length).toFixed(1) : '0',
            minRtt: rtts.length > 0 ? Math.min(...rtts).toFixed(1) : '0',
            maxRtt: rtts.length > 0 ? Math.max(...rtts).toFixed(1) : '0',
            avgJitter: jitters.length > 0 ? (jitters.reduce((a, b) => a + b, 0) / jitters.length).toFixed(1) : '0',
            avgMos: mosScores.length > 0 ? (mosScores.reduce((a, b) => a + b, 0) / mosScores.length).toFixed(2) : 'N/A'
        };
    }, [calls]);

    // Newest history first with Filters
    const sortedHistory = React.useMemo(() => {
        return [...calls]
            .filter(c => c.event === 'start' || c.event === 'end' || c.event === 'skipped')
            .filter(c => {
                // Search filter
                const matchesSearch = c.call_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    c.target.toLowerCase().includes(searchTerm.toLowerCase());

                if (!matchesSearch) return false;

                // Quality filter (only applies to 'end' events)
                if (qualityFilter !== 'all' && c.event === 'end') {
                    const loss = c.loss_pct || 0;
                    const rtt = c.avg_rtt_ms || 0;
                    const quality = (loss < 1 && rtt < 100) ? 'excellent' :
                        (loss < 5 && rtt < 200) ? 'fair' : 'poor';
                    return quality === qualityFilter;
                }

                return true;
            })
            .sort((a: any, b: any) => {
                if (!sortConfig) {
                    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
                }
                const aVal = a[sortConfig.key] ?? 0;
                const bVal = b[sortConfig.key] ?? 0;
                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
    }, [calls, searchTerm, qualityFilter, sortConfig]);

    return (
        <div className="space-y-6">
            {/* Header Control */}
            <div className="bg-card border border-border rounded-2xl p-8 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                    <Phone size={120} />
                </div>
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8 relative z-10">
                    <div className="flex items-center gap-6">
                        <div className={cn(
                            "p-5 rounded-2xl shadow-xl transition-all border",
                            enabled
                                ? "bg-blue-600 text-white shadow-blue-900/30 border-blue-500/20"
                                : "bg-card-secondary text-text-muted border-border"
                        )}>
                            <Phone size={32} className={cn(enabled && "animate-pulse")} />
                        </div>
                        <div>
                            <div className="flex items-center gap-3 mb-1">
                                <h2 className="text-2xl font-black text-text-primary tracking-tight">VoIP Simulation</h2>
                                <span className={cn(
                                    "px-2 py-0.5 rounded-full text-[10px] font-black tracking-widest border",
                                    enabled ? "bg-green-600/10 text-green-600 dark:text-green-400 border-green-500/20" : "bg-red-600/10 text-red-600 dark:text-red-400 border-red-500/20"
                                )}>
                                    {enabled ? 'Active' : 'Offline'}
                                </span>
                            </div>
                            <p className="text-text-muted text-xs font-bold uppercase tracking-widest opacity-70">
                                Real-time RTP Stream Emulation • {enabled ? `${activeCalls.length} Concurrent Streams` : (parsedProbes.length === 0 ? "No Targets Defined" : "Engine Standby")}
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={handleToggle}
                        disabled={isStartingV || isStoppingV || (!enabled && parsedProbes.length === 0)}
                        className={cn(
                            "px-10 py-4 rounded-2xl font-black text-[11px] tracking-[0.2em] transition-all shadow-2xl flex items-center justify-center gap-3 group relative overflow-hidden",
                            !enabled && parsedProbes.length === 0
                                ? "bg-card-secondary text-text-muted border border-border cursor-not-allowed shadow-none"
                                : (enabled
                                    ? "bg-red-600 hover:bg-red-500 text-white shadow-red-900/40"
                                    : "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/40"),
                            (isStartingV || isStoppingV) && "opacity-50 cursor-not-allowed"
                        )}
                    >
                        {(isStartingV || isStoppingV) ? (
                            <Activity size={20} className="animate-spin" />
                        ) : (
                            enabled ? <Pause size={20} fill="currentColor" className="group-hover:scale-110 transition-transform" /> : <Play size={20} fill="currentColor" className="group-hover:scale-110 transition-transform" />
                        )}
                        <span className="relative z-10">
                            {isStartingV ? 'Initializing...' : isStoppingV ? 'Terminating...' : (enabled ? 'Stop Voice Simulation' : 'Start Voice Simulation')}
                        </span>
                    </button>
                </div>

                {/* QoS Summary Widget */}
                {qosSummary && (
                    <div className="mt-10 grid grid-cols-2 lg:grid-cols-6 gap-4">
                        {[
                            { label: 'Total Calls', value: qosSummary.totalCalls, icon: Activity, color: 'text-text-primary' },
                            { label: 'Avg Loss', value: `${qosSummary.avgLoss}%`, icon: Wifi, color: parseFloat(qosSummary.avgLoss) < 1 ? "text-green-600 dark:text-green-400" : "text-orange-600 dark:text-orange-400" },
                            { label: 'Avg Latency', value: `${qosSummary.avgRtt}ms`, icon: Clock, color: "text-blue-600 dark:text-blue-400" },
                            { label: 'Avg MOS Score', value: qosSummary.avgMos, icon: Activity, color: parseFloat(qosSummary.avgMos) >= 4.0 ? "text-green-600 dark:text-green-400" : parseFloat(qosSummary.avgMos) >= 3.0 ? "text-orange-600 dark:text-orange-400" : "text-red-600 dark:text-red-400" },
                            { label: 'RTT Variance', value: `${qosSummary.minRtt} / ${qosSummary.maxRtt}ms`, icon: BarChart2, color: "text-text-muted" },
                            { label: 'Avg Jitter', value: `${qosSummary.avgJitter}ms`, icon: Activity, color: "text-purple-600 dark:text-purple-400" }
                        ].map((stat, i) => (
                            <div key={i} className="bg-card-secondary/50 border border-border rounded-2xl p-4 shadow-sm group hover:border-blue-500/30 transition-colors">
                                <div className="flex items-center gap-2 mb-2">
                                    <stat.icon size={12} className="text-text-muted opacity-50" />
                                    <label className="text-[9px] font-black text-text-muted uppercase tracking-widest">{stat.label}</label>
                                </div>
                                <div className={cn("text-lg font-black tracking-tighter truncate", stat.color)}>
                                    {stat.value}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Main Tabs */}
            <div className="flex gap-1 bg-card-secondary/50 p-1 rounded-2xl border border-border w-fit shadow-inner">
                <button
                    onClick={() => setActiveTab('status')}
                    className={cn(
                        "px-8 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                        activeTab === 'status'
                            ? "bg-card text-blue-600 dark:text-blue-400 shadow-md border border-border"
                            : "text-text-muted hover:text-text-primary"
                    )}
                >
                    Call Monitoring
                </button>
                <button
                    onClick={() => setActiveTab('config')}
                    className={cn(
                        "px-8 py-2.5 rounded-xl text-[10px] font-black tracking-widest transition-all",
                        activeTab === 'config'
                            ? "bg-card text-blue-600 dark:text-blue-400 shadow-md border border-border"
                            : "text-text-muted hover:text-text-primary"
                    )}
                >
                    Configuration
                </button>
            </div>

            {activeTab === 'status' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Active Calls Widget */}
                    <div className="lg:col-span-1 bg-card border border-border rounded-2xl p-6 shadow-sm overflow-hidden relative">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-[10px] font-black text-text-primary tracking-[0.2em] flex items-center gap-2 border-l-2 border-blue-500 pl-2">
                                <Activity size={14} className="text-blue-500" /> Live Streams
                            </h3>
                            <span className="text-[10px] font-black text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded-full">
                                {activeCalls.length} UP
                            </span>
                        </div>
                        <div className="space-y-4">
                            {activeCalls.length === 0 ? (
                                <div className="text-text-muted text-[10px] font-bold uppercase tracking-widest py-12 text-center bg-card-secondary/30 rounded-2xl border border-dashed border-border/50">
                                    No active voice telemetry
                                </div>
                            ) : (
                                activeCalls.map((call, idx) => (
                                    <div key={idx} className="bg-card-secondary/50 p-4 rounded-2xl border border-border flex items-center justify-between shadow-sm group hover:border-blue-500/30 transition-all">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <span title={`Source Port: ${deriveSourcePort(call.call_id)}`} className="text-[9px] font-black text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded bg-blue-600/10 border border-blue-500/10 font-mono italic cursor-help">
                                                    #{call.call_id}
                                                </span>
                                                <div className="text-xs font-black text-text-primary tracking-tight uppercase">{call.target}</div>
                                            </div>
                                            <div className="text-[9px] text-text-muted font-bold uppercase tracking-widest opacity-60">
                                                {call.codec} • Started {call.duration}s ago
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 bg-green-600/10 px-2 py-1 rounded-lg border border-green-500/20">
                                            <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                                            <span className="text-[9px] text-green-600 dark:text-green-400 font-black tracking-tighter">Live</span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Stats Summary */}
                    <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-6 shadow-sm flex flex-col">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-600/10 rounded-lg text-blue-600 dark:text-blue-400">
                                    <BarChart2 size={18} />
                                </div>
                                <h3 className="text-[10px] font-black text-text-primary tracking-[0.2em]">Diagnostic History</h3>
                            </div>

                            <div className="flex flex-1 max-w-md gap-3">
                                <div className="relative flex-1">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted opacity-50" />
                                    <input
                                        type="text"
                                        placeholder="Search traces..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full bg-card-secondary/50 border border-border text-[10px] font-black tracking-widest text-text-primary rounded-xl pl-10 pr-3 py-2.5 outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-inner"
                                    />
                                </div>
                                <select
                                    value={qualityFilter}
                                    onChange={(e) => setQualityFilter(e.target.value as any)}
                                    className="bg-card-secondary/50 border border-border text-[10px] font-black uppercase tracking-widest text-text-primary rounded-xl px-4 py-2.5 outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-inner"
                                >
                                    <option value="all">Any Quality</option>
                                    <option value="excellent">Excellent</option>
                                    <option value="fair">Fair</option>
                                    <option value="poor">Poor</option>
                                </select>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    onClick={resetIds}
                                    className="flex items-center gap-2 px-4 py-2.5 text-[9px] font-black tracking-[0.15em] text-orange-600 dark:text-orange-400 hover:bg-orange-600/10 border border-orange-500/20 rounded-xl transition-all shadow-sm"
                                >
                                    <Hash size={12} />
                                    Reset ID
                                </button>
                                <button
                                    onClick={resetLogs}
                                    className="flex items-center gap-2 px-4 py-2.5 text-[9px] font-black tracking-[0.15em] text-red-600 dark:text-red-400 hover:bg-red-600/10 border border-red-500/20 rounded-xl transition-all shadow-sm"
                                >
                                    <Trash2 size={12} />
                                    Purge
                                </button>
                            </div>
                        </div>
                        <div className="overflow-x-auto max-h-[500px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-border">
                            <table className="w-full text-sm relative">
                                <thead className="text-text-muted text-left sticky top-0 bg-card z-10">
                                    <tr className="border-b border-border">
                                        {[
                                            { key: 'timestamp', label: 'Timeline' },
                                            { key: 'event', label: 'Disposition' },
                                            { key: 'target', label: 'Endpoint' },
                                            { key: 'loss_pct', label: 'Loss / MOS' },
                                            { key: 'avg_rtt_ms', label: 'RTT / Jitter' }
                                        ].map(col => (
                                            <th
                                                key={col.key}
                                                onClick={() => handleSort(col.key)}
                                                className={`pb-4 px-3 text-[9px] font-black text-text-muted tracking-widest cursor-pointer hover:text-blue-500 transition-colors ${col.key === 'avg_rtt_ms' ? 'text-right' : ''}`}
                                            >
                                                <div className={`flex items-center gap-2 ${col.key === 'avg_rtt_ms' ? 'justify-end' : ''}`}>
                                                    {col.label}
                                                    {sortConfig?.key === col.key && (
                                                        <Activity size={10} className={cn("text-blue-500 transform transition-transform", sortConfig.direction === 'desc' ? 'rotate-180' : '')} />
                                                    )}
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="text-text-secondary divide-y divide-border/50">
                                    {sortedHistory.map((call: VoiceCall, idx: number) => (
                                        <tr key={idx} className="hover:bg-card-secondary/30 transition-all group">
                                            <td className="py-4 px-3 text-[10px] font-black font-mono text-text-muted">
                                                {new Date(call.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                            </td>
                                            <td className="py-4 px-3">
                                                <div className="flex items-center gap-3">
                                                    <span title={`Source Port: ${deriveSourcePort(call.call_id)}`} className="text-[10px] font-black text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded bg-blue-600/10 border border-blue-500/10 font-mono italic min-w-[80px] text-center cursor-help">
                                                        #{call.call_id}
                                                    </span>
                                                    {call.event === 'start' && <Phone className="text-blue-500 animate-pulse" size={14} fill="currentColor" />}
                                                    {call.event === 'end' && <div className="flex items-center justify-center w-3.5 h-3.5 rounded-full bg-green-500/20"><CheckSquare className="text-green-500" size={10} /></div>}
                                                    {call.event === 'skipped' && <AlertCircle className="text-orange-500" size={14} />}
                                                </div>
                                            </td>
                                            <td className="py-4 px-3 text-xs font-black text-text-primary tracking-tight">{call.target}</td>
                                            <td className="py-4 px-3">
                                                {call.event === 'end' && call.loss_pct !== undefined ? (
                                                    <div className="flex items-center gap-4">
                                                        <div className="flex items-center gap-2">
                                                            <div className={cn(
                                                                "h-2 w-2 rounded-full",
                                                                call.loss_pct < 1 ? "bg-green-500" :
                                                                    call.loss_pct < 5 ? "bg-orange-500" : "bg-red-500"
                                                            )} />
                                                            <span className={cn(
                                                                "text-[10px] font-black",
                                                                call.loss_pct < 1 ? "text-green-600 dark:text-green-400" :
                                                                    call.loss_pct < 5 ? "text-orange-600 dark:text-orange-400" : "text-red-600 dark:text-red-400"
                                                            )}>
                                                                {call.loss_pct}% loss
                                                            </span>
                                                        </div>
                                                        {call.mos_score !== undefined && (
                                                            <div className="flex items-center">
                                                                <span className={cn(
                                                                    "text-[10px] font-black px-2 py-0.5 rounded-lg border shadow-sm whitespace-nowrap",
                                                                    call.mos_score >= 4.0 ? "bg-green-600/10 text-green-600 dark:text-green-400 border-green-500/20" :
                                                                        call.mos_score >= 3.0 ? "bg-orange-600/10 text-orange-600 dark:text-orange-400 border-orange-500/20" :
                                                                            "bg-red-600/10 text-red-600 dark:text-red-400 border-red-500/20"
                                                                )}>
                                                                    MOS: {call.mos_score}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-text-muted opacity-30">—</span>
                                                )}
                                            </td>
                                            <td className="py-4 px-3 text-right">
                                                {call.event === 'end' && call.avg_rtt_ms !== undefined ? (
                                                    <div className="flex flex-col items-end gap-1">
                                                        <span className={cn(
                                                            "text-[11px] font-black tracking-tighter",
                                                            call.avg_rtt_ms < 100 ? "text-text-primary" :
                                                                call.avg_rtt_ms < 200 ? "text-orange-500" : "text-red-500"
                                                        )}>
                                                            {call.avg_rtt_ms}ms
                                                        </span>
                                                        <span className="text-[9px] text-text-muted font-bold uppercase tracking-widest opacity-50">Jitter: {call.jitter_ms}ms</span>
                                                    </div>
                                                ) : (
                                                    <span className="text-text-muted opacity-30">—</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'config' && (
                <div className="space-y-6">
                    <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                            <div>
                                <h3 className="text-lg font-black text-text-primary tracking-tight flex items-center gap-3">
                                    <div className="p-2 bg-blue-600/10 rounded-lg text-blue-600 dark:text-blue-400">
                                        <Server size={18} />
                                    </div>
                                    Simulation Parameters
                                </h3>
                                <p className="text-text-muted text-[10px] font-bold uppercase tracking-widest mt-1 opacity-70">Configure RTP stream attributes and target endpoints</p>
                            </div>
                            <div className="flex items-center gap-3">
                                <label className="cursor-pointer text-blue-600 dark:text-blue-400 hover:bg-blue-600/10 p-2.5 rounded-xl border border-blue-500/20 transition-all shadow-sm flex items-center gap-2 text-[9px] font-black uppercase tracking-widest">
                                    <Upload size={14} />
                                    Import
                                    <input type="file" className="hidden" accept=".json" onChange={handleImport} />
                                </label>
                                <button
                                    onClick={handleExport}
                                    className="text-blue-600 dark:text-blue-400 hover:bg-blue-600/10 p-2.5 rounded-xl border border-blue-500/20 transition-all shadow-sm flex items-center gap-2 text-[9px] font-black uppercase tracking-widest"
                                >
                                    <Download size={14} />
                                    Export
                                </button>
                                {isDirty && (
                                    <button
                                        onClick={handleResetToCurrent}
                                        className="text-text-muted hover:text-text-primary px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                                    >
                                        Revert Changes
                                    </button>
                                )}
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className={cn(
                                        "px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all shadow-lg",
                                        isDirty
                                            ? "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/20"
                                            : "bg-card-secondary text-text-muted border border-border cursor-not-allowed"
                                    )}
                                >
                                    <Save size={14} /> {saving ? 'Persisting...' : 'Save'}
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            <div className="space-y-6">
                                <div className="bg-card-secondary/30 p-6 rounded-2xl border border-border space-y-6 shadow-inner">
                                    <div className="flex items-center gap-2 mb-2 border-b border-border pb-4">
                                        <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                                        <h4 className="text-[10px] font-black text-text-primary tracking-[0.2em]">Runtime Controls</h4>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-[9px] text-text-muted uppercase font-black tracking-widest flex items-center gap-2">
                                                <Activity size={10} /> Max Concurrency
                                            </label>
                                            <input
                                                type="number"
                                                value={config?.max_simultaneous_calls}
                                                onChange={(e) => {
                                                    setIsDirty(true);
                                                    setConfig(prev => prev ? { ...prev, max_simultaneous_calls: parseInt(e.target.value) } : null);
                                                }}
                                                className="w-full bg-card border border-border text-text-primary rounded-xl p-3 text-sm font-black focus:ring-1 focus:ring-blue-500 outline-none shadow-sm"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-[9px] text-text-muted uppercase font-black tracking-widest flex items-center gap-2">
                                                <Clock size={10} /> Inter-Call Delay (s)
                                            </label>
                                            <input
                                                type="number"
                                                value={config?.sleep_between_calls}
                                                onChange={(e) => {
                                                    setIsDirty(true);
                                                    setConfig(prev => prev ? { ...prev, sleep_between_calls: parseInt(e.target.value) } : null);
                                                }}
                                                className="w-full bg-card border border-border text-text-primary rounded-xl p-3 text-sm font-black focus:ring-1 focus:ring-blue-500 outline-none shadow-sm"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[9px] text-text-muted uppercase font-black tracking-widest flex items-center gap-2">
                                            <Wifi size={10} /> Egress Interface
                                        </label>
                                        <input
                                            type="text"
                                            value={config?.interface}
                                            onChange={(e) => {
                                                setIsDirty(true);
                                                setConfig(prev => prev ? { ...prev, interface: e.target.value } : null);
                                            }}
                                            className="w-full bg-card border border-border text-text-primary rounded-xl p-3 text-sm font-black focus:ring-1 focus:ring-blue-500 outline-none shadow-sm"
                                            placeholder="eth0, bond0, etc."
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="flex items-center justify-between mb-1 px-1">
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-[0.2em] flex items-center gap-2">
                                        <Plus size={12} className="text-blue-500" /> Target Parameter
                                    </label>
                                    <button
                                        onClick={() => setShowGuided(!showGuided)}
                                        className="text-[9px] text-blue-500 hover:text-blue-400 font-black uppercase tracking-widest px-2 py-1 rounded-lg bg-blue-500/5 border border-blue-500/20"
                                    >
                                        {showGuided ? 'Collapse' : 'Expand Editor'}
                                    </button>
                                </div>

                                {showGuided && (
                                    <div className="bg-card-secondary/40 border border-border p-6 rounded-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200 shadow-sm relative overflow-hidden">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <label className="flex items-center gap-2 text-[9px] text-text-muted uppercase font-black tracking-widest">
                                                    <span>Target Host/IP</span>
                                                    {newProbe.host && !isValidIpOrFqdn(newProbe.host) && (
                                                        <span className="text-[9px] text-red-500 font-black px-1.5 py-0.5 rounded border border-red-500/20 bg-red-500/10 tracking-widest">
                                                            Invalid Format
                                                        </span>
                                                    )}
                                                </label>
                                                <input
                                                    type="text"
                                                    placeholder="10.0.0.50"
                                                    value={newProbe.host}
                                                    onChange={e => setNewProbe({ ...newProbe, host: e.target.value })}
                                                    className={cn(
                                                        "w-full bg-card border rounded-xl p-3 text-xs font-bold outline-none shadow-sm transition-all",
                                                        newProbe.host && !isValidIpOrFqdn(newProbe.host)
                                                            ? "border-red-500/50 focus:border-red-500 text-red-400 focus:ring-1 focus:ring-red-500/50"
                                                            : "border-border text-text-primary focus:ring-1 focus:ring-blue-500"
                                                    )}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[9px] text-text-muted uppercase font-black tracking-widest">Network Port</label>
                                                <input
                                                    type="text"
                                                    placeholder="6100"
                                                    value={newProbe.port}
                                                    onChange={e => setNewProbe({ ...newProbe, port: e.target.value })}
                                                    className="w-full bg-card border border-border text-text-primary rounded-xl p-3 text-xs font-bold focus:ring-1 focus:ring-blue-500 outline-none shadow-sm"
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-3 gap-4">
                                            <div className="space-y-2">
                                                <label className="text-[9px] text-text-muted uppercase font-black tracking-widest">Voice Codec</label>
                                                <select
                                                    value={newProbe.codec}
                                                    onChange={e => setNewProbe({ ...newProbe, codec: e.target.value })}
                                                    className="w-full bg-card border border-border text-text-primary rounded-xl p-3 text-xs font-bold focus:ring-1 focus:ring-blue-500 outline-none shadow-sm"
                                                >
                                                    <option value="G.711-ulaw">G.711-ulaw</option>
                                                    <option value="G.711-alaw">G.711-alaw</option>
                                                    <option value="G.729">G.729</option>
                                                    <option value="OPUS">OPUS</option>
                                                </select>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[9px] text-text-muted uppercase font-black tracking-widest">Weight (%)</label>
                                                <input
                                                    type="number"
                                                    value={newProbe.weight}
                                                    onChange={e => setNewProbe({ ...newProbe, weight: e.target.value })}
                                                    className="w-full bg-card border border-border text-text-primary rounded-xl p-3 text-xs font-bold focus:ring-1 focus:ring-blue-500 outline-none shadow-sm"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[9px] text-text-muted uppercase font-black tracking-widest">Length (s)</label>
                                                <input
                                                    type="number"
                                                    value={newProbe.duration}
                                                    onChange={e => setNewProbe({ ...newProbe, duration: e.target.value })}
                                                    className="w-full bg-card border border-border text-text-primary rounded-xl p-3 text-xs font-bold focus:ring-1 focus:ring-blue-500 outline-none shadow-sm"
                                                />
                                            </div>
                                        </div>

                                        <button
                                            onClick={addProbeFromForm}
                                            disabled={!newProbe.host || !newProbe.port || !isValidIpOrFqdn(newProbe.host)}
                                            className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-xl shadow-blue-900/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <Plus size={16} /> Add Voice Target
                                        </button>
                                    </div>
                                )}

                                <div className="space-y-4">
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between px-1">
                                            <label className="text-[10px] font-black text-text-muted uppercase tracking-[0.2em]">Active Distribution ({parsedProbes.length})</label>
                                        </div>
                                        <div className="space-y-2 max-h-[180px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-border">
                                            {parsedProbes.map((p, i) => (
                                                <div key={i} className="flex items-center justify-between bg-card-secondary/30 border border-border px-4 py-2.5 rounded-xl group shadow-sm hover:border-blue-500/20 transition-all">
                                                    <div className="flex items-center gap-4">
                                                        <div className="text-[11px] font-black font-mono text-text-primary">{p.target}</div>
                                                        <div className="text-[9px] font-black text-blue-600 dark:text-blue-400 bg-blue-600/10 border border-blue-500/10 px-1.5 py-0.5 rounded shadow-sm">{p.codec}</div>
                                                        <div className="text-[9px] font-bold text-text-muted uppercase tracking-tighter italic">Weight: {p.weight}%</div>
                                                        <div className="text-[9px] font-bold text-text-muted uppercase tracking-tighter italic">Time: {p.duration}</div>
                                                    </div>
                                                    <button
                                                        onClick={() => removeProbeAt(p.id)}
                                                        className="p-1.5 text-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                                        title="Delete entry"
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                            ))}
                                            {parsedProbes.length === 0 && (
                                                <div className="text-center py-10 text-[10px] font-black text-text-muted uppercase tracking-[0.2em] border border-dashed border-border rounded-xl opacity-50">
                                                    Manifest Empty
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
