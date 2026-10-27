import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Download, Trash2, Filter, ChevronDown, Activity, X } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { triggerFileDownload } from '../utils/download';

interface LogEntry {
    type: string;
    timestamp: string;
    level: string;
    message: string;
    device_id: string;
}

interface LogViewerProps {
    deviceId: string;
    deviceName: string;
    onClose?: () => void;
}

export default function LogViewer({ deviceId, deviceName, onClose }: LogViewerProps) {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [filter, setFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');
    const [autoScroll, setAutoScroll] = useState(true);
    const logContainerRef = useRef<HTMLDivElement>(null);
    const socketRef = useRef<Socket | null>(null);

    useEffect(() => {
        // Initialize socket connection
        const socket = io();
        socketRef.current = socket;

        socket.emit('join-device-logs', deviceId);

        socket.on('initial-logs', (data) => {
            if (data.device_id === deviceId) {
                setLogs(data.logs);
            }
        });

        socket.on('device:log', (log: LogEntry) => {
            if (log.device_id === deviceId) {
                setLogs(prev => {
                    const next = [...prev, log];
                    if (next.length > 200) return next.slice(-200);
                    return next;
                });
            }
        });

        return () => {
            socket.emit('leave-device-logs', deviceId);
            socket.disconnect();
        };
    }, [deviceId]);

    useEffect(() => {
        if (autoScroll && logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs, autoScroll]);

    const filteredLogs = logs.filter(log => {
        if (filter === 'all') return true;
        if (filter === 'error') return log.level === 'error';
        if (filter === 'warn') return log.level === 'warning' || log.level === 'warn';
        if (filter === 'info') return log.level === 'info';
        return true;
    });

    const exportLogs = () => {
        const date = new Date().toISOString().split('T')[0];
        triggerFileDownload(logs, `SDWAN-IoT-Log-${deviceId}-${date}.json`, 'application/json');
    };

    const getLevelColor = (level: string) => {
        switch (level.toLowerCase()) {
            case 'error': return 'text-red-500 dark:text-red-400';
            case 'warning':
            case 'warn': return 'text-orange-500 dark:text-orange-400';
            case 'info': return 'text-blue-600 dark:text-blue-400';
            default: return 'text-text-muted';
        }
    };

    const formatTimestamp = (ts: string) => {
        try {
            return new Date(ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch {
            return ts;
        }
    };

    return (
        <div className="flex flex-col h-full bg-card rounded-2xl overflow-hidden border border-border shadow-2xl">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-3 bg-card-secondary border-b border-border">
                <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-blue-600/10 rounded-lg">
                        <Terminal size={16} className="text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                        <h4 className="text-sm font-bold text-text-primary uppercase tracking-tight">{deviceName} Logs</h4>
                        <p className="text-[10px] text-text-muted font-mono font-bold uppercase tracking-widest">{deviceId}</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Filter Dropdown */}
                    <div className="relative group">
                        <button className="flex items-center gap-1.5 px-2 py-1.5 bg-card hover:bg-card-hover text-[10px] font-bold text-text-muted rounded-lg transition-all border border-border uppercase tracking-widest">
                            <Filter size={12} />
                            {filter.toUpperCase()}
                            <ChevronDown size={10} />
                        </button>
                        <div className="absolute right-0 top-full mt-1 w-32 bg-card border border-border rounded-lg shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-all z-20 overflow-hidden">
                            {(['all', 'info', 'warn', 'error'] as const).map(f => (
                                <button
                                    key={f}
                                    onClick={() => setFilter(f)}
                                    className="w-full text-left px-3 py-2 text-[10px] font-bold text-text-muted hover:bg-card-hover hover:text-text-primary transition-colors border-b border-border last:border-0 uppercase tracking-widest"
                                >
                                    {f}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="w-px h-4 bg-border mx-1" />

                    <button
                        onClick={() => setAutoScroll(!autoScroll)}
                        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all border uppercase tracking-widest ${autoScroll ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400 border-blue-500/20' : 'bg-card text-text-muted border-border'}`}
                    >
                        <Activity size={12} className={autoScroll ? 'animate-pulse' : ''} />
                        AUTO-SCROLL
                    </button>

                    <button
                        onClick={exportLogs}
                        className="p-1.5 bg-card hover:bg-card-hover text-text-muted hover:text-text-primary rounded-lg transition-all border border-border shadow-sm"
                        title="Export Logs"
                    >
                        <Download size={14} />
                    </button>

                    <button
                        onClick={() => setLogs([])}
                        className="p-1.5 bg-card hover:bg-red-500/10 text-text-muted hover:text-red-500 rounded-lg transition-all border border-border shadow-sm"
                        title="Clear View"
                    >
                        <Trash2 size={14} />
                    </button>

                    {onClose && (
                        <button
                            onClick={onClose}
                            className="p-1.5 bg-card hover:bg-card-hover text-text-muted hover:text-text-primary rounded-lg transition-all border border-border shadow-sm"
                            title="Close Terminal"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>

            {/* Log Display */}
            <div
                ref={logContainerRef}
                className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent bg-[#1e1e1e] text-gray-300 font-bold"
                onWheel={() => setAutoScroll(false)}
            >
                {filteredLogs.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-text-muted space-y-2 opacity-30">
                        <Terminal size={32} />
                        <p className="uppercase tracking-widest font-black text-[10px]">No log entries found for this device</p>
                    </div>
                ) : (
                    filteredLogs.map((log, i) => (
                        <div key={i} className="flex gap-3 py-0.5 group">
                            <span className="text-text-muted dark:text-slate-600 shrink-0 select-none opacity-60">[{formatTimestamp(log.timestamp)}]</span>
                            <span className={`font-black shrink-0 uppercase w-10 select-none ${getLevelColor(log.level)}`}>{log.level.substring(0, 4)}</span>
                            <span className="font-mono text-gray-300 break-all">{log.message}</span>
                        </div>
                    ))
                )}
            </div>

            {/* Footer / Status */}
            <div className="px-4 py-1.5 bg-card-secondary border-t border-border flex items-center justify-between">
                <span className="text-[9px] font-black text-text-muted tracking-widest uppercase opacity-70">
                    Lines: {filteredLogs.length} / {logs.length}
                </span>
                <span className="text-[9px] font-black text-text-muted tracking-widest uppercase flex items-center gap-1 opacity-70">
                    Streaming Active <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                </span>
            </div>
        </div>
    );
}
