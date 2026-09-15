import React, { useState, useEffect, useRef } from 'react';
import type { ApiLogEntry } from '../../types/api-studio';
import { ApiLogDetailDrawer } from './ApiLogDetailDrawer';
import { 
    Play, Pause, Trash2, Download, Search, Filter, RefreshCw, 
    Zap, Eye, AlertCircle, ArrowUpRight, ArrowDownLeft, Radio, ShieldCheck 
} from 'lucide-react';
import toast from 'react-hot-toast';

interface ApiLogInspectorProps {
    token: string | null;
    onReplayInPlayground: (log: ApiLogEntry) => void;
}

export const ApiLogInspector: React.FC<ApiLogInspectorProps> = ({ token, onReplayInPlayground }) => {
    const [logs, setLogs] = useState<ApiLogEntry[]>([]);
    const [selectedLog, setSelectedLog] = useState<ApiLogEntry | null>(null);
    const [isPaused, setIsPaused] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | '2xx' | '4xx' | '5xx' | 'errors'>('all');
    const [filterSource, setFilterSource] = useState<string>('all');
    const [filterMethod, setFilterMethod] = useState<string>('all');
    const [autoScroll, setAutoScroll] = useState(true);

    const eventSourceRef = useRef<EventSource | null>(null);
    const logsContainerRef = useRef<HTMLDivElement | null>(null);

    // 1. Fetch recent initial logs from backend
    const fetchRecentLogs = async () => {
        try {
            const res = await fetch('/api/logs/recent?limit=250', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.logs) {
                    setLogs(data.logs);
                }
            }
        } catch (err) {
            console.error('Failed to fetch initial API logs:', err);
        }
    };

    // 2. Connect to Server-Sent Events (SSE) stream
    useEffect(() => {
        fetchRecentLogs();

        const sseUrl = `/api/logs/stream?token=${encodeURIComponent(token || '')}`;
        const es = new EventSource(sseUrl);
        eventSourceRef.current = es;

        es.onopen = () => {
            setIsConnected(true);
        };

        es.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'init') {
                    setIsConnected(true);
                    return;
                }
                if (data.type === 'clear') {
                    setLogs([]);
                    return;
                }

                // If stream is not paused, prepend new log entry
                if (!isPaused) {
                    setLogs(prev => [data, ...prev.slice(0, 499)]);
                }
            } catch (err) {
                // Heartbeat or parse error
            }
        };

        es.onerror = () => {
            setIsConnected(false);
        };

        return () => {
            es.close();
        };
    }, [token, isPaused]);

    // Handle clear logs
    const handleClearLogs = async () => {
        try {
            await fetch('/api/logs/clear', {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setLogs([]);
            setSelectedLog(null);
            toast.success('API logs cleared');
        } catch {
            toast.error('Failed to clear logs');
        }
    };

    // Handle export logs as JSON file
    const handleExportLogs = () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(logs, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `stigix_api_logs_${new Date().toISOString().slice(0, 19)}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        toast.success(`Exported ${logs.length} API logs`);
    };

    // Filter logic
    const filteredLogs = logs.filter(log => {
        // Status filter
        if (filterStatus === '2xx' && (log.statusCode < 200 || log.statusCode >= 300)) return false;
        if (filterStatus === '4xx' && (log.statusCode < 400 || log.statusCode >= 500)) return false;
        if (filterStatus === '5xx' && log.statusCode < 500) return false;
        if (filterStatus === 'errors' && log.statusCode < 400 && !log.error) return false;

        // Source filter
        if (filterSource !== 'all') {
            if (log.source !== filterSource && !(log.scriptName && log.scriptName.includes(filterSource))) {
                return false;
            }
        }

        // Method filter
        if (filterMethod !== 'all' && log.method.toUpperCase() !== filterMethod) {
            return false;
        }

        // Search query
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            const matchUrl = log.url.toLowerCase().includes(query);
            const matchPath = (log.pathname || '').toLowerCase().includes(query);
            const matchMethod = log.method.toLowerCase().includes(query);
            const matchStatus = String(log.statusCode).includes(query);
            const matchScript = (log.scriptName || '').toLowerCase().includes(query);
            const matchError = (log.error || '').toLowerCase().includes(query);
            return matchUrl || matchPath || matchMethod || matchStatus || matchScript || matchError;
        }

        return true;
    });

    const getStatusBadge = (code: number, error?: string) => {
        if (error || code >= 500) {
            return <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-rose-500/15 text-rose-400 border border-rose-500/30">{code || 'ERR'}</span>;
        }
        if (code >= 400) {
            return <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-amber-500/15 text-amber-400 border border-amber-500/30">{code}</span>;
        }
        if (code >= 300) {
            return <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-blue-500/15 text-blue-400 border border-blue-500/30">{code}</span>;
        }
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">{code}</span>;
    };

    const getMethodPill = (method: string) => {
        switch (method.toUpperCase()) {
            case 'GET': return <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">GET</span>;
            case 'POST': return <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono text-blue-400 bg-blue-500/10 border border-blue-500/20">POST</span>;
            case 'PUT': return <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20">PUT</span>;
            case 'DELETE': return <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono text-rose-400 bg-rose-500/10 border border-rose-500/20">DEL</span>;
            case 'PATCH': return <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono text-purple-400 bg-purple-500/10 border border-purple-500/20">PATCH</span>;
            default: return <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono text-gray-400 bg-gray-500/10 border border-gray-500/20">{method}</span>;
        }
    };

    return (
        <div className="flex flex-col h-full bg-card rounded-xl border border-border overflow-hidden shadow-sm">
            {/* Top Toolbar */}
            <div className="p-4 border-b border-border bg-card-header/40 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center space-x-3">
                    <div className="flex items-center space-x-2">
                        <span className="relative flex h-2.5 w-2.5">
                            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                                isPaused ? 'bg-amber-400' : isConnected ? 'bg-emerald-400' : 'bg-rose-400'
                            }`} />
                            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                                isPaused ? 'bg-amber-500' : isConnected ? 'bg-emerald-500' : 'bg-rose-500'
                            }`} />
                        </span>
                        <span className="text-xs font-semibold text-text">
                            {isPaused ? 'Stream Paused' : isConnected ? 'Live Streaming' : 'Connecting...'}
                        </span>
                    </div>
                    <span className="text-xs text-text-muted">|</span>
                    <span className="text-xs font-mono text-text-muted">
                        Showing <strong className="text-text">{filteredLogs.length}</strong> / {logs.length} events
                    </span>
                </div>

                {/* Stream Controls */}
                <div className="flex items-center space-x-2">
                    <button
                        onClick={() => setIsPaused(!isPaused)}
                        className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            isPaused 
                                ? 'bg-amber-500/15 border-amber-500/30 text-amber-400 hover:bg-amber-500/25' 
                                : 'bg-card hover:bg-card-hover border-border text-text'
                        }`}
                        title={isPaused ? "Resume live log streaming" : "Pause live log streaming"}
                    >
                        {isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5" />}
                        <span>{isPaused ? 'Resume' : 'Pause'}</span>
                    </button>

                    <button
                        onClick={fetchRecentLogs}
                        className="p-1.5 bg-card hover:bg-card-hover border border-border rounded-lg text-text-muted hover:text-text transition-colors"
                        title="Refresh logs from buffer"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                    </button>

                    <button
                        onClick={handleClearLogs}
                        className="flex items-center space-x-1.5 px-3 py-1.5 bg-card hover:bg-rose-500/10 hover:border-rose-500/30 hover:text-rose-400 border border-border rounded-lg text-xs font-medium text-text-muted transition-colors"
                        title="Clear all stored logs"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Clear</span>
                    </button>

                    <button
                        onClick={handleExportLogs}
                        className="flex items-center space-x-1.5 px-3 py-1.5 bg-card hover:bg-card-hover border border-border rounded-lg text-xs font-medium text-text-muted hover:text-text transition-colors"
                        title="Download logs as JSON"
                    >
                        <Download className="w-3.5 h-3.5" />
                        <span>Export</span>
                    </button>
                </div>
            </div>

            {/* Filter Bar */}
            <div className="p-3 border-b border-border/70 bg-card-body/30 flex flex-wrap items-center gap-3">
                {/* Search Box */}
                <div className="relative flex-1 min-w-[240px]">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search URL, path, method, status, error..."
                        className="w-full pl-9 pr-3 py-1.5 bg-input border border-input-border rounded-lg text-xs text-text placeholder-text-muted/60 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text text-[10px]"
                        >
                            ✕
                        </button>
                    )}
                </div>

                {/* Status Filter Chips */}
                <div className="flex items-center space-x-1 bg-card border border-border rounded-lg p-1 text-[11px]">
                    {(['all', '2xx', '4xx', '5xx', 'errors'] as const).map(st => (
                        <button
                            key={st}
                            onClick={() => setFilterStatus(st)}
                            className={`px-2 py-0.5 rounded capitalize font-medium transition-colors ${
                                filterStatus === st ? 'bg-blue-600 text-white shadow-sm' : 'text-text-muted hover:text-text'
                            }`}
                        >
                            {st === 'errors' ? 'Errors Only' : st}
                        </button>
                    ))}
                </div>

                {/* Source Filter Dropdown */}
                <div className="flex items-center space-x-1.5">
                    <span className="text-[11px] text-text-muted font-medium">Source:</span>
                    <select
                        value={filterSource}
                        onChange={(e) => setFilterSource(e.target.value)}
                        className="bg-input border border-input-border rounded-lg px-2.5 py-1 text-xs text-text focus:outline-none"
                    >
                        <option value="all">All Sources</option>
                        <option value="node">Node.js (Inbound & Outbound)</option>
                        <option value="python">Python (getflow / prisma_apps / etc.)</option>
                        <option value="vyos">VyOS Router API</option>
                        <option value="probe">Security Probes</option>
                    </select>
                </div>

                {/* Method Filter Dropdown */}
                <div className="flex items-center space-x-1.5">
                    <span className="text-[11px] text-text-muted font-medium">Method:</span>
                    <select
                        value={filterMethod}
                        onChange={(e) => setFilterMethod(e.target.value)}
                        className="bg-input border border-input-border rounded-lg px-2.5 py-1 text-xs text-text focus:outline-none font-mono"
                    >
                        <option value="all">ALL</option>
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="DELETE">DELETE</option>
                        <option value="PATCH">PATCH</option>
                    </select>
                </div>
            </div>

            {/* Table of Live API Transactions */}
            <div ref={logsContainerRef} className="flex-1 overflow-y-auto font-mono text-xs">
                {filteredLogs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-center text-text-muted">
                        <Radio className="w-10 h-10 mb-2 opacity-30 text-blue-400 animate-pulse" />
                        <p className="text-sm font-semibold text-text">No API transactions captured yet</p>
                        <p className="text-xs max-w-sm mt-1">
                            Trigger a topology discovery, run a security probe, query flows, or compose a test request in the API Playground.
                        </p>
                    </div>
                ) : (
                    <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-card-header/90 backdrop-blur border-b border-border text-[11px] text-text-muted uppercase tracking-wider select-none z-10">
                            <tr>
                                <th className="p-3 pl-4 w-20">Time</th>
                                <th className="p-3 w-16">Status</th>
                                <th className="p-3 w-16">Method</th>
                                <th className="p-3 w-28">Source</th>
                                <th className="p-3">Path / Endpoint</th>
                                <th className="p-3 w-24 text-right">Latency</th>
                                <th className="p-3 pr-4 w-28 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                            {filteredLogs.map((log) => {
                                const isSelected = selectedLog?.id === log.id;
                                const isError = log.statusCode >= 400 || !!log.error;
                                return (
                                    <tr
                                        key={log.id}
                                        onClick={() => setSelectedLog(log)}
                                        className={`cursor-pointer transition-colors ${
                                            isSelected 
                                                ? 'bg-blue-600/10 border-l-2 border-blue-500' 
                                                : isError 
                                                    ? 'hover:bg-rose-500/5' 
                                                    : 'hover:bg-card-hover/50'
                                        }`}
                                    >
                                        <td className="p-3 pl-4 text-text-muted whitespace-nowrap text-[11px]">
                                            {new Date(log.timestamp).toLocaleTimeString()}
                                        </td>
                                        <td className="p-3 whitespace-nowrap">
                                            {getStatusBadge(log.statusCode, log.error)}
                                        </td>
                                        <td className="p-3 whitespace-nowrap">
                                            {getMethodPill(log.method)}
                                        </td>
                                        <td className="p-3 whitespace-nowrap text-text-muted text-[11px]">
                                            <span className="flex items-center space-x-1">
                                                {log.direction === 'outbound' ? (
                                                    <ArrowUpRight className="w-3 h-3 text-blue-400 shrink-0" />
                                                ) : (
                                                    <ArrowDownLeft className="w-3 h-3 text-emerald-400 shrink-0" />
                                                )}
                                                <span className="truncate max-w-[90px]" title={log.scriptName || log.source}>
                                                    {log.scriptName || log.source}
                                                </span>
                                            </span>
                                        </td>
                                        <td className="p-3 text-text truncate max-w-md">
                                            <span className="font-semibold text-text mr-1">
                                                {log.pathname || log.url}
                                            </span>
                                            {log.url.startsWith('http') && (
                                                <span className="text-[10px] text-text-muted font-normal block truncate">
                                                    {log.url}
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-3 text-right whitespace-nowrap text-[11px] text-text-muted">
                                            <span className={log.durationMs > 1000 ? 'text-amber-400 font-semibold' : 'text-text-muted'}>
                                                {log.durationMs}ms
                                            </span>
                                        </td>
                                        <td className="p-3 pr-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                            <div className="flex items-center justify-end space-x-1">
                                                <button
                                                    onClick={() => onReplayInPlayground(log)}
                                                    className="p-1 px-2 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-500/20 rounded text-[10px] font-semibold flex items-center space-x-1 transition-colors"
                                                    title="Replay in API Playground"
                                                >
                                                    <Zap className="w-3 h-3" />
                                                    <span>Replay</span>
                                                </button>
                                                <button
                                                    onClick={() => setSelectedLog(log)}
                                                    className="p-1 text-text-muted hover:text-text rounded transition-colors"
                                                    title="Inspect Details"
                                                >
                                                    <Eye className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Slide-over Detail Drawer */}
            <ApiLogDetailDrawer
                log={selectedLog}
                onClose={() => setSelectedLog(null)}
                onReplay={(l) => onReplayInPlayground(l)}
            />
        </div>
    );
};
