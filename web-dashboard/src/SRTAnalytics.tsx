import React, { useState, useEffect } from 'react';
import { usePeerContext } from './PeerContext';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, AreaChart, Area } from 'recharts';
import { Gauge, Activity, Server, LayoutDashboard, Settings, Play, StopCircle, RefreshCw, AlertCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

interface SRTAnalyticsProps {
    token: string;
}

export default function SRTAnalytics({ token }: SRTAnalyticsProps) {
    const [target, setTarget] = useState('127.0.0.1'); // Default to self
    const [isRunning, setIsRunning] = useState(false);
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const { gFetch } = usePeerContext();

    const fetchSRTData = async () => {
        try {
            const res = await gFetch('/api/srt/stats', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const stats = await res.json();
                if (stats.history) {
                    const history = stats.history.map((h: any) => ({
                        ...h,
                        time: new Date(h.timestamp * 1000).toLocaleTimeString()
                    }));
                    setData(history);
                }
                setIsRunning(stats.running);
            }
        } catch (e) {
            console.warn('SRT fetch failed');
        }
    };

    useEffect(() => {
        const interval = setInterval(fetchSRTData, 2000);
        return () => clearInterval(interval);
    }, [token]);

    const toggleSRT = async () => {
        setLoading(true);
        setError(null);
        try {
            const endpoint = isRunning ? '/api/srt/stop' : '/api/srt/start';
            const body = isRunning ? {} : { target };
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            if (!res.ok) {
                const err = await res.json();
                setError(err.error || 'Failed to toggle SRT probe');
            } else {
                setIsRunning(!isRunning);
            }
        } catch (e) {
            setError('Connection error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Config Card */}
            <div className="bg-card/50 border border-border rounded-xl p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-500/20 rounded-lg text-amber-400">
                            <Gauge size={24} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-xl font-bold text-text-primary">SRT Analytics</h3>
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-amber-500/20 text-amber-400 border border-amber-500/30">Beta</span>
                            </div>
                            <p className="text-text-muted text-xs">Measure Network RTT vs Application SRT (Server Response Time)</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-text-muted uppercase font-bold tracking-wider px-1">Target Host / IP</label>
                            <input
                                type="text"
                                value={target}
                                disabled={isRunning}
                                onChange={(e) => setTarget(e.target.value)}
                                placeholder="e.g. 192.168.1.50"
                                className="bg-card border border-border rounded-lg px-4 py-2 text-sm text-text-primary focus:border-amber-500 outline-none w-48 transition-all disabled:opacity-50"
                            />
                        </div>
                        <button
                            onClick={toggleSRT}
                            disabled={loading}
                            className={cn(
                                "px-6 py-2.5 rounded-lg font-bold flex items-center gap-2 transition-all shadow-lg mt-4",
                                isRunning
                                    ? "bg-red-600 hover:bg-red-500 text-white shadow-red-900/20"
                                    : "bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/20"
                            )}
                        >
                            {loading ? <RefreshCw className="animate-spin" size={18} /> : isRunning ? <StopCircle size={18} /> : <Play size={18} />}
                            {isRunning ? 'Stop Probe' : 'Start Probe'}
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs font-medium flex items-center gap-2">
                        <AlertCircle size={14} /> {error}
                    </div>
                )}
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 gap-6">
                <div className="bg-card/50 border border-border rounded-xl p-6 backdrop-blur-sm">
                    <h3 className="text-lg font-semibold mb-6 text-text-primary flex items-center gap-2">
                        <Activity className="text-amber-400" size={18} /> Delay Analysis (ms)
                    </h3>
                    <div className="h-[400px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data}>
                                <defs>
                                    <linearGradient id="colorRTT" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorSRT" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#fbbf24" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                                <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={10} />
                                <YAxis stroke="var(--text-muted)" fontSize={10} unit="ms" />
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                                />
                                <Legend iconType="circle" />
                                <Area
                                    type="monotone"
                                    dataKey="rtt_ms"
                                    name="Network Latency (RTT)"
                                    stroke="#38bdf8"
                                    strokeWidth={2}
                                    fillOpacity={1}
                                    fill="url(#colorRTT)"
                                    stackId="1"
                                />
                                <Area
                                    type="monotone"
                                    dataKey="srt_ms"
                                    name="Server Processing (SRT)"
                                    stroke="#fbbf24"
                                    strokeWidth={2}
                                    fillOpacity={1}
                                    fill="url(#colorSRT)"
                                    stackId="1"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="mt-4 p-4 bg-card border border-border rounded-lg flex gap-4">
                        <div className="flex-1">
                            <span className="text-[10px] text-text-muted uppercase font-black">How to read this:</span>
                            <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
                                The chart shows the **Total Time to First Byte (TTFB)** split into two parts:
                            </p>
                            <div className="grid grid-cols-2 gap-4 mt-2">
                                <div className="p-2 border border-blue-500/20 rounded">
                                    <span className="text-blue-400 font-bold block">RTT (Blue)</span>
                                    <span className="text-[10px] text-text-muted">Pure network delay for TCP connection across the SD-WAN fabric.</span>
                                </div>
                                <div className="p-2 border border-amber-500/20 rounded">
                                    <span className="text-amber-400 font-bold block">SRT (Yellow)</span>
                                    <span className="text-[10px] text-text-muted">Time spent by the application/server processing the request before responding.</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
