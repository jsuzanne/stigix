import React, { useState, useEffect } from 'react';
import { usePeerContext } from './PeerContext';
import { Phone, PhoneIncoming, PhoneOutgoing, Play, Pause, BarChart2, Save, Plus, Trash2, Clock, Activity, Wifi, Search, CheckSquare, AlertCircle, Hash, Download, Upload, X, Settings } from 'lucide-react';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import toast from 'react-hot-toast';
import { isValidIpOrFqdn } from './utils/validation';
import { VoiceSkeleton } from './components/skeletons/VoiceSkeleton';
import { StigixSelect } from './components/common/StigixSelect';

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
    source_port_mode?: 'call_id' | 'ephemeral';
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
    const { gFetch, activePeerId } = usePeerContext();

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
    const [showSettings, setShowSettings] = useState(false);
    const [globalCodec, setGlobalCodec] = useState('G.711-ulaw');
    const [globalDuration, setGlobalDuration] = useState('30');
    const [showAddManual, setShowAddManual] = useState(false);

    // ── Call history filters & Ingress ──
    const [ingressSessions, setIngressSessions] = useState<any[]>([]);
    const [callTab, setCallTab] = useState<'egress' | 'ingress'>('egress');
    const [searchTerm, setSearchTerm] = useState('');
    const [qualityFilter, setQualityFilter] = useState<'all' | 'excellent' | 'fair' | 'poor'>('all');
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({ key: 'timestamp', direction: 'desc' });
    const [selectedStat, setSelectedStat] = useState<any>(null);

    // ── Target rows (merged registry + manual) ──
    const [targetRows, setTargetRows] = useState<TargetRow[]>([]);
    const [registryVoiceTargets, setRegistryVoiceTargets] = useState<any[]>([]);
    const [allRegistryTargets, setAllRegistryTargets] = useState<any[]>([]);
    const [excludedCount, setExcludedCount] = useState(0);
    const [voiceTargetsLoaded, setVoiceTargetsLoaded] = useState(false);
    const [configLoaded, setConfigLoaded] = useState(false);

    // ── New manual row form ──
    const [newRow, setNewRow] = useState({ host: '', port: '6100' });

    // ════════════════════════════════════════════════
    // Reachability polling
    // ════════════════════════════════════════════════
    const [reachability, setReachability] = useState<Record<string, boolean | 'loading'>>({});

    useEffect(() => {
        // Reachability must be checked by the node itself — proxying via the
        // gateway from the Leader makes no sense and causes a request storm.
        // Skip entirely in remote view mode.
        if (activePeerId) return;
        if (!targetRows.length) return;
        const checkTargets = async () => {
            const targetsToPing = targetRows.map(r => ({ host: r.host, port: r.port, id: r.id }));

            await Promise.all(targetsToPing.map(async (t) => {
                setReachability(prev => ({ ...prev, [t.id]: 'loading' }));
                let isReachable = false;
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        const res = await gFetch('/api/convergence/reachability', {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ target: t.host, port: parseInt(t.port, 10) })
                        });
                        if (res.ok) {
                            const data = await res.json();
                            if (data.reachable) {
                                isReachable = true;
                                break;
                            }
                        }
                    } catch {}
                    if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
                }
                setReachability(prev => ({ ...prev, [t.id]: isReachable }));
            }));
        };

        checkTargets();
        const interval = setInterval(checkTargets, 60000);
        return () => clearInterval(interval);
    }, [targetRows, token, activePeerId]);

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
    // Reset stale target/config state on peer switch
    // Prevents DC1's registryVoiceTargets from being used to build
    // targetRows for a remote peer before the new fetch completes.
    // ════════════════════════════════════════════════
    useEffect(() => {
        setVoiceTargetsLoaded(false);
        setConfigLoaded(false);
        setRegistryVoiceTargets([]);
        setAllRegistryTargets([]);
        setRawServers('');
        setTargetRows([]);
    }, [activePeerId]);

    // ════════════════════════════════════════════════
    // Initial load
    // ════════════════════════════════════════════════
    useEffect(() => {
        fetchConfig();
        fetchIngress();
        const interval = setInterval(() => {
            fetchConfig();
            fetchIngress();
        }, 3000);

        gFetch('/api/targets', { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.json())
            .then((data: any[]) => {
                const all = Array.isArray(data) ? data : [];
                setAllRegistryTargets(all);
                const withVoice = all.filter(t => t.enabled && t.capabilities?.voice);
                const withoutVoice = all.filter(t => t.enabled && !t.capabilities?.voice).length;
                setRegistryVoiceTargets(withVoice);
                setExcludedCount(withoutVoice);
                setVoiceTargetsLoaded(true);
            })
            .catch(() => setVoiceTargetsLoaded(true));

        return () => clearInterval(interval);
    }, [token, activePeerId]);

    // ════════════════════════════════════════════════
    // Build targetRows when both data sources are ready
    // Skipped if isDirty (user has unsaved edits)
    // ════════════════════════════════════════════════
    useEffect(() => {
        if (!voiceTargetsLoaded || !configLoaded || isDirty) return;

        // Parse rawServers string into a map keyed by "host:port"
        const serverMap = new Map<string, { codec: string; weight: string; duration: string }>();
        let firstCodec = '';
        let firstDuration = '';
        rawServers.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const parts = trimmed.split('|');
            const c = parts[1] || 'G.711-ulaw';
            const w = parts[2] || '50';
            const d = parts[3] || '30';
            if (!firstCodec) firstCodec = c;
            if (!firstDuration) firstDuration = d;
            serverMap.set(parts[0], {
                codec: c,
                weight: w,
                duration: d,
            });
        });

        if (firstCodec) setGlobalCodec(firstCodec);
        if (firstDuration) setGlobalDuration(firstDuration);

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
                codec: settings?.codec || firstCodec || 'G.711-ulaw',
                weight: settings?.weight || '50',
                duration: settings?.duration || firstDuration || '30',
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
    const fetchIngress = async () => {
        try {
            const r = await gFetch('/api/voice/ingress', { headers: { Authorization: `Bearer ${token}` } });
            const data = await r.json();
            if (data.success && Array.isArray(data.sessions)) {
                setIngressSessions(data.sessions);
            }
        } catch { }
    };

    const fetchConfig = async () => {
        try {
            const r = await gFetch('/api/voice/config', { headers: { Authorization: `Bearer ${token}` } });
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
            const r = await gFetch('/api/voice/config/export', { headers: { Authorization: `Bearer ${token}` } });
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
            const r = await gFetch('/api/voice/config/import', {
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
            const r = await gFetch('/api/voice/control', {
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
        try { await gFetch('/api/voice/counter', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }); } catch { }
    };

    const resetLogs = async () => {
        if (!confirm('Reset all voice call history?')) return;
        try { await gFetch('/api/voice/stats', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }); } catch { }
    };

    const buildRawServers = (rows: TargetRow[], codec: string, duration: string) =>
        rows.filter(r => r.enabled).map(r => `${r.host}:${r.port}|${codec}|50|${duration}`).join('\n');

    // Shared save function (called by auto-save timer)
    const performSave = async (rows: TargetRow[], ctrl: VoiceControl | null, codec: string, duration: string) => {
        setSaveStatus('saving');
        const servers = buildRawServers(rows, codec, duration);
        try {
            const r = await gFetch('/api/voice/config', {
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
            performSave(targetRows, config, globalCodec, globalDuration);
        }, 1500);
        return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
    }, [isDirty, targetRows, config, globalCodec, globalDuration]);

    // ════════════════════════════════════════════════
    // Row manipulation
    // ════════════════════════════════════════════════
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
            host: newRow.host, port: newRow.port || '6100',
            codec: globalCodec, weight: '50', duration: globalDuration,
            enabled: true, isManual: true,
        };
        setTargetRows(prev => [...prev, row]);
        setNewRow({ host: '', port: '6100' });
        setShowAddManual(false);
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

    const perTargetStatsMap = React.useMemo(() => {
        const m = new Map<string, typeof perTargetStats[0]>();
        perTargetStats.forEach(s => m.set(s.target, s));
        return m;
    }, [perTargetStats]);

    // Map host:port -> friendly site name for history table
    const targetNameMap = React.useMemo(() => {
        const map = new Map<string, string>();
        targetRows.forEach(r => {
            if (!r.isManual && r.name) {
                map.set(`${r.host}:${r.port}`, r.name);
                map.set(r.host, r.name);
            }
        });
        return map;
    }, [targetRows]);

    const handleSort = (key: string) => {
        setSortConfig(prev => ({ key, direction: prev?.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
    };

    const sortedHistory = React.useMemo(() => {
        const cleanTerm = searchTerm.trim().toLowerCase().replace(/^#/, '');
        return [...calls]
            .filter(c => ['start', 'end', 'skipped'].includes(c.event))
            .filter(c => {
                if (cleanTerm) {
                    const siteName = targetNameMap.get(c.target) || '';
                    const srcPort = deriveSourcePort(c.call_id);
                    const isLive = c.event === 'start' && activeCalls.some(ac => ac.call_id === c.call_id);
                    const statusText = isLive ? 'live active' : c.event;

                    const haystack = [
                        c.call_id,
                        c.target,
                        siteName,
                        srcPort,
                        statusText,
                        c.event,
                        c.loss_pct !== undefined ? `${c.loss_pct}%` : '',
                        c.mos_score !== undefined ? `MOS:${c.mos_score}` : '',
                        c.avg_rtt_ms !== undefined ? `${c.avg_rtt_ms}ms` : ''
                    ];
                    const matched = haystack.some(h => h !== undefined && h !== null && String(h).toLowerCase().includes(cleanTerm));
                    if (!matched) return false;
                }
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
    }, [calls, searchTerm, qualityFilter, sortConfig, targetNameMap, activeCalls]);

    // ════════════════════════════════════════════════
    // Render
    // ════════════════════════════════════════════════
    if (loading && !config && targetRows.length === 0) {
        return <VoiceSkeleton />;
    }

    return (
        <div className="space-y-6">

            {/* ─── HEADER ─── */}
            <div className="bg-card border border-border rounded-2xl p-8 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none"><Phone size={120} /></div>

                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">

                    {/* Left: title + clickable runtime summary badges */}
                    <div className="flex-1 space-y-3">
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

                                {/* Compact clickable summary pills */}
                                {config && (
                                    <div
                                        onClick={() => setShowSettings(s => !s)}
                                        title="Click to configure global call parameters & network settings"
                                        className="flex flex-wrap items-center gap-1.5 mt-2.5 cursor-pointer group/pills"
                                    >
                                        {[
                                            { label: `${config.max_simultaneous_calls} Max Calls`, icon: Activity },
                                            { label: `${config.sleep_between_calls}s Inter-Call`, icon: Clock },
                                            { label: globalCodec, icon: Phone },
                                            { label: `${globalDuration}s Duration`, icon: Clock },
                                            { label: config.interface || 'Auto Egress', icon: Wifi },
                                            { label: (config.source_port_mode || 'call_id') === 'call_id' ? 'Port 30000+N' : 'Ephemeral Ports', icon: Hash },
                                        ].map((pill, i) => (
                                            <span
                                                key={i}
                                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-card-secondary/60 text-text-secondary border border-border/70 group-hover/pills:border-blue-500/40 group-hover/pills:text-text-primary transition-all"
                                            >
                                                <pill.icon size={10} className="text-blue-500 opacity-80" />
                                                {pill.label}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right: Auto-save status + Settings toggle + Start/Stop */}
                    <div className="flex flex-wrap items-center gap-3 shrink-0">
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

                        <button
                            onClick={() => setShowSettings(s => !s)}
                            className={cn(
                                "px-4 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all border flex items-center gap-2 cursor-pointer",
                                showSettings
                                    ? "bg-blue-600/15 text-blue-500 border-blue-500/40 shadow-sm"
                                    : "bg-card-secondary/60 hover:bg-card-secondary text-text-secondary hover:text-text-primary border-border"
                            )}
                            title="Voice Engine & Call Profile Settings"
                        >
                            <Settings size={16} className={cn("transition-transform duration-300", showSettings && "rotate-90 text-blue-500")} />
                            <span>Settings</span>
                        </button>

                        <button
                            onClick={handleToggle}
                            disabled={isStartingV || isStoppingV || (!enabled && enabledRows.length === 0)}
                            className={cn(
                                "px-8 py-4 rounded-2xl font-black text-[11px] tracking-[0.2em] transition-all shadow-2xl flex items-center gap-3 group cursor-pointer",
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

                {/* ─── COLLAPSIBLE SETTINGS DRAWER ─── */}
                {showSettings && config && (
                    <div className="mt-6 pt-6 border-t border-border/70 relative z-10 animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="bg-card-secondary/40 border border-border rounded-2xl p-5 space-y-5">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/50 pb-3">
                                <div>
                                    <h4 className="text-[10px] font-black text-text-primary uppercase tracking-[0.2em] flex items-center gap-2">
                                        <Settings size={12} className="text-blue-500" /> Global Call Profile & Engine Configuration
                                    </h4>
                                    <p className="text-[10px] text-text-muted mt-0.5">
                                        Applied uniformly across all selected Stigix Voice targets (equal round-robin distribution). Changes auto-save.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <label className="cursor-pointer text-blue-600 dark:text-blue-400 hover:bg-blue-600/10 px-3 py-1.5 rounded-xl border border-blue-500/20 transition-all flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest">
                                        <Upload size={11} /> Import JSON
                                        <input type="file" className="hidden" accept=".json" onChange={handleImport} />
                                    </label>
                                    <button onClick={handleExport} className="text-blue-600 dark:text-blue-400 hover:bg-blue-600/10 px-3 py-1.5 rounded-xl border border-blue-500/20 transition-all flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest cursor-pointer">
                                        <Download size={11} /> Export JSON
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                                {/* Max Simultaneous Calls */}
                                <div className="space-y-1.5">
                                    <label className="text-[9px] text-text-muted uppercase font-black tracking-widest flex items-center gap-1.5">
                                        <Activity size={10} className="text-blue-500" /> Max Calls
                                    </label>
                                    <input
                                        type="number" min={1} max={64}
                                        value={config.max_simultaneous_calls}
                                        onChange={e => { setIsDirty(true); setConfig(p => p ? { ...p, max_simultaneous_calls: Math.max(1, parseInt(e.target.value) || 1) } : null); }}
                                        className="w-full bg-card border border-border text-text-primary rounded-xl px-3 py-2 text-xs font-black focus:ring-1 focus:ring-blue-500 outline-none shadow-sm"
                                    />
                                </div>

                                {/* Inter-Call Delay */}
                                <div className="space-y-1.5">
                                    <label className="text-[9px] text-text-muted uppercase font-black tracking-widest flex items-center gap-1.5">
                                        <Clock size={10} className="text-blue-500" /> Inter-Call (s)
                                    </label>
                                    <input
                                        type="number" min={1}
                                        value={config.sleep_between_calls}
                                        onChange={e => { setIsDirty(true); setConfig(p => p ? { ...p, sleep_between_calls: Math.max(1, parseInt(e.target.value) || 1) } : null); }}
                                        className="w-full bg-card border border-border text-text-primary rounded-xl px-3 py-2 text-xs font-black focus:ring-1 focus:ring-blue-500 outline-none shadow-sm"
                                    />
                                </div>

                                {/* Global Codec */}
                                <div className="space-y-1.5">
                                    <label className="text-[9px] text-text-muted uppercase font-black tracking-widest flex items-center gap-1.5">
                                        <Phone size={10} className="text-blue-500" /> RTP Codec
                                    </label>
                                    <StigixSelect
                                        value={globalCodec}
                                        onChange={val => { setIsDirty(true); setGlobalCodec(val); }}
                                        accent="blue"
                                        triggerClassName="rounded-xl px-3 py-2 text-xs font-black shadow-sm"
                                        options={CODEC_OPTIONS.map(c => ({ value: c, label: c }))}
                                    />
                                </div>

                                {/* Global Call Duration */}
                                <div className="space-y-1.5">
                                    <label className="text-[9px] text-text-muted uppercase font-black tracking-widest flex items-center gap-1.5">
                                        <Clock size={10} className="text-blue-500" /> Call Duration (s)
                                    </label>
                                    <input
                                        type="number" min={5} max={3600}
                                        value={globalDuration}
                                        onChange={e => { setIsDirty(true); setGlobalDuration(String(Math.max(1, parseInt(e.target.value) || 30))); }}
                                        className="w-full bg-card border border-border text-text-primary rounded-xl px-3 py-2 text-xs font-black focus:ring-1 focus:ring-blue-500 outline-none shadow-sm"
                                    />
                                </div>

                                {/* Egress Interface */}
                                <div className="space-y-1.5">
                                    <label className="text-[9px] text-text-muted uppercase font-black tracking-widest flex items-center gap-1.5">
                                        <Wifi size={10} className="text-blue-500" /> Egress Interface
                                    </label>
                                    <input
                                        type="text"
                                        value={config.interface || ''}
                                        onChange={e => { setIsDirty(true); setConfig(p => p ? { ...p, interface: e.target.value } : null); }}
                                        className="w-full bg-card border border-border text-text-primary rounded-xl px-3 py-2 text-xs font-black focus:ring-1 focus:ring-blue-500 outline-none shadow-sm"
                                        placeholder="eth0, enp2s0…"
                                    />
                                </div>

                                {/* Source Ports Mode */}
                                <div className="space-y-1.5">
                                    <label className="text-[9px] text-text-muted uppercase font-black tracking-widest flex items-center gap-1.5">
                                        <Hash size={10} className="text-blue-500" /> Source Ports
                                    </label>
                                    <StigixSelect
                                        value={config.source_port_mode || 'call_id'}
                                        onChange={val => { setIsDirty(true); setConfig(p => p ? { ...p, source_port_mode: val as any } : null); }}
                                        accent="blue"
                                        triggerClassName="rounded-xl px-3 py-2 text-xs font-black shadow-sm"
                                        options={[
                                            { value: 'call_id', label: '🎯 Call ID (30000+N)' },
                                            { value: 'ephemeral', label: '🎲 Ephemeral' },
                                        ]}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Always-visible QoS Global KPIs (single-line compact strip) */}
                <div className="mt-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 relative z-10">
                    {[
                        {
                            label: 'Avg MOS',
                            value: qosSummary ? qosSummary.avgMos : '—',
                            icon: Activity,
                            color: !qosSummary || qosSummary.avgMos === 'N/A'
                                ? 'text-text-muted opacity-50'
                                : parseFloat(qosSummary.avgMos) >= 4
                                    ? 'text-green-500'
                                    : parseFloat(qosSummary.avgMos) >= 3
                                        ? 'text-orange-500'
                                        : 'text-red-500'
                        },
                        {
                            label: 'Total Calls',
                            value: qosSummary ? qosSummary.totalCalls : 0,
                            icon: Phone,
                            color: qosSummary ? 'text-text-primary' : 'text-text-muted opacity-50'
                        },
                        {
                            label: 'Avg Loss',
                            value: qosSummary ? `${qosSummary.avgLoss}%` : '—',
                            icon: Wifi,
                            color: !qosSummary
                                ? 'text-text-muted opacity-50'
                                : parseFloat(qosSummary.avgLoss) < 1
                                    ? 'text-green-500'
                                    : 'text-orange-500'
                        },
                        {
                            label: 'Avg Latency',
                            value: qosSummary ? `${qosSummary.avgRtt}ms` : '—',
                            icon: Clock,
                            color: qosSummary ? 'text-blue-500' : 'text-text-muted opacity-50'
                        },
                        {
                            label: 'Avg Jitter',
                            value: qosSummary ? `${qosSummary.avgJitter}ms` : '—',
                            icon: Activity,
                            color: qosSummary ? 'text-purple-500' : 'text-text-muted opacity-50'
                        },
                        {
                            label: 'RTT Min/Max',
                            value: qosSummary ? `${qosSummary.minRtt}/${qosSummary.maxRtt}ms` : '—',
                            icon: BarChart2,
                            color: 'text-text-secondary'
                        },
                    ].map((s, i) => (
                        <div
                            key={i}
                            className="bg-card-secondary/50 border border-border rounded-xl px-3.5 py-2.5 shadow-sm hover:border-blue-500/30 transition-colors flex items-center justify-between gap-2"
                        >
                            <div className="flex items-center gap-1.5 min-w-0">
                                <s.icon size={12} className="text-text-muted opacity-50 shrink-0" />
                                <span className="text-[9px] font-black text-text-muted uppercase tracking-wider truncate">
                                    {s.label}
                                </span>
                            </div>
                            <div className={cn('text-sm font-mono font-black tracking-tight shrink-0', s.color)}>
                                {s.value}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ─── 2-COL: LIVE STREAMS + UNIFIED STIGIX VOICE TARGETS & QoS ─── */}
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
                    <div className="space-y-3 flex-1 min-h-[300px] max-h-[600px] lg:max-h-none overflow-y-auto pr-1">
                        {activeCalls.length === 0 ? (
                            <div className="text-text-muted text-[10px] font-bold uppercase tracking-widest py-16 text-center bg-card-secondary/30 rounded-2xl border border-dashed border-border/50">
                                No active voice streams
                            </div>
                        ) : (
                            activeCalls.map((call, idx) => {
                                const siteName = targetNameMap.get(call.target);
                                return (
                                    <div key={idx} className="bg-card-secondary/50 p-4 rounded-2xl border border-border flex items-center justify-between shadow-sm hover:border-blue-500/30 transition-all">
                                        <div className="space-y-1.5 min-w-0 flex-1 mr-3">
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
                                            <div className="flex items-center gap-1.5 text-[10px] truncate">
                                                {siteName && (
                                                    <>
                                                        <span className="font-mono font-medium text-text-secondary">
                                                            {call.target}
                                                        </span>
                                                        <span className="text-text-muted/60 text-[9px]">•</span>
                                                    </>
                                                )}
                                                <span className="text-text-secondary/90 font-sans font-bold uppercase tracking-wider text-[9px]">
                                                    {call.codec} • {call.duration}s
                                                </span>
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

                {/* RIGHT — Unified Stigix Voice Targets & Per-Target QoS */}
                <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-6 shadow-sm flex flex-col justify-between">
                    <div>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                            <div>
                                <h3 className="text-[10px] font-black text-text-primary tracking-[0.2em] border-l-2 border-blue-500 pl-2 flex items-center gap-2">
                                    <Phone size={12} className="text-blue-500" /> Stigix Voice Targets & QoS Telemetry
                                </h3>
                                <p className="text-[9px] text-text-muted font-bold mt-1 pl-4 opacity-60">
                                    {enabledRows.length} target{enabledRows.length !== 1 ? 's' : ''} enabled • Profile: {globalCodec} ({globalDuration}s)
                                    {excludedCount > 0 && (
                                        <span className="ml-2 opacity-60">
                                            — {excludedCount} excluded (no Voice capability)
                                        </span>
                                    )}
                                </p>
                            </div>
                            <button
                                onClick={() => setShowAddManual(v => !v)}
                                className={cn(
                                    "px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all flex items-center gap-1.5 self-start sm:self-auto cursor-pointer",
                                    showAddManual
                                        ? "bg-blue-600/15 text-blue-500 border-blue-500/40"
                                        : "bg-card-secondary/50 hover:bg-card-secondary text-text-secondary hover:text-text-primary border-border"
                                )}
                            >
                                <Plus size={12} /> Custom Target
                            </button>
                        </div>

                        {/* Collapsible Manual Target Bar */}
                        {showAddManual && (
                            <div className="mb-4 p-3 bg-card-secondary/40 border border-dashed border-blue-500/30 rounded-xl flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-2 flex-1 min-w-[220px]">
                                    <span className="text-[9px] font-black text-blue-500 uppercase tracking-widest px-2 py-0.5 bg-blue-500/10 rounded">
                                        Manual Endpoint
                                    </span>
                                    <input
                                        type="text"
                                        placeholder="IP or FQDN (e.g. 192.168.201.10)"
                                        value={newRow.host}
                                        onChange={e => setNewRow(p => ({ ...p, host: e.target.value }))}
                                        onKeyDown={e => { if (e.key === 'Enter') addManualRow(); }}
                                        className={cn(
                                            'flex-1 bg-card border rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold focus:ring-1 focus:ring-blue-500 outline-none',
                                            newRow.host && !isValidIpOrFqdn(newRow.host) ? 'border-red-500/60 text-red-400' : 'border-border text-text-primary'
                                        )}
                                    />
                                    <span className="text-text-muted opacity-50 font-mono text-xs">:</span>
                                    <input
                                        type="text"
                                        placeholder="6100"
                                        value={newRow.port}
                                        onChange={e => setNewRow(p => ({ ...p, port: e.target.value }))}
                                        onKeyDown={e => { if (e.key === 'Enter') addManualRow(); }}
                                        className="w-20 bg-card border border-border text-text-primary rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold focus:ring-1 focus:ring-blue-500 outline-none"
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={addManualRow}
                                        disabled={!newRow.host || !isValidIpOrFqdn(newRow.host)}
                                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer"
                                    >
                                        <Plus size={12} /> Add Target
                                    </button>
                                    <button
                                        onClick={() => setShowAddManual(false)}
                                        className="p-1.5 text-text-muted hover:text-text-primary rounded-lg"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border">
                                        <th className="pb-3 px-2 w-10" />
                                        <th className="pb-3 px-3 text-[9px] font-black text-text-muted uppercase tracking-widest text-left">Site</th>
                                        <th className="pb-3 px-3 text-[9px] font-black text-text-muted uppercase tracking-widest text-left">Endpoint</th>
                                        <th className="pb-3 px-3 text-[9px] font-black text-text-muted uppercase tracking-widest text-left">Calls</th>
                                        <th className="pb-3 px-3 text-[9px] font-black text-text-muted uppercase tracking-widest text-left">Avg MOS</th>
                                        <th className="pb-3 px-3 text-[9px] font-black text-text-muted uppercase tracking-widest text-left">Loss</th>
                                        <th className="pb-3 px-3 text-[9px] font-black text-text-muted uppercase tracking-widest text-left">RTT / Jitter</th>
                                        <th className="pb-3 px-3 text-[9px] font-black text-text-muted uppercase tracking-widest text-right">Quality</th>
                                        <th className="pb-3 px-2 w-8" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/30">
                                    {targetRows.map(row => {
                                        const targetKey = `${row.host}:${row.port}`;
                                        const stat = perTargetStatsMap.get(targetKey);
                                        return (
                                            <tr
                                                key={row.id}
                                                className="group transition-all hover:bg-card-secondary/20"
                                            >
                                                {/* Checkbox */}
                                                <td className="py-3.5 px-2">
                                                    <button
                                                        onClick={() => toggleRow(row.id)}
                                                        className={cn(
                                                            'w-5 h-5 rounded border-2 flex items-center justify-center transition-all shrink-0 cursor-pointer',
                                                            row.enabled
                                                                ? 'bg-blue-600 border-blue-600 text-white'
                                                                : 'border-slate-400 dark:border-slate-600 bg-card-secondary/30 hover:border-blue-500 hover:bg-blue-500/10'
                                                        )}
                                                    >
                                                        {row.enabled && <CheckSquare size={11} />}
                                                    </button>
                                                </td>

                                                {/* Site name + reachability dot */}
                                                <td
                                                    className={cn("py-3.5 px-3 transition-opacity duration-200 cursor-pointer select-none", !row.enabled && "opacity-45")}
                                                    onClick={() => toggleRow(row.id)}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        {reachability[row.id] === 'loading' || reachability[row.id] === undefined ? (
                                                            <div className="w-1.5 h-1.5 rounded-full bg-border animate-pulse shrink-0" title="Checking reachability..." />
                                                        ) : reachability[row.id] ? (
                                                            <div className="relative flex h-2 w-2 items-center justify-center shrink-0" title="Reachable">
                                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" style={{ animationDuration: '3s' }}></span>
                                                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
                                                            </div>
                                                        ) : (
                                                            <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)] shrink-0" title="Unreachable" />
                                                        )}
                                                        {row.isManual ? (
                                                            <span className="text-[9px] text-orange-500 font-black uppercase tracking-wider px-1.5 py-0.5 bg-orange-500/10 border border-orange-500/20 rounded">
                                                                Manual
                                                            </span>
                                                        ) : (
                                                            <span className="text-xs font-black text-text-primary group-hover:text-blue-500 transition-colors">
                                                                {row.name}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* Host:Port */}
                                                <td className={cn("py-3.5 px-3 transition-opacity duration-200", !row.enabled && "opacity-45")}>
                                                    <span className="text-[11px] font-mono font-bold text-text-muted">{targetKey}</span>
                                                </td>

                                                {/* Calls */}
                                                <td
                                                    onClick={() => stat && setSelectedStat(stat)}
                                                    className={cn("py-3.5 px-3 transition-opacity duration-200", !row.enabled && "opacity-45", stat && "cursor-pointer")}
                                                >
                                                    {stat ? (
                                                        <span className="text-xs font-black text-text-primary">{stat.totalCalls}</span>
                                                    ) : (
                                                        <span className="text-xs text-text-muted opacity-30">—</span>
                                                    )}
                                                </td>

                                                {/* Avg MOS */}
                                                <td
                                                    onClick={() => stat && setSelectedStat(stat)}
                                                    className={cn("py-3.5 px-3 transition-opacity duration-200", !row.enabled && "opacity-45", stat && "cursor-pointer")}
                                                >
                                                    {stat ? (
                                                        <span className={cn(
                                                            'text-[10px] font-black px-2 py-0.5 rounded-lg border',
                                                            stat.avgMos !== 'N/A' && parseFloat(stat.avgMos) >= 4
                                                                ? 'bg-green-600/10 text-green-500 border-green-500/20'
                                                                : stat.avgMos !== 'N/A' && parseFloat(stat.avgMos) >= 3
                                                                    ? 'bg-orange-600/10 text-orange-500 border-orange-500/20'
                                                                    : 'bg-red-600/10 text-red-500 border-red-500/20'
                                                        )}>{stat.avgMos}</span>
                                                    ) : (
                                                        <span className="text-xs text-text-muted opacity-30">—</span>
                                                    )}
                                                </td>

                                                {/* Avg Loss */}
                                                <td
                                                    onClick={() => stat && setSelectedStat(stat)}
                                                    className={cn("py-3.5 px-3 transition-opacity duration-200", !row.enabled && "opacity-45", stat && "cursor-pointer")}
                                                >
                                                    {stat ? (
                                                        <span className={cn('text-xs font-black',
                                                            parseFloat(stat.avgLoss) < 1 ? 'text-green-500' : parseFloat(stat.avgLoss) < 5 ? 'text-orange-500' : 'text-red-500'
                                                        )}>{stat.avgLoss}%</span>
                                                    ) : (
                                                        <span className="text-xs text-text-muted opacity-30">—</span>
                                                    )}
                                                </td>

                                                {/* RTT / Jitter */}
                                                <td
                                                    onClick={() => stat && setSelectedStat(stat)}
                                                    className={cn("py-3.5 px-3 transition-opacity duration-200", !row.enabled && "opacity-45", stat && "cursor-pointer")}
                                                >
                                                    {stat ? (
                                                        <div className="flex items-center gap-1.5 text-xs">
                                                            <span className="font-black text-text-primary">{stat.avgRtt}ms</span>
                                                            <span className="text-text-muted opacity-40">/</span>
                                                            <span className="text-[10px] font-bold text-text-muted">{stat.avgJitter}ms</span>
                                                        </div>
                                                    ) : (
                                                        <span className="text-xs text-text-muted opacity-30">—</span>
                                                    )}
                                                </td>

                                                {/* Quality badge + radar modal trigger */}
                                                <td
                                                    onClick={() => stat && setSelectedStat(stat)}
                                                    className={cn("py-3.5 px-3 text-right transition-opacity duration-200", !row.enabled && "opacity-45", stat && "cursor-pointer")}
                                                    title={stat ? "Click to open QoS radar profile" : undefined}
                                                >
                                                    {stat ? (
                                                        <div className="inline-flex items-center justify-end gap-1.5 px-2 py-0.5 rounded-lg hover:bg-blue-500/10 transition-colors">
                                                            <div className={cn('h-2 w-2 rounded-full', qualityDotClass(stat.quality))} />
                                                            <span className={cn('text-[9px] font-black uppercase tracking-widest', qualityTextClass(stat.quality))}>
                                                                {stat.quality}
                                                            </span>
                                                            <BarChart2 size={11} className="text-blue-500 opacity-60 ml-0.5" />
                                                        </div>
                                                    ) : (
                                                        <span className="text-xs text-text-muted opacity-30">—</span>
                                                    )}
                                                </td>

                                                {/* Actions (Remove for manual target) */}
                                                <td className={cn("py-3.5 px-2 transition-opacity duration-200", !row.enabled && "opacity-45")}>
                                                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        {row.isManual && (
                                                            <button
                                                                onClick={() => removeRow(row.id)}
                                                                className="p-1.5 text-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all cursor-pointer"
                                                                title="Remove custom target"
                                                            >
                                                                <Trash2 size={12} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}

                                    {/* Empty state */}
                                    {targetRows.length === 0 && !loading && (
                                        <tr>
                                            <td colSpan={9} className="py-12 text-center text-[10px] font-black text-text-muted uppercase tracking-widest opacity-40">
                                                No voice-capable Stigix targets — click "+ Custom Target" above or enable Voice capability in Targets
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>{/* end RIGHT col */}
            </div>{/* end 2-col grid */}

            {/* ─── CALL HISTORY ─── */}
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-6">
                    <div className="flex items-center gap-4">
                        <div className="p-2 bg-blue-600/10 rounded-lg text-blue-600 dark:text-blue-400">
                            <BarChart2 size={16} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setCallTab('egress')}
                                    className={cn(
                                        "px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 border shadow-sm",
                                        callTab === 'egress'
                                            ? "bg-blue-600/20 text-blue-400 border-blue-500/40"
                                            : "bg-card-secondary/40 text-text-muted border-border/50 hover:text-text-primary"
                                    )}
                                >
                                    <PhoneOutgoing size={12} />
                                    <span>Outbound (Caller)</span>
                                </button>
                                <button
                                    onClick={() => setCallTab('ingress')}
                                    className={cn(
                                        "px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 border shadow-sm",
                                        callTab === 'ingress'
                                            ? "bg-cyan-600/20 text-cyan-400 border-cyan-500/40"
                                            : "bg-card-secondary/40 text-text-muted border-border/50 hover:text-text-primary"
                                    )}
                                >
                                    <PhoneIncoming size={12} />
                                    <span>Inbound (Receiver)</span>
                                    {ingressSessions.filter(s => s.status === 'active').length > 0 && (
                                        <span className="px-1.5 py-0.2 rounded-full bg-cyan-500/20 text-cyan-300 text-[8px] font-mono animate-pulse">
                                            {ingressSessions.filter(s => s.status === 'active').length}
                                        </span>
                                    )}
                                </button>
                            </div>
                            {callTab === 'egress' && activeCalls.length > 0 && (
                                <p className="text-[9px] text-green-500 font-black mt-1 flex items-center gap-1">
                                    <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                                    {activeCalls.length} stream{activeCalls.length > 1 ? 's' : ''} live
                                </p>
                            )}
                            {callTab === 'ingress' && (
                                <p className="text-[9px] text-cyan-400 font-black mt-1 flex items-center gap-1">
                                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse inline-block" />
                                    {ingressSessions.filter(s => s.status === 'active').length} inbound stream{ingressSessions.filter(s => s.status === 'active').length !== 1 ? 's' : ''} live
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
                        {callTab === 'egress' && (
                            <StigixSelect
                                value={qualityFilter}
                                onChange={val => setQualityFilter(val as any)}
                                accent="blue"
                                uppercaseTrigger
                                triggerClassName="bg-card-secondary/50 rounded-xl px-4 py-2.5 text-[10px]"
                                menuMinWidth={160}
                                options={[
                                    { value: 'all', label: 'Any Quality' },
                                    { value: 'excellent', label: 'Excellent' },
                                    { value: 'fair', label: 'Fair' },
                                    { value: 'poor', label: 'Poor' },
                                ]}
                            />
                        )}
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

                {callTab === 'egress' ? (
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
                ) : (
                    <div className="overflow-x-auto max-h-[500px] overflow-y-auto pr-2">
                        <table className="w-full text-sm relative">
                            <thead className="sticky top-0 bg-card z-10 text-left">
                                <tr className="border-b border-border">
                                    <th className="pb-4 px-3 text-[9px] font-black text-text-muted tracking-widest">Timeline</th>
                                    <th className="pb-4 px-3 text-[9px] font-black text-text-muted tracking-widest">Disposition</th>
                                    <th className="pb-4 px-3 text-[9px] font-black text-text-muted tracking-widest">Source Site / IP</th>
                                    <th className="pb-4 px-3 text-[9px] font-black text-text-muted tracking-widest">Src Port</th>
                                    <th className="pb-4 px-3 text-[9px] font-black text-text-muted tracking-widest">Dest Port</th>
                                    <th className="pb-4 px-3 text-[9px] font-black text-text-muted tracking-widest">Volume (Packets)</th>
                                    <th className="pb-4 px-3 text-[9px] font-black text-text-muted tracking-widest text-right">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {(() => {
                                    const getResolvedSiteName = (ip: string, payloadSite?: string) => {
                                        if (payloadSite && payloadSite.trim()) return payloadSite.trim();
                                        if (!ip) return 'Unknown';
                                        const cleanIp = ip.split(':')[0];

                                        const matchTarget = (t: any) => {
                                            const h = (t.host || t.ip || '').split(':')[0];
                                            return h === cleanIp;
                                        };

                                        const regMatch = allRegistryTargets.find(matchTarget);
                                        if (regMatch?.name && !/^[\d.]+$/.test(regMatch.name)) return regMatch.name;

                                        const rowMatch = targetRows.find(matchTarget);
                                        if (rowMatch?.name && !/^[\d.]+$/.test(rowMatch.name)) return rowMatch.name;

                                        const ipPrefix = cleanIp.split('.').slice(0, 3).join('.');
                                        const subnetMatch = allRegistryTargets.find((t: any) => {
                                            const targetIp = (t.host || t.ip || '').split(':')[0];
                                            if (!targetIp) return false;
                                            return targetIp.split('.').slice(0, 3).join('.') === ipPrefix && t.name && !/^[\d.]+$/.test(t.name);
                                        }) || targetRows.find((r: any) => {
                                            const targetIp = (r.host || r.ip || '').split(':')[0];
                                            if (!targetIp) return false;
                                            return targetIp.split('.').slice(0, 3).join('.') === ipPrefix && r.name && !/^[\d.]+$/.test(r.name);
                                        });

                                        if (subnetMatch?.name) return subnetMatch.name;

                                        return ip;
                                    };

                                    return ingressSessions
                                        .filter(s => {
                                            if (!searchTerm) return true;
                                            const cleanTerm = searchTerm.trim().toLowerCase().replace(/^#/, '');
                                            if (!cleanTerm) return true;

                                            const sessId = s.id || (s as any).call_id || '';
                                            const sessIp = s.src_ip || (s as any).source_ip || '';
                                            const rawPayloadSite = (s as any).src_site || (s as any).source_site || '';
                                            const siteName = getResolvedSiteName(sessIp, rawPayloadSite);
                                            const sessSrcPort = s.src_port || (s as any).source_port;
                                            const sessDestPort = s.dest_port || (s as any).target_port;
                                            const derivedPort = deriveSourcePort(sessId);
                                            const statusLabel = s.status === 'active' ? 'live active' : 'completed';

                                            const haystack = [
                                                sessId,
                                                sessIp,
                                                rawPayloadSite,
                                                siteName,
                                                sessSrcPort,
                                                derivedPort,
                                                sessDestPort,
                                                statusLabel,
                                                s.type,
                                                s.label,
                                                s.packet_count ? `${s.packet_count} pkts` : '',
                                                s.packet_count
                                            ];

                                            return haystack.some(h => h !== undefined && h !== null && String(h).toLowerCase().includes(cleanTerm));
                                        })
                                        .map((session, idx) => {
                                            const sessId = session.id || (session as any).call_id || 'CALL-IN';
                                            const sessIp = session.src_ip || (session as any).source_ip || '';
                                            const sessSite = (session as any).src_site || (session as any).source_site || '';
                                            const sessSrcPort = session.src_port || (session as any).source_port;
                                            const sessDestPort = session.dest_port || (session as any).target_port || 6100;
                                            const siteName = getResolvedSiteName(sessIp, sessSite);
                                            const isActive = session.status === 'active';
                                            const startTime = session.start_time ? new Date(session.start_time * 1000) : new Date();
                                            return (
                                                <tr key={`${sessId}-${sessIp}-${session.start_time || idx}`} className="hover:bg-card-secondary/30 transition-all group">
                                                    <td className="py-4 px-3 text-[10px] font-black font-mono text-text-muted">
                                                        {startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                    </td>
                                                    <td className="py-4 px-3">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] font-black text-cyan-400 px-2 py-0.5 rounded bg-cyan-600/10 border border-cyan-500/20 font-mono italic">
                                                                #{sessId}
                                                            </span>
                                                            <PhoneIncoming size={13} className={isActive ? "text-cyan-400 animate-pulse" : "text-text-muted opacity-50"} />
                                                        </div>
                                                    </td>
                                                    <td className="py-4 px-3">
                                                        <div className="flex flex-col">
                                                            <span className="text-xs font-black text-text-primary">{siteName}</span>
                                                            <span className="text-[9px] font-mono text-text-muted opacity-60">{sessIp}</span>
                                                        </div>
                                                    </td>
                                                    <td className="py-4 px-3 font-mono text-[10px] font-bold text-text-muted">
                                                        <span className="px-2 py-0.5 rounded bg-card-secondary border border-border">
                                                            {sessSrcPort || '—'}
                                                        </span>
                                                    </td>
                                                    <td className="py-4 px-3 font-mono text-[10px] font-bold text-cyan-400">
                                                        {sessDestPort} UDP
                                                    </td>
                                                    <td className="py-4 px-3 font-mono text-[10px] font-bold text-text-primary">
                                                        {session.packet_count?.toLocaleString() || 0} pkts
                                                    </td>
                                                    <td className="py-4 px-3 text-right">
                                                        <span className={cn(
                                                            "px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border",
                                                            isActive
                                                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                                                : "bg-gray-500/10 text-gray-400 border-gray-500/20"
                                                        )}>
                                                            {isActive ? '🟢 LIVE' : '✅ COMPLETED'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        });
                                })()}
                            </tbody>
                        </table>
                        {ingressSessions.length === 0 && (
                            <div className="text-center py-16 text-[10px] font-black text-text-muted uppercase tracking-widest opacity-40">
                                No inbound voice sessions recorded yet
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ─── QoS Spider Chart Modal ─── */}
            {selectedStat && (() => {
                const loss    = parseFloat(selectedStat.avgLoss);
                const rtt     = parseFloat(selectedStat.avgRtt);
                const jitter  = parseFloat(selectedStat.avgJitter);
                const mos     = selectedStat.avgMos !== 'N/A' ? parseFloat(selectedStat.avgMos) : 3;
                const radarData = [
                    { metric: 'Loss',   value: Math.max(0, Math.round((1 - loss   / 10)  * 100)), raw: `${selectedStat.avgLoss}%` },
                    { metric: 'RTT',    value: Math.max(0, Math.round((1 - rtt    / 400) * 100)), raw: `${selectedStat.avgRtt}ms` },
                    { metric: 'MOS',    value: Math.round((mos / 5) * 100),                        raw: selectedStat.avgMos },
                    { metric: 'Jitter', value: Math.max(0, Math.round((1 - jitter / 50)  * 100)), raw: `${selectedStat.avgJitter}ms` },
                ];
                const quality      = selectedStat.quality;
                const qualityColor = quality === 'excellent' ? '#22c55e' : quality === 'fair' ? '#f97316' : '#ef4444';
                const radarColor   = quality === 'excellent' ? '#3b82f6' : quality === 'fair' ? '#f97316' : '#ef4444';
                return (
                    <div
                        className="fixed inset-0 z-50 flex items-center justify-center"
                        onClick={() => setSelectedStat(null)}
                    >
                        {/* Backdrop */}
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

                        {/* Modal card */}
                        <div
                            className="relative z-10 bg-card border border-border rounded-2xl shadow-2xl p-6 w-[420px] max-w-[95vw]"
                            onClick={e => e.stopPropagation()}
                        >
                            {/* Header */}
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <h4 className="text-sm font-black text-text-primary tracking-tight">{selectedStat.name}</h4>
                                    {selectedStat.name !== selectedStat.target && (
                                        <p className="text-[9px] font-mono text-text-muted opacity-50 mt-0.5">{selectedStat.target}</p>
                                    )}
                                    <div className="flex items-center gap-1.5 mt-1.5">
                                        <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: qualityColor }} />
                                        <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: qualityColor }}>
                                            {quality}
                                        </span>
                                        <span className="text-[9px] text-text-muted opacity-50 font-bold">• {selectedStat.totalCalls} call{selectedStat.totalCalls !== 1 ? 's' : ''}</span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setSelectedStat(null)}
                                    className="p-1.5 hover:bg-card-secondary rounded-lg transition-all text-text-muted hover:text-text-primary"
                                >
                                    <X size={14} />
                                </button>
                            </div>

                            {/* Radar chart */}
                            <div className="h-56">
                                <ResponsiveContainer width="100%" height="100%">
                                    <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
                                        <PolarGrid stroke="var(--border)" strokeOpacity={0.5} />
                                        <PolarAngleAxis
                                            dataKey="metric"
                                            tick={({ x, y, payload }: any) => {
                                                const d = radarData.find(r => r.metric === payload.value);
                                                return (
                                                    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fill="var(--text-secondary)" fontSize={10} fontWeight={700}>
                                                        <tspan x={x} dy="0">{payload.value}</tspan>
                                                        <tspan x={x} dy={13} fontSize={9} opacity={0.55} fill="var(--text-muted)">{d?.raw}</tspan>
                                                    </text>
                                                );
                                            }}
                                        />
                                        <Radar
                                            dataKey="value"
                                            stroke={radarColor}
                                            fill={radarColor}
                                            fillOpacity={0.18}
                                            strokeWidth={2}
                                        />
                                    </RadarChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Raw metric grid */}
                            <div className="grid grid-cols-4 gap-2 mt-4">
                                {radarData.map(d => (
                                    <div key={d.metric} className="bg-card-secondary/50 border border-border rounded-xl p-2.5 text-center">
                                        <div className="text-[8px] font-black text-text-muted uppercase tracking-widest opacity-60 mb-1">{d.metric}</div>
                                        <div className="text-xs font-black text-text-primary">{d.raw}</div>
                                        <div className="text-[8px] text-text-muted opacity-40 mt-0.5">{d.value}/100</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
