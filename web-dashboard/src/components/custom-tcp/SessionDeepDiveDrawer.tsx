import React, { useState } from 'react';
import {
    X, Activity, ArrowDownRight, ArrowUpRight, Shield, Zap,
    Clock, RefreshCw, Cpu, CheckCircle2, AlertTriangle, Copy,
    Server, Globe, Info, Gauge, Layers, BarChart3
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { IncomingSessionState, OutgoingSessionState } from '../../../custom-tcp-apps/types.js';

interface SessionDeepDiveDrawerProps {
    session: (IncomingSessionState & { isIncoming?: boolean }) | (OutgoingSessionState & { isIncoming?: boolean }) | null;
    appPort?: number;
    appName?: string;
    onClose: () => void;
    onTestPeer?: (peerId: string) => void;
}

export const SessionDeepDiveDrawer: React.FC<SessionDeepDiveDrawerProps> = ({
    session,
    appPort,
    appName,
    onClose,
    onTestPeer
}) => {
    const [activeTab, setActiveTab] = useState<'latency' | 'throughput' | 'diagnostics'>('latency');
    const [hoveredSampleIndex, setHoveredSampleIndex] = useState<number | null>(null);

    if (!session) return null;

    const isIncoming = 'declaredSiteName' in session || (session as any).isIncoming === true;
    const incoming = isIncoming ? (session as IncomingSessionState) : null;
    const outgoing = !isIncoming ? (session as OutgoingSessionState) : null;

    const formatBytes = (bytes?: number) => {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const formatBitrate = (bps?: number) => {
        if (!bps || bps <= 0) return '0 bps';
        if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
        if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} Kbps`;
        return `${bps} bps`;
    };

    const formatUptime = (seconds?: number) => {
        if (!seconds || seconds <= 0) return '< 1m';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        if (mins < 60) return `${mins}m ${secs}s`;
        const hours = Math.floor(mins / 60);
        const remMins = mins % 60;
        return `${hours}h ${remMins}m`;
    };

    const rttStats = outgoing?.rttMs;
    const recentSamples = rttStats?.recentSamples || [];
    const totalRtt = rttStats?.last || 0;
    const serverDelay = rttStats?.serverDelayMs || 0;
    const networkRtt = rttStats?.networkRttMs || Math.max(0, totalRtt - serverDelay);

    // Percentage breakdown
    const sumComponents = serverDelay + networkRtt || 1;
    const networkPct = Math.min(100, Math.max(0, Math.round((networkRtt / sumComponents) * 100)));
    const serverPct = 100 - networkPct;

    const copyJson = () => {
        navigator.clipboard.writeText(JSON.stringify(session, null, 2));
        toast.success('Session diagnostics copied to clipboard');
    };

    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm animate-fadeIn">
            {/* Click-away backdrop */}
            <div className="flex-1 cursor-pointer" onClick={onClose} />

            {/* Sliding Drawer Container */}
            <div className="w-full max-w-2xl bg-card border-l border-border h-full shadow-2xl flex flex-col justify-between animate-slideLeft overflow-y-auto">
                {/* Header */}
                <div className="p-6 border-b border-border bg-card-secondary/40 sticky top-0 z-10 backdrop-blur-md flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3.5">
                        <div className={`p-3 rounded-2xl border shadow-sm ${
                            isIncoming
                                ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-600 dark:text-indigo-400'
                                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                        }`}>
                            {isIncoming ? <ArrowDownRight size={24} /> : <ArrowUpRight size={24} />}
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-bold text-text-primary">
                                    {isIncoming
                                        ? ((incoming?.declaredSiteName && incoming?.declaredSiteName !== 'Handshaking...' ? incoming.declaredSiteName : incoming?.declaredHostname) || (incoming?.state === 'handshaking' ? 'Handshaking...' : 'External Client'))
                                        : (outgoing?.peerName || 'Outgoing Session')}
                                </h2>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                    isIncoming
                                        ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30'
                                        : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                                }`}>
                                    {isIncoming ? 'Incoming Session' : 'Outgoing Session'}
                                </span>
                            </div>
                            <div className="flex items-center gap-2.5 text-xs text-text-muted mt-1 font-mono">
                                <span>
                                    {isIncoming
                                        ? `${incoming?.remoteIp}:${incoming?.remotePort} ➔ :${appPort}`
                                        : `local ➔ ${outgoing?.peerHost}:${outgoing?.peerPort}`}
                                </span>
                                <span>•</span>
                                <span className="text-text-secondary">{appName}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={copyJson}
                            className="p-2 text-text-muted hover:text-text-primary hover:bg-card-secondary rounded-xl transition-colors border border-border/60"
                            title="Copy Diagnostics JSON"
                        >
                            <Copy size={16} />
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 text-text-muted hover:text-text-primary hover:bg-card-secondary rounded-xl transition-colors border border-border/60"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Status Bar */}
                <div className="px-6 py-3 bg-card-secondary/20 border-b border-border flex items-center justify-between text-xs">
                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1.5 font-bold">
                            <span className={`w-2 h-2 rounded-full ${
                                session.state === 'connected' ? 'bg-emerald-500 animate-pulse' :
                                session.state === 'reconnecting' ? 'bg-amber-500 animate-pulse' : 'bg-rose-500'
                            }`} />
                            <span className="uppercase text-text-primary font-mono">{session.state}</span>
                        </span>
                        <span className="text-text-muted">|</span>
                        <span className="text-text-muted font-mono flex items-center gap-1">
                            <Clock size={13} /> Uptime: <strong className="text-text-primary">{formatUptime(session.uptimeSec)}</strong>
                        </span>
                    </div>

                    {outgoing && (
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] text-text-muted">Jitter:</span>
                            <span className="text-[11px] font-mono font-bold text-cyan-500">± {rttStats?.jitterMs ?? 0} ms</span>
                        </div>
                    )}
                </div>

                {/* Navigation Tabs */}
                <div className="px-6 pt-4 border-b border-border flex items-center gap-2">
                    <button
                        onClick={() => setActiveTab('latency')}
                        className={`pb-3 px-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
                            activeTab === 'latency'
                                ? 'border-indigo-600 dark:border-indigo-400 text-indigo-600 dark:text-indigo-400'
                                : 'border-transparent text-text-muted hover:text-text-primary'
                        }`}
                    >
                        <Zap size={14} /> Latency Breakdown (RTT)
                    </button>
                    <button
                        onClick={() => setActiveTab('throughput')}
                        className={`pb-3 px-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
                            activeTab === 'throughput'
                                ? 'border-indigo-600 dark:border-indigo-400 text-indigo-600 dark:text-indigo-400'
                                : 'border-transparent text-text-muted hover:text-text-primary'
                        }`}
                    >
                        <Gauge size={14} /> Flow & Bitrates
                    </button>
                    <button
                        onClick={() => setActiveTab('diagnostics')}
                        className={`pb-3 px-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
                            activeTab === 'diagnostics'
                                ? 'border-indigo-600 dark:border-indigo-400 text-indigo-600 dark:text-indigo-400'
                                : 'border-transparent text-text-muted hover:text-text-primary'
                        }`}
                    >
                        <Info size={14} /> Socket & Protocol
                    </button>
                </div>

                {/* Tab Content */}
                <div className="p-6 space-y-6 flex-1">
                    {/* ═══ TAB 1: LATENCY BREAKDOWN (PRIORITY 3) ═══ */}
                    {activeTab === 'latency' && (
                        <div className="space-y-6 animate-fadeIn">
                            {outgoing ? (
                                <>
                                    {/* Decomposition Visual Card */}
                                    <div className="bg-card-secondary/40 border border-border rounded-2xl p-5 space-y-4 shadow-sm">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-bold text-text-primary uppercase tracking-wider flex items-center gap-1.5">
                                                <Zap size={15} className="text-amber-500" /> Latency Origin Breakdown
                                            </span>
                                            <span className="text-xs font-mono font-bold text-amber-500">
                                                Total App RTT: {totalRtt} ms
                                            </span>
                                        </div>

                                        {/* Stacked Proportional Bar */}
                                        <div className="space-y-1.5">
                                            <div className="h-4 w-full bg-border rounded-full overflow-hidden flex shadow-inner">
                                                <div
                                                    style={{ width: `${networkPct}%` }}
                                                    className="bg-gradient-to-r from-cyan-500 to-blue-500 h-full transition-all duration-500 relative group"
                                                    title={`Network Link Transit: ${networkRtt}ms (${networkPct}%)`}
                                                />
                                                <div
                                                    style={{ width: `${serverPct}%` }}
                                                    className="bg-gradient-to-r from-amber-500 to-orange-500 h-full transition-all duration-500 relative group"
                                                    title={`Server Processing Delay: ${serverDelay}ms (${serverPct}%)`}
                                                />
                                            </div>
                                            <div className="flex items-center justify-between text-[11px] font-mono">
                                                <span className="text-cyan-500 font-semibold flex items-center gap-1">
                                                    <span className="w-2 h-2 rounded-full bg-cyan-500 inline-block" />
                                                    SD-WAN Transport: <strong>{networkRtt} ms</strong> ({networkPct}%)
                                                </span>
                                                <span className="text-amber-500 font-semibold flex items-center gap-1">
                                                    <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                                                    Server Processing Delay: <strong>{serverDelay} ms</strong> ({serverPct}%)
                                                </span>
                                            </div>
                                        </div>

                                        {serverDelay > 0 && (
                                            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-2">
                                                <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                                                <span>
                                                    <strong>Simulated Server Delay Active:</strong> The remote server behavior adds a fixed or random artificial processing delay of <strong>{serverDelay}ms</strong>. The true network path transit is <strong>{networkRtt}ms</strong>.
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Percentile Stats Grid */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        <div className="bg-card-secondary/30 border border-border p-3.5 rounded-xl">
                                            <div className="text-[10px] text-text-muted font-mono uppercase">Minimum</div>
                                            <div className="text-lg font-black text-emerald-500 mt-1 font-mono">{rttStats?.min || 0} ms</div>
                                        </div>
                                        <div className="bg-card-secondary/30 border border-border p-3.5 rounded-xl">
                                            <div className="text-[10px] text-text-muted font-mono uppercase">Median (p50)</div>
                                            <div className="text-lg font-black text-text-primary mt-1 font-mono">{rttStats?.p50 || 0} ms</div>
                                        </div>
                                        <div className="bg-card-secondary/30 border border-border p-3.5 rounded-xl">
                                            <div className="text-[10px] text-text-muted font-mono uppercase">Tail (p95)</div>
                                            <div className="text-lg font-black text-amber-500 mt-1 font-mono">{rttStats?.p95 || 0} ms</div>
                                        </div>
                                        <div className="bg-card-secondary/30 border border-border p-3.5 rounded-xl">
                                            <div className="text-[10px] text-text-muted font-mono uppercase">Peak (Max)</div>
                                            <div className="text-lg font-black text-rose-500 mt-1 font-mono">{rttStats?.max || 0} ms</div>
                                        </div>
                                    </div>

                                    {/* Real-time Interactive Waveform Chart */}
                                    <div className="bg-card-secondary/30 border border-border rounded-2xl p-5 space-y-3">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="font-bold text-text-primary flex items-center gap-1.5">
                                                <BarChart3 size={15} /> Real-Time RTT Waveform (Last 20 ticks)
                                            </span>
                                            <span className="text-text-muted font-mono text-[11px]">
                                                {hoveredSampleIndex !== null && recentSamples[hoveredSampleIndex] !== undefined
                                                    ? `Tick #${hoveredSampleIndex + 1}: ${recentSamples[hoveredSampleIndex]} ms`
                                                    : `Avg: ${rttStats?.avg || 0} ms`}
                                            </span>
                                        </div>

                                        {recentSamples.length >= 2 ? (
                                            <div className="h-32 w-full relative pt-4 pb-2">
                                                {/* Chart SVG */}
                                                <svg className="w-full h-full overflow-visible" viewBox="0 0 500 100" preserveAspectRatio="none">
                                                    {(() => {
                                                        const min = Math.min(...recentSamples);
                                                        const max = Math.max(...recentSamples);
                                                        const range = max - min === 0 ? 1 : max - min;

                                                        const pts = recentSamples.map((v: number, i: number) => ({
                                                            x: (i / (recentSamples.length - 1)) * 500,
                                                            y: 100 - ((v - min) / range) * 85 - 5,
                                                            val: v
                                                        }));

                                                        const pathStr = pts.reduce((acc: string, p: { x: number; y: number }, i: number) => i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`, '');
                                                        const areaStr = `${pathStr} L 500 100 L 0 100 Z`;

                                                        return (
                                                            <>
                                                                <defs>
                                                                    <linearGradient id="drawer-chart-grad" x1="0" y1="0" x2="0" y2="1">
                                                                        <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.4" />
                                                                        <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                                                                    </linearGradient>
                                                                </defs>
                                                                <path d={areaStr} fill="url(#drawer-chart-grad)" />
                                                                <path d={pathStr} fill="none" stroke="#06b6d4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                                                {pts.map((p: { x: number; y: number }, i: number) => (
                                                                    <circle
                                                                        key={i}
                                                                        cx={p.x}
                                                                        cy={p.y}
                                                                        r={hoveredSampleIndex === i ? 5 : 2.5}
                                                                        fill={hoveredSampleIndex === i ? '#f59e0b' : '#06b6d4'}
                                                                        className="cursor-pointer transition-all"
                                                                        onMouseEnter={() => setHoveredSampleIndex(i)}
                                                                        onMouseLeave={() => setHoveredSampleIndex(null)}
                                                                    />
                                                                ))}
                                                            </>
                                                        );
                                                    })()}
                                                </svg>
                                            </div>
                                        ) : (
                                            <div className="h-28 flex items-center justify-center text-xs text-text-muted italic">
                                                Awaiting rolling workload data points...
                                            </div>
                                        )}

                                        {/* SLA & Percentiles Explanatory Footnote */}
                                        <div className="p-3.5 bg-card/60 border border-border/80 rounded-xl text-[11px] text-text-muted space-y-1.5 leading-relaxed mt-2">
                                            <div className="font-semibold text-text-primary flex items-center gap-1.5 text-xs">
                                                <Info size={13} className="text-indigo-400" />
                                                Understanding Latency Metrics & Percentiles
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] pt-1">
                                                <div>
                                                    <strong className="text-text-primary font-mono">Median (P50):</strong> 50% of requests are faster than this value. Represents typical baseline performance.
                                                </div>
                                                <div>
                                                    <strong className="text-amber-500 font-mono">Tail Latency (P95):</strong> 95% of requests complete within this delay. Highlights SD-WAN tunnel jitter and micro-burst queuing.
                                                </div>
                                                <div>
                                                    <strong className="text-emerald-500 font-mono">Minimum:</strong> Best observed physical transport floor across underlay/overlay tunnels.
                                                </div>
                                                <div>
                                                    <strong className="text-rose-500 font-mono">Peak (Max):</strong> Worst-case outlier transaction recorded in the sliding window.
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="p-8 text-center space-y-3 bg-card-secondary/20 rounded-2xl border border-border">
                                    <Server size={32} className="mx-auto text-indigo-400" />
                                    <div className="font-semibold text-text-primary text-sm">Server-side Incoming Session</div>
                                    <p className="text-xs text-text-muted max-w-md mx-auto">
                                        Round-trip latency (RTT) is measured by the client initiating requests. As a receiver listener, this node tracks incoming throughput, handled requests, and payload execution.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ═══ TAB 2: FLOW & BITRATES ═══ */}
                    {activeTab === 'throughput' && (() => {
                        const uptimeSec = Math.max(1, session.uptimeSec || 1);
                        const avgTxBps = Math.round(((session.bytesSent || 0) * 8) / uptimeSec);
                        const avgRxBps = Math.round(((session.bytesReceived || 0) * 8) / uptimeSec);
                        const displayTxBps = (session.txBps && session.txBps > 0) ? session.txBps : avgTxBps;
                        const displayRxBps = (session.rxBps && session.rxBps > 0) ? session.rxBps : avgRxBps;
                        const totalReqs = isIncoming ? (incoming?.requestsHandled || 0) : (outgoing?.requestsSent || 0);
                        const avgTps = Number((totalReqs / uptimeSec).toFixed(1));
                        const displayTps = (session.tps && session.tps > 0) ? session.tps : avgTps;

                        return (
                            <div className="space-y-6 animate-fadeIn">
                                {/* Live Rate Gauges */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-card-secondary/40 border border-border p-5 rounded-2xl space-y-2">
                                        <div className="flex items-center justify-between text-xs text-text-muted font-mono">
                                            <span>LIVE TRANSMIT (TX)</span>
                                            <ArrowUpRight size={16} className="text-indigo-400" />
                                        </div>
                                        <div className="text-2xl font-black text-indigo-400 font-mono">
                                            {formatBitrate(displayTxBps)}
                                        </div>
                                        <div className="text-[11px] text-text-muted font-mono">
                                            Total Cumulative: <strong className="text-text-primary">{formatBytes(session.bytesSent)}</strong>
                                            {avgTxBps > 0 && <span className="text-[10px] opacity-75 ml-1.5">(avg {formatBitrate(avgTxBps)})</span>}
                                        </div>
                                    </div>

                                    <div className="bg-card-secondary/40 border border-border p-5 rounded-2xl space-y-2">
                                        <div className="flex items-center justify-between text-xs text-text-muted font-mono">
                                            <span>LIVE RECEIVE (RX)</span>
                                            <ArrowDownRight size={16} className="text-emerald-500" />
                                        </div>
                                        <div className="text-2xl font-black text-emerald-500 font-mono">
                                            {formatBitrate(displayRxBps)}
                                        </div>
                                        <div className="text-[11px] text-text-muted font-mono">
                                            Total Cumulative: <strong className="text-text-primary">{formatBytes(session.bytesReceived)}</strong>
                                            {avgRxBps > 0 && <span className="text-[10px] opacity-75 ml-1.5">(avg {formatBitrate(avgRxBps)})</span>}
                                        </div>
                                    </div>
                                </div>

                                {/* Transaction & Message Counts */}
                                <div className="bg-card-secondary/30 border border-border rounded-2xl p-5 space-y-4">
                                    <h4 className="text-xs font-bold text-text-primary uppercase tracking-wider flex items-center gap-1.5">
                                        <Activity size={14} /> Transactions & Cadence
                                    </h4>
                                    <div className="grid grid-cols-3 gap-4 text-center">
                                        <div className="p-3 bg-card border border-border rounded-xl">
                                            <div className="text-[10px] text-text-muted font-mono uppercase">Rate (TPS)</div>
                                            <div className="text-lg font-black text-text-primary font-mono mt-0.5">{displayTps} /s</div>
                                            {avgTps > 0 && <div className="text-[9px] text-text-muted font-mono mt-0.5">avg {avgTps}/s</div>}
                                        </div>
                                        <div className="p-3 bg-card border border-border rounded-xl">
                                            <div className="text-[10px] text-text-muted font-mono uppercase">{isIncoming ? 'Handled Reqs' : 'Sent Reqs'}</div>
                                            <div className="text-lg font-black text-text-primary font-mono mt-0.5">
                                                {totalReqs}
                                            </div>
                                        </div>
                                        <div className="p-3 bg-card border border-border rounded-xl">
                                            <div className="text-[10px] text-text-muted font-mono uppercase">{isIncoming ? 'Drops / Errs' : 'Replies Recv'}</div>
                                            <div className="text-lg font-black text-text-primary font-mono mt-0.5">
                                                {isIncoming ? `${incoming?.simulatedDrops || 0} / ${incoming?.simulatedErrors || 0}` : (outgoing?.responsesReceived || 0)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {/* ═══ TAB 3: SOCKET & PROTOCOL DIAGNOSTICS ═══ */}
                    {activeTab === 'diagnostics' && (
                        <div className="space-y-4 text-xs animate-fadeIn font-mono">
                            <div className="bg-card-secondary/30 border border-border rounded-2xl p-5 space-y-3">
                                <h4 className="font-sans font-bold text-text-primary uppercase text-[11px] tracking-wider flex items-center gap-1.5">
                                    <Cpu size={14} /> Transport Parameters
                                </h4>
                                <div className="divide-y divide-border/60">
                                    <div className="py-2 flex justify-between">
                                        <span className="text-text-muted">Session UUID</span>
                                        <span className="text-text-primary font-semibold">{session.sessionId}</span>
                                    </div>
                                    {isIncoming ? (
                                        <>
                                            <div className="py-2 flex justify-between">
                                                <span className="text-text-muted">Declared Origin</span>
                                                <span className="text-text-primary font-semibold">
                                                    {incoming?.declaredSiteName && incoming?.declaredSiteName !== 'Handshaking...'
                                                        ? incoming.declaredSiteName
                                                        : (incoming?.declaredHostname || (incoming?.state === 'handshaking' ? 'Handshaking...' : 'External Client'))}
                                                </span>
                                            </div>
                                            <div className="py-2 flex justify-between">
                                                <span className="text-text-muted">Source IP</span>
                                                <span className="text-text-primary font-semibold">{incoming?.remoteIp}:{incoming?.remotePort}</span>
                                            </div>
                                            {incoming?.declaredHostname && incoming.declaredHostname !== incoming.declaredSiteName && (
                                                <div className="py-2 flex justify-between">
                                                    <span className="text-text-muted">Declared Hostname</span>
                                                    <span className="text-text-primary font-semibold">{incoming.declaredHostname}</span>
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <div className="py-2 flex justify-between">
                                                <span className="text-text-muted">Target Peer</span>
                                                <span className="text-text-primary font-semibold">{outgoing?.peerName}</span>
                                            </div>
                                            <div className="py-2 flex justify-between">
                                                <span className="text-text-muted">Remote Endpoint</span>
                                                <span className="text-text-primary font-semibold">{outgoing?.peerHost}:{outgoing?.peerPort}</span>
                                            </div>
                                        </>
                                    )}
                                    <div className="py-2 flex justify-between">
                                        <span className="text-text-muted">TCP Initial Handshake Time</span>
                                        <span className="text-text-primary font-semibold">{session.tcpConnectMs || 2} ms</span>
                                    </div>
                                    <div className="py-2 flex justify-between">
                                        <span className="text-text-muted">Framing Protocol</span>
                                        <span className="text-text-primary font-semibold">Stigix Length-Prefixed v1 (UInt32BE)</span>
                                    </div>
                                    {outgoing && (
                                        <>
                                            <div className="py-2 flex justify-between">
                                                <span className="text-text-muted">Total Reconnections</span>
                                                <span className="text-text-primary font-semibold">{outgoing.reconnects}</span>
                                            </div>
                                            <div className="py-2 flex justify-between">
                                                <span className="text-text-muted">Timeouts</span>
                                                <span className="text-rose-500 font-semibold">{outgoing.timeouts}</span>
                                            </div>
                                            <div className="py-2 flex justify-between">
                                                <span className="text-text-muted">Errors</span>
                                                <span className="text-rose-500 font-semibold">{outgoing.errors}</span>
                                            </div>
                                            {outgoing.lastError && (
                                                <div className="py-2 flex justify-between">
                                                    <span className="text-text-muted">Last Error</span>
                                                    <span className="text-rose-500 font-semibold">{outgoing.lastError}</span>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Action Bar */}
                <div className="p-6 border-t border-border bg-card-secondary/40 flex items-center justify-between gap-3">
                    <div className="text-xs text-text-muted">
                        Real-time telemetry stream active (1.5s refresh)
                    </div>

                    <div className="flex items-center gap-2">
                        {outgoing && onTestPeer && (
                            <button
                                onClick={() => onTestPeer(outgoing.peerId)}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors shadow-sm"
                            >
                                <Zap size={14} /> Send SYN/Handshake Probe
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-card-secondary hover:bg-border text-text-primary border border-border rounded-xl text-xs font-semibold transition-colors"
                        >
                            Close Drawer
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
