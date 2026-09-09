import React, { useState } from 'react';
import { BarChart3, Search, Activity, Zap, Check, Plus, Clock, Server, Shield, Globe, Info } from 'lucide-react';
import { Favicon } from './components/Favicon';

interface TelemetryData {
    rtt_ms: number;
    ttfb_ms: number;
    dns_ms?: number;
    tcp_ms?: number;
    tls_ms?: number;
    last_code?: string | number;
}

interface Stats {
    timestamp: number;
    total_requests: number;
    requests_by_app: Record<string, number>;
    errors_by_app: Record<string, number>;
    telemetry_by_app?: Record<string, TelemetryData>;
}

interface StatsProps {
    stats: Stats | null;
    appConfig: any[];
    onReset?: () => void;
    token?: string | null;
}

export default function Statistics({ stats, appConfig, onReset, token }: StatsProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState<'requests' | 'errors' | 'name' | 'group' | 'successRate' | 'latency' | 'ttfb'>('requests');
    const [promotingApp, setPromotingApp] = useState<string | null>(null);
    const [promotedApps, setPromotedApps] = useState<Record<string, boolean>>({});
    const [hoveredApp, setHoveredApp] = useState<string | null>(null);
    const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const authToken = token || localStorage.getItem('token');

    if (!stats) {
        return (
            <div className="p-8 text-center text-text-muted">
                <BarChart3 size={48} className="mx-auto mb-4 opacity-50" />
                <p>No statistics available yet. Start traffic generation to see data.</p>
            </div>
        );
    }

    // Create a lookup map for app -> group
    const appToGroup: Record<string, string> = {};
    const truncatedToGroup: Record<string, string> = {};

    const normalizeAppName = (name: string) => name.replace(/^https?:\/\//, '');

    if (Array.isArray(appConfig)) {
        appConfig.forEach(cat => {
            if (cat.apps && Array.isArray(cat.apps)) {
                cat.apps.forEach((app: any) => {
                    const cleanName = normalizeAppName(app.domain);
                    appToGroup[cleanName] = cat.name;
                    appToGroup[app.domain] = cat.name; // Keep original as fallback

                    // Fallback for truncated names in existing stats
                    const hostPart = cleanName.split('.')[0];
                    if (hostPart && !truncatedToGroup[hostPart]) {
                        truncatedToGroup[hostPart] = cat.name;
                    }
                });
            }
        });
    }

    // Combine requests, errors, and live telemetry data
    const appStats = Object.keys(stats.requests_by_app).map(app => {
        const cleanApp = normalizeAppName(app);
        const tel = stats.telemetry_by_app?.[cleanApp] || stats.telemetry_by_app?.[app];

        return {
            name: app,
            group: appToGroup[cleanApp] || appToGroup[app] || truncatedToGroup[cleanApp] || 'Uncategorized',
            requests: stats.requests_by_app[app] || 0,
            errors: stats.errors_by_app[app] || 0,
            successRate: stats.requests_by_app[app] > 0
                ? ((stats.requests_by_app[app] - (stats.errors_by_app[app] || 0)) / stats.requests_by_app[app] * 100).toFixed(1)
                : '100.0',
            rtt_ms: tel && tel.rtt_ms > 0 ? tel.rtt_ms : null,
            ttfb_ms: tel && tel.ttfb_ms > 0 ? tel.ttfb_ms : null,
            dns_ms: tel?.dns_ms ?? 0,
            tcp_ms: tel?.tcp_ms ?? 0,
            tls_ms: tel?.tls_ms ?? 0,
            last_code: tel?.last_code ?? 200
        };
    });

    // Filter and sort
    const filteredStats = appStats
        .filter(app =>
            app.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            app.group.toLowerCase().includes(searchTerm.toLowerCase())
        )
        .sort((a, b) => {
            if (sortBy === 'requests') return b.requests - a.requests;
            if (sortBy === 'errors') return b.errors - a.errors;
            if (sortBy === 'name') return a.name.localeCompare(b.name);
            if (sortBy === 'group') {
                const groupComp = a.group.localeCompare(b.group);
                if (groupComp !== 0) return groupComp;
                return a.name.localeCompare(b.name);
            }
            if (sortBy === 'successRate') return parseFloat(b.successRate) - parseFloat(a.successRate);
            if (sortBy === 'latency') return (b.rtt_ms ?? -1) - (a.rtt_ms ?? -1);
            if (sortBy === 'ttfb') return (b.ttfb_ms ?? -1) - (a.ttfb_ms ?? -1);
            return 0;
        });

    const totalErrors = Object.values(stats.errors_by_app).reduce((a, b) => a + b, 0);
    const overallSuccessRate = stats.total_requests > 0
        ? ((stats.total_requests - totalErrors) / stats.total_requests * 100).toFixed(1)
        : '100.0';

    // 1-Click Promote to DEM
    const handlePromoteToDem = async (appName: string) => {
        setPromotingApp(appName);
        try {
            const res = await fetch('/api/probes/promote-app', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ domain: appName, name: appName })
            });
            const data = await res.json();
            if (data.success) {
                setPromotedApps(prev => ({ ...prev, [appName]: true }));
                setFeedbackMessage({
                    type: 'success',
                    text: data.created
                        ? `✅ Promoted "${appName}" to Synthetic DEM Monitoring (1-min interval)!`
                        : `ℹ️ "${appName}" is already actively monitored in Synthetic Probes.`
                });
            } else {
                setFeedbackMessage({ type: 'error', text: data.error || 'Failed to promote to DEM' });
            }
        } catch (err: any) {
            setFeedbackMessage({ type: 'error', text: err.message || 'Network error' });
        } finally {
            setPromotingApp(null);
            setTimeout(() => setFeedbackMessage(null), 5000);
        }
    };

    return (
        <div className="space-y-6 w-full">
            {/* Feedback notification banner */}
            {feedbackMessage && (
                <div className={`p-4 rounded-xl border flex items-center justify-between text-xs font-bold transition-all shadow-lg animate-in slide-in-from-top-2 duration-200 ${
                    feedbackMessage.type === 'success'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-emerald-950/20'
                        : 'bg-red-500/10 border-red-500/30 text-red-400 shadow-red-950/20'
                }`}>
                    <div className="flex items-center gap-2">
                        {feedbackMessage.type === 'success' ? <Check size={16} /> : <Info size={16} />}
                        <span>{feedbackMessage.text}</span>
                    </div>
                    <button
                        onClick={() => setFeedbackMessage(null)}
                        className="opacity-70 hover:opacity-100 text-xs px-2 py-0.5"
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* Controls */}
            <div className="bg-card border border-border rounded-xl p-4 flex flex-col md:flex-row gap-4 items-center justify-between shadow-sm">
                <div className="relative flex-1 w-full">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                    <input
                        type="text"
                        placeholder="Search applications or groups..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-card-secondary border border-border text-text-primary rounded-lg pl-10 pr-4 py-2 outline-none focus:border-blue-500 transition-colors text-xs"
                    />
                </div>
                {onReset && (
                    <button
                        onClick={onReset}
                        className="px-4 py-2 rounded-lg font-bold bg-red-600/10 text-red-500 hover:bg-red-600 hover:text-white border border-red-500/20 transition-all ml-2 text-xs shadow-sm"
                    >
                        Reset Counters
                    </button>
                )}
            </div>

            {/* Statistics Table */}
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-card-secondary/50 select-none">
                            <tr>
                                <th
                                    className="text-left px-5 py-3.5 text-xs font-black text-text-muted uppercase tracking-wider cursor-pointer hover:bg-card-hover transition-colors"
                                    onClick={() => setSortBy('name')}
                                >
                                    Application {sortBy === 'name' && '↓'}
                                </th>
                                <th
                                    className="text-left px-4 py-3.5 text-xs font-black text-text-muted uppercase tracking-wider cursor-pointer hover:bg-card-hover transition-colors"
                                    onClick={() => setSortBy('group')}
                                >
                                    Group {sortBy === 'group' && '↓'}
                                </th>
                                <th
                                    className="text-right px-4 py-3.5 text-xs font-black text-text-muted uppercase tracking-wider cursor-pointer hover:bg-card-hover transition-colors"
                                    onClick={() => setSortBy('requests')}
                                >
                                    Requests {sortBy === 'requests' && '↓'}
                                </th>
                                <th
                                    className="text-right px-4 py-3.5 text-xs font-black text-text-muted uppercase tracking-wider cursor-pointer hover:bg-card-hover transition-colors"
                                    onClick={() => setSortBy('errors')}
                                >
                                    Errors {sortBy === 'errors' && '↓'}
                                </th>
                                <th
                                    className="text-right px-4 py-3.5 text-xs font-black text-text-muted uppercase tracking-wider cursor-pointer hover:bg-card-hover transition-colors"
                                    onClick={() => setSortBy('latency')}
                                    title="Real-Time Round-Trip Time from live curl background traffic"
                                >
                                    <div className="flex items-center justify-end gap-1">
                                        <Activity size={13} className="text-blue-400" />
                                        <span>Avg Latency {sortBy === 'latency' && '↓'}</span>
                                    </div>
                                </th>
                                <th
                                    className="text-right px-4 py-3.5 text-xs font-black text-text-muted uppercase tracking-wider cursor-pointer hover:bg-card-hover transition-colors"
                                    onClick={() => setSortBy('ttfb')}
                                    title="Time To First Byte — Server Backend Processing Responsiveness"
                                >
                                    <div className="flex items-center justify-end gap-1">
                                        <Server size={13} className="text-purple-400" />
                                        <span>TTFB {sortBy === 'ttfb' && '↓'}</span>
                                    </div>
                                </th>
                                <th
                                    className="text-right px-4 py-3.5 text-xs font-black text-text-muted uppercase tracking-wider cursor-pointer hover:bg-card-hover transition-colors"
                                    onClick={() => setSortBy('successRate')}
                                >
                                    Success Rate {sortBy === 'successRate' && '↓'}
                                </th>
                                <th className="text-center px-4 py-3.5 text-xs font-black text-text-muted uppercase tracking-wider">
                                    DEM Monitor
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                            {filteredStats.map((app, index) => {
                                const isHovered = hoveredApp === app.name;
                                const isPromoted = promotedApps[app.name];
                                const isPromoting = promotingApp === app.name;

                                return (
                                    <tr key={app.name} className="hover:bg-card-secondary/40 transition-colors">
                                        {/* Application Name */}
                                        <td className="px-5 py-3.5">
                                            <div className="flex items-center gap-3">
                                                <span className="text-text-muted font-mono text-xs opacity-60">#{index + 1}</span>
                                                <Favicon domain={app.name} size={18} />
                                                <span className="font-bold text-text-primary text-xs">{app.name}</span>
                                            </div>
                                        </td>

                                        {/* Group */}
                                        <td className="px-4 py-3.5">
                                            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-card-secondary text-text-muted border border-border/80">
                                                {app.group}
                                            </span>
                                        </td>

                                        {/* Requests */}
                                        <td className="px-4 py-3.5 text-right">
                                            <span className="text-blue-500 dark:text-blue-400 font-mono font-bold text-xs">
                                                {app.requests.toLocaleString()}
                                            </span>
                                        </td>

                                        {/* Errors */}
                                        <td className="px-4 py-3.5 text-right">
                                            <span className={`font-mono text-xs font-bold ${app.errors > 0 ? 'text-red-400' : 'text-text-muted opacity-40'}`}>
                                                {app.errors.toLocaleString()}
                                            </span>
                                        </td>

                                        {/* Avg Latency (RTT) with Hover Breakdown Pill */}
                                        <td className="px-4 py-3.5 text-right relative">
                                            {app.rtt_ms !== null ? (
                                                <div
                                                    className="inline-flex items-center gap-1.5 cursor-help"
                                                    onMouseEnter={() => setHoveredApp(app.name)}
                                                    onMouseLeave={() => setHoveredApp(null)}
                                                >
                                                    <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                                                        app.rtt_ms < 50 ? 'bg-emerald-400' :
                                                        app.rtt_ms < 150 ? 'bg-amber-400' : 'bg-red-400'
                                                    }`} />
                                                    <span className={`font-mono text-xs font-black px-2 py-0.5 rounded border ${
                                                        app.rtt_ms < 50
                                                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                                            : app.rtt_ms < 150
                                                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                                            : 'bg-red-500/10 text-red-400 border-red-500/20'
                                                    }`}>
                                                        {app.rtt_ms.toFixed(1)} ms
                                                    </span>

                                                    {/* Floating Telemetry Breakdown Card */}
                                                    {isHovered && (
                                                        <div className="absolute right-0 top-full mt-1 z-30 w-64 p-3 bg-card-secondary/95 backdrop-blur-md border border-blue-500/30 rounded-xl shadow-2xl text-left text-[10px] space-y-1.5 pointer-events-none animate-in fade-in duration-150">
                                                            <div className="flex items-center justify-between border-b border-border/60 pb-1 font-black text-text-primary uppercase tracking-wider">
                                                                <span className="flex items-center gap-1">
                                                                    <Zap size={11} className="text-blue-400" />
                                                                    Curl RUM Timing
                                                                </span>
                                                                <span className="font-mono text-emerald-400">HTTP {app.last_code}</span>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-1.5 pt-0.5 text-text-muted font-mono">
                                                                <div>🌐 DNS: <span className="text-text-primary font-bold">{app.dns_ms.toFixed(1)} ms</span></div>
                                                                <div>🔌 TCP: <span className="text-text-primary font-bold">{app.tcp_ms.toFixed(1)} ms</span></div>
                                                                <div>🔒 TLS: <span className="text-text-primary font-bold">{app.tls_ms.toFixed(1)} ms</span></div>
                                                                <div>⚡ TTFB: <span className="text-purple-400 font-bold">{app.ttfb_ms?.toFixed(1) || '0'} ms</span></div>
                                                            </div>
                                                            <div className="border-t border-border/40 pt-1 flex justify-between font-black text-text-primary">
                                                                <span>Total RTT:</span>
                                                                <span className="text-blue-400 font-mono">{app.rtt_ms.toFixed(1)} ms</span>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-text-muted opacity-30 font-mono text-xs">-</span>
                                            )}
                                        </td>

                                        {/* TTFB (Server Time) */}
                                        <td className="px-4 py-3.5 text-right font-mono text-xs">
                                            {app.ttfb_ms !== null ? (
                                                <span className="text-purple-400 font-bold">
                                                    {app.ttfb_ms.toFixed(1)} ms
                                                </span>
                                            ) : (
                                                <span className="text-text-muted opacity-30">-</span>
                                            )}
                                        </td>

                                        {/* Success Rate */}
                                        <td className="px-4 py-3.5 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <div className="w-20 bg-card-secondary border border-border/80 rounded-full h-1.5 overflow-hidden shadow-inner">
                                                    <div
                                                        className={`h-full transition-all ${
                                                            parseFloat(app.successRate) >= 95 ? 'bg-emerald-500' :
                                                            parseFloat(app.successRate) >= 80 ? 'bg-amber-500' :
                                                            'bg-red-500'
                                                        }`}
                                                        style={{ width: `${app.successRate}%` }}
                                                    />
                                                </div>
                                                <span className={`font-mono font-bold min-w-[3.2rem] text-xs ${
                                                    parseFloat(app.successRate) >= 95 ? 'text-emerald-400' :
                                                    parseFloat(app.successRate) >= 80 ? 'text-amber-400' :
                                                    'text-red-400'
                                                }`}>
                                                    {app.successRate}%
                                                </span>
                                            </div>
                                        </td>

                                        {/* 1-Click Promote to DEM Probe */}
                                        <td className="px-4 py-3.5 text-center">
                                            {isPromoted ? (
                                                <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                    <Check size={10} /> Active DEM
                                                </span>
                                            ) : (
                                                <button
                                                    onClick={() => handlePromoteToDem(app.name)}
                                                    disabled={isPromoting}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/10 hover:bg-blue-600 text-blue-400 hover:text-white border border-blue-500/30 text-[9.5px] font-black uppercase tracking-widest transition-all shadow-sm hover:shadow-blue-900/40 disabled:opacity-50"
                                                    title={`Promote ${app.name} to continuous 1-min Synthetic DEM Monitoring`}
                                                >
                                                    {isPromoting ? (
                                                        <Activity size={10} className="animate-spin" />
                                                    ) : (
                                                        <Plus size={10} />
                                                    )}
                                                    <span>+ DEM</span>
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {filteredStats.length === 0 && (
                    <div className="p-12 text-center text-text-muted">
                        <Search size={48} className="mx-auto mb-4 opacity-20" />
                        <p className="text-sm font-bold">No applications found matching "<span className="text-text-primary">{searchTerm}</span>"</p>
                    </div>
                )}
            </div>

            <div className="text-center text-[10px] text-text-muted font-bold tracking-wider uppercase opacity-70 pb-4">
                Displaying {filteredStats.length} of {appStats.length} applications • Live curl RUM telemetry active
            </div>
        </div>
    );
}
