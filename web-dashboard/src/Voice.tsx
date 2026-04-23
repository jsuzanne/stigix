import React, { useState, useEffect } from 'react';
import { Phone, Play, Pause, BarChart2, Save, Plus, Trash2, Clock, Activity, Wifi, Search, CheckSquare, AlertCircle, Hash, Download, Upload } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import toast from 'react-hot-toast';
import { isValidIpOrFqdn } from './utils/validation';

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

// CALL-0000 -> src port 30000,  CALL-9999 -> 39999
const deriveSourcePort = (callId: string): string => {
    if (callId && callId.startsWith('CALL-')) {
        const num = parseInt(callId.substring(5), 10);
        if (!isNaN(num)) return (30000 + (num % 10000)).toString();
    }
    return '?';
};

const CallProgress = ({ duration, seenAt }: { duration: number, seenAt: number }) => {
    const [, setTick] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(timer);
    }, []);

    const elapsedSec = Math.min(duration, Math.floor((Date.now() - seenAt) / 1000));
    const remaining = Math.max(0, duration - elapsedSec);
    const progress = Math.min(100, Math.max(0, (elapsedSec / duration) * 100));

    return (
        <div className="mt-3 space-y-1.5">
            <div className="flex justify-between items-center text-[8px] font-black text-text-muted uppercase tracking-widest opacity-80">
                <span className="flex items-center gap-1"><Clock size={8} className="text-blue-500" /> Progress</span>
                <span className={`font-mono ${remaining === 0 ? 'text-text-muted italic' : 'text-blue-500'}`}>
                    {remaining === 0 ? 'ending…' : `${remaining} sec`}
                </span>
            </div>
            <div className="h-1 w-full bg-blue-500/10 rounded-full overflow-hidden border border-blue-500/5">
                <div
                    className="h-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.3)] transition-all duration-300 ease-linear"
                    style={{ width: `${progress}%` }}
                />
            </div>
        </div>
    );
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

interface TargetRow {
    id: string;
    name: string;
    host: string;
    port: string;
    codec: string;
    weight: string;
    duration: string;
    enabled: boolean;
    isManual: boolean;
}

const CODEC_OPTIONS = ['G.711-ulaw', 'G.711-alaw', 'G.729', 'OPUS'];

const qualityOf = (avgLoss: number, avgRtt: number) =>
    avgLoss < 1 && avgRtt < 100 ? 'excellent' : avgLoss < 5 && avgRtt < 200 ? 'fair' : 'poor';

const qualityDotClass = (q: string) =>
    q === 'excellent' ? 'bg-green-500' : q === 'fair' ? 'bg-orange-500' : 'bg-red-500';

const qualityTextClass = (q: string) =>
    q === 'excellent' ? 'text-green-500' : q === 'fair' ? 'text-orange-500' : 'text-red-500';

export default function Voice(props: VoiceProps) {
    const { token, externalStatus } = props;

    // ── Core state ──
    const [enabled, setEnabled] = useState(false);
    const [config, setConfig] = useState<VoiceControl | null>(null);
    const [rawServers, setRawServers] = useState('');
    const [calls, setCalls] = useState<VoiceCall[]>([]);
    // Tracks browser wall-clock time when each call_id first appeared — avoids server timezone issues
    const seenAtMap = React.useRef<Map<string, number>>(new Map());
    const [loading, setLoading] = useState(true);
    const [isDirty, setIsDirty] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');
    const autoSaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [isStartingV, setIsStartingV] = useState(false);
    const [isStoppingV, setIsStoppingV] = useState(false);

    // ── Call history filters ──
    const [searchTerm, setSearchTerm] = useState('');
    const [qualityFilter, setQualityFilter] = useState<'all' | 'excellent' | 'fair' | 'poor'>('all');
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({ key: 'timestamp', direction: 'desc' });

    // ── Target rows (merged registry + manual) ──
    const [targetRows, setTargetRows] = useState<TargetRow[]>([]);
    const [registryVoiceTargets, setRegistryVoiceTargets] = useState<any[]>([]);
    const [excludedCount, setExcludedCount] = useState(0);
    const [voiceTargetsLoaded, setVoiceTargetsLoaded] = useState(false);
    const [configLoaded, setConfigLoaded] = useState(false);

    // ── New manual row form ──
    const [newRow, setNewRow] = useState({ host: '', port: '6100', codec: 'G.711-ulaw', weight: '50', duration: '30' });

    // ════════════════════════════════════════════════
    // Reachability polling
    // ════════════════════════════════════════════════
    const [reachability, setReachability] = useState<Record<string, boolean | 'loading'>>({});

    useEffect(() => {
        if (!targetRows.length) return;
        const checkTargets = async () => {
            const targetsToPing = targetRows.map(r => ({ host: r.host, port: r.port, id: r.id }));
            
            for (const t of targetsToPing) {
                setReachability(prev => ({ ...prev, [t.id]: 'loading' }));
                try {
                    const res = await fetch('/api/convergence/reachability', {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ host: t.host, port: parseInt(t.port, 10) })
                    });
                    const data = await res.json();
                    setReachability(prev => ({ ...prev, [t.id]: !!data.reachable }));
                } catch {
                    setReachability(prev => ({ ...prev, [t.id]: false }));
                }
            }
        };
        
        checkTargets();
        const interval = setInterval(checkTargets, 60000);
        return () => clearInterval(interval);
    }, [targetRows, token]);

    // ════════════════════════════════════════════════
    // External status feed (WebSocket / poll from parent)
    // ════════════════════════════════════════════════
    useEffect(() => {
        if (!externalStatus) return;
        if (externalStatus.stats) {
            // Record browser-local 'seenAt' for any new call_id that we haven't seen before
            (externalStatus.stats as VoiceCall[]).forEach(c => {
                if (c.event === 'start' && !seenAtMap.current.has(c.call_id)) {
                    seenAtMap.current.set(c.call_id, Date.now());
                }
            });
            setCalls(externalStatus.stats);
        }
        if (externalStatus.control && !isDirty) {
            setEnabled(externalStatus.control.enabled);
            setConfig(prev => ({ ...prev, ...externalStatus.control }));
        }
    }, [externalStatus, isDirty]);

    // ════════════════════════════════════════════════
    // Initial load
    // ════════════════════════════════════════════════
    useEffect(() => {
        fetchConfig();
        const interval = setInterval(fetchConfig, 30000);

        fetch('/api/targets', { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.json())
            .then((data: any[]) => {
                const all = Array.isArray(data) ? data : [];
                const withVoice = all.filter(t => t.enabled && t.capabilities?.voice);
                const withoutVoice = all.filter(t => t.enabled && !t.capabilities?.voice).length;
                setRegistryVoiceTargets(withVoice);
                setExcludedCount(withoutVoice);
                setVoiceTargetsLoaded(true);
            })
            .catch(() => setVoiceTargetsLoaded(true));

        return () => clearInterval(interval);
    }, [token]);

    // ════════════════════════════════════════════════
    // Build targetRows when both data sources are ready
    // Skipped if isDirty (user has unsaved edits)
    // ════════════════════════════════════════════════
    useEffect(() => {
        if (!voiceTargetsLoaded || !configLoaded || isDirty) return;

        // Parse rawServers string into a map keyed by "host:port"
        const serverMap = new Map<string, { codec: string; weight: string; duration: string }>();
        rawServers.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const parts = trimmed.split('|');
            serverMap.set(parts[0], {
                codec: parts[1] || 'G.711-ulaw',
                weight: parts[2] || '50',
                duration: parts[3] || '30',
            });
        });

        // Registry targets first
        const rows: TargetRow[] = registryVoiceTargets.map(t => {
            const key = `${t.host}:${t.ports?.voice ?? 6100}`;
            const settings = serverMap.get(key);
            serverMap.delete(key); // mark consumed — leftover = manual
            // Use the registry name, but if it looks like a raw IP (no letters), show host as fallback label
            const isIpName = /^[\d.]+$/.test(t.name);
            const displayName = isIpName ? t.host : t.name;
            return {
                id: t.id,
                name: displayName,
                host: t.host,
                port: String(t.ports?.voice ?? 6100),
                codec: settings?.codec || 'G.711-ulaw',
                weight: settings?.weight || '50',
                duration: settings?.duration || '30',
                enabled: !!settings,
                isManual: false,
            };
        });

        // Remaining rawServers lines that don't match any registry target → manual rows
        serverMap.forEach((settings, target) => {
            const colonIdx = target.lastIndexOf(':');
            rows.push({
                id: `manual-${target}`,
                name: target,
                host: colonIdx >= 0 ? target.slice(0, colonIdx) : target,
                port: colonIdx >= 0 ? target.slice(colonIdx + 1) : '6100',
                ...settings,
                enabled: true,
                isManual: true,
            });
        });

        setTargetRows(rows);
    }, [voiceTargetsLoaded, configLoaded, isDirty, rawServers, registryVoiceTargets]);

    // ════════════════════════════════════════════════
    // API helpers
    // ════════════════════════════════════════════════
    const fetchConfig = async () => {
        try {
            const r = await fetch('/api/voice/config', { headers: { Authorization: `Bearer ${token}` } });
            const data = await r.json();
            if (data.success) {
                if (!isDirty) setRawServers(data.servers);
                if (!isDirty) setConfig((prev: any) => ({ ...prev, ...data }));
                setLoading(false);
                setConfigLoaded(true);
            }
        } catch {
            setLoading(false);
            setConfigLoaded(true);
        }
    };

    const handleExport = async () => {
        try {
            const r = await fetch('/api/voice/config/export', { headers: { Authorization: `Bearer ${token}` } });
            const blob = await r.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `voice-config-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a); a.click(); a.remove();
        } catch { }
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const cfg = JSON.parse(await file.text());
            const r = await fetch('/api/voice/config/import', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ config: cfg }),
            });
            const data = await r.json();
            if (r.ok && data.success) { fetchConfig(); toast.success('✓ Voice configuration imported'); }
            else toast.error(`❌ Import failed: ${data.error || 'Server error'}`);
        } catch (e: any) { toast.error(`❌ Import failed: ${e.message}`); }
    };

    const handleToggle = async () => {
        const target = !enabled;
        if (target) setIsStartingV(true); else setIsStoppingV(true);
        try {
            const r = await fetch('/api/voice/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ enabled: target }),
            });
            const data = await r.json();
            if (data.success) setEnabled(data.enabled);
        } catch { } finally { setIsStartingV(false); setIsStoppingV(false); }
    };

    const resetIds = async () => {
        if (!confirm('Reset CALL-XXXX counter to CALL-0000?')) return;
        try { await fetch('/api/voice/counter', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }); } catch { }
    };

    const resetLogs = async () => {
        if (!confirm('Reset all voice call history?')) return;
        try { await fetch('/api/voice/stats', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }); } catch { }
    };

    const buildRawServers = (rows: TargetRow[]) =>
        rows.filter(r => r.enabled).map(r => `${r.host}:${r.port}|${r.codec}|${r.weight}|${r.duration}`).join('\n');

    // Shared save function (called by auto-save timer)
    const performSave = async (rows: TargetRow[], ctrl: VoiceControl | null) => {
        setSaveStatus('saving');
        const servers = buildRawServers(rows);
        try {
            const r = await fetch('/api/voice/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ servers, control: ctrl }),
            });
            if (r.ok) {
                setRawServers(servers);
                setIsDirty(false);
                setSaveStatus('saved');
                setTimeout(() => setSaveStatus('idle'), 2500);
            } else {
                setSaveStatus('error');
                setTimeout(() => setSaveStatus('idle'), 3000);
            }
        } catch {
            setSaveStatus('error');
            setTimeout(() => setSaveStatus('idle'), 3000);
        }
    };

    // ════════════════════════════════════════════════
    // Auto-save with 1.5s debounce on any dirty change
    // ════════════════════════════════════════════════
    useEffect(() => {
        if (!isDirty) return;
        setSaveStatus('pending');
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = setTimeout(() => {
            // Capture current values via functional access to avoid stale closure issues
            setTargetRows(rows => {
                setConfig(ctrl => {
                    performSave(rows, ctrl);
                    return ctrl;
                });
                return rows;
            });
        }, 1500);
        return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
    }, [isDirty, targetRows, config]);

    // ════════════════════════════════════════════════
    // Row manipulation
    // ════════════════════════════════════════════════
    const updateRow = (id: string, field: keyof TargetRow, value: any) => {
        setIsDirty(true);
        setTargetRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    };

    const toggleRow = (id: string) => {
        setIsDirty(true);
        setTargetRows(prev => prev.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
    };

    const removeRow = (id: string) => {
        setIsDirty(true);
        setTargetRows(prev => prev.filter(r => r.id !== id));
    };

    const addManualRow = () => {
        if (!newRow.host || !isValidIpOrFqdn(newRow.host)) { toast.error('Invalid host / IP format'); return; }
        const row: TargetRow = {
            id: `manual-${newRow.host}:${newRow.port}-${Date.now()}`,
            name: `${newRow.host}:${newRow.port}`,
            host: newRow.host, port: newRow.port,
            codec: newRow.codec, weight: newRow.weight, duration: newRow.duration,
            enabled: true, isManual: true,
        };
        setTargetRows(prev => [...prev, row]);
        setNewRow({ host: '', port: '6100', codec: 'G.711-ulaw', weight: '50', duration: '30' });
        setIsDirty(true);
    };

    // ════════════════════════════════════════════════
    // Derived / computed
    // ════════════════════════════════════════════════
    const enabledRows = targetRows.filter(r => r.enabled);

    const activeCalls = React.useMemo(() => {
        const endedIds = new Set(calls.filter(c => c.event === 'end').map(c => c.call_id));
        return calls.filter(c => c.event === 'start' && !endedIds.has(c.call_id));
    }, [calls]);

    const qosSummary = React.useMemo(() => {
        const fin = calls.filter(c => c.event === 'end' && c.loss_pct !== undefined);
        if (!fin.length) return null;
        const loss = fin.reduce((a, c) => a + (c.loss_pct || 0), 0) / fin.length;
        const rtts = fin.map(c => c.avg_rtt_ms || 0).filter(Boolean);
        const jitters = fin.map(c => c.jitter_ms || 0).filter(Boolean);
        const mos = fin.map(c => c.mos_score || 0).filter(Boolean);
        const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        return {
            totalCalls: fin.length,
            avgLoss: loss.toFixed(1),
            avgRtt: avg(rtts).toFixed(1),
            minRtt: rtts.length ? Math.min(...rtts).toFixed(1) : '0',
            maxRtt: rtts.length ? Math.max(...rtts).toFixed(1) : '0',
            avgJitter: avg(jitters).toFixed(1),
            avgMos: mos.length ? avg(mos).toFixed(2) : 'N/A',
        };
    }, [calls]);

    const perTargetStats = React.useMemo(() => {
        const fin = calls.filter(c => c.event === 'end' && c.loss_pct !== undefined);
        const grouped = new Map<string, VoiceCall[]>();
        fin.forEach(c => { if (!grouped.has(c.target)) grouped.set(c.target, []); grouped.get(c.target)!.push(c); });
        const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        return Array.from(grouped.entries()).map(([target, tCalls]) => {
            const avgLoss = avg(tCalls.map(c => c.loss_pct || 0));
            const avgRtt = avg(tCalls.map(c => c.avg_rtt_ms || 0).filter(Boolean));
            const avgJitter = avg(tCalls.map(c => c.jitter_ms || 0).filter(Boolean));
            const avgMos = avg(tCalls.map(c => c.mos_score || 0).filter(Boolean));
            const row = targetRows.find(r => `${r.host}:${r.port}` === target);
            return {
                target,
                name: (!row?.isManual && row?.name) ? row.name : target,
                totalCalls: tCalls.length,
                avgLoss: avgLoss.toFixed(1),
                avgRtt: avgRtt.toFixed(1),
                avgJitter: avgJitter.toFixed(1),
                avgMos: avgMos > 0 ? avgMos.toFixed(2) : 'N/A',
                quality: qualityOf(avgLoss, avgRtt),
            };
        }).sort((a, b) => b.totalCalls - a.totalCalls);
    }, [calls, targetRows]);

    // Map host:port -> friendly site name for history table
    const targetNameMap = React.useMemo(() => {
        const map = new Map<string, string>();
        targetRows.forEach(r => {
            if (!r.isManual && r.name) map.set(`${r.host}:${r.port}`, r.name);
        });
        return map;
    }, [targetRows]);

    const handleSort = (key: string) => {
        setSortConfig(prev => ({ key, direction: prev?.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
    };

    const sortedHistory = React.useMemo(() => {
        return [...calls]
            .filter(c => ['start', 'end', 'skipped'].includes(c.event))
            .filter(c => {
                const matchSearch = c.call_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    c.target.toLowerCase().includes(searchTerm.toLowerCase());
                if (!matchSearch) return false;
                if (qualityFilter !== 'all' && c.event === 'end') {
                    return qualityOf(c.loss_pct || 0, c.avg_rtt_ms || 0) === qualityFilter;
                }
                return true;
            })
            .sort((a: any, b: any) => {
                if (!sortConfig) return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
                const av = a[sortConfig.key] ?? 0, bv = b[sortConfig.key] ?? 0;
                if (av < bv) return sortConfig.direction === 'asc' ? -1 : 1;
                if (av > bv) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
    }, [calls, searchTerm, qualityFilter, sortConfig]);

    // ════════════════════════════════════════════════
    // Render
    // ════════════════════════════════════════════════
    return (
        <div className="space-y-6">

            {/* ─── HEADER ─── */}
            <div className="bg-card border border-border rounded-2xl p-8 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none"><Phone size={120} /></div>

                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-8 relative z-10">

                    {/* Left: title + runtime controls */}
                    <div className="flex-1 space-y-5">
                        <div className="flex items-center gap-5">
                            <div className={cn(
                                "p-5 rounded-2xl shadow-xl transition-all border",
                                enabled ? "bg-blue-600 text-white shadow-blue-900/30 border-blue-500/20" : "bg-card-secondary text-text-muted border-border"
                            )}>
                                <Phone size={30} className={cn(enabled && "animate-pulse")} />
                            </div>
                            <div>
                                <div className="flex items-center gap-3 mb-1">
                                    <h2 className="text-2xl font-black text-text-primary tracking-tight">VoIP Simulation</h2>
                                    <span className={cn(
                                        "px-2 py-0.5 rounded-full text-[10px] font-black tracking-widest border",
                                        enabled ? "bg-green-600/10 text-green-600 dark:text-green-400 border-green-500/20" : "bg-red-600/10 text-red-600 dark:text-red-400 border-red-500/20"
                                    )}>{enabled ? 'Active' : 'Offline'}</span>
                                </div>
                                <p className="text-text-muted text-xs font-bold uppercase tracking-widest opacity-70">
                                    Real-time RTP Stream Emulation • {enabled ? `${activeCalls.length} Concurrent Streams` : (enabledRows.length === 0 ? 'No Targets Selected' : 'Engine Standby')}
                                </p>
                            </div>
                        </div>

                        {/* Compact runtime controls */}
                        {config && (
                            <div className="flex flex-wrap items-center gap-5 pl-1">
                                <div className="flex items-center gap-2">
                                    <label className="text-[9px] text-text-muted uppercase font-black tracking-widest flex items-center gap-1 whitespace-nowrap opacity-70">
                                        <Activity size={9} /> Max Calls
                                    </label>
                                    <input
                                        type="number" min={1} max={64}
                                        value={config.max_simultaneous_calls}
                                        onChange={e => { setIsDirty(true); setConfig(p => p ? { ...p, max_simultaneous_calls: parseInt(e.target.value) } : null); }}
                                        className="w-16 bg-card-secondary/50 border border-border text-text-primary rounded-lg px-2 py-1.5 text-xs font-black focus:ring-1 focus:ring-blue-500 outline-none shadow-sm"
                                    />
                                </div>
                                <div className="w-px h-5 bg-border hidden sm:block" />
                                <div className="flex items-center gap-2">
                                    <label className="text-[9px] text-text-muted uppercase font-black tracking-widest flex items-center gap-1 whitespace-nowrap opacity-70">
                                        <Clock size={9} /> Inter-Call (s)
                                    </label>
                                    <input
                                        type="number" min={1}
                                        value={config.sleep_between_calls}
                                        onChange={e => { setIsDirty(true); setConfig(p => p ? { ...p, sleep_between_calls: Math.max(1, parseInt(e.target.value) || 1) } : null); }}
                                        className="w-16 bg-card-secondary/50 border border-border text-text-primary rounded-lg px-2 py-1.5 text-xs font-black focus:ring-1 focus:ring-blue-500 outline-none shadow-sm"
                                    />
                                </div>
                                <div className="w-px h-5 bg-border hidden sm:block" />
                                <div className="flex items-center gap-2">
                                    <label className="text-[9px] text-text-muted uppercase font-black tracking-widest flex items-center gap-1 whitespace-nowrap opacity-70">
                                        <Wifi size={9} /> Egress Interface
                                    </label>
                                    <input
                                        type="text"
                                        value={config.interface || ''}
                                        onChange={e => { setIsDirty(true); setConfig(p => p ? { ...p, interface: e.target.value } : null); }}
                                        className="w-28 bg-card-secondary/50 border border-border text-text-primary rounded-lg px-2 py-1.5 text-xs font-black focus:ring-1 focus:ring-blue-500 outline-none shadow-sm"
                                        placeholder="eth0, bond0…"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right: Import/Export + auto-save status + Start/Stop */}
                    <div className="flex flex-col items-end gap-4 shrink-0">
                        <div className="flex items-center gap-2">
                            <label className="cursor-pointer text-blue-600 dark:text-blue-400 hover:bg-blue-600/10 px-3 py-2 rounded-xl border border-blue-500/20 transition-all flex items-center gap-2 text-[9px] font-black uppercase tracking-widest">
                                <Upload size={12} /> Import
                                <input type="file" className="hidden" accept=".json" onChange={handleImport} />
                            </label>
                            <button onClick={handleExport} className="text-blue-600 dark:text-blue-400 hover:bg-blue-600/10 px-3 py-2 rounded-xl border border-blue-500/20 transition-all flex items-center gap-2 text-[9px] font-black uppercase tracking-widest">
                                <Download size={12} /> Export
                            </button>
                            {/* Auto-save status indicator */}
                            <div className="min-w-[80px] flex justify-end">
                                {saveStatus === 'pending' && (
                                    <span className="flex items-center gap-1.5 text-[9px] font-black text-text-muted opacity-50">
                                        <Clock size={10} /> Unsaved…
                                    </span>
                                )}
                                {saveStatus === 'saving' && (
                                    <span className="flex items-center gap-1.5 text-[9px] font-black text-blue-500">
                                        <Activity size={10} className="animate-spin" /> Saving…
                                    </span>
                                )}
                                {saveStatus === 'saved' && (
                                    <span className="flex items-center gap-1.5 text-[9px] font-black text-green-500">
                                        <Save size={10} /> Saved
                                    </span>
                                )}
                                {saveStatus === 'error' && (
                                    <span className="flex items-center gap-1.5 text-[9px] font-black text-red-500">
                                        <AlertCircle size={10} /> Save failed
                                    </span>
                                )}
                            </div>
                        </div>

                        <button
                            onClick={handleToggle}
                            disabled={isStartingV || isStoppingV || (!enabled && enabledRows.length === 0)}
                            className={cn(
                                "px-10 py-4 rounded-2xl font-black text-[11px] tracking-[0.2em] transition-all shadow-2xl flex items-center gap-3 group",
                                !enabled && enabledRows.length === 0
                                    ? "bg-card-secondary text-text-muted border border-border cursor-not-allowed shadow-none"
                                    : enabled
                                        ? "bg-red-600 hover:bg-red-500 text-white shadow-red-900/40"
                                        : "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/40",
                                (isStartingV || isStoppingV) && "opacity-50 cursor-not-allowed"
                            )}
                        >
                            {isStartingV || isStoppingV
                                ? <Activity size={20} className="animate-spin" />
                                : enabled
                                    ? <Pause size={20} fill="currentColor" className="group-hover:scale-110 transition-transform" />
                                    : <Play size={20} fill="currentColor" className="group-hover:scale-110 transition-transform" />
                            }
                            {isStartingV ? 'Initializing…' : isStoppingV ? 'Terminating…' : enabled ? 'Stop Voice Simulation' : 'Start Voice Simulation'}
                        </button>
                    </div>
                </div>

                {/* QoS Global widget */}
                {qosSummary && (
                    <div className="mt-8 grid grid-cols-2 lg:grid-cols-6 gap-4">
                        {[
                            { label: 'Total Calls', value: qosSummary.totalCalls, icon: Activity, color: 'text-text-primary' },
                            { label: 'Avg Loss', value: `${qosSummary.avgLoss}%`, icon: Wifi, color: parseFloat(qosSummary.avgLoss) < 1 ? 'text-green-500' : 'text-orange-500' },
                            { label: 'Avg Latency', value: `${qosSummary.avgRtt}ms`, icon: Clock, color: 'text-blue-500' },
                            { label: 'Avg MOS', value: qosSummary.avgMos, icon: Activity, color: qosSummary.avgMos !== 'N/A' && parseFloat(qosSummary.avgMos) >= 4 ? 'text-green-500' : qosSummary.avgMos !== 'N/A' && parseFloat(qosSummary.avgMos) >= 3 ? 'text-orange-500' : 'text-red-500' },
                            { label: 'RTT Variance', value: `${qosSummary.minRtt} / ${qosSummary.maxRtt}ms`, icon: BarChart2, color: 'text-text-muted' },
                            { label: 'Avg Jitter', value: `${qosSummary.avgJitter}ms`, icon: Activity, color: 'text-purple-500' },
                        ].map((s, i) => (
                            <div key={i} className="bg-card-secondary/50 border border-border rounded-2xl p-4 shadow-sm hover:border-blue-500/30 transition-colors">
                                <div className="flex items-center gap-2 mb-2">
                                    <s.icon size={12} className="text-text-muted opacity-50" />
                                    <label className="text-[9px] font-black text-text-muted uppercase tracking-widest">{s.label}</label>
                                </div>
                                <div className={cn('text-lg font-black tracking-tighter truncate', s.color)}>{s.value}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ─── 2-COL: LIVE STREAMS + STIGIX VOICE TARGETS CONFIG ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* LEFT — Live Streams */}
                <div className="lg:col-span-1 bg-card border border-border rounded-2xl p-6 shadow-sm overflow-hidden relative flex flex-col">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-[10px] font-black text-text-primary tracking-[0.2em] flex items-center gap-2 border-l-2 border-blue-500 pl-2">
                            <Activity size={14} className="text-blue-500" /> Live Streams
                        </h3>
                        <span className={cn(
                            'text-[10px] font-black px-2 py-0.5 rounded-full',
                            activeCalls.length > 0 ? 'text-green-500 bg-green-500/10' : 'text-text-muted bg-card-secondary/50'
                        )}>
                            {activeCalls.length} UP
                        </span>
                    </div>
                    <div className="space-y-3 flex-1 overflow-y-auto max-h-96">
                        {activeCalls.length === 0 ? (
                            <div className="text-text-muted text-[10px] font-bold uppercase tracking-widest py-16 text-center bg-card-secondary/30 rounded-2xl border border-dashed border-border/50">
                                No active voice streams
                            </div>
                        ) : (
                            activeCalls.map((call, idx) => {
                                const siteName = targetNameMap.get(call.target);
                                return (
                                    <div key={idx} className="bg-card-secondary/50 p-4 rounded-2xl border border-border flex items-center justify-between shadow-sm hover:border-blue-500/30 transition-all">
                                        <div className="space-y-1 min-w-0 flex-1 mr-3">
                                            <div className="flex items-center gap-2">
                                                <span
                                                    title={`Source Port: ${deriveSourcePort(call.call_id)}`}
                                                    className="text-[9px] font-black text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded bg-blue-600/10 border border-blue-500/10 font-mono italic cursor-help shrink-0"
                                                >
                                                    #{call.call_id}
                                                </span>
                                                <div className="text-xs font-black text-text-primary tracking-tight truncate">
                                                    {siteName || call.target}
                                                </div>
                                            </div>
                                            {siteName && (
                                                <div className="text-[9px] font-mono text-text-muted opacity-50 truncate">{call.target}</div>
                                            )}
                                            <div className="text-[9px] text-text-muted font-bold uppercase tracking-widest opacity-60">
                                                {call.codec} • {call.duration}s
                                            </div>

                                            <CallProgress
                                                duration={call.duration}
                                                seenAt={seenAtMap.current.get(call.call_id) ?? Date.now()}
                                            />
                                        </div>
                                        <div className="flex items-center gap-2 bg-green-600/10 px-2.5 py-1.5 rounded-xl border border-green-500/20 shrink-0">
                                            <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-blink-slow" />
                                            <span className="text-[9px] text-green-500 font-black tracking-tight">Live</span>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* RIGHT — Stigix Voice Targets config */}
                <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-1">
                    <div>
                        <h3 className="text-[10px] font-black text-text-primary tracking-[0.2em] border-l-2 border-blue-500 pl-2 flex items-center gap-2">
                            <Phone size={12} className="text-blue-500" /> Stigix Voice Targets
                        </h3>
                        <p className="text-[9px] text-text-muted font-bold mt-1 pl-4 opacity-60">
                            {enabledRows.length} target{enabledRows.length !== 1 ? 's' : ''} selected for simulation
                            {excludedCount > 0 && (
                                <span className="ml-2 opacity-60">
                                    — {excludedCount} excluded (no Voice capability)
                                </span>
                            )}
                        </p>
                    </div>
                </div>

                <div className="mt-5 overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border">
                                <th className="pb-3 px-2 w-10" />
                                <th className="pb-3 px-3 text-[9px] font-black text-text-muted tracking-widest text-left">Site</th>
                                <th className="pb-3 px-3 text-[9px] font-black text-text-muted tracking-widest text-left">Host : Port</th>
                                <th className="pb-3 px-3 text-[9px] font-black text-text-muted tracking-widest text-left">Codec</th>
                                <th className="pb-3 px-3 text-[9px] font-black text-text-muted tracking-widest text-left">Duration (s)</th>
                                <th className="pb-3 px-3 text-[9px] font-black text-text-muted tracking-widest text-left">Weight (%)</th>
                                <th className="pb-3 px-2 w-8" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                            {targetRows.map(row => (
                                <tr
                                    key={row.id}
                                    className={cn(
                                        'group transition-all',
                                        row.enabled ? '' : 'opacity-35'
                                    )}
                                >
                                    {/* Checkbox */}
                                    <td className="py-3 px-2">
                                        <button
                                            onClick={() => toggleRow(row.id)}
                                            className={cn(
                                                'w-5 h-5 rounded border-2 flex items-center justify-center transition-all shrink-0',
                                                row.enabled
                                                    ? 'bg-blue-600 border-blue-600 text-white'
                                                    : 'border-border bg-transparent hover:border-blue-500/50'
                                            )}
                                        >
                                            {row.enabled && <CheckSquare size={11} />}
                                        </button>
                                    </td>

                                    {/* Site name */}
                                    <td className="py-3 px-3">
                                        <div className="flex items-center gap-2">
                                            {reachability[row.id] === 'loading' || reachability[row.id] === undefined ? (
                                                <div className="w-1.5 h-1.5 rounded-full bg-border animate-pulse shrink-0" title="Checking reachability..." />
                                            ) : reachability[row.id] ? (
                                                <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse shrink-0" style={{ animationDuration: '3s' }} title="Reachable" />
                                            ) : (
                                                <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)] shrink-0" title="Unreachable" />
                                            )}
                                            {row.isManual
                                                ? <span className="text-[9px] text-orange-500 font-black uppercase tracking-wider px-1.5 py-0.5 bg-orange-500/10 border border-orange-500/20 rounded">Manual</span>
                                                : <span className="text-xs font-black text-text-primary">{row.name}</span>
                                            }
                                        </div>
                                    </td>

                                    {/* Host:Port (read-only) */}
                                    <td className="py-3 px-3">
                                        <span className="text-[11px] font-mono font-bold text-text-muted">{row.host}:{row.port}</span>
                                    </td>

                                    {/* Codec */}
                                    <td className="py-3 px-3">
                                        <select
                                            value={row.codec}
                                            onChange={e => updateRow(row.id, 'codec', e.target.value)}
                                            className="bg-card-secondary/50 border border-border text-text-primary rounded-lg px-2 py-1.5 text-[10px] font-bold focus:ring-1 focus:ring-blue-500 outline-none cursor-pointer"
                                        >
                                            {CODEC_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </td>

                                    {/* Duration */}
                                    <td className="py-3 px-3">
                                        <input
                                            type="number" min={1}
                                            value={row.duration}
                                            onChange={e => updateRow(row.id, 'duration', e.target.value)}
                                            className="w-20 bg-card-secondary/50 border border-border text-text-primary rounded-lg px-2 py-1.5 text-[10px] font-bold focus:ring-1 focus:ring-blue-500 outline-none"
                                        />
                                    </td>

                                    {/* Weight */}
                                    <td className="py-3 px-3">
                                        <input
                                            type="number" min={1} max={100}
                                            value={row.weight}
                                            onChange={e => updateRow(row.id, 'weight', e.target.value)}
                                            className="w-20 bg-card-secondary/50 border border-border text-text-primary rounded-lg px-2 py-1.5 text-[10px] font-bold focus:ring-1 focus:ring-blue-500 outline-none"
                                        />
                                    </td>

                                    {/* Delete (manual only) */}
                                    <td className="py-3 px-2">
                                        {row.isManual && (
                                            <button
                                                onClick={() => removeRow(row.id)}
                                                className="p-1.5 text-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                                title="Remove"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}

                            {/* Empty state */}
                            {targetRows.length === 0 && !loading && (
                                <tr>
                                    <td colSpan={7} className="py-10 text-center text-[10px] font-black text-text-muted uppercase tracking-widest opacity-40">
                                        No voice-capable Stigix targets — add one below or configure targets in Settings
                                    </td>
                                </tr>
                            )}

                            {/* ── Add manual target row ── */}
                            <tr className="border-t-2 border-dashed border-border/50">
                                <td className="pt-4 px-2">
                                    <div className="w-5 h-5 rounded border-2 border-dashed border-border/40" />
                                </td>
                                <td className="pt-4 px-3">
                                    <span className="text-[9px] font-black text-text-muted uppercase tracking-widest opacity-40">Manual</span>
                                </td>
                                <td className="pt-4 px-3">
                                    <div className="flex items-center gap-1">
                                        <input
                                            type="text"
                                            placeholder="IP / FQDN"
                                            value={newRow.host}
                                            onChange={e => setNewRow(p => ({ ...p, host: e.target.value }))}
                                            className={cn(
                                                'w-32 bg-card-secondary/30 border rounded-lg px-2 py-1.5 text-[10px] font-bold focus:ring-1 focus:ring-blue-500 outline-none',
                                                newRow.host && !isValidIpOrFqdn(newRow.host) ? 'border-red-500/60 text-red-400' : 'border-border text-text-primary'
                                            )}
                                        />
                                        <span className="text-text-muted opacity-40 text-xs">:</span>
                                        <input
                                            type="text"
                                            placeholder="6100"
                                            value={newRow.port}
                                            onChange={e => setNewRow(p => ({ ...p, port: e.target.value }))}
                                            className="w-16 bg-card-secondary/30 border border-border text-text-primary rounded-lg px-2 py-1.5 text-[10px] font-bold focus:ring-1 focus:ring-blue-500 outline-none"
                                        />
                                    </div>
                                </td>
                                <td className="pt-4 px-3">
                                    <select
                                        value={newRow.codec}
                                        onChange={e => setNewRow(p => ({ ...p, codec: e.target.value }))}
                                        className="bg-card-secondary/30 border border-border text-text-primary rounded-lg px-2 py-1.5 text-[10px] font-bold focus:ring-1 focus:ring-blue-500 outline-none"
                                    >
                                        {CODEC_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </td>
                                <td className="pt-4 px-3">
                                    <input
                                        type="number" min={1}
                                        value={newRow.duration}
                                        onChange={e => setNewRow(p => ({ ...p, duration: e.target.value }))}
                                        className="w-20 bg-card-secondary/30 border border-border text-text-primary rounded-lg px-2 py-1.5 text-[10px] font-bold focus:ring-1 focus:ring-blue-500 outline-none"
                                    />
                                </td>
                                <td className="pt-4 px-3">
                                    <input
                                        type="number" min={1} max={100}
                                        value={newRow.weight}
                                        onChange={e => setNewRow(p => ({ ...p, weight: e.target.value }))}
                                        className="w-20 bg-card-secondary/30 border border-border text-text-primary rounded-lg px-2 py-1.5 text-[10px] font-bold focus:ring-1 focus:ring-blue-500 outline-none"
                                    />
                                </td>
                                <td className="pt-4 px-2">
                                    <button
                                        onClick={addManualRow}
                                        disabled={!newRow.host || !isValidIpOrFqdn(newRow.host)}
                                        title="Add custom target"
                                        className="p-1.5 text-blue-500 hover:bg-blue-500/10 border border-blue-500/30 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                                    >
                                        <Plus size={14} />
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                </div>{/* end RIGHT col */}
            </div>{/* end 2-col grid */}

            {/* ─── PER-TARGET QoS STATS ─── */}
            {perTargetStats.length > 0 && (
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-blue-600/10 rounded-lg text-blue-600 dark:text-blue-400">
                            <BarChart2 size={16} />
                        </div>
                        <h3 className="text-[10px] font-black text-text-primary tracking-[0.2em]">Per-Target QoS Statistics</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border">
                                    {['Site / Endpoint', 'Calls', 'Avg Loss', 'Avg RTT', 'Avg MOS', 'Avg Jitter', 'Quality'].map(h => (
                                        <th key={h} className="pb-3 px-3 text-[9px] font-black text-text-muted tracking-widest text-left">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/30">
                                {perTargetStats.map(stat => (
                                    <tr key={stat.target} className="hover:bg-card-secondary/20 transition-all">
                                        <td className="py-3 px-3">
                                            <div className="text-xs font-black text-text-primary">{stat.name}</div>
                                            {stat.name !== stat.target && (
                                                <div className="text-[9px] font-mono text-text-muted opacity-50 mt-0.5">{stat.target}</div>
                                            )}
                                        </td>
                                        <td className="py-3 px-3 text-xs font-black text-text-muted">{stat.totalCalls}</td>
                                        <td className="py-3 px-3">
                                            <span className={cn('text-xs font-black',
                                                parseFloat(stat.avgLoss) < 1 ? 'text-green-500' : parseFloat(stat.avgLoss) < 5 ? 'text-orange-500' : 'text-red-500'
                                            )}>{stat.avgLoss}%</span>
                                        </td>
                                        <td className="py-3 px-3 text-xs font-black text-text-primary">{stat.avgRtt}ms</td>
                                        <td className="py-3 px-3">
                                            <span className={cn(
                                                'text-[10px] font-black px-2 py-0.5 rounded-lg border',
                                                stat.avgMos !== 'N/A' && parseFloat(stat.avgMos) >= 4
                                                    ? 'bg-green-600/10 text-green-500 border-green-500/20'
                                                    : stat.avgMos !== 'N/A' && parseFloat(stat.avgMos) >= 3
                                                        ? 'bg-orange-600/10 text-orange-500 border-orange-500/20'
                                                        : 'bg-red-600/10 text-red-500 border-red-500/20'
                                            )}>{stat.avgMos}</span>
                                        </td>
                                        <td className="py-3 px-3 text-xs font-black text-text-muted">{stat.avgJitter}ms</td>
                                        <td className="py-3 px-3">
                                            <div className="flex items-center gap-2">
                                                <div className={cn('h-2 w-2 rounded-full', qualityDotClass(stat.quality))} />
                                                <span className={cn('text-[9px] font-black uppercase tracking-widest', qualityTextClass(stat.quality))}>
                                                    {stat.quality}
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ─── CALL HISTORY ─── */}
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-6">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-600/10 rounded-lg text-blue-600 dark:text-blue-400">
                            <BarChart2 size={16} />
                        </div>
                        <div>
                            <h3 className="text-[10px] font-black text-text-primary tracking-[0.2em]">Call History</h3>
                            {activeCalls.length > 0 && (
                                <p className="text-[9px] text-green-500 font-black mt-0.5 flex items-center gap-1">
                                    <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                                    {activeCalls.length} stream{activeCalls.length > 1 ? 's' : ''} live
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-1 max-w-md gap-3">
                        <div className="relative flex-1">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted opacity-50" />
                            <input
                                type="text" placeholder="Search traces…" value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="w-full bg-card-secondary/50 border border-border text-[10px] font-black tracking-widest text-text-primary rounded-xl pl-10 pr-3 py-2.5 outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                        <select
                            value={qualityFilter} onChange={e => setQualityFilter(e.target.value as any)}
                            className="bg-card-secondary/50 border border-border text-[10px] font-black uppercase tracking-widest text-text-primary rounded-xl px-4 py-2.5 outline-none focus:ring-1 focus:ring-blue-500"
                        >
                            <option value="all">Any Quality</option>
                            <option value="excellent">Excellent</option>
                            <option value="fair">Fair</option>
                            <option value="poor">Poor</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-2">
                        <button onClick={resetIds} className="flex items-center gap-2 px-4 py-2.5 text-[9px] font-black tracking-[0.15em] text-orange-600 dark:text-orange-400 hover:bg-orange-600/10 border border-orange-500/20 rounded-xl transition-all">
                            <Hash size={12} /> Reset ID
                        </button>
                        <button onClick={resetLogs} className="flex items-center gap-2 px-4 py-2.5 text-[9px] font-black tracking-[0.15em] text-red-600 dark:text-red-400 hover:bg-red-600/10 border border-red-500/20 rounded-xl transition-all">
                            <Trash2 size={12} /> Purge
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto max-h-[500px] overflow-y-auto pr-2">
                    <table className="w-full text-sm relative">
                        <thead className="sticky top-0 bg-card z-10 text-left">
                            <tr className="border-b border-border">
                                {[
                                    { key: 'timestamp', label: 'Timeline' },
                                    { key: 'event', label: 'Disposition' },
                                    { key: 'target', label: 'Site' },
                                    { key: 'target_ip', label: 'Endpoint' },
                                    { key: 'src_port', label: 'Src Port' },
                                    { key: 'loss_pct', label: 'Loss / MOS' },
                                    { key: 'avg_rtt_ms', label: 'RTT / Jitter', right: true },
                                ].map(col => (
                                    <th key={col.key} onClick={() => handleSort(col.key)}
                                        className={cn('pb-4 px-3 text-[9px] font-black text-text-muted tracking-widest cursor-pointer hover:text-blue-500 transition-colors', col.right && 'text-right')}
                                    >
                                        <div className={cn('flex items-center gap-2', col.right && 'justify-end')}>
                                            {col.label}
                                            {sortConfig?.key === col.key && (
                                                <Activity size={10} className={cn('text-blue-500 transform transition-transform', sortConfig.direction === 'desc' ? 'rotate-180' : '')} />
                                            )}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
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
                                    {/* Site name column */}
                                    <td className="py-4 px-3">
                                        {(() => {
                                            const name = targetNameMap.get(call.target);
                                            return name
                                                ? <span className="text-xs font-black text-text-primary">{name}</span>
                                                : <span className="text-[9px] text-orange-500 font-black uppercase tracking-wider opacity-70">Manual</span>;
                                        })()}
                                    </td>
                                    {/* Endpoint (IP:port) column */}
                                    <td className="py-4 px-3 text-[10px] font-mono font-bold text-text-muted">{call.target}</td>
                                    {/* Source Port column */}
                                    <td className="py-4 px-3">
                                        {(() => {
                                            const sp = deriveSourcePort(call.call_id);
                                            return sp !== '?' ? (
                                                <button
                                                    onClick={() => { navigator.clipboard.writeText(sp); toast.success(`Port ${sp} copied`); }}
                                                    title="Click to copy — use in Prisma SD-WAN flow browser to filter this call's RTP stream"
                                                    className="font-mono text-[11px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded hover:bg-cyan-500/20 transition-all cursor-copy"
                                                >
                                                    {sp}
                                                </button>
                                            ) : (
                                                <span className="text-text-muted opacity-30">—</span>
                                            );
                                        })()}
                                    </td>
                                    <td className="py-4 px-3">
                                        {call.event === 'end' && call.loss_pct !== undefined ? (
                                            <div className="flex items-center gap-4">
                                                <div className="flex items-center gap-2">
                                                    <div className={cn('h-2 w-2 rounded-full', call.loss_pct < 1 ? 'bg-green-500' : call.loss_pct < 5 ? 'bg-orange-500' : 'bg-red-500')} />
                                                    <span className={cn('text-[10px] font-black', call.loss_pct < 1 ? 'text-green-500' : call.loss_pct < 5 ? 'text-orange-500' : 'text-red-500')}>
                                                        {call.loss_pct}% loss
                                                    </span>
                                                </div>
                                                {call.mos_score !== undefined && (
                                                    <span className={cn(
                                                        'text-[10px] font-black px-2 py-0.5 rounded-lg border whitespace-nowrap',
                                                        call.mos_score >= 4 ? 'bg-green-600/10 text-green-500 border-green-500/20'
                                                            : call.mos_score >= 3 ? 'bg-orange-600/10 text-orange-500 border-orange-500/20'
                                                                : 'bg-red-600/10 text-red-500 border-red-500/20'
                                                    )}>MOS: {call.mos_score}</span>
                                                )}
                                            </div>
                                        ) : <span className="text-text-muted opacity-30">—</span>}
                                    </td>
                                    <td className="py-4 px-3 text-right">
                                        {call.event === 'end' && call.avg_rtt_ms !== undefined ? (
                                            <div className="flex flex-col items-end gap-1">
                                                <span className={cn('text-[11px] font-black tracking-tighter', call.avg_rtt_ms < 100 ? 'text-text-primary' : call.avg_rtt_ms < 200 ? 'text-orange-500' : 'text-red-500')}>
                                                    {call.avg_rtt_ms}ms
                                                </span>
                                                <span className="text-[9px] text-text-muted font-bold uppercase tracking-widest opacity-50">Jitter: {call.jitter_ms}ms</span>
                                            </div>
                                        ) : <span className="text-text-muted opacity-30">—</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {sortedHistory.length === 0 && (
                        <div className="text-center py-16 text-[10px] font-black text-text-muted uppercase tracking-widest opacity-40">
                            No call history yet
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
