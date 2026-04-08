import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Area, AreaChart, ComposedChart, Bar } from 'recharts';
import {
    Activity, Gauge, Play, Pause, AlertCircle, Clock, Zap, Target, Network,
    Shield, Cpu, ChevronRight, BarChart3, Info, CheckCircle2, XCircle,
    Search, Filter, Download, Trash2, ChevronDown, ChevronUp, Share2,
    ShieldAlert, ExternalLink, ArrowUpRight, ShieldOff, Copy, RefreshCw,
    History as HistoryIcon, X
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { isValidIpOrFqdn } from './utils/validation';

/**
 * Utility for Tailwind class merging
 */
function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface Props {
    token: string;
}

interface XfrInterval {
    timestamp: string;
    sent_mbps: number;
    received_mbps: number;
    loss_percent: number;
    rtt_ms: number;
    retransmits?: number;
    lost?: number;
    jitter_ms?: number;
    cwnd?: number;
}

interface XfrSummary {
    protocol: string;
    duration_sec: number;
    sent_mbps: number;
    received_mbps: number;
    loss_percent: number;
    rtt_ms_avg: number;
    rtt_ms_min: number;
    rtt_ms_max: number;
    jitter_ms_avg: number;
    retransmits?: number;
    lost?: number;
    cwnd?: number;
    bytes_total?: number;
}

interface XfrJob {
    id: string;
    sequence_id: string;
    status: 'queued' | 'running' | 'completed' | 'failed';
    params: any;
    started_at: string | null;
    finished_at: string | null;
    summary: XfrSummary | null;
    intervals: XfrInterval[];
    error: string | null;
}

export default function Speedtest({ token }: Props) {
    const [mode, setMode] = useState<'default' | 'custom'>('default');
    const [targetHost, setTargetHost] = useState('');
    const [targetPort, setTargetPort] = useState(9000);
    const [psk, setPsk] = useState('');

    // Custom params
    const [protocol, setProtocol] = useState<'tcp' | 'udp' | 'quic'>('tcp');
    const [direction, setDirection] = useState<'client-to-server' | 'server-to-client' | 'bidirectional'>('client-to-server');
    const [duration, setDuration] = useState(10);
    const [bitrate, setBitrate] = useState('200M');
    const [streams, setStreams] = useState(4);

    const [activeJob, setActiveJob] = useState<XfrJob | null>(null);
    const [history, setHistory] = useState<XfrJob[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [chartData, setChartData] = useState<any[]>([]);
    const [showDetailModal, setShowDetailModal] = useState(false);
    const [selectedJob, setSelectedJob] = useState<XfrJob | null>(null);
    const [isHistoryExpanded, setIsHistoryExpanded] = useState(true);
    
    // Custom Config Advanced Inputs
    const [dscp, setDscp] = useState('');
    const [congestion, setCongestion] = useState('cubic');
    const [cport, setCport] = useState<number>(30000);
    const sseRef = useRef<EventSource | null>(null);

    const authHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    const [quickTargets, setQuickTargets] = useState<{ label: string, host: string }[]>([]);
    const [sharedTargets, setSharedTargets] = useState<{ id: string; name: string; host: string; capabilities: any }[]>([]);

    useEffect(() => {
        fetchHistory();
        fetchFeatures();
        fetchSharedTargets();
        const interval = setInterval(fetchHistory, 5000);
        return () => {
            if (sseRef.current) sseRef.current.close();
            clearInterval(interval);
        };
    }, []);

    const fetchFeatures = async () => {
        try {
            const res = await fetch('/api/features', { headers: authHeaders });
            const data = await res.json();
            if (res.ok && data.xfr_targets) {
                setQuickTargets(data.xfr_targets);
            }
        } catch (e) { }
    };

    const fetchSharedTargets = async () => {
        try {
            const res = await fetch('/api/targets', { headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                setSharedTargets((Array.isArray(data) ? data : []).filter((t: any) => t.enabled && t.capabilities?.xfr));
            }
        } catch (e) { }
    };

    const fetchHistory = async () => {
        try {
            const res = await fetch('/api/tests/xfr', { headers: authHeaders });
            const data = await res.json();
            if (res.ok) {
                setHistory(data);
                if (data.length > 0) {
                    const match = data[0].sequence_id.match(/\d+/);
                    if (match) setCport(30000 + parseInt(match[0], 10) + 1);
                } else {
                    setCport(30001);
                }
            }
        } catch (e) { }
    };

    const isValidDscp = (val: string) => {
        if (!val) return true;
        const upper = val.toUpperCase();
        const validNames = ['EF', 'AF11', 'AF12', 'AF13', 'AF21', 'AF22', 'AF23', 'AF31', 'AF32', 'AF33', 'AF41', 'AF42', 'AF43', 'CS0', 'CS1', 'CS2', 'CS3', 'CS4', 'CS5', 'CS6', 'CS7'];
        if (validNames.includes(upper)) return true;
        const num = parseInt(val, 10);
        return !isNaN(num) && num >= 0 && num <= 255 && num.toString() === val;
    };

    const runTest = async () => {
        if (!targetHost) {
            toast.error('Host is required');
            return;
        }

        const body = mode === 'default' ? {
            mode: 'default',
            target: { host: targetHost, port: targetPort }
        } : {
            mode: 'custom',
            target: { host: targetHost, port: targetPort, psk },
            protocol,
            direction,
            duration_sec: duration,
            bitrate,
            parallel_streams: streams,
            dscp,
            congestion,
            cport
        };

        try {
            console.log(`[XFR] Starting test to ${targetHost}:${targetPort}...`);
            const res = await fetch('/api/tests/xfr', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({ error: `HTTP ${res.status} ${res.statusText}` }));
                console.error('[XFR] Server error:', data);
                toast.error(data.error || 'Failed to start test');
                return;
            }

            const data = await res.json();
            console.log('[XFR] Test accepted:', data);
            toast.success(`Test started: ${data.id}`);
            pollJob(data.id);
            subscribeToStream(data.id);
            fetchHistory();
        } catch (e: any) {
            console.error('[XFR] Request failed:', e);
            toast.error(`Network error: ${e.message || 'Check connection'}`);
        }
    };

    const pollJob = async (id: string) => {
        try {
            const res = await fetch(`/api/tests/xfr/${id}`, { headers: authHeaders });
            const data = await res.json();
            if (res.ok) {
                setActiveJob(data);
                if (data.status === 'running' || data.status === 'queued') {
                    setTimeout(() => pollJob(id), 2000);
                } else {
                    fetchHistory();
                }
            }
        } catch (e) { }
    };

    const subscribeToStream = (id: string) => {
        if (sseRef.current) sseRef.current.close();
        setChartData([]);

        const sse = new EventSource(`/api/tests/xfr/${id}/stream?token=${token}`);
        sseRef.current = sse;

        sse.addEventListener('interval', (e: any) => {
            const data = JSON.parse(e.data);
            setChartData(prev => {
                const next = [...prev, { ...data, time: prev.length }];
                return next.slice(-60);
            });
        });

        sse.addEventListener('done', (e: any) => {
            const data = JSON.parse(e.data);
            toast.success(`Test ${data.status}`);
            sse.close();
            fetchHistory();
        });

        sse.onerror = () => {
            sse.close();
        };
    };

    const viewJobDetails = (job: XfrJob) => {
        setSelectedJob(job);
        setShowDetailModal(true);
    };

    const filteredHistory = history.filter(j =>
        j.sequence_id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        j.params?.host?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        j.status?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const isRunning = activeJob?.status === 'running' || activeJob?.status === 'queued';

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row gap-6">
                {/* Configuration Side */}
                <div className="w-full md:w-96 space-y-6">
                    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm overflow-hidden relative">
                        <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                            <Gauge size={120} />
                        </div>

                        <h2 className="text-xl font-black text-text-primary flex items-center gap-2 mb-6 tracking-tight">
                            <Zap className="text-blue-500" size={24} />
                            Bandwidth Test
                        </h2>

                        <div className="flex p-1 bg-card-secondary rounded-xl mb-6 border border-border/50">
                            <button
                                onClick={() => setMode('default')}
                                className={cn(
                                    "flex-1 py-1.5 text-[10px] font-black tracking-widest rounded-lg transition-all",
                                    mode === 'default' ? 'bg-blue-600 text-white shadow-lg' : 'text-text-muted hover:text-text-primary'
                                )}
                            >
                                Default
                            </button>
                            <button
                                onClick={() => setMode('custom')}
                                className={cn(
                                    "flex-1 py-1.5 text-[10px] font-black tracking-widest rounded-lg transition-all",
                                    mode === 'custom' ? 'bg-blue-600 text-white shadow-lg' : 'text-text-muted hover:text-text-primary'
                                )}
                            >
                                Custom
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="text-[10px] font-black text-text-muted tracking-widest mb-1.5 block">Target Host</label>
                                <div className="relative group">
                                    <Target className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted/50" size={16} />
                                    <input
                                        type="text"
                                        value={targetHost}
                                        onChange={e => setTargetHost(e.target.value)}
                                        placeholder="e.g. 1.2.3.4"
                                        className="w-full bg-card-secondary border border-border rounded-xl pl-10 pr-4 py-3 text-sm focus:border-blue-500 outline-none transition-all"
                                    />
                                </div>
                                {/* Quick Targets — env-var entries + shared targets with xfr capability */}
                                {(quickTargets.length > 0 || sharedTargets.length > 0) && (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {/* Legacy XFR_QUICK_TARGETS env-var pills */}
                                        {quickTargets.map((t, i) => (
                                            <button
                                                key={`env-${i}`}
                                                onClick={() => setTargetHost(t.host)}
                                                className={cn(
                                                    "px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all duration-200 flex items-center gap-2",
                                                    targetHost === t.host
                                                        ? "bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-600/20 scale-[1.02]"
                                                        : "bg-blue-600/5 text-blue-500 border-blue-500/10 hover:bg-blue-600/10 hover:border-blue-500/30"
                                                )}
                                            >
                                                <div className={cn("w-1 h-1 rounded-full", targetHost === t.host ? "bg-white" : "bg-blue-500")}></div>
                                                {t.label}
                                            </button>
                                        ))}
                                        {/* Shared Targets (registry) with xfr capability */}
                                        {sharedTargets
                                            .filter(st => !quickTargets.some(qt => qt.host === st.host))
                                            .map((t) => (
                                                <button
                                                    key={`tgt-${t.id}`}
                                                    onClick={() => setTargetHost(t.host)}
                                                    className={cn(
                                                        "px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all duration-200 flex items-center gap-2",
                                                        targetHost === t.host
                                                            ? "bg-emerald-600 text-white border-emerald-600 shadow-lg shadow-emerald-600/20 scale-[1.02]"
                                                            : "bg-emerald-600/5 text-emerald-500 border-emerald-500/10 hover:bg-emerald-600/10 hover:border-emerald-500/30"
                                                    )}
                                                >
                                                    <div className={cn("w-1 h-1 rounded-full", targetHost === t.host ? "bg-white" : "bg-emerald-500")}></div>
                                                    {t.name}
                                                </button>
                                            ))
                                        }
                                    </div>
                                )}
                            </div>

                            <div>
                                <label className="text-[10px] font-black text-text-muted tracking-widest mb-1.5 block">Port</label>
                                <input
                                    type="number"
                                    value={targetPort}
                                    onChange={e => setTargetPort(parseInt(e.target.value))}
                                    className="w-full bg-card-secondary border border-border rounded-xl px-4 py-3 text-sm focus:border-blue-500 outline-none transition-all"
                                />
                            </div>

                            {mode === 'custom' && (
                                <div className="space-y-4 pt-2 border-t border-border/50 animate-in fade-in duration-300">
                                    <div>
                                        <label className="text-[10px] font-black text-text-muted tracking-widest mb-1.5 block">Protocol</label>
                                        <select
                                            value={protocol}
                                            onChange={e => setProtocol(e.target.value as any)}
                                            className="w-full bg-card-secondary border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-500"
                                        >
                                            <option value="tcp">TCP</option>
                                            <option value="udp">UDP</option>
                                            <option value="quic">QUIC</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-[10px] font-black text-text-muted tracking-widest mb-1.5 block">Direction</label>
                                        <select
                                            value={direction}
                                            onChange={e => setDirection(e.target.value as any)}
                                            className="w-full bg-card-secondary border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-500"
                                        >
                                            <option value="client-to-server">Upload (Client to Server)</option>
                                            <option value="server-to-client">Download (Reverse)</option>
                                            <option value="bidirectional">Bidirectional</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-[10px] font-black text-text-muted tracking-widest mb-1.5 block">Bitrate (e.g. 100M, 0=Max)</label>
                                        <input
                                            type="text"
                                            value={bitrate}
                                            onChange={e => setBitrate(e.target.value)}
                                            placeholder="e.g. 100M, Max, 0"
                                            className="w-full bg-card-secondary border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-500"
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-[10px] font-black text-text-muted tracking-widest mb-1.5 block">Duration (s)</label>
                                            <input
                                                type="number"
                                                value={duration}
                                                onChange={e => setDuration(parseInt(e.target.value))}
                                                className="w-full bg-card-secondary border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-500"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-black text-text-muted tracking-widest mb-1.5 block">Streams</label>
                                            <input
                                                type="number"
                                                value={streams}
                                                onChange={e => setStreams(parseInt(e.target.value))}
                                                className="w-full bg-card-secondary border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-500"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-[10px] font-black text-text-muted tracking-widest mb-1.5 block">DSCP / TOS (ex: EF, 00)</label>
                                            <input
                                                type="text"
                                                list="dscp-options"
                                                value={dscp}
                                                onChange={e => setDscp(e.target.value)}
                                                placeholder="Default (Blank)"
                                                className={`w-full bg-card-secondary border rounded-xl px-4 py-3 text-sm outline-none transition-colors ${dscp && !isValidDscp(dscp) ? 'border-red-500/50 focus:border-red-500' : 'border-border focus:border-blue-500'}`}
                                            />
                                            <datalist id="dscp-options">
                                                <option value="EF" />
                                                <option value="AF11" />
                                                <option value="AF21" />
                                                <option value="CS1" />
                                                <option value="CS6" />
                                                <option value="46" />
                                            </datalist>
                                            {dscp && !isValidDscp(dscp) && (
                                                <span className="text-[9px] text-red-500 font-bold block mt-1">Invalid DSCP Marking</span>
                                            )}
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-black text-text-muted tracking-widest mb-1.5 block">Client Flow Port (Auto)</label>
                                            <input
                                                type="number"
                                                value={cport}
                                                onChange={e => setCport(parseInt(e.target.value))}
                                                className="w-full bg-card-secondary border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-500"
                                            />
                                        </div>
                                    </div>

                                    {protocol === 'tcp' && (
                                        <div>
                                            <label className="text-[10px] font-black text-text-muted tracking-widest mb-1.5 block">TCP Congestion Avoidance</label>
                                            <select
                                                value={congestion}
                                                onChange={e => setCongestion(e.target.value)}
                                                className="w-full bg-card-secondary border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-500"
                                            >
                                                <option value="cubic">Cubic (Default)</option>
                                                <option value="reno">Reno</option>
                                            </select>
                                        </div>
                                    )}

                                    <div>
                                        <label className="text-[10px] font-black text-text-muted tracking-widest mb-1.5 block">Psk (Optional)</label>
                                        <input
                                            type="password"
                                            value={psk}
                                            onChange={e => setPsk(e.target.value)}
                                            className="w-full bg-card-secondary border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-500"
                                        />
                                    </div>
                                </div>
                            )}

                            <button
                                onClick={runTest}
                                disabled={isRunning || !targetHost || !isValidIpOrFqdn(targetHost) || !isValidDscp(dscp)}
                                className={cn(
                                    "w-full py-4 rounded-xl font-black tracking-widest text-xs flex items-center justify-center gap-2 transition-all shadow-xl",
                                    isRunning || !targetHost || !isValidDscp(dscp) ? "bg-card-secondary text-text-muted cursor-not-allowed" :
                                        !isValidIpOrFqdn(targetHost) ? "bg-red-500/10 text-red-500 border border-red-500/20 cursor-not-allowed" :
                                            "bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:opacity-90 active:scale-[0.98]"
                                )}
                            >
                                {isRunning ? (
                                    <>
                                        <RefreshCw size={20} className="animate-spin" />
                                        Running Test...
                                    </>
                                ) : !targetHost ? (
                                    <>
                                        <Play size={20} fill="currentColor" />
                                        Launch Speedtest
                                    </>
                                ) : !isValidIpOrFqdn(targetHost) ? (
                                    <>
                                        <AlertCircle size={20} />
                                        Invalid Target IP/FQDN
                                    </>
                                ) : (
                                    <>
                                        <Play size={20} fill="currentColor" />
                                        Launch Speedtest
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Info Card */}
                    <div className="p-4 bg-blue-600/5 border border-blue-500/10 rounded-2xl flex gap-3">
                        <Info className="text-blue-500 shrink-0 mt-0.5" size={18} />
                        <div>
                            <h4 className="text-[10px] font-black text-blue-500 tracking-widest mb-1">Testing Note</h4>
                            <p className="text-[10px] text-text-muted leading-relaxed font-bold opacity-60">
                                This tool sends bidirectional traffic to validate path throughput and latency.
                                Ensure the target host has `xfr` running in server mode.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Main Results & Chart */}
                <div className="flex-1 space-y-6">
                    {/* Live Results Panel */}
                    <div className="bg-card border border-border rounded-2xl p-6 shadow-xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none rotate-12">
                            <Zap size={200} className="text-blue-500" />
                        </div>

                        <div className="flex items-center justify-between mb-8 relative z-10">
                            <div>
                                <h2 className="text-2xl font-black text-text-primary tracking-tight">
                                    {isRunning ? 'Live Performance' : 'Session Ready'}
                                </h2>
                                <p className="text-[10px] font-black text-text-muted tracking-[0.2em] opacity-60">
                                    {isRunning ? `Analyzing sequence ${activeJob?.sequence_id}` : 'Select target and launch test'}
                                </p>
                            </div>
                            {isRunning && (
                                <div className="px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full animate-pulse text-[10px] font-black text-blue-500">
                                    Live Stream
                                </div>
                            )}
                        </div>

                        {/* Summary Cards */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8 relative z-10">
                            <div className="bg-card-secondary/50 border border-border/50 rounded-2xl p-5 group hover:border-blue-500/30 transition-all">
                                <label className="text-[10px] font-black text-text-muted tracking-widest opacity-60 flex items-center gap-2 mb-2">
                                    <ArrowUpRight size={14} className="text-blue-500" /> Throughput
                                </label>
                                <div className="flex items-baseline gap-2">
                                    <span className="text-3xl font-black text-text-primary tracking-tighter">
                                        {activeJob?.summary ? Math.round(activeJob.summary.received_mbps) :
                                            (chartData.length > 0 ? Math.round(chartData[chartData.length - 1].received_mbps || chartData[chartData.length - 1].sent_mbps) : '0')}
                                    </span>
                                    <span className="text-[10px] font-black text-text-muted italic opacity-40">Mbps</span>
                                </div>
                            </div>

                            <div className="bg-card-secondary/50 border border-border/50 rounded-2xl p-5 group hover:border-cyan-500/30 transition-all">
                                <label className="text-[10px] font-black text-text-muted tracking-widest opacity-60 flex items-center gap-2 mb-2">
                                    <Clock size={14} className="text-cyan-500" /> Latency (Rtt)
                                </label>
                                <div className="flex items-baseline gap-2">
                                    <span className="text-3xl font-black text-text-primary tracking-tighter">
                                        {activeJob?.summary ? activeJob.summary.rtt_ms_avg.toFixed(1) :
                                            (chartData.length > 0 ? chartData[chartData.length - 1].rtt_ms?.toFixed(1) : '0.0')}
                                    </span>
                                    <span className="text-[10px] font-black text-text-muted italic opacity-40">ms</span>
                                </div>
                            </div>

                            <div className="bg-card-secondary/50 border border-border/50 rounded-2xl p-5 group hover:border-red-500/30 transition-all">
                                <label className="text-[10px] font-black text-text-muted tracking-widest opacity-60 flex items-center gap-2 mb-2">
                                    <ShieldOff size={14} className="text-red-500" /> Packet Loss
                                </label>
                                <div className="flex items-baseline gap-2">
                                    <span className="text-3xl font-black text-text-primary tracking-tighter text-red-500">
                                        {activeJob?.summary ? activeJob.summary.loss_percent.toFixed(1) :
                                            (activeJob?.params.protocol === 'udp' ? 'N/A' : (chartData.length > 0 ? chartData[chartData.length - 1].loss_percent?.toFixed(1) : '0.0'))}
                                    </span>
                                    <span className="text-[10px] font-black text-text-muted italic opacity-40">%</span>
                                </div>
                            </div>

                            <div className="bg-card-secondary/50 border border-border/50 rounded-2xl p-5 group hover:border-orange-500/30 transition-all">
                                <label className="text-[10px] font-black text-text-muted tracking-widest opacity-60 flex items-center gap-2 mb-2">
                                    <Target size={14} className="text-orange-500" /> {activeJob?.params.protocol === 'udp' ? 'Packets Lost' : 'Retransmits'}
                                </label>
                                <div className="flex items-baseline gap-2">
                                    <span className="text-3xl font-black text-text-primary tracking-tighter text-orange-500">
                                        {activeJob?.summary ?
                                            (activeJob.params.protocol === 'udp' ? activeJob.summary.lost || 0 : activeJob.summary.retransmits || 0) :
                                            (chartData.length > 0 ?
                                                (activeJob?.params.protocol === 'udp' ? chartData[chartData.length - 1].lost || 0 : chartData[chartData.length - 1].retransmits || 0) : '0')}
                                    </span>
                                    <span className="text-[10px] font-black text-text-muted italic opacity-40">Pkts</span>
                                </div>
                            </div>
                        </div>

                        {/* Chart Area */}
                        <div className="h-64 mt-4 relative z-10">
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={chartData}>
                                    <defs>
                                        <linearGradient id="colorMain" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128,128,128,0.1)" />
                                    <XAxis
                                        dataKey="time"
                                        axisLine={false}
                                        tickLine={false}
                                        fontSize={10}
                                        tick={{ fill: 'currentColor' }}
                                        className="text-text-muted opacity-60"
                                    />
                                    <YAxis
                                        yAxisId="left"
                                        axisLine={false}
                                        tickLine={false}
                                        fontSize={10}
                                        tick={{ fill: 'currentColor' }}
                                        className="text-text-muted opacity-60"
                                        label={{ value: 'Bandwidth (Mbps)', angle: -90, position: 'insideLeft', fill: 'currentColor', style: { textAnchor: 'middle', opacity: 0.5, fontSize: 9, fontWeight: 'bold', letterSpacing: '0.1em' } }}
                                    />
                                    <YAxis
                                        yAxisId="right"
                                        orientation="right"
                                        axisLine={false}
                                        tickLine={false}
                                        fontSize={10}
                                        tick={{ fill: 'currentColor' }}
                                        className="text-text-muted opacity-60"
                                        label={{ value: activeJob?.params.protocol === 'udp' ? 'Loss (Pkts)' : 'RTT (ms) / Rxmt', angle: 90, position: 'insideRight', fill: 'currentColor', style: { textAnchor: 'middle', opacity: 0.5, fontSize: 9, fontWeight: 'bold', letterSpacing: '0.1em' } }}
                                    />
                                    <Tooltip
                                        content={({ active, payload, label }) => {
                                            if (active && payload && payload.length) {
                                                return (
                                                    <div className="bg-card border border-border p-3 rounded-xl shadow-lg text-[10px]">
                                                        <p className="text-text-muted font-bold tracking-widest opacity-60 mb-2">{label}s</p>
                                                        {payload.map((entry: any, index: number) => (
                                                            <div key={index} className="flex items-center justify-between gap-6 mb-1">
                                                                <span style={{ color: entry.color }} className="font-bold">{entry.name}</span>
                                                                <span className="font-black text-text-primary">
                                                                    {entry.name.includes('Mbps') ? Number(entry.value).toFixed(2) : (entry.name.includes('RTT') ? Number(entry.value).toFixed(1) + ' ms' : entry.value)}
                                                                </span>
                                                            </div>
                                                        ))}
                                                        {activeJob?.params.protocol === 'tcp' && payload[0].payload.cwnd !== undefined && (
                                                            <div className="flex items-center justify-between gap-6 mt-2 pt-2 border-t border-border/50">
                                                                <span className="font-bold text-[#8b5cf6]">TCP Window</span>
                                                                <span className="font-black text-text-primary">{(payload[0].payload.cwnd / 1024).toFixed(0)} KB</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }}
                                    />
                                    <Area yAxisId="left" type="monotone" dataKey="received_mbps" name="Received Mbps" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorMain)" />
                                    <Area yAxisId="left" type="monotone" dataKey="sent_mbps" name="Sent Mbps" stroke="#10b981" strokeWidth={3} fill="transparent" />
                                    {activeJob?.params.protocol === 'tcp' && (
                                        <Line yAxisId="right" type="monotone" dataKey="rtt_ms" name="RTT" stroke="#8b5cf6" strokeWidth={2} dot={false} strokeDasharray="3 3" />
                                    )}
                                    <Bar yAxisId="right" dataKey={activeJob?.params.protocol === 'udp' ? 'lost' : 'retransmits'} name={activeJob?.params.protocol === 'udp' ? 'Packets Lost' : 'Retransmits'} fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={20} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* History Table Widget */}
                    <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
                        <div className="px-6 py-4 flex items-center justify-between bg-card-secondary transition-colors border-b border-border">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-500/10 rounded-lg text-blue-500 border border-blue-500/20">
                                    <HistoryIcon size={18} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-black text-text-primary tracking-tight">Bandwidth Test History</h3>
                                    <p className="text-[10px] text-text-muted font-bold tracking-widest opacity-60">Past Telemetry Log</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
                                className="p-2 hover:bg-card rounded-lg transition-colors border border-transparent hover:border-border text-text-muted"
                            >
                                {isHistoryExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                            </button>
                        </div>

                        {isHistoryExpanded && (
                            <div className="p-6 space-y-6">
                                <div className="relative group">
                                    <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted group-focus-within:text-blue-500 transition-colors" />
                                    <input
                                        type="text"
                                        placeholder="Filter results by Job ID, Target Host, or Status..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full pl-12 pr-4 py-3 bg-card-secondary border border-border text-text-primary rounded-xl text-xs font-bold outline-none focus:ring-1 focus:ring-blue-500 shadow-inner transition-all tracking-widest placeholder:opacity-50"
                                    />
                                </div>

                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead>
                                            <tr className="border-b border-border">
                                                <th className="px-4 py-4 text-[9px] font-black text-text-muted tracking-[0.2em]">Sequence Id</th>
                                                <th className="px-4 py-4 text-[9px] font-black text-text-muted tracking-[0.2em]">Target / Params</th>
                                                <th className="px-4 py-4 text-[9px] font-black text-text-muted tracking-[0.2em] text-center">Disposition</th>
                                                <th className="px-4 py-4 text-[9px] font-black text-text-muted tracking-[0.2em] text-right">Throughput</th>
                                                <th className="px-4 py-4 text-[9px] font-black text-text-muted tracking-[0.2em] text-right">Test Details</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/50">
                                            {filteredHistory.map((job) => (
                                                <tr key={job.id} className="group hover:bg-card-secondary/30 transition-all">
                                                    <td className="px-4 py-4">
                                                        <div className="text-xs font-black text-text-primary">{job.sequence_id}</div>
                                                        <div className="text-[9px] text-text-muted font-bold opacity-60">
                                                            {job.started_at ? new Date(job.started_at).toLocaleString() : 'N/A'}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-4">
                                                        <div className="text-xs font-black text-text-primary">{job.params.host}:{job.params.port}</div>
                                                        <div className="text-[9px] text-text-muted font-bold opacity-60">
                                                            {job.params.protocol.toUpperCase()} • {job.params.direction.replace(/-/g, ' ')}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-4 text-center">
                                                        <span className={cn(
                                                            "px-2 py-1 rounded-lg text-[9px] font-black tracking-widest border",
                                                            job.status === 'completed' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                                                job.status === 'failed' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                                                                    'bg-blue-500/10 text-blue-500 border-blue-500/20'
                                                        )}>
                                                            {job.status}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-4 text-right">
                                                        {job.summary ? (
                                                            <div className="flex flex-col items-end">
                                                                <div className="text-xs font-black text-text-primary">{Math.round(job.summary.received_mbps)} Mbps</div>
                                                                <div className="text-[9px] text-red-500 font-bold tracking-tighter">{job.summary.loss_percent.toFixed(1)}% Loss</div>
                                                            </div>
                                                        ) : (
                                                            <span className="text-xs font-bold text-text-muted italic">No results</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-4 text-right">
                                                        <button
                                                            onClick={() => viewJobDetails(job)}
                                                            className="p-2 border border-border bg-card-secondary rounded-lg hover:bg-card transition-all text-blue-500 hover:shadow-lg group"
                                                        >
                                                            <ExternalLink size={16} className="group-hover:scale-110 transition-transform" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {filteredHistory.length === 0 && (
                                                <tr>
                                                    <td colSpan={5} className="px-4 py-12 text-center text-text-muted italic text-[10px] font-bold tracking-widest opacity-40">
                                                        No telemetry matches found
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Results Detail Modal */}
            {
                showDetailModal && selectedJob && (
                    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
                        <div className="bg-card border border-border rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden relative">
                            <div className="absolute top-0 right-0 p-6 z-10">
                                <button
                                    onClick={() => setShowDetailModal(false)}
                                    className="p-2 hover:bg-card-secondary rounded-xl transition-all border border-transparent hover:border-border text-text-muted"
                                >
                                    <X size={24} />
                                </button>
                            </div>

                            <div className="p-8 border-b border-border bg-card-secondary/50">
                                <div className="flex items-center gap-4 mb-4">
                                    <div className="p-3 bg-blue-600 rounded-2xl shadow-xl shadow-blue-900/30">
                                        <BarChart3 className="text-white" size={24} />
                                    </div>
                                    <div>
                                        <h3 className="text-2xl font-black text-text-primary tracking-tight">Test Details</h3>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-black text-text-muted bg-card px-2 py-0.5 rounded border border-border">{selectedJob.sequence_id}</span>
                                            <span className="text-[10px] font-black text-text-muted tracking-widest opacity-60">
                                                {selectedJob.started_at ? new Date(selectedJob.started_at).toLocaleString() : 'N/A'}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                    <div className="bg-card border border-border rounded-2xl p-4">
                                        <label className="text-[9px] font-black text-text-muted tracking-widest mb-2 block opacity-60 tracking-[0.2em]">Avg Rtt</label>
                                        <div className="text-xl font-black text-cyan-500">{selectedJob.summary?.rtt_ms_avg.toFixed(1) || '0.0'} ms</div>
                                    </div>
                                    <div className="bg-card border border-border rounded-2xl p-4">
                                        <label className="text-[9px] font-black text-text-muted tracking-widest mb-2 block opacity-60 tracking-[0.2em]">Jitter</label>
                                        <div className="text-xl font-black text-purple-500">{selectedJob.summary?.jitter_ms_avg.toFixed(2) || '0.00'} ms</div>
                                    </div>
                                    <div className="bg-card border border-border rounded-2xl p-4">
                                        <label className="text-[9px] font-black text-text-muted tracking-widest mb-2 block opacity-60 tracking-[0.2em]">Min Latency</label>
                                        <div className="text-xl font-black text-text-primary">{selectedJob.summary?.rtt_ms_min.toFixed(1) || '0.0'} ms</div>
                                    </div>
                                    <div className="bg-card border border-border rounded-2xl p-4">
                                        <label className="text-[9px] font-black text-text-muted tracking-widest mb-2 block opacity-60 tracking-[0.2em]">Max Latency</label>
                                        <div className="text-xl font-black text-text-secondary">{selectedJob.summary?.rtt_ms_max.toFixed(1) || '0.0'} ms</div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
                                    <div className="bg-card border border-border rounded-2xl p-4">
                                        <label className="text-[9px] font-black text-text-muted tracking-widest mb-2 block opacity-60 tracking-[0.2em]">DSCP</label>
                                        <div className="text-lg font-bold text-text-primary flex items-center gap-2">{selectedJob.params.dscp || 'Default'}</div>
                                    </div>
                                    {selectedJob.params.protocol === 'tcp' && (
                                        <div className="bg-card border border-border rounded-2xl p-4">
                                            <label className="text-[9px] font-black text-text-muted tracking-widest mb-2 block opacity-60 tracking-[0.2em]">Congestion</label>
                                            <div className="text-lg font-bold text-text-primary capitalize">{selectedJob.params.congestion || 'Cubic'}</div>
                                        </div>
                                    )}
                                    <div className="bg-card border border-border rounded-2xl p-4">
                                        <label className="text-[9px] font-black text-text-muted tracking-widest mb-2 block opacity-60 tracking-[0.2em]">Source Port</label>
                                        <div className="text-lg font-bold text-text-primary">{selectedJob.params.cport || 'Auto'}</div>
                                    </div>
                                </div>

                                {(() => {
                                    const isUpload = selectedJob.params.direction === 'client-to-server';
                                    const isDownload = selectedJob.params.direction === 'server-to-client';
                                    const isBidir = selectedJob.params.direction === 'bidirectional';

                                    let txBytes = 0;
                                    let rxBytes = 0;

                                    if (selectedJob.summary?.bytes_total) {
                                        if (isUpload) txBytes = selectedJob.summary.bytes_total;
                                        if (isDownload) rxBytes = selectedJob.summary.bytes_total;
                                        if (isBidir) {
                                            const totalMbps = (selectedJob.summary.sent_mbps || 0) + (selectedJob.summary.received_mbps || 0);
                                            if (totalMbps > 0) {
                                                txBytes = ((selectedJob.summary.sent_mbps || 0) / totalMbps) * selectedJob.summary.bytes_total;
                                                rxBytes = ((selectedJob.summary.received_mbps || 0) / totalMbps) * selectedJob.summary.bytes_total;
                                            }
                                        }
                                    } else if (selectedJob.intervals) {
                                        txBytes = selectedJob.intervals.reduce((acc: number, i: any) => acc + (i.sent_mbps * 1024 * 1024 / 8), 0);
                                        rxBytes = selectedJob.intervals.reduce((acc: number, i: any) => acc + (i.received_mbps * 1024 * 1024 / 8), 0);
                                    }

                                    const formatBytes = (bytes: number) => {
                                        if (!bytes || bytes === 0) return '0 B';
                                        const k = 1024;
                                        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
                                        const i = Math.floor(Math.log(bytes) / Math.log(k));
                                        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
                                    };

                                    return (
                                        <div className="bg-card-secondary p-5 rounded-2xl border border-border mt-8 flex flex-col sm:flex-row justify-between gap-4">
                                            <div>
                                                <div className="text-[10px] font-black text-text-muted tracking-widest uppercase mb-1">Total Download</div>
                                                <div className="text-3xl font-black text-[#3b82f6]">{formatBytes(rxBytes)}</div>
                                            </div>
                                            <div>
                                                <div className="text-[10px] font-black text-text-muted tracking-widest uppercase mb-1">Total Upload</div>
                                                <div className="text-3xl font-black text-[#10b981]">{formatBytes(txBytes)}</div>
                                            </div>
                                            <div>
                                                <div className="text-[10px] font-black text-text-muted tracking-widest uppercase mb-1">Total Transferred</div>
                                                <div className="text-3xl font-black text-text-primary">{formatBytes(rxBytes + txBytes)}</div>
                                            </div>
                                        </div>
                                    );
                                })()}

                            </div>

                            <div className="p-8 space-y-8">
                                <div>
                                    <h4 className="flex items-center gap-2 text-[10px] font-black text-text-muted tracking-widest mb-4">
                                        <ShieldOff size={14} className={selectedJob.params.protocol === 'udp' ? "text-red-500" : "text-orange-500"} /> 
                                        {selectedJob.params.protocol === 'udp' ? 'Loss Analysis' : 'Retransmit Analysis'}
                                    </h4>
                                    <div className="bg-card-secondary p-5 rounded-2xl border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                        <div className="flex items-center gap-8">
                                            <div>
                                                <div className={cn("text-3xl font-black", selectedJob.params.protocol === 'udp' ? "text-red-500" : "text-orange-500")}>
                                                    {selectedJob.params.protocol === 'udp' ? `${selectedJob.summary?.loss_percent.toFixed(1)}%` : selectedJob.summary?.retransmits || 0}
                                                </div>
                                                <div className="text-[10px] font-black text-text-muted tracking-widest mt-1">
                                                    {selectedJob.params.protocol === 'udp' ? 'Average Packet Loss' : 'Total Retransmitted Packets'}
                                                </div>
                                            </div>
                                            {selectedJob.params.protocol === 'udp' && (
                                                <div>
                                                    <div className="text-3xl font-black text-text-primary">{selectedJob.summary?.lost ?? 0}</div>
                                                    <div className="text-[10px] font-black text-text-muted tracking-widest mt-1">Total Packets Dropped</div>
                                                </div>
                                            )}
                                            {selectedJob.params.protocol === 'tcp' && selectedJob.summary?.cwnd !== undefined && (
                                                <div>
                                                    <div className="text-3xl font-black text-text-primary">{(selectedJob.summary.cwnd / 1024).toFixed(0)} <span className="text-sm">KB</span></div>
                                                    <div className="text-[10px] font-black text-text-muted tracking-widest mt-1">TCP Window Size</div>
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-left sm:text-right">
                                            <div className="text-xl font-black text-text-primary">{selectedJob.params.protocol.toUpperCase()}</div>
                                            <div className="text-[10px] font-black text-text-muted tracking-widest mt-1">{selectedJob.params.parallel_streams} Parallel Streams</div>
                                        </div>
                                    </div>
                                </div>

                                {selectedJob.error && (
                                    <div className="bg-red-500/5 p-4 rounded-xl border border-red-500/20 flex flex-col gap-2">
                                        <span className="text-[9px] font-black text-red-500 tracking-widest">Diagnostic Error Signature</span>
                                        <pre className="text-xs font-mono text-red-500 whitespace-pre-wrap">{selectedJob.error}</pre>
                                    </div>
                                )}

                                <div className="pt-4 flex flex-col sm:flex-row gap-3">
                                    <button
                                        onClick={() => setShowDetailModal(false)}
                                        className="flex-1 py-3 bg-card-secondary border border-border hover:bg-card rounded-xl text-[10px] font-black text-text-primary tracking-widest transition-all"
                                    >
                                        Dismiss Diagnostic
                                    </button>
                                    <button
                                        onClick={() => {
                                            toast.success("Telemetry report exported to clipboard");
                                            navigator.clipboard.writeText(JSON.stringify(selectedJob, null, 2));
                                        }}
                                        className="flex-1 py-3 bg-blue-600 text-white rounded-xl text-[10px] font-black tracking-widest transition-all hover:shadow-lg shadow-blue-900/40"
                                    >
                                        Export JSON Log
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
}
