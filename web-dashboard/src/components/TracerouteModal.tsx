import React, { useState, useEffect } from 'react';
import { Route, X, Play, Copy, Check, Terminal, Activity, ArrowRight, AlertCircle, CheckCircle2, RefreshCw, Shield, ChevronDown, ChevronUp } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

interface HopData {
    hop: number;
    ip: string;
    rtt_ms: number | null;
    status: string;
}

interface TracerouteResponse {
    success: boolean;
    target?: string;
    max_hops?: number;
    destination_reached?: boolean;
    total_hops?: number;
    hops?: HopData[];
    raw_output?: string;
    error?: string;
}

interface TracerouteModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialTarget?: string;
    token?: string;
    title?: string;
}

/**
 * Extracts a clean hostname or IP from an arbitrary probe URL or string
 * e.g., "https://1.1.1.1:443/health" -> "1.1.1.1"
 *       "8.8.8.8" -> "8.8.8.8"
 *       "http://vyos.internal/api" -> "vyos.internal"
 */
function cleanTarget(target: string): string {
    if (!target) return '';
    let trimmed = target.trim();
    // Remove protocol
    trimmed = trimmed.replace(/^https?:\/\//i, '');
    // Remove path/query
    trimmed = trimmed.split('/')[0];
    // Remove port if present (unless IPv6)
    if (trimmed.includes(':') && !trimmed.includes('[')) {
        const parts = trimmed.split(':');
        if (parts.length === 2 && /^\d+$/.test(parts[1])) {
            trimmed = parts[0];
        }
    }
    return trimmed;
}

export const TracerouteModal: React.FC<TracerouteModalProps> = ({
    isOpen,
    onClose,
    initialTarget = '',
    token = '',
    title = 'Network Path Trace'
}) => {
    const [target, setTarget] = useState<string>('');
    const [maxHops, setMaxHops] = useState<number>(15);
    const [method, setMethod] = useState<'udp' | 'tcp' | 'icmp'>('tcp');
    const [port, setPort] = useState<number>(443);
    const [loading, setLoading] = useState<boolean>(false);
    const [result, setResult] = useState<TracerouteResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState<boolean>(false);
    const [showRaw, setShowRaw] = useState<boolean>(false);

    // Sync initial target whenever modal opens
    useEffect(() => {
        if (isOpen) {
            const cleaned = cleanTarget(initialTarget);
            setTarget(cleaned);
            setResult(null);
            setError(null);
            setShowRaw(false);
            if (cleaned) {
                // Auto-run when opened with a specific target
                executeTrace(cleaned, maxHops, method, port);
            }
        }
    }, [isOpen, initialTarget]);

    if (!isOpen) return null;

    const executeTrace = async (targetToTrace?: string, hopsCount?: number, traceMethod?: 'udp' | 'tcp' | 'icmp', tracePort?: number) => {
        const dest = cleanTarget(targetToTrace || target);
        if (!dest) {
            setError('Please enter a valid IP address or hostname');
            return;
        }

        setLoading(true);
        setError(null);
        setResult(null);

        try {
            const effectiveToken = token || localStorage.getItem('token') || '';
            const res = await fetch('/api/network/traceroute', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${effectiveToken}`
                },
                body: JSON.stringify({
                    target: dest,
                    max_hops: hopsCount || maxHops,
                    method: traceMethod || method,
                    port: (traceMethod || method) === 'tcp' ? (tracePort || port) : undefined
                })
            });

            const data: TracerouteResponse = await res.json();
            if (!res.ok || data.success === false) {
                setError(data.error || 'Traceroute execution failed');
            } else {
                setResult(data);
            }
        } catch (e: any) {
            setError(e.message || 'Network communication error with Stigix backend');
        } finally {
            setLoading(false);
        }
    };

    const copyRawOutput = () => {
        const textToCopy = result?.raw_output || JSON.stringify(result?.hops, null, 2) || '';
        if (!textToCopy) return;
        navigator.clipboard.writeText(textToCopy);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const getLatencyBadge = (rtt: number | null) => {
        if (rtt === null) {
            return <span className="text-text-muted/60 font-mono text-[11px]">* (timeout)</span>;
        }
        if (rtt < 20) {
            return <span className="text-emerald-500 dark:text-emerald-400 font-mono font-bold text-[11px]">{rtt.toFixed(1)} ms</span>;
        }
        if (rtt < 75) {
            return <span className="text-blue-500 dark:text-blue-400 font-mono font-bold text-[11px]">{rtt.toFixed(1)} ms</span>;
        }
        if (rtt < 150) {
            return <span className="text-amber-500 dark:text-amber-400 font-mono font-bold text-[11px]">{rtt.toFixed(1)} ms</span>;
        }
        return <span className="text-rose-500 dark:text-rose-400 font-mono font-bold text-[11px]">{rtt.toFixed(1)} ms</span>;
    };

    // Calculate quick stats if hops available
    const validHops = result?.hops?.filter(h => h.rtt_ms !== null) || [];
    const avgLatency = validHops.length > 0
        ? Math.round(validHops.reduce((acc, h) => acc + (h.rtt_ms || 0), 0) / validHops.length)
        : null;
    const finalHop = result?.hops && result.hops.length > 0 ? result.hops[result.hops.length - 1] : null;

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 sm:p-6 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
            <div 
                className="bg-card border border-border/80 w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-border/80 bg-card-secondary/40 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500 dark:text-blue-400 border border-blue-500/20 shadow-sm">
                            <Route size={18} />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-text-primary tracking-tight flex items-center gap-2">
                                {title}
                                {target && (
                                    <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-card-secondary text-text-secondary border border-border">
                                        {target}
                                    </span>
                                )}
                            </h3>
                            <p className="text-[11px] text-text-muted">Hop-by-hop layer-3 latency and underlay path analysis</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-card-secondary transition-colors"
                        title="Close (Esc)"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Target & Options Input Bar */}
                <div className="p-5 border-b border-border/60 bg-card/50 flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                            <input
                                type="text"
                                placeholder="Enter IPv4, IPv6, or hostname (e.g. 1.1.1.1, 192.168.203.100, google.com)"
                                value={target}
                                onChange={(e) => setTarget(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !loading) {
                                        executeTrace();
                                    }
                                }}
                                className="w-full bg-card-secondary/70 border border-border text-text-primary pl-4 pr-10 py-2 rounded-xl text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-text-muted/50"
                            />
                            {target && (
                                <button
                                    onClick={() => setTarget('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        {/* Protocol Method Selector */}
                        <div className="flex items-center p-0.5 bg-card-secondary/80 border border-border rounded-xl text-[11px] font-mono">
                            {(['tcp', 'icmp', 'udp'] as const).map((m) => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => setMethod(m)}
                                    className={twMerge(
                                        "px-2.5 py-1.5 rounded-lg font-bold uppercase transition-all",
                                        method === m
                                            ? "bg-blue-600 text-white shadow-sm"
                                            : "text-text-muted hover:text-text-primary"
                                    )}
                                >
                                    {m}
                                </button>
                            ))}
                        </div>

                        {/* Port (Only if TCP) */}
                        {method === 'tcp' && (
                            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-card-secondary/70 border border-border rounded-xl">
                                <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Port</span>
                                <input
                                    type="number"
                                    value={port}
                                    onChange={(e) => setPort(Math.max(1, Math.min(65535, Number(e.target.value) || 443)))}
                                    className="w-12 bg-transparent text-text-primary text-xs font-bold font-mono outline-none"
                                />
                            </div>
                        )}

                        {/* Max Hops */}
                        <div className="flex items-center gap-1.5 px-3 py-2 bg-card-secondary/70 border border-border rounded-xl">
                            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Hops</span>
                            <select
                                value={maxHops}
                                onChange={(e) => setMaxHops(Number(e.target.value))}
                                className="bg-transparent text-text-primary text-xs font-bold outline-none cursor-pointer font-mono"
                            >
                                <option value={10}>10</option>
                                <option value={15}>15</option>
                                <option value={20}>20</option>
                            </select>
                        </div>

                        {/* Trace Button */}
                        <button
                            onClick={() => executeTrace()}
                            disabled={loading || !target.trim()}
                            className={twMerge(
                                "flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm",
                                loading || !target.trim()
                                    ? "bg-blue-600/50 text-white/70 cursor-not-allowed"
                                    : "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/20 active:scale-[0.98]"
                            )}
                        >
                            {loading ? (
                                <>
                                    <RefreshCw size={13} className="animate-spin" />
                                    <span>Tracing...</span>
                                </>
                            ) : (
                                <>
                                    <Play size={13} fill="currentColor" />
                                    <span>Trace Path</span>
                                </>
                            )}
                        </button>
                    </div>

                    {/* Quick Presets */}
                    <div className="flex items-center justify-between flex-wrap gap-2 text-[10px]">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-text-muted font-bold uppercase tracking-wider">Presets:</span>
                            {[
                                { label: 'Cloudflare (1.1.1.1)', ip: '1.1.1.1' },
                                { label: 'Google DNS (8.8.8.8)', ip: '8.8.8.8' },
                                { label: 'Quad9 (9.9.9.9)', ip: '9.9.9.9' }
                            ].map((preset) => (
                                <button
                                    key={preset.ip}
                                    onClick={() => {
                                        setTarget(preset.ip);
                                        executeTrace(preset.ip, maxHops, method, port);
                                    }}
                                    className="px-2.5 py-1 rounded-lg bg-card-secondary hover:bg-blue-500/10 hover:text-blue-500 hover:border-blue-500/20 border border-border text-text-muted transition-all font-mono"
                                >
                                    {preset.label}
                                </button>
                            ))}
                        </div>
                        <div className="text-[10px] text-text-muted/70 font-mono">
                            Method: <span className="uppercase font-bold text-text-muted">{method}</span>{method === 'tcp' ? `:${port}` : ''}
                        </div>
                    </div>
                </div>

                {/* Content Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {/* Error Banner */}
                    {error && (
                        <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 dark:text-rose-400 text-xs">
                            <AlertCircle size={16} className="shrink-0 mt-0.5" />
                            <div className="space-y-1">
                                <div className="font-bold">Traceroute Error</div>
                                <div className="text-[11px] opacity-90 leading-relaxed font-mono">{error}</div>
                            </div>
                        </div>
                    )}

                    {/* Loading Skeleton */}
                    {loading && (
                        <div className="space-y-3 py-6 flex flex-col items-center justify-center text-center">
                            <div className="relative flex items-center justify-center w-14 h-14 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-500 animate-pulse">
                                <Route size={24} />
                                <div className="absolute inset-0 rounded-full border border-blue-500/40 animate-ping" />
                            </div>
                            <div className="space-y-1">
                                <div className="text-xs font-bold text-text-primary">Probing Network Hops...</div>
                                <div className="text-[11px] text-text-muted font-mono">
                                    Tracing path to <span className="text-blue-500 font-bold">{target}</span> (max {maxHops} hops)
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Results Display */}
                    {!loading && result && (
                        <div className="space-y-4">
                            {/* Summary Metrics Card */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div className="p-3 rounded-xl bg-card-secondary/40 border border-border">
                                    <div className="text-[9px] font-bold text-text-muted uppercase tracking-wider">Status</div>
                                    <div className="mt-1 flex items-center gap-1.5 text-xs font-bold">
                                        {result.destination_reached ? (
                                            <>
                                                <CheckCircle2 size={14} className="text-emerald-500" />
                                                <span className="text-emerald-500">Destination Reached</span>
                                            </>
                                        ) : (
                                            <>
                                                <AlertCircle size={14} className="text-amber-500" />
                                                <span className="text-amber-500">Partial / Unreached</span>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="p-3 rounded-xl bg-card-secondary/40 border border-border">
                                    <div className="text-[9px] font-bold text-text-muted uppercase tracking-wider">Total Hops</div>
                                    <div className="mt-1 text-xs font-bold font-mono text-text-primary">
                                        {result.total_hops || result.hops?.length || 0} hops
                                    </div>
                                </div>

                                <div className="p-3 rounded-xl bg-card-secondary/40 border border-border">
                                    <div className="text-[9px] font-bold text-text-muted uppercase tracking-wider">Avg Latency</div>
                                    <div className="mt-1 text-xs font-bold font-mono text-blue-500">
                                        {avgLatency !== null ? `${avgLatency} ms` : '—'}
                                    </div>
                                </div>

                                <div className="p-3 rounded-xl bg-card-secondary/40 border border-border">
                                    <div className="text-[9px] font-bold text-text-muted uppercase tracking-wider">Final Hop RTT</div>
                                    <div className="mt-1 text-xs font-bold font-mono text-text-primary">
                                        {finalHop?.rtt_ms ? `${finalHop.rtt_ms.toFixed(1)} ms` : '—'}
                                    </div>
                                </div>
                            </div>

                            {/* Hops Table */}
                            {result.hops && result.hops.length > 0 ? (
                                <div className="border border-border/80 rounded-xl overflow-hidden shadow-sm bg-card">
                                    <table className="w-full text-left border-collapse">
                                        <thead className="bg-card-secondary/60 border-b border-border text-[10px] font-bold text-text-muted uppercase tracking-wider">
                                            <tr>
                                                <th className="py-2.5 px-4 w-16 text-center">Hop</th>
                                                <th className="py-2.5 px-4">Node / Gateway IP</th>
                                                <th className="py-2.5 px-4 text-right">Round-Trip Time</th>
                                                <th className="py-2.5 px-4 text-right">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border text-xs font-mono">
                                            {result.hops.map((h) => {
                                                const isFinal = h.hop === result.hops?.length;
                                                const isTargetMatch = h.ip.trim() === target.trim();
                                                return (
                                                    <tr 
                                                        key={h.hop}
                                                        className={twMerge(
                                                            "hover:bg-card-secondary/30 transition-colors",
                                                            isTargetMatch ? "bg-blue-500/5 font-semibold" : ""
                                                        )}
                                                    >
                                                        <td className="py-2.5 px-4 text-center text-text-muted font-bold">
                                                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-card-secondary text-[10px] border border-border">
                                                                {h.hop < 10 ? `0${h.hop}` : h.hop}
                                                            </span>
                                                        </td>
                                                        <td className="py-2.5 px-4">
                                                            <div className="flex items-center gap-2">
                                                                <span className={h.ip === '*' ? "text-text-muted" : "text-text-primary"}>
                                                                    {h.ip}
                                                                </span>
                                                                {isTargetMatch && (
                                                                    <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-500 border border-blue-500/20">
                                                                        Target
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="py-2.5 px-4 text-right">
                                                            {getLatencyBadge(h.rtt_ms)}
                                                        </td>
                                                        <td className="py-2.5 px-4 text-right text-[10px] font-bold uppercase">
                                                            {h.status === 'reached' ? (
                                                                <span className="text-emerald-500">Reached</span>
                                                            ) : (
                                                                <span className="text-text-muted/60">Timeout</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="text-xs text-text-muted italic py-4 text-center">
                                    No hop details returned.
                                </div>
                            )}

                            {/* Raw Console Output Accordion */}
                            {result.raw_output && (
                                <div className="border border-border/80 rounded-xl overflow-hidden bg-card-secondary/20">
                                    <button
                                        onClick={() => setShowRaw(!showRaw)}
                                        className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-bold text-text-muted hover:text-text-primary transition-colors"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Terminal size={14} />
                                            <span>Raw Shell Output</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {showRaw ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                        </div>
                                    </button>

                                    {showRaw && (
                                        <div className="p-3 border-t border-border/60 bg-black/40 relative">
                                            <button
                                                onClick={copyRawOutput}
                                                className="absolute top-3 right-3 p-1.5 rounded-md bg-card/60 hover:bg-card text-text-muted hover:text-text-primary border border-border text-[10px] flex items-center gap-1 transition-all"
                                                title="Copy Output"
                                            >
                                                {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                                <span>{copied ? 'Copied' : 'Copy'}</span>
                                            </button>
                                            <pre className="text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed whitespace-pre-wrap">
                                                {result.raw_output}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Initial Blank State */}
                    {!loading && !result && !error && (
                        <div className="py-12 flex flex-col items-center justify-center text-center text-text-muted space-y-2">
                            <Route size={32} className="opacity-30" />
                            <div className="text-xs font-bold">Ready to trace path</div>
                            <div className="text-[11px] opacity-70 max-w-sm">
                                Enter an IP address, site gateway, or hostname above to inspect the step-by-step route taken by packets.
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-border/80 bg-card-secondary/40 flex items-center justify-between text-xs text-text-muted">
                    <div className="flex items-center gap-1.5 text-[10px]">
                        <Shield size={12} className="text-blue-500" />
                        <span>Strict IPv4/IPv6 sanitization & safe container execution</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 rounded-lg bg-card-secondary hover:bg-card border border-border text-text-primary text-xs font-semibold transition-all"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};
