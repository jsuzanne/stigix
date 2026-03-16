import React, { useEffect, useState, useRef } from 'react';
import { Terminal, Search, Trash2, Pause, Play, Download, Wifi, WifiOff } from 'lucide-react';
import { io } from 'socket.io-client';

export default function LiveEvents({ token }: { token: string | null }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [isPaused, setIsPaused] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<any>(null);

  useEffect(() => {
    // Fetch History
    fetch('/api/admin/system/logs', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
      if (data.logs) setLogs(data.logs);
    })
    .catch(err => console.error("Failed to fetch logs:", err));

    // Initialize Socket
    socketRef.current = io();

    socketRef.current.on('connect', () => setIsConnected(true));
    socketRef.current.on('disconnect', () => setIsConnected(false));

    socketRef.current.on('system:log', (line: string) => {
      if (!isPaused) {
        setLogs(prev => [line, ...prev].slice(0, 2000));
      }
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [token]);

  // Handle Pause/Resume - We don't want to re-init socket on pause
  useEffect(() => {
    if (!socketRef.current) return;
    
    // Clear old listener and re-attach with current isPaused state
    socketRef.current.off('system:log');
    socketRef.current.on('system:log', (line: string) => {
      if (!isPaused) {
        setLogs(prev => [line, ...prev].slice(0, 2000));
      }
    });
  }, [isPaused]);

  const filteredLogs = logs.filter(log => 
    log.toLowerCase().includes(filter.toLowerCase())
  );

  const clearLogs = () => setLogs([]);

  const downloadLogs = () => {
    const content = logs.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stigix-logs-${new Date().toISOString()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-160px)] animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 bg-card border border-border p-5 rounded-2xl shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-500/10 rounded-xl text-blue-500 shadow-inner">
            <Terminal size={24} />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-tight text-text-primary flex items-center gap-2">
              Live Events
              {isConnected ? (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-green-500/10 text-green-500 text-[8px] font-black uppercase tracking-widest rounded-full border border-green-500/20">
                  <Wifi size={10} /> Live
                </span>
              ) : (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-red-500/10 text-red-500 text-[8px] font-black uppercase tracking-widest rounded-full border border-red-500/20">
                  <WifiOff size={10} /> Offline
                </span>
              )}
            </h2>
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mt-0.5">Real-time system-wide log streaming</p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 md:flex-none">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted opacity-50" size={16} />
            <input 
              type="text" 
              placeholder="Search keyword..." 
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bg-card-secondary/50 border border-border/50 rounded-xl pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-full md:w-64 transition-all"
            />
          </div>
          
          <div className="flex items-center gap-2 bg-card-secondary/30 p-1 rounded-xl border border-border/40">
            <button 
              onClick={() => setIsPaused(!isPaused)}
              title={isPaused ? "Resume Streaming" : "Pause Streaming"}
              className={`p-2 rounded-lg transition-all flex items-center gap-2 text-xs font-black uppercase tracking-widest px-3 ${
                isPaused 
                  ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' 
                  : 'text-text-muted hover:text-text-primary hover:bg-white/5'
              }`}
            >
              {isPaused ? <><Play size={16} fill="currentColor" /> Resumed</> : <><Pause size={16} fill="currentColor" /> Stream</>}
            </button>

            <button 
              onClick={downloadLogs}
              title="Download Logs"
              className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-white/5 transition-all"
            >
              <Download size={18} />
            </button>

            <div className="w-px h-4 bg-border/50 mx-1" />

            <button 
              onClick={clearLogs}
              title="Clear View"
              className="p-2 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/5 transition-all"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Log Terminal Container */}
      <div className="flex-1 bg-black/90 dark:bg-[#0a0f18] rounded-2xl border border-white/5 overflow-hidden flex flex-col shadow-2xl relative">
        <div className="bg-white/5 px-4 py-3 border-b border-white/5 flex items-center justify-between backdrop-blur-md">
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500/60 shadow-[0_0_8px_rgba(239,68,68,0.2)]" />
            <div className="w-3 h-3 rounded-full bg-amber-500/60 shadow-[0_0_8px_rgba(245,158,11,0.2)]" />
            <div className="w-3 h-3 rounded-full bg-green-500/60 shadow-[0_0_8px_rgba(34,197,94,0.2)]" />
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[10px] font-mono text-white/20 uppercase tracking-[0.3em]">stigix-bash — 80x24</span>
            <div className="h-4 w-px bg-white/5" />
            <span className="text-[10px] font-mono text-blue-400/50 uppercase tracking-widest">{filteredLogs.length} Events</span>
          </div>
        </div>

        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-6 font-mono text-xs leading-relaxed selection:bg-blue-500/30 selection:text-white custom-scrollbar"
        >
          {filteredLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-white/10 gap-4">
              <Terminal size={48} className="opacity-10 animate-pulse" />
              <p className="italic font-bold tracking-widest text-[10px] uppercase">
                {filter ? "No results found matching your search" : "Waiting for system events..."}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredLogs.map((log, i) => {
                const isError = log.includes('[ERROR]') || log.includes('FAILED') || log.toLowerCase().includes('error') || log.includes('ERR ');
                const isWarn = log.includes('[WARN]') || log.toLowerCase().includes('warn');
                const isInfo = log.includes('[INFO]') || log.includes('SUCCESS') || log.includes('🚀');
                const isService = log.includes('| '); // supervisord style
                
                return (
                  <div key={i} className={`group py-1 border-l-2 pl-4 transition-all border-white/5 hover:border-white/20 hover:bg-white/[0.02] ${
                    isError ? 'border-red-500/50 text-red-400/90' : 
                    isWarn ? 'border-amber-500/50 text-amber-400/90' : 
                    isInfo ? 'border-blue-500/40 text-blue-300/90' :
                    'text-white/60'
                  }`}>
                    <div className="flex items-start gap-3">
                      <span className="opacity-20 flex-shrink-0 tabular-nums text-[10px] group-hover:opacity-40 transition-opacity">
                        {new Date().toLocaleTimeString('en-GB', { hour12: false })}
                      </span>
                      <span className="break-words w-full select-all">{log}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        
        {/* Subtle overlay when paused */}
        {isPaused && (
          <div className="absolute inset-x-0 bottom-0 py-2 bg-amber-500/10 border-t border-amber-500/20 backdrop-blur-sm flex items-center justify-center gap-2">
            <Pause size={12} className="text-amber-500 animate-pulse" />
            <span className="text-[9px] font-black text-amber-500 uppercase tracking-[0.2em]">Stream Paused — New events buffered</span>
          </div>
        )}
      </div>
    </div>
  );
}
