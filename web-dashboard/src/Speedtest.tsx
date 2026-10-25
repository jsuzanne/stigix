import React, { useState, useEffect, useRef } from 'react';
import { usePeerContext } from './PeerContext';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Area, AreaChart, ComposedChart, Bar } from 'recharts';
import {
    Activity, Gauge, Play, Pause, AlertCircle, Clock, Zap, Target, Network,
    Shield, Cpu, ChevronRight, ChevronLeft, BarChart3, Info, CheckCircle2, XCircle,
    Search, Filter, Download, Trash2, ChevronDown, ChevronUp, Share2,
    ShieldAlert, ExternalLink, ArrowUpRight, ShieldOff, Copy, RefreshCw,
    History as HistoryIcon, X, Layers, Calendar, Bookmark, Plus, TrendingUp, RotateCcw
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { isValidIpOrFqdn } from './utils/validation';
import { StigixSelect } from './components/common/StigixSelect';

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
    packets_sent?: number;
    packets_received?: number;
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

interface XfrPreset {
    id: string;
    name: string;
    description: string;
    builtin?: boolean;
    protocol: 'tcp' | 'udp' | 'quic';
    direction: 'client-to-server' | 'server-to-client' | 'bidirectional';
    bitrate: string;
    duration_sec: number;
    parallel_streams: number;
    dscp: string;
    congestion: string;
    updatedAt?: string;
}

const FALLBACK_BUILTIN_PRESETS: XfrPreset[] = [
    {
        id: 'wan-max-capacity',
        name: 'WAN Max Capacity',
        description: 'Link saturation & asymmetric capacity validation',
        builtin: true,
        protocol: 'tcp',
        direction: 'bidirectional',
        bitrate: '500M',
        duration_sec: 10,
        parallel_streams: 8,
        dscp: '',
        congestion: 'cubic'
    },
    {
        id: 'transactional-erp',
        name: 'Transactional / ERP',
        description: 'Low-latency interactive SQL/SAP burst profile',
        builtin: true,
        protocol: 'tcp',
        direction: 'bidirectional',
        bitrate: '50M',
        duration_sec: 10,
        parallel_streams: 2,
        dscp: 'AF21',
        congestion: 'cubic'
    },
    {
        id: 'voice-video-ef',
        name: 'Voice / Video (EF)',
        description: 'Real-time priority queue & jitter/loss stress',
        builtin: true,
        protocol: 'udp',
        direction: 'bidirectional',
        bitrate: '20M',
        duration_sec: 10,
        parallel_streams: 4,
        dscp: 'EF',
        congestion: 'cubic'
    },
    {
        id: 'cloud-backup-bulk',
        name: 'Cloud Backup (AF11)',
        description: 'Sustained bulk replication & QoS shaping check',
        builtin: true,
        protocol: 'tcp',
        direction: 'client-to-server',
        bitrate: '300M',
        duration_sec: 15,
        parallel_streams: 4,
        dscp: 'AF11',
        congestion: 'cubic'
    },
    {
        id: 'modern-web-quic',
        name: 'Modern Web (QUIC)',
        description: 'Encrypted UDP/HTTP3 multiplexed stream test',
        builtin: true,
        protocol: 'quic',
        direction: 'server-to-client',
        bitrate: '100M',
        duration_sec: 10,
        parallel_streams: 4,
        dscp: 'AF41',
        congestion: 'cubic'
    }
];

// Helper to format congestion window (normalizes legacy 1448x-scaled records > 64MB)
const formatCwnd = (raw: number | undefined): { val: string; unit: string } => {
    if (!raw || raw <= 0) return { val: '0', unit: 'KB' };
    const bytes = raw > 67108864 ? raw / 1448 : raw;
    if (bytes >= 1048576) {
        return { val: (bytes / 1048576).toFixed(1), unit: 'MB' };
    }
    if (bytes >= 1024) {
        return { val: (bytes / 1024).toFixed(0), unit: 'KB' };
    }
    return { val: Math.round(bytes).toString(), unit: 'B' };
};

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
    const [isConfigExpanded, setIsConfigExpanded] = useState(true);
    
    // Custom Config Advanced Inputs
    const [dscp, setDscp] = useState('');
    const [congestion, setCongestion] = useState('cubic');
    const [cport, setCport] = useState<number>(30000);
    const [showAdvancedParams, setShowAdvancedParams] = useState(false);

    // Use-Case Presets & Trend Evolution States
    const [presets, setPresets] = useState<XfrPreset[]>(FALLBACK_BUILTIN_PRESETS);
    const [selectedPresetId, setSelectedPresetId] = useState<string>('');
    const [showSavePresetForm, setShowSavePresetForm] = useState(false);
    const [newPresetName, setNewPresetName] = useState('');
    const [newPresetDesc, setNewPresetDesc] = useState('');
    const [savingPreset, setSavingPreset] = useState(false);

    const [selectedHistoryPreset, setSelectedHistoryPreset] = useState<string>('all');
    const [selectedHistoryTarget, setSelectedHistoryTarget] = useState<string>('all');
    const [showTrendPanel, setShowTrendPanel] = useState(false);

    const sseRef = useRef<EventSource | null>(null);
    const hasAutoLoadedRef = useRef(false);
    const lastAutoJobIdRef = useRef<string | null>(null);

    const formatIntervalsForChart = (intervals?: XfrInterval[]) =>
        (intervals || []).map((item, idx) => ({ ...item, time: idx + 1 }));

    const { gFetch, activePeerId } = usePeerContext();
    const authHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    const [quickTargets, setQuickTargets] = useState<{ label: string, host: string }[]>([]);
    const [sharedTargets, setSharedTargets] = useState<any[]>([]);
    const [allKnownTargets, setAllKnownTargets] = useState<any[]>([]);
    const [selectedTargetLabel, setSelectedTargetLabel] = useState<string>('');

    const getTargetDisplayName = (host?: string, port?: number, fallbackTargetName?: string): { name: string; isFriendly: boolean } => {
        if (fallbackTargetName && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(fallbackTargetName.trim())) {
            return { name: fallbackTargetName.trim(), isFriendly: true };
        }
        if (!host) return { name: 'Unknown Target', isFriendly: false };
        const qt = quickTargets.find(q => q.host === host);
        if (qt && qt.label && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(qt.label.trim())) {
            return { name: qt.label.trim(), isFriendly: true };
        }
        const st = allKnownTargets.find(t => t.host === host);
        if (st && st.name && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(st.name.trim())) {
            return { name: st.name.trim(), isFriendly: true };
        }
        const sh = sharedTargets.find(t => t.host === host);
        if (sh && sh.name && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(sh.name.trim())) {
            return { name: sh.name.trim(), isFriendly: true };
        }
        return { name: port ? `${host}:${port}` : host, isFriendly: false };
    };

    const formatDateDisplay = (dateStr: string | null) => {
        if (!dateStr) return 'N/A';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            const pad = (n: number) => n.toString().padStart(2, '0');
            const day = pad(d.getDate());
            const month = pad(d.getMonth() + 1);
            const year = d.getFullYear();
            const hours = pad(d.getHours());
            const mins = pad(d.getMinutes());
            const secs = pad(d.getSeconds());
            return `${day}/${month}/${year} ${hours}:${mins}:${secs}`;
        } catch {
            return dateStr;
        }
    };

    const [targetReachability, setTargetReachability] = useState<Record<string, boolean | 'loading'>>({});

    useEffect(() => {
        const targetsToPing: { host: string, port: number }[] = [];
        quickTargets.forEach(qt => targetsToPing.push({ host: qt.host, port: 6200 }));
        sharedTargets.forEach(st => {
            if (!targetsToPing.find(t => t.host === st.host)) {
                targetsToPing.push({ host: st.host, port: 6200 }); // Ping 6200 to verify it's a Stigix node
            }
        });

        if (!targetsToPing.length) return;

        const checkReachability = async () => {
            await Promise.all(targetsToPing.map(async (t) => {
                setTargetReachability(prev => ({ ...prev, [t.host]: 'loading' }));
                let isReachable = false;
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        const res = await gFetch('/api/convergence/reachability', {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ target: t.host, port: t.port })
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
                setTargetReachability(prev => ({ ...prev, [t.host]: isReachable }));
            }));
        };

        checkReachability();
        const interval = setInterval(checkReachability, 60000);
        const onWakeup = () => checkReachability();
        window.addEventListener('stigix:wakeup', onWakeup);
        return () => {
            clearInterval(interval);
            window.removeEventListener('stigix:wakeup', onWakeup);
        };
    }, [quickTargets, sharedTargets, token]);

    useEffect(() => {
        hasAutoLoadedRef.current = false;
        lastAutoJobIdRef.current = null;
        fetchHistory();
        fetchFeatures();
        fetchSharedTargets();
        fetchPresets();
        const interval = setInterval(fetchHistory, 5000);
        const targetsInterval = setInterval(() => {
            fetchFeatures();
            fetchSharedTargets();
            fetchPresets();
        }, 60000);
        const onWakeup = () => {
            fetchHistory();
            fetchFeatures();
            fetchSharedTargets();
            fetchPresets();
        };
        window.addEventListener('stigix:wakeup', onWakeup);
        return () => {
            if (sseRef.current) sseRef.current.close();
            clearInterval(interval);
            clearInterval(targetsInterval);
            window.removeEventListener('stigix:wakeup', onWakeup);
        };
    }, [activePeerId]);

    const fetchFeatures = async () => {
        try {
            const res = await gFetch('/api/features', { headers: authHeaders });
            const data = await res.json();
            if (res.ok && data.xfr_targets) {
                setQuickTargets(data.xfr_targets);
            }
        } catch (e) { }
    };

    const fetchSharedTargets = async () => {
        try {
            const res = await gFetch('/api/targets', { headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                const list = Array.isArray(data) ? data : [];
                setAllKnownTargets(list);
                setSharedTargets(list.filter((t: any) => t.enabled && t.capabilities?.xfr));
            }
        } catch (e) { }
    };

    const fetchPresets = async () => {
        try {
            const res = await gFetch('/api/xfr/presets', { headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.presets) && data.presets.length > 0) {
                    setPresets(data.presets);
                }
            }
        } catch (e) { }
    };

    const activePresetObj = presets.find(p => p.id === selectedPresetId) || null;
    const isPresetModified = Boolean(
        activePresetObj && (
            protocol !== activePresetObj.protocol ||
            direction !== activePresetObj.direction ||
            bitrate.trim().toUpperCase() !== activePresetObj.bitrate.trim().toUpperCase() ||
            duration !== activePresetObj.duration_sec ||
            streams !== activePresetObj.parallel_streams ||
            (dscp || '').trim().toUpperCase() !== (activePresetObj.dscp || '').trim().toUpperCase() ||
            (protocol === 'tcp' && (congestion || 'cubic') !== (activePresetObj.congestion || 'cubic'))
        )
    );

    const applyPreset = (preset: XfrPreset) => {
        setSelectedPresetId(preset.id);
        setProtocol(preset.protocol);
        setDirection(preset.direction);
        setBitrate(preset.bitrate);
        setDuration(preset.duration_sec);
        setStreams(preset.parallel_streams);
        setDscp(preset.dscp || '');
        setCongestion(preset.congestion || 'cubic');
        setShowSavePresetForm(false);
    };

    const handleSavePreset = async (updateExistingId?: string) => {
        const targetPreset = updateExistingId ? presets.find(p => p.id === updateExistingId) : null;
        const nameToSave = targetPreset ? targetPreset.name : newPresetName.trim();
        const descToSave = targetPreset ? targetPreset.description : newPresetDesc.trim();
        if (!nameToSave) {
            toast.error('Preset name is required');
            return;
        }
        setSavingPreset(true);
        try {
            const res = await gFetch('/api/xfr/presets', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    id: updateExistingId,
                    name: nameToSave,
                    description: descToSave,
                    protocol,
                    direction,
                    bitrate,
                    duration_sec: duration,
                    parallel_streams: streams,
                    dscp,
                    congestion
                })
            });
            const data = await res.json();
            if (!res.ok) {
                toast.error(data.error || 'Failed to save preset');
                return;
            }
            if (Array.isArray(data.presets)) setPresets(data.presets);
            if (data.preset?.id) setSelectedPresetId(data.preset.id);
            setShowSavePresetForm(false);
            setNewPresetName('');
            setNewPresetDesc('');
            toast.success(updateExistingId ? `Updated preset "${nameToSave}"` : `Saved preset "${nameToSave}"`);
        } catch (e: any) {
            toast.error(e.message || 'Error saving preset');
        } finally {
            setSavingPreset(false);
        }
    };

    const handleDeletePreset = async (preset: XfrPreset) => {
        if (preset.builtin) return;
        if (!confirm(`Delete custom preset "${preset.name}"?`)) return;
        try {
            const res = await gFetch(`/api/xfr/presets/${encodeURIComponent(preset.id)}`, {
                method: 'DELETE',
                headers: authHeaders
            });
            const data = await res.json();
            if (res.ok) {
                if (Array.isArray(data.presets)) setPresets(data.presets);
                if (selectedPresetId === preset.id) setSelectedPresetId('');
                toast.success(`Deleted preset "${preset.name}"`);
            } else {
                toast.error(data.error || 'Failed to delete preset');
            }
        } catch (e: any) {
            toast.error(e.message || 'Error deleting preset');
        }
    };

    const fetchHistory = async () => {
        try {
            const res = await gFetch('/api/tests/xfr', { headers: authHeaders });
            const data = await res.json();
            if (res.ok) {
                setHistory(data);
                if (data.length > 0) {
                    const match = data[0].sequence_id.match(/\d+/);
                    if (match) setCport(30000 + parseInt(match[0], 10) + 1);
                    const latest = data[0];
                    const latestKey = latest.id || latest.sequence_id;
                    if (!hasAutoLoadedRef.current || (lastAutoJobIdRef.current !== latestKey && !sseRef.current)) {
                        hasAutoLoadedRef.current = true;
                        lastAutoJobIdRef.current = latestKey;
                        try {
                            const detailRes = await gFetch(`/api/tests/xfr/${encodeURIComponent(latestKey)}`, { headers: authHeaders });
                            if (detailRes.ok) {
                                const fullJob = await detailRes.json();
                                setActiveJob({ ...latest, ...fullJob });
                                setChartData(formatIntervalsForChart(fullJob.intervals));
                            }
                        } catch { }
                    }
                } else {
                    setCport(30001);
                }
            }
        } catch (e) { }
    };

    const purgeHistory = async () => {
        if (!confirm('Are you sure you want to purge all bandwidth test history? This action cannot be undone.')) return;
        try {
            const res = await gFetch('/api/tests/xfr', {
                method: 'DELETE',
                headers: authHeaders
            });
            if (res.ok) {
                setHistory([]);
                if (showDetailModal) setShowDetailModal(false);
                toast.success('Bandwidth test history purged');
            } else {
                toast.error('Failed to purge history');
            }
        } catch (e: any) {
            toast.error(e.message || 'Error purging history');
        }
    };

    const deleteJob = async (job: any) => {
        if (!confirm(`Delete test record "${job.sequence_id}"?`)) return;
        try {
            const res = await gFetch(`/api/tests/xfr/${encodeURIComponent(job.id || job.sequence_id)}`, {
                method: 'DELETE',
                headers: authHeaders
            });
            if (res.ok) {
                setHistory(prev => prev.filter(j => j.id !== job.id && j.sequence_id !== job.sequence_id));
                if (selectedJob && (selectedJob.id === job.id || selectedJob.sequence_id === job.sequence_id)) {
                    setShowDetailModal(false);
                }
                toast.success(`Deleted ${job.sequence_id}`);
            } else {
                toast.error('Failed to delete test');
            }
        } catch (e: any) {
            toast.error(e.message || 'Error deleting test');
        }
    };

    const isValidDscp = (val: string) => {
        if (!val) return true;
        const upper = val.toUpperCase();
        const validNames = ['EF', 'AF11', 'AF12', 'AF13', 'AF21', 'AF22', 'AF23', 'AF31', 'AF32', 'AF33', 'AF41', 'AF42', 'AF43', 'CS0', 'CS1', 'CS2', 'CS3', 'CS4', 'CS5', 'CS6', 'CS7'];
        if (validNames.includes(upper)) return true;
        const num = parseInt(val, 10);
        return !isNaN(num) && num >= 0 && num <= 255 && num.toString() === val;
    };

    const runTest = async (overrideHost?: string, overridePort?: number) => {
        const h = overrideHost || targetHost;
        const p = overridePort !== undefined ? overridePort : targetPort;
        
        if (!h) {
            toast.error('Host is required');
            return;
        }

        const body = mode === 'default' ? {
            mode: 'default',
            target: { host: h, port: p, label: selectedTargetLabel || getTargetDisplayName(h).name }
        } : {
            mode: 'custom',
            target: { host: h, port: p, psk, label: selectedTargetLabel || getTargetDisplayName(h).name },
            protocol,
            direction,
            duration_sec: duration,
            bitrate,
            parallel_streams: streams,
            dscp,
            congestion,
            cport,
            preset_id: activePresetObj ? (isPresetModified ? `${activePresetObj.id}:modified` : activePresetObj.id) : undefined,
            preset_name: activePresetObj ? (isPresetModified ? `${activePresetObj.name} (Modified)` : activePresetObj.name) : undefined
        };

        try {
            console.log(`[XFR] Starting test to ${h}:${p}...`);
            const res = await gFetch('/api/tests/xfr', {
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
            const res = await gFetch(`/api/tests/xfr/${id}`, { headers: authHeaders });
            const data = await res.json();
            if (res.ok) {
                setActiveJob(data);
                if (data.status === 'running' || data.status === 'queued') {
                    setTimeout(() => pollJob(id), 2000);
                } else {
                    if (Array.isArray(data.intervals) && data.intervals.length > 0) {
                        setChartData(formatIntervalsForChart(data.intervals));
                    }
                    fetchHistory();
                }
            }
        } catch (e) { }
    };

    const subscribeToStream = (id: string) => {
        if (sseRef.current) sseRef.current.close();
        setChartData([]);

        // In remote-view mode, the EventSource must go through the gateway so that
        // BR8 streams the test events — not DC1. activePeerId is null in local mode.
        const gwPrefix = activePeerId ? `/api/gateway/${activePeerId}` : '';
        const sse = new EventSource(`${gwPrefix}/api/tests/xfr/${id}/stream?token=${token}`);
        sseRef.current = sse;
        
        let counter = 0;
        sse.addEventListener('interval', (e: any) => {
            const data = JSON.parse(e.data);
            counter++;
            setChartData(prev => {
                const next = [...prev, { ...data, time: counter }];
                // Allow up to 300 seconds (5 mins) or the requested test duration on the graph
                return next.slice(-Math.max(60, duration + 10, 300));
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

    const viewJobDetails = async (job: XfrJob) => {
        setSelectedJob(job);
        setShowDetailModal(true);
        try {
            const res = await gFetch(`/api/tests/xfr/${encodeURIComponent(job.id || job.sequence_id)}`, { headers: authHeaders });
            if (res.ok) {
                const fullJob = await res.json();
                const mergedJob: XfrJob = { ...job, ...fullJob };
                setSelectedJob(mergedJob);
                if (!isRunning) {
                    setActiveJob(mergedJob);
                    setChartData(formatIntervalsForChart(mergedJob.intervals));
                }
            }
        } catch { }
    };

    const filteredHistory = history.filter(j => {
        if (selectedHistoryPreset !== 'all') {
            if (selectedHistoryPreset === '__default__') {
                if (j.params?.mode !== 'default' && j.params?.preset_id) return false;
            } else {
                const jobPresetId = j.params?.preset_id || '';
                const jobPresetName = j.params?.preset_name || '';
                if (jobPresetId !== selectedHistoryPreset && jobPresetName !== selectedHistoryPreset && jobPresetId.replace(/:modified$/, '') !== selectedHistoryPreset) {
                    return false;
                }
            }
        }
        if (selectedHistoryTarget !== 'all' && j.params?.host !== selectedHistoryTarget) {
            return false;
        }
        const q = searchQuery.toLowerCase();
        if (!q) return true;
        const targetName = getTargetDisplayName(j.params?.host, j.params?.port, j.params?.target_name).name;
        return (
            j.sequence_id?.toLowerCase().includes(q) ||
            j.params?.host?.toLowerCase().includes(q) ||
            targetName.toLowerCase().includes(q) ||
            j.params?.preset_name?.toLowerCase().includes(q) ||
            j.status?.toLowerCase().includes(q)
        );
    });

    const isRunning = activeJob?.status === 'running' || activeJob?.status === 'queued';

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row gap-6 items-stretch">
                {/* Configuration Side */}
                {isConfigExpanded ? (
                    <div className="w-full md:w-96 flex flex-col shrink-0 animate-in slide-in-from-left-4 fade-in duration-300">
                        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm overflow-hidden relative flex-1 flex flex-col">
                            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                                <Gauge size={110} />
                            </div>

                            <div className="flex items-center justify-between mb-4 relative z-10">
                                <h2 className="text-lg font-black text-text-primary flex items-center gap-2 tracking-tight">
                                    <Zap className="text-blue-500" size={20} />
                                    Bandwidth Test
                                </h2>
                                <button
                                    onClick={() => setIsConfigExpanded(false)}
                                    title="Collapse Configuration"
                                    className="p-1.5 hover:bg-card-secondary rounded-lg text-text-muted hover:text-text-primary transition-colors"
                                >
                                    <ChevronLeft size={18} />
                                </button>
                            </div>

                            <div className="flex p-1 bg-card-secondary rounded-xl mb-4 border border-border/50">
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

                            <div className="space-y-3.5 flex-1 flex flex-col">
                                {/* Unified Stigix Targets Selector (shared between Default & Custom) */}
                                {(() => {
                                    const allTargets = [
                                        ...quickTargets.map((t, i) => ({
                                            key: `env-${i}`,
                                            label: t.label,
                                            host: t.host,
                                            port: 9000,
                                            accent: 'blue' as const,
                                        })),
                                        ...sharedTargets
                                            .filter(st => !quickTargets.some(qt => qt.host === st.host))
                                            .map(t => ({
                                                key: `tgt-${t.id}`,
                                                label: t.name,
                                                host: t.host,
                                                port: (t.ports?.xfr && t.ports.xfr !== 5201) ? t.ports.xfr : 9000,
                                                accent: 'emerald' as const,
                                            })),
                                    ];

                                    const getStatusRank = (host: string) => {
                                        const st = targetReachability[host];
                                        if (st === true) return 0;
                                        if (st === 'loading' || st === undefined) return 1;
                                        return 2;
                                    };

                                    const sortedTargets = [...allTargets].sort((a, b) => getStatusRank(a.host) - getStatusRank(b.host));
                                    const onlineCount = sortedTargets.filter(t => targetReachability[t.host] === true).length;

                                    if (sortedTargets.length === 0) return null;

                                    return (
                                        <div>
                                            <div className="flex items-center justify-between mb-2">
                                                <label className="text-[10px] font-black text-text-muted tracking-widest flex items-center gap-1.5 uppercase">
                                                    <Target size={13} className="text-blue-500" />
                                                    Stigix Targets
                                                </label>
                                                <span className="text-[9px] font-mono font-bold text-text-muted">
                                                    <span className="text-green-500">{onlineCount}</span>/{sortedTargets.length} online
                                                </span>
                                            </div>

                                            <div className={cn(
                                                "grid grid-cols-2 gap-1.5 overflow-y-auto pr-1 transition-all",
                                                mode === 'default' ? "max-h-[212px]" : "max-h-[158px]"
                                            )}>
                                                {sortedTargets.map((t) => {
                                                    const isSelected = targetHost === t.host;
                                                    const status = targetReachability[t.host];
                                                    const isEmerald = t.accent === 'emerald';
                                                    return (
                                                        <div
                                                            key={t.key}
                                                            onClick={() => { setTargetHost(t.host); setTargetPort(t.port); setSelectedTargetLabel(t.label); }}
                                                            className={cn(
                                                                "bg-card border px-2.5 py-2 rounded-xl group cursor-pointer transition-all flex flex-col justify-between gap-0.5 shadow-sm hover:shadow-md",
                                                                isSelected
                                                                    ? isEmerald
                                                                        ? "border-emerald-500 bg-emerald-600/5 shadow-emerald-500/10"
                                                                        : "border-blue-500 bg-blue-600/5 shadow-blue-500/10"
                                                                    : "border-border hover:border-border/80"
                                                            )}
                                                        >
                                                            <div className="flex items-center justify-between gap-1.5 min-w-0">
                                                                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                                                    <div className="shrink-0 flex items-center justify-center w-2.5">
                                                                        {status === 'loading' || status === undefined ? (
                                                                            <div className="w-1.5 h-1.5 rounded-full bg-border animate-pulse shrink-0" title="Checking reachability..." />
                                                                        ) : status ? (
                                                                            <div className="relative flex h-2 w-2 items-center justify-center shrink-0" title="Reachable">
                                                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" style={{ animationDuration: '3s' }}></span>
                                                                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
                                                                            </div>
                                                                        ) : (
                                                                            <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)] shrink-0" title="Unreachable" />
                                                                        )}
                                                                    </div>
                                                                    <h4 className={cn(
                                                                        "text-[11px] font-bold transition-colors tracking-tight truncate",
                                                                        isSelected ? (isEmerald ? "text-emerald-500" : "text-blue-500") : "text-text-primary"
                                                                    )} title={t.label}>
                                                                        {t.label}
                                                                    </h4>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setTargetHost(t.host);
                                                                        setTargetPort(t.port);
                                                                        setSelectedTargetLabel(t.label);
                                                                        runTest(t.host, t.port);
                                                                    }}
                                                                    className={cn(
                                                                        "p-1 rounded-md transition-colors border shadow-sm shrink-0",
                                                                        isEmerald
                                                                            ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-600 hover:text-white border-emerald-500/20 hover:border-emerald-600"
                                                                            : "bg-blue-500/10 text-blue-500 hover:bg-blue-600 hover:text-white border-blue-500/20 hover:border-blue-600"
                                                                    )}
                                                                    title="Quick Launch Speedtest"
                                                                >
                                                                    <Play size={9} fill="currentColor" />
                                                                </button>
                                                            </div>
                                                            <p className="text-[9px] text-text-muted font-mono truncate pl-4">{t.host}:{t.port}</p>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Target IP + Port on a single horizontal row (shared between Default & Custom) */}
                                <div className="pt-2.5 border-t border-border/60 grid grid-cols-3 gap-2.5">
                                    <div className="col-span-2">
                                        <label className="text-[10px] font-black text-text-muted tracking-widest mb-1 block uppercase">Target IP / FQDN</label>
                                        <div className="relative">
                                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted/50">
                                                <Network size={13} />
                                            </div>
                                            <input
                                                type="text"
                                                value={targetHost}
                                                onChange={e => { setTargetHost(e.target.value); setSelectedTargetLabel(''); }}
                                                placeholder="e.g. 1.2.3.4"
                                                className="w-full bg-card-secondary border border-border rounded-xl pl-8 pr-3 py-2 text-xs focus:border-blue-500 outline-none transition-all font-mono"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-text-muted tracking-widest mb-1 block uppercase">Port</label>
                                        <input
                                            type="number"
                                            value={targetPort}
                                            onChange={e => setTargetPort(parseInt(e.target.value))}
                                            className="w-full bg-card-secondary border border-border rounded-xl px-3 py-2 text-xs focus:border-blue-500 outline-none transition-all font-mono"
                                        />
                                    </div>
                                </div>

                                {mode === 'default' ? (
                                    /* Compact Default Profile Summary Strip (single line) */
                                    <div className="px-3 py-2 rounded-xl bg-card-secondary/50 border border-border/50 flex items-center justify-between gap-2 text-[10px] font-mono text-text-muted whitespace-nowrap overflow-hidden">
                                        <span className="font-sans font-black uppercase tracking-wider text-[9px] text-text-secondary shrink-0">Profile:</span>
                                        <span className="truncate">TCP Cubic • Upload • 200M • 10s • 4 streams</span>
                                    </div>
                                ) : (
                                    <div className="space-y-3 animate-in fade-in duration-200">
                                        {/* Use-Case Presets Selector */}
                                        <div className="pt-2.5 border-t border-border/60">
                                            <div className="flex items-center justify-between mb-2">
                                                <label className="text-[10px] font-black text-text-muted tracking-widest flex items-center gap-1.5 uppercase">
                                                    <Bookmark size={12} className="text-violet-500" />
                                                    Use-Case Presets
                                                </label>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setShowSavePresetForm(!showSavePresetForm);
                                                        if (!showSavePresetForm && activePresetObj && !activePresetObj.builtin) {
                                                            setNewPresetName(activePresetObj.name);
                                                            setNewPresetDesc(activePresetObj.description || '');
                                                        }
                                                    }}
                                                    className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider bg-violet-500/10 text-violet-500 hover:bg-violet-500/20 border border-violet-500/20 transition-colors cursor-pointer"
                                                >
                                                    <Plus size={10} />
                                                    {showSavePresetForm ? 'Cancel' : 'Save Preset'}
                                                </button>
                                            </div>

                                            <div className="grid grid-cols-2 gap-1.5 max-h-[156px] overflow-y-auto pr-1">
                                                {presets.map((p) => {
                                                    const isSelected = selectedPresetId === p.id;
                                                    const isCustom = !p.builtin;
                                                    return (
                                                        <div
                                                            key={p.id}
                                                            onClick={() => applyPreset(p)}
                                                            title={p.description}
                                                            className={cn(
                                                                "bg-card border px-2.5 py-1.5 rounded-xl group cursor-pointer transition-all flex flex-col justify-between gap-0.5 shadow-sm hover:shadow-md relative",
                                                                isSelected
                                                                    ? isCustom
                                                                        ? "border-violet-500 bg-violet-600/5 shadow-violet-500/10"
                                                                        : "border-blue-500 bg-blue-600/5 shadow-blue-500/10"
                                                                    : "border-border hover:border-border/80"
                                                            )}
                                                        >
                                                            <div className="flex items-center justify-between gap-1 min-w-0">
                                                                <span className={cn(
                                                                    "text-[10px] font-black tracking-tight truncate",
                                                                    isSelected ? (isCustom ? "text-violet-500" : "text-blue-500") : "text-text-primary"
                                                                )}>
                                                                    {p.name}
                                                                </span>
                                                                <div className="flex items-center gap-1 shrink-0">
                                                                    {isCustom && (
                                                                        <span className="text-[8px] font-black uppercase px-1 py-0.2 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
                                                                            Fleet
                                                                        </span>
                                                                    )}
                                                                    {isCustom && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                handleDeletePreset(p);
                                                                            }}
                                                                            title="Delete custom preset"
                                                                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/10 text-text-muted hover:text-red-400 transition-all"
                                                                        >
                                                                            <Trash2 size={10} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="text-[8px] font-mono text-text-muted truncate">
                                                                {p.protocol.toUpperCase()} • {p.bitrate === '0' ? 'Max' : p.bitrate} • {p.parallel_streams}x • {p.duration_sec}s{p.dscp ? ` • ${p.dscp}` : ''}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {/* Active preset description & modified indicator */}
                                            {activePresetObj && (
                                                <div className="mt-1.5 px-2.5 py-1.5 rounded-lg bg-card-secondary/60 border border-border/50 flex items-center justify-between gap-2">
                                                    <p className="text-[9px] text-text-muted leading-tight truncate flex-1" title={activePresetObj.description}>
                                                        <span className="font-black text-text-secondary">{activePresetObj.name}:</span> {activePresetObj.description}
                                                    </p>
                                                    {isPresetModified && (
                                                        <div className="flex items-center gap-1 shrink-0">
                                                            <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                                                Modified
                                                            </span>
                                                            {!activePresetObj.builtin && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleSavePreset(activePresetObj.id)}
                                                                    disabled={savingPreset}
                                                                    title="Update this custom preset with modified parameters"
                                                                    className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-violet-600 text-white hover:bg-violet-500 transition-colors"
                                                                >
                                                                    Update
                                                                </button>
                                                            )}
                                                            <button
                                                                type="button"
                                                                onClick={() => applyPreset(activePresetObj)}
                                                                title="Reset parameters to preset baseline"
                                                                className="p-1 rounded bg-card hover:bg-card-secondary border border-border text-text-muted hover:text-text-primary transition-colors"
                                                            >
                                                                <RotateCcw size={9} />
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* Save / Update Custom Preset Inline Drawer */}
                                            {showSavePresetForm && (
                                                <div className="mt-2 p-2.5 rounded-xl bg-violet-500/5 border border-violet-500/20 space-y-2 animate-in fade-in duration-150">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[9px] font-black uppercase tracking-wider text-violet-400">
                                                            Save Current Profile as Fleet Preset
                                                        </span>
                                                        <span className="text-[8px] font-mono text-text-muted">
                                                            {protocol.toUpperCase()} • {bitrate} • {streams}x • {duration}s
                                                        </span>
                                                    </div>
                                                    <input
                                                        type="text"
                                                        value={newPresetName}
                                                        onChange={e => setNewPresetName(e.target.value)}
                                                        placeholder="Preset Name (e.g. Branch VoIP SLA)"
                                                        className="w-full bg-card border border-border rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-violet-500"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={newPresetDesc}
                                                        onChange={e => setNewPresetDesc(e.target.value)}
                                                        placeholder="Short description / objective (optional)"
                                                        className="w-full bg-card border border-border rounded-lg px-2.5 py-1.5 text-[11px] outline-none focus:border-violet-500"
                                                    />
                                                    <div className="flex justify-end gap-1.5">
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowSavePresetForm(false)}
                                                            className="px-2.5 py-1 rounded-lg text-[9px] font-bold text-text-muted hover:text-text-primary border border-border bg-card"
                                                        >
                                                            Cancel
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={savingPreset || !newPresetName.trim()}
                                                            onClick={() => handleSavePreset()}
                                                            className="px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 transition-all"
                                                        >
                                                            {savingPreset ? 'Saving...' : 'Save & Sync Fleet'}
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Row 2: Protocol + Direction */}
                                        <div className="grid grid-cols-2 gap-2.5">
                                            <div>
                                                <label className="text-[10px] font-black text-text-muted tracking-widest mb-1 block uppercase">Protocol</label>
                                                <StigixSelect
                                                    value={protocol}
                                                    onChange={val => setProtocol(val as any)}
                                                    accent="blue"
                                                    triggerClassName="bg-card-secondary rounded-xl px-3 py-2 text-xs"
                                                    options={[
                                                        { value: 'tcp', label: 'TCP' },
                                                        { value: 'udp', label: 'UDP' },
                                                        { value: 'quic', label: 'QUIC' },
                                                    ]}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-black text-text-muted tracking-widest mb-1 block uppercase">Direction</label>
                                                <StigixSelect
                                                    value={direction}
                                                    onChange={val => setDirection(val as any)}
                                                    accent="blue"
                                                    triggerClassName="bg-card-secondary rounded-xl px-3 py-2 text-xs"
                                                    options={[
                                                        { value: 'client-to-server', label: 'Upload (TX)' },
                                                        { value: 'server-to-client', label: 'Download (RX)' },
                                                        { value: 'bidirectional', label: 'Bidirectional' },
                                                    ]}
                                                />
                                            </div>
                                        </div>

                                        {/* Row 3: Bitrate + Duration + Streams */}
                                        <div className="grid grid-cols-3 gap-2.5">
                                            <div>
                                                <label className="text-[10px] font-black text-text-muted tracking-widest mb-1 block uppercase" title="e.g. 100M, 0=Max">Bitrate</label>
                                                <input
                                                    type="text"
                                                    value={bitrate}
                                                    onChange={e => setBitrate(e.target.value)}
                                                    placeholder="200M"
                                                    className="w-full bg-card-secondary border border-border rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-blue-500"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-black text-text-muted tracking-widest mb-1 flex items-center justify-between uppercase">
                                                    <span>Duration</span>
                                                    <span className="text-[8px] font-mono opacity-50 lowercase">s</span>
                                                </label>
                                                <input
                                                    type="number"
                                                    min="10"
                                                    max="3600"
                                                    value={duration}
                                                    onChange={e => setDuration(parseInt(e.target.value))}
                                                    onBlur={e => {
                                                        const val = parseInt(e.target.value);
                                                        setDuration(isNaN(val) ? 10 : Math.min(3600, Math.max(10, val)));
                                                    }}
                                                    className="w-full bg-card-secondary border border-border rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-blue-500"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-black text-text-muted tracking-widest mb-1 block uppercase">Streams</label>
                                                <input
                                                    type="number"
                                                    value={streams}
                                                    onChange={e => setStreams(parseInt(e.target.value))}
                                                    className="w-full bg-card-secondary border border-border rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-blue-500"
                                                />
                                            </div>
                                        </div>

                                        {/* Collapsible Advanced Options (DSCP, Src Port, Congestion, PSK) */}
                                        <div className="pt-1">
                                            <button
                                                type="button"
                                                onClick={() => setShowAdvancedParams(!showAdvancedParams)}
                                                className="w-full px-3 py-1.5 rounded-xl bg-card-secondary/50 hover:bg-card-secondary border border-border/60 flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-wider text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                                            >
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span>Advanced Options</span>
                                                    {dscp && (
                                                        <span className="px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono text-[8px]">
                                                            DSCP {dscp}
                                                        </span>
                                                    )}
                                                    {cport !== 30000 && (
                                                        <span className="px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono text-[8px]">
                                                            Port {cport}
                                                        </span>
                                                    )}
                                                    {protocol === 'tcp' && congestion !== 'cubic' && (
                                                        <span className="px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono text-[8px]">
                                                            {congestion.toUpperCase()}
                                                        </span>
                                                    )}
                                                    {psk && (
                                                        <span className="px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono text-[8px]">
                                                            PSK
                                                        </span>
                                                    )}
                                                </div>
                                                {showAdvancedParams ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                            </button>

                                            {showAdvancedParams && (
                                                <div className="mt-2.5 space-y-2.5 animate-in fade-in duration-150">
                                                    {/* Row 4: DSCP + Client Port */}
                                                    <div className="grid grid-cols-2 gap-2.5">
                                                        <div>
                                                            <label className="text-[10px] font-black text-text-muted tracking-widest mb-1 block uppercase">DSCP / TOS</label>
                                                            <input
                                                                type="text"
                                                                list="dscp-options"
                                                                value={dscp}
                                                                onChange={e => setDscp(e.target.value)}
                                                                placeholder="Default (0)"
                                                                className={`w-full bg-card-secondary border rounded-xl px-3 py-2 text-xs font-mono outline-none transition-colors ${dscp && !isValidDscp(dscp) ? 'border-red-500/50 focus:border-red-500' : 'border-border focus:border-blue-500'}`}
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
                                                                <span className="text-[9px] text-red-500 font-bold block mt-0.5">Invalid DSCP</span>
                                                            )}
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] font-black text-text-muted tracking-widest mb-1 block uppercase">Src Flow Port</label>
                                                            <input
                                                                type="number"
                                                                value={cport}
                                                                onChange={e => setCport(parseInt(e.target.value))}
                                                                className="w-full bg-card-secondary border border-border rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-blue-500"
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* Row 5: Congestion + PSK */}
                                                    <div className="grid grid-cols-2 gap-2.5">
                                                        <div>
                                                            <label className="text-[10px] font-black text-text-muted tracking-widest mb-1 block uppercase">Congestion</label>
                                                            {protocol === 'tcp' ? (
                                                                <StigixSelect
                                                                    value={congestion}
                                                                    onChange={val => setCongestion(val)}
                                                                    accent="blue"
                                                                    triggerClassName="bg-card-secondary rounded-xl px-3 py-2 text-xs"
                                                                    options={[
                                                                        { value: 'cubic', label: 'Cubic (Default)' },
                                                                        { value: 'reno', label: 'Reno' },
                                                                    ]}
                                                                />
                                                            ) : (
                                                                <div className="w-full bg-card-secondary/50 border border-border/50 rounded-xl px-3 py-2 text-xs font-mono text-text-muted">
                                                                    N/A ({protocol.toUpperCase()})
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] font-black text-text-muted tracking-widest mb-1 block uppercase">PSK (Optional)</label>
                                                            <input
                                                                type="password"
                                                                value={psk}
                                                                onChange={e => setPsk(e.target.value)}
                                                                placeholder="••••••"
                                                                className="w-full bg-card-secondary border border-border rounded-xl px-3 py-2 text-xs outline-none focus:border-blue-500"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <button
                                    onClick={() => runTest()}
                                    disabled={isRunning || !targetHost || !isValidIpOrFqdn(targetHost) || !isValidDscp(dscp)}
                                    className={cn(
                                        "w-full py-3 mt-auto rounded-xl font-black tracking-widest text-xs flex items-center justify-center gap-2 transition-all shadow-xl",
                                        isRunning || !targetHost || !isValidDscp(dscp) ? "bg-card-secondary text-text-muted cursor-not-allowed" :
                                            !isValidIpOrFqdn(targetHost) ? "bg-red-500/10 text-red-500 border border-red-500/20 cursor-not-allowed" :
                                                "bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:opacity-90 active:scale-[0.98]"
                                    )}
                                >
                                    {isRunning ? (
                                        <>
                                            <RefreshCw size={16} className="animate-spin" />
                                            Running Test...
                                        </>
                                    ) : !targetHost ? (
                                        <>
                                            <Play size={16} fill="currentColor" />
                                            Launch Speedtest
                                        </>
                                    ) : !isValidIpOrFqdn(targetHost) ? (
                                        <>
                                            <AlertCircle size={16} />
                                            Invalid Target IP/FQDN
                                        </>
                                    ) : (
                                        <>
                                            <Play size={16} fill="currentColor" />
                                            Launch Speedtest
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="hidden md:flex w-16 shrink-0 flex-col gap-4 animate-in slide-in-from-left-4 fade-in duration-300">
                        <button
                            onClick={() => setIsConfigExpanded(true)}
                            title="Expand Configuration"
                            className="bg-card border border-border rounded-2xl py-6 flex flex-col items-center gap-4 shadow-sm hover:border-blue-500/50 hover:bg-card-secondary transition-all w-full text-text-muted hover:text-blue-500 group"
                        >
                            <Zap size={20} className="text-blue-500 group-hover:scale-110 transition-transform" />
                            <ChevronRight size={18} />
                        </button>
                    </div>
                )}

                {/* Main Results & Chart */}
                <div className="flex-1 flex flex-col min-w-0">
                    {/* Live Results Panel */}
                    <div className="bg-card border border-border rounded-2xl p-6 shadow-xl relative overflow-hidden flex-1 flex flex-col justify-between">
                        <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none rotate-12">
                            <Zap size={200} className="text-blue-500" />
                        </div>

                        <div className="flex items-center justify-between mb-8 relative z-10">
                            <div>
                                <div className="flex items-center gap-2.5 flex-wrap">
                                    <h2 className="text-2xl font-black text-text-primary tracking-tight">
                                        {isRunning ? 'Live Performance' : (activeJob?.summary ? 'Test Completed' : 'Session Ready')}
                                    </h2>
                                    {activeJob?.params?.preset_name && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-violet-500/10 text-violet-400 border border-violet-500/20">
                                            <Bookmark size={11} className="text-violet-400" />
                                            {activeJob.params.preset_name}
                                        </span>
                                    )}
                                </div>
                                <p className="text-[10px] font-black text-text-muted tracking-[0.2em] opacity-60">
                                    {isRunning 
                                        ? (activeJob?.sequence_id 
                                            ? `Analyzing sequence #${activeJob.sequence_id}` 
                                            : `Live Stream • Target: ${getTargetDisplayName(activeJob?.params?.host, activeJob?.params?.port, activeJob?.params?.target_name).name}`)
                                        : (activeJob?.summary 
                                            ? `Summary for ${activeJob.sequence_id || 'Last Run'} • Target: ${getTargetDisplayName(activeJob?.params?.host, activeJob?.params?.port, activeJob?.params?.target_name).name}${activeJob?.params?.host ? ` (${activeJob.params.host}:${activeJob.params.port})` : ''}` 
                                            : 'Select target and launch test')}
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
                                    <Clock size={14} className="text-cyan-500" /> {activeJob?.params?.protocol === 'udp' ? 'Jitter' : 'Latency (RTT)'}
                                </label>
                                <div className="flex items-baseline gap-2">
                                    <span className="text-3xl font-black text-text-primary tracking-tighter">
                                        {activeJob?.params?.protocol === 'udp'
                                            ? (activeJob?.summary ? (activeJob.summary.jitter_ms_avg ?? 0).toFixed(2) : (chartData.length > 0 ? (chartData[chartData.length - 1].jitter_ms ?? 0).toFixed(2) : '0.00'))
                                            : (activeJob?.summary ? activeJob.summary.rtt_ms_avg.toFixed(1) : (chartData.length > 0 ? chartData[chartData.length - 1].rtt_ms?.toFixed(1) : '0.0'))}
                                    </span>
                                    <span className="text-[10px] font-black text-text-muted italic opacity-40">ms</span>
                                </div>
                            </div>
                            {activeJob?.params.protocol === 'tcp' ? (
                                <div className="bg-card-secondary/50 border border-border/50 rounded-2xl p-5 group hover:border-indigo-500/30 transition-all">
                                    <label className="text-[10px] font-black text-text-muted tracking-widest opacity-60 flex items-center gap-2 mb-2">
                                        <Layers size={14} className="text-indigo-500" /> TCP Window
                                    </label>
                                    <div className="flex items-baseline gap-2">
                                        {(() => {
                                            const rawVal = activeJob?.summary ?
                                                (activeJob.summary.cwnd || (chartData.length > 0 ? chartData[chartData.length - 1].cwnd : 0)) :
                                                (chartData.length > 0 ? chartData[chartData.length - 1].cwnd || 0 : 0);
                                            const formatted = formatCwnd(typeof rawVal === 'number' ? rawVal : parseFloat(rawVal) || 0);
                                            return (
                                                <>
                                                    <span className="text-3xl font-black text-text-primary tracking-tighter text-indigo-500">
                                                        {formatted.val}
                                                    </span>
                                                    <span className="text-[10px] font-black text-text-muted italic opacity-40">{formatted.unit}</span>
                                                </>
                                            );
                                        })()}
                                    </div>
                                </div>
                            ) : (
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
                            )}

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
                        <div className="flex-1 min-h-[256px] mt-4 relative z-10">
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={chartData}>
                                    <defs>
                                        {/* Emerald green gradient for Sent / Upload throughput */}
                                        <linearGradient id="colorSent" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                                            <stop offset="60%" stopColor="#10b981" stopOpacity={0.12} />
                                            <stop offset="100%" stopColor="#10b981" stopOpacity={0.0} />
                                        </linearGradient>
                                        {/* Electric blue gradient for Received / Download throughput */}
                                        <linearGradient id="colorReceived" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                                            <stop offset="60%" stopColor="#3b82f6" stopOpacity={0.12} />
                                            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.0} />
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
                                                                <span className="font-bold text-indigo-400">TCP Window</span>
                                                                <span className="font-black text-indigo-400">{formatCwnd(payload[0].payload.cwnd).val} {formatCwnd(payload[0].payload.cwnd).unit}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }}
                                    />
                                    <Area 
                                        yAxisId="left" 
                                        type="monotone" 
                                        dataKey="sent_mbps" 
                                        name="Sent Mbps" 
                                        stroke="#10b981" 
                                        strokeWidth={2.5} 
                                        fillOpacity={1} 
                                        fill="url(#colorSent)" 
                                        dot={false}
                                        activeDot={{ r: 5, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }}
                                    />
                                    <Area 
                                        yAxisId="left" 
                                        type="monotone" 
                                        dataKey="received_mbps" 
                                        name="Received Mbps" 
                                        stroke="#3b82f6" 
                                        strokeWidth={2.5} 
                                        fillOpacity={1} 
                                        fill="url(#colorReceived)" 
                                        dot={false}
                                        activeDot={{ r: 5, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }}
                                    />
                                    {activeJob?.params.protocol === 'tcp' && (
                                        <Line yAxisId="right" type="monotone" dataKey="rtt_ms" name="RTT" stroke="#06b6d4" strokeWidth={2} dot={false} strokeDasharray="3 3" />
                                    )}
                                    <Bar yAxisId="right" dataKey={activeJob?.params.protocol === 'udp' ? 'lost' : 'retransmits'} name={activeJob?.params.protocol === 'udp' ? 'Packets Lost' : 'Retransmits'} fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={16} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            </div>

            {/* History Table Widget (Full Width) */}
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
                            <div className="flex items-center gap-2">
                                {history.length > 0 && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            purgeHistory();
                                        }}
                                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-widest text-red-600 dark:text-red-400 bg-red-600/5 hover:bg-red-600/10 border border-red-500/20 rounded-lg transition-all shrink-0 cursor-pointer"
                                        title="Purge all bandwidth test history"
                                    >
                                        <Trash2 size={12} />
                                        PURGE ALL
                                    </button>
                                )}
                                <button
                                    onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
                                    className="p-2 hover:bg-card rounded-lg transition-colors border border-transparent hover:border-border text-text-muted"
                                >
                                    {isHistoryExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                </button>
                            </div>
                        </div>

                        {isHistoryExpanded && (
                            <div className="p-6 space-y-5">
                                {/* Preset Filter Pill Bar & Target Evolution Selector */}
                                {(() => {
                                    // Discover unique presets used in history + configured presets
                                    const presetOptionsMap = new Map<string, string>();
                                    presets.forEach(p => presetOptionsMap.set(p.id, p.name));
                                    history.forEach(j => {
                                        if (j.params?.preset_id && j.params?.preset_name) {
                                            const baseId = j.params.preset_id.replace(/:modified$/, '');
                                            if (!presetOptionsMap.has(baseId)) {
                                                presetOptionsMap.set(baseId, j.params.preset_name.replace(/\s*\(Modified\)$/i, ''));
                                            }
                                        }
                                    });
                                    const uniqueTargetsMap = new Map<string, string>();
                                    history.forEach(j => {
                                        if (j.params?.host) {
                                            const name = getTargetDisplayName(j.params.host, j.params.port, j.params.target_name).name;
                                            uniqueTargetsMap.set(j.params.host, name);
                                        }
                                    });

                                    // Compute chronological runs for trend chart when a preset (or target) is filtered
                                    const completedRuns = [...filteredHistory]
                                        .filter(j => j.status === 'completed' && j.summary)
                                        .reverse();

                                    const trendData = completedRuns.map((j, idx) => {
                                        const isRx = j.params?.direction === 'server-to-client';
                                        const mbps = Math.round(isRx ? (j.summary?.received_mbps || j.summary?.sent_mbps || 0) : (j.summary?.sent_mbps || j.summary?.received_mbps || 0));
                                        const rtt = Number((j.params?.protocol === 'udp' ? (j.summary?.jitter_ms_avg ?? 0) : (j.summary?.rtt_ms_avg ?? 0)).toFixed(1));
                                        const lossOrRxmt = j.params?.protocol === 'udp'
                                            ? Number((j.summary?.loss_percent ?? 0).toFixed(2))
                                            : (j.summary?.retransmits ?? 0);
                                        const targetLabel = getTargetDisplayName(j.params?.host, j.params?.port, j.params?.target_name).name;
                                        return {
                                            idx: idx + 1,
                                            seq: j.sequence_id,
                                            date: formatDateDisplay(j.started_at),
                                            mbps,
                                            rtt,
                                            lossOrRxmt,
                                            protocol: j.params?.protocol || 'tcp',
                                            target: targetLabel,
                                            preset: j.params?.preset_name || (j.params?.mode === 'default' ? 'Default' : 'Custom'),
                                            job: j
                                        };
                                    });

                                    const avgMbps = trendData.length > 0
                                        ? Math.round(trendData.reduce((acc, d) => acc + d.mbps, 0) / trendData.length)
                                        : 0;
                                    const peakMbps = trendData.length > 0
                                        ? Math.max(...trendData.map(d => d.mbps))
                                        : 0;
                                    const latestMbps = trendData.length > 0 ? trendData[trendData.length - 1].mbps : 0;
                                    const deltaPercent = trendData.length >= 2 && avgMbps > 0
                                        ? Math.round(((latestMbps - avgMbps) / avgMbps) * 100)
                                        : null;
                                    const avgRtt = trendData.length > 0
                                        ? (trendData.reduce((acc, d) => acc + d.rtt, 0) / trendData.length).toFixed(1)
                                        : '0.0';

                                    return (
                                        <div className="space-y-4">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span className="text-[9px] font-black uppercase tracking-widest text-text-muted mr-1 flex items-center gap-1">
                                                        <Bookmark size={11} className="text-violet-500" />
                                                        Preset:
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => setSelectedHistoryPreset('all')}
                                                        className={cn(
                                                            "px-2.5 py-1 rounded-lg text-[10px] font-black transition-all border cursor-pointer",
                                                            selectedHistoryPreset === 'all'
                                                                ? "bg-blue-600 text-white border-blue-500 shadow-sm"
                                                                : "bg-card-secondary text-text-muted hover:text-text-primary border-border"
                                                        )}
                                                    >
                                                        All Runs ({history.length})
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setSelectedHistoryPreset('__default__')}
                                                        className={cn(
                                                            "px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all border cursor-pointer",
                                                            selectedHistoryPreset === '__default__'
                                                                ? "bg-blue-600 text-white border-blue-500 shadow-sm"
                                                                : "bg-card-secondary text-text-muted hover:text-text-primary border-border"
                                                        )}
                                                    >
                                                        Quick Default
                                                    </button>
                                                    {Array.from(presetOptionsMap.entries()).map(([id, name]) => {
                                                        const count = history.filter(j => {
                                                            const pid = (j.params?.preset_id || '').replace(/:modified$/, '');
                                                            return pid === id || j.params?.preset_name === name;
                                                        }).length;
                                                        if (count === 0 && !presets.some(p => p.id === id)) return null;
                                                        return (
                                                            <button
                                                                key={id}
                                                                type="button"
                                                                onClick={() => {
                                                                    setSelectedHistoryPreset(id);
                                                                    setShowTrendPanel(true);
                                                                }}
                                                                className={cn(
                                                                    "px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all border flex items-center gap-1.5 cursor-pointer",
                                                                    selectedHistoryPreset === id
                                                                        ? "bg-violet-600 text-white border-violet-500 shadow-sm"
                                                                        : "bg-card-secondary text-text-muted hover:text-text-primary border-border"
                                                                )}
                                                            >
                                                                <span>{name}</span>
                                                                {count > 0 && (
                                                                    <span className={cn(
                                                                        "text-[8px] font-mono px-1 rounded",
                                                                        selectedHistoryPreset === id ? "bg-white/20 text-white" : "bg-card text-text-muted"
                                                                    )}>
                                                                        {count}
                                                                    </span>
                                                                )}
                                                            </button>
                                                        );
                                                    })}
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    {uniqueTargetsMap.size > 1 && (
                                                        <select
                                                            value={selectedHistoryTarget}
                                                            onChange={e => setSelectedHistoryTarget(e.target.value)}
                                                            className="bg-card-secondary border border-border rounded-lg px-2.5 py-1 text-[10px] font-bold text-text-primary outline-none focus:border-blue-500"
                                                        >
                                                            <option value="all">All Targets ({uniqueTargetsMap.size})</option>
                                                            {Array.from(uniqueTargetsMap.entries()).map(([host, label]) => (
                                                                <option key={host} value={host}>{label} ({host})</option>
                                                            ))}
                                                        </select>
                                                    )}
                                                    {trendData.length >= 2 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowTrendPanel(!showTrendPanel)}
                                                            className={cn(
                                                                "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-all cursor-pointer",
                                                                showTrendPanel
                                                                    ? "bg-violet-500/15 text-violet-400 border-violet-500/30"
                                                                    : "bg-card-secondary text-text-muted hover:text-text-primary border-border"
                                                            )}
                                                        >
                                                            <TrendingUp size={12} />
                                                            Baseline Trend
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Preset Baseline Evolution / Trend Chart Panel */}
                                            {(selectedHistoryPreset !== 'all' || showTrendPanel) && trendData.length >= 2 && (
                                                <div className="bg-card-secondary/40 border border-violet-500/20 rounded-2xl p-4 space-y-3 animate-in fade-in duration-200">
                                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                                        <div className="flex items-center gap-2">
                                                            <div className="p-1.5 rounded-lg bg-violet-500/10 text-violet-400 border border-violet-500/20">
                                                                <TrendingUp size={14} />
                                                            </div>
                                                            <div>
                                                                <h4 className="text-xs font-black text-text-primary tracking-tight flex items-center gap-2 flex-wrap">
                                                                    <span>Preset Evolution &amp; Baseline Comparison</span>
                                                                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
                                                                        {trendData.length} runs
                                                                    </span>
                                                                    <span className="inline-flex items-center gap-3 ml-1 text-[9px] font-bold">
                                                                        <span className="inline-flex items-center gap-1 text-violet-400">
                                                                            <span className="w-2 h-2 rounded-full bg-violet-500 inline-block"></span>
                                                                            Throughput (Mbps)
                                                                        </span>
                                                                        <span className="inline-flex items-center gap-1 text-cyan-400">
                                                                            <span className="w-3 border-t-2 border-dashed border-cyan-400 inline-block"></span>
                                                                            RTT / Jitter (ms)
                                                                        </span>
                                                                    </span>
                                                                </h4>
                                                                <p className="text-[9px] text-text-muted font-bold opacity-70">
                                                                    Historical throughput &amp; latency stability across runs (click any point to inspect)
                                                                </p>
                                                            </div>
                                                        </div>

                                                        {/* Baseline KPI Pills */}
                                                        <div className="flex items-center gap-3 flex-wrap">
                                                            <div className="px-3 py-1.5 rounded-xl bg-card border border-border flex flex-col">
                                                                <span className="text-[8px] font-black uppercase tracking-wider text-text-muted">Baseline Avg</span>
                                                                <span className="text-xs font-black text-violet-400">{avgMbps} Mbps</span>
                                                            </div>
                                                            <div className="px-3 py-1.5 rounded-xl bg-card border border-border flex flex-col">
                                                                <span className="text-[8px] font-black uppercase tracking-wider text-text-muted">Peak Run</span>
                                                                <span className="text-xs font-black text-emerald-400">{peakMbps} Mbps</span>
                                                            </div>
                                                            <div className="px-3 py-1.5 rounded-xl bg-card border border-border flex flex-col">
                                                                <span className="text-[8px] font-black uppercase tracking-wider text-text-muted">Avg RTT/Jitter</span>
                                                                <span className="text-xs font-black text-cyan-400">{avgRtt} ms</span>
                                                            </div>
                                                            {deltaPercent !== null && (
                                                                <div className="px-3 py-1.5 rounded-xl bg-card border border-border flex flex-col">
                                                                    <span className="text-[8px] font-black uppercase tracking-wider text-text-muted">Latest vs Avg</span>
                                                                    <span className={cn(
                                                                        "text-xs font-black",
                                                                        deltaPercent >= 0 ? "text-emerald-400" : deltaPercent <= -15 ? "text-red-400" : "text-amber-400"
                                                                    )}>
                                                                        {deltaPercent >= 0 ? `+${deltaPercent}%` : `${deltaPercent}%`}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="h-44 w-full">
                                                        <ResponsiveContainer width="100%" height="100%">
                                                            <ComposedChart data={trendData}>
                                                                <defs>
                                                                    <linearGradient id="colorPresetTrend" x1="0" y1="0" x2="0" y2="1">
                                                                        <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
                                                                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.0} />
                                                                    </linearGradient>
                                                                </defs>
                                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128,128,128,0.12)" />
                                                                <XAxis
                                                                    dataKey="seq"
                                                                    axisLine={false}
                                                                    tickLine={false}
                                                                    fontSize={9}
                                                                    tick={{ fill: 'currentColor' }}
                                                                    className="text-text-muted opacity-60 font-mono"
                                                                />
                                                                <YAxis
                                                                    yAxisId="left"
                                                                    axisLine={false}
                                                                    tickLine={false}
                                                                    fontSize={9}
                                                                    tick={{ fill: '#a78bfa' }}
                                                                    tickFormatter={(v) => `${v}M`}
                                                                    width={42}
                                                                />
                                                                <YAxis
                                                                    yAxisId="right"
                                                                    orientation="right"
                                                                    axisLine={false}
                                                                    tickLine={false}
                                                                    fontSize={9}
                                                                    tick={{ fill: '#22d3ee' }}
                                                                    tickFormatter={(v) => `${v}ms`}
                                                                    width={42}
                                                                />
                                                                <Tooltip
                                                                    content={({ active, payload }) => {
                                                                        if (active && payload && payload.length) {
                                                                            const d = payload[0].payload;
                                                                            return (
                                                                                <div className="bg-card border border-border p-2.5 rounded-xl shadow-xl text-[10px] space-y-1">
                                                                                    <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-1">
                                                                                        <span className="font-mono font-black text-text-primary">{d.seq}</span>
                                                                                        <span className="text-text-muted font-mono">{d.date}</span>
                                                                                    </div>
                                                                                    <div className="flex items-center justify-between gap-4">
                                                                                        <span className="text-text-muted font-bold">Target:</span>
                                                                                        <span className="font-black text-text-primary">{d.target}</span>
                                                                                    </div>
                                                                                    <div className="flex items-center justify-between gap-4">
                                                                                        <span className="text-text-muted font-bold">Preset:</span>
                                                                                        <span className="font-bold text-text-secondary">{d.preset}</span>
                                                                                    </div>
                                                                                    <div className="flex items-center justify-between gap-4">
                                                                                        <span className="text-violet-400 font-bold flex items-center gap-1.5">
                                                                                            <span className="w-2 h-2 rounded-full bg-violet-500 inline-block"></span>
                                                                                            Throughput:
                                                                                        </span>
                                                                                        <span className="font-black text-violet-400">{d.mbps} Mbps</span>
                                                                                    </div>
                                                                                    <div className="flex items-center justify-between gap-4">
                                                                                        <span className="text-cyan-400 font-bold flex items-center gap-1.5">
                                                                                            <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block"></span>
                                                                                            {d.protocol === 'udp' ? 'Jitter:' : 'RTT:'}
                                                                                        </span>
                                                                                        <span className="font-black text-cyan-400">{d.rtt} ms</span>
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        }
                                                                        return null;
                                                                    }}
                                                                />
                                                                <Area
                                                                    yAxisId="left"
                                                                    type="monotone"
                                                                    dataKey="mbps"
                                                                    name="Throughput (Mbps)"
                                                                    stroke="#8b5cf6"
                                                                    strokeWidth={2.5}
                                                                    fillOpacity={1}
                                                                    fill="url(#colorPresetTrend)"
                                                                    dot={{ r: 3.5, fill: '#8b5cf6', strokeWidth: 1.5, stroke: '#fff' }}
                                                                    activeDot={{
                                                                        r: 5,
                                                                        fill: '#8b5cf6',
                                                                        stroke: '#fff',
                                                                        strokeWidth: 2,
                                                                        onClick: (_: any, payload: any) => {
                                                                            if (payload?.payload?.job) viewJobDetails(payload.payload.job);
                                                                        }
                                                                    }}
                                                                />
                                                                <Line
                                                                    yAxisId="right"
                                                                    type="monotone"
                                                                    dataKey="rtt"
                                                                    name="RTT / Jitter (ms)"
                                                                    stroke="#06b6d4"
                                                                    strokeWidth={2}
                                                                    strokeDasharray="3 3"
                                                                    dot={{ r: 2.5, fill: '#06b6d4' }}
                                                                />
                                                            </ComposedChart>
                                                        </ResponsiveContainer>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                <div className="relative group">
                                    <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted group-focus-within:text-blue-500 transition-colors" />
                                    <input
                                        type="text"
                                        placeholder="Filter results by Job ID, Target Host, Preset, or Status..."
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
                                                <th className="px-4 py-4 text-[9px] font-black text-text-muted tracking-[0.2em] text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/50">
                                            {filteredHistory.map((job) => (
                                                <tr
                                                    key={job.id}
                                                    onClick={() => viewJobDetails(job)}
                                                    className="group hover:bg-card-secondary/50 transition-all cursor-pointer"
                                                >
                                                    <td className="px-4 py-3.5">
                                                        <div className="flex items-center gap-2">
                                                            <span className="bg-blue-600/10 text-blue-500 dark:text-blue-400 text-[10px] px-1.5 py-0.5 rounded font-bold border border-blue-500/20 font-mono tracking-wider">
                                                                {job.sequence_id}
                                                            </span>
                                                        </div>
                                                        <div className="text-[10px] text-text-muted font-mono flex items-center gap-1 mt-1 opacity-75 whitespace-nowrap">
                                                            <Calendar size={10} className="text-blue-400 shrink-0" />
                                                            <span>{formatDateDisplay(job.started_at)}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3.5">
                                                        {(() => {
                                                            const resolved = getTargetDisplayName(job.params?.host, job.params?.port, job.params?.target_name);
                                                            return (
                                                                <div>
                                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                                        <Target size={13} className="text-blue-500 shrink-0" />
                                                                        <span className="text-xs font-black text-text-primary tracking-tight">
                                                                            {resolved.name}
                                                                        </span>
                                                                        {resolved.isFriendly && (
                                                                            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                                                                Target
                                                                            </span>
                                                                        )}
                                                                        {job.params?.preset_name && (
                                                                            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
                                                                                <Bookmark size={9} className="text-violet-400" />
                                                                                {job.params.preset_name}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="text-[10px] text-text-muted font-mono flex items-center gap-1.5 flex-wrap mt-0.5">
                                                                        <span className="font-bold text-text-secondary">{job.params.host}:{job.params.port}</span>
                                                                        <span className="opacity-40">•</span>
                                                                        <span className="font-bold uppercase text-[9px] px-1 py-0.2 rounded bg-card border border-border text-text-secondary">
                                                                            {job.params.protocol.toUpperCase()}
                                                                        </span>
                                                                        <span className="opacity-40">•</span>
                                                                        <span>{job.params.direction.replace(/-/g, ' ')}</span>
                                                                        {job.params.bitrate && (
                                                                            <>
                                                                                <span className="opacity-40">•</span>
                                                                                <span>{job.params.bitrate}</span>
                                                                            </>
                                                                        )}
                                                                        {job.params.duration_sec && (
                                                                            <>
                                                                                <span className="opacity-40">•</span>
                                                                                <span>{job.params.duration_sec}s</span>
                                                                            </>
                                                                        )}
                                                                        {job.params.parallel_streams && (
                                                                            <>
                                                                                <span className="opacity-40">•</span>
                                                                                <span>{job.params.parallel_streams} stream{job.params.parallel_streams > 1 ? 's' : ''}</span>
                                                                            </>
                                                                        )}
                                                                        {job.params.cport && (
                                                                            <>
                                                                                <span className="opacity-40">•</span>
                                                                                <span>Port {job.params.cport}</span>
                                                                            </>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}
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
                                                                <div className="text-xs font-black text-text-primary">{Math.round(job.summary.received_mbps || job.summary.sent_mbps)} Mbps</div>
                                                                {job.params.protocol === 'udp' ? (
                                                                    <div className={cn(
                                                                        "text-[9px] font-bold tracking-tight",
                                                                        (job.summary.loss_percent ?? 0) > 0 ? "text-red-500" : "text-emerald-500"
                                                                    )}>
                                                                        {(job.summary.loss_percent ?? 0).toFixed(1)}% Loss
                                                                    </div>
                                                                ) : (
                                                                    <div className="text-[9px] font-bold tracking-tight flex items-center gap-1">
                                                                        <span className="text-cyan-400">{(job.summary.rtt_ms_avg ?? 0).toFixed(1)} ms</span>
                                                                        <span className="text-text-muted opacity-50">•</span>
                                                                        <span className={cn(
                                                                            (job.summary.retransmits ?? 0) > 0 ? "text-amber-400" : "text-emerald-500"
                                                                        )}>
                                                                            {job.summary.retransmits ?? 0} rxmt
                                                                        </span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <span className="text-xs font-bold text-text-muted italic">No results</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-4 text-right">
                                                        <div className="flex items-center justify-end">
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    deleteJob(job);
                                                                }}
                                                                className="p-2 border border-transparent hover:border-red-500/30 hover:bg-red-500/10 rounded-lg text-text-muted hover:text-red-400 transition-all inline-flex cursor-pointer"
                                                                title="Delete this test record"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
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

            {/* Results Detail Modal */}
            {
                showDetailModal && selectedJob && (
                    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
                        <div className="bg-card border border-border rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden relative">

                            {/* Header */}
                            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between bg-card-secondary/40 shrink-0">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-blue-600 rounded-xl shadow-lg shadow-blue-900/30">
                                        <BarChart3 className="text-white" size={16} />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-black text-text-primary tracking-tight">Test Details</h3>
                                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                            <span className="text-[10px] font-black text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 font-mono">{selectedJob.sequence_id}</span>
                                            {(() => {
                                                const resolved = getTargetDisplayName(selectedJob.params?.host, selectedJob.params?.port, selectedJob.params?.target_name);
                                                return (
                                                    <>
                                                        {resolved.isFriendly && (
                                                            <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 flex items-center gap-1">
                                                                <Target size={11} className="text-emerald-400" />
                                                                {resolved.name}
                                                            </span>
                                                        )}
                                                        {selectedJob.params?.host && (
                                                            <span className="text-[10px] font-bold text-text-secondary bg-card px-2 py-0.5 rounded border border-border font-mono">
                                                                {selectedJob.params.host}:{selectedJob.params.port}
                                                            </span>
                                                        )}
                                                        {selectedJob.params?.preset_name && (
                                                            <span className="text-[10px] font-black text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20 flex items-center gap-1">
                                                                <Bookmark size={11} className="text-violet-400" />
                                                                {selectedJob.params.preset_name}
                                                            </span>
                                                        )}
                                                    </>
                                                );
                                            })()}
                                            <span className="text-[10px] text-text-muted opacity-70 font-mono flex items-center gap-1">
                                                <Calendar size={10} className="text-blue-400 shrink-0" />
                                                <span>{formatDateDisplay(selectedJob.started_at)}</span>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setShowDetailModal(false)}
                                    className="p-1.5 hover:bg-card rounded-lg transition-all border border-transparent hover:border-border text-text-muted"
                                >
                                    <X size={16} />
                                </button>
                            </div>

                            {/* Body */}
                            <div className="p-4 space-y-3 overflow-y-auto">

                                {/* Historical Time-Series Chart */}
                                {selectedJob.intervals && selectedJob.intervals.length > 0 && (() => {
                                    const modalChartData = formatIntervalsForChart(selectedJob.intervals);
                                    const isUdpModal = selectedJob.params.protocol === 'udp';
                                    const isUploadModal = selectedJob.params.direction === 'client-to-server';
                                    const isDownloadModal = selectedJob.params.direction === 'server-to-client';
                                    const isBidirModal = selectedJob.params.direction === 'bidirectional';

                                    return (
                                        <div className="bg-card-secondary/30 rounded-xl p-3.5 border border-border">
                                            <div className="flex items-center justify-between mb-2.5">
                                                <span className="text-[9px] font-black text-text-muted tracking-widest opacity-60 uppercase">
                                                    Throughput &amp; {isUdpModal ? 'Loss' : 'Latency'} Profile ({selectedJob.intervals.length}s)
                                                </span>
                                                <div className="flex items-center gap-3 text-[10px] font-bold">
                                                    {(isUploadModal || isBidirModal) && (
                                                        <span className="flex items-center gap-1 text-emerald-400">
                                                            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Sent (Mbps)
                                                        </span>
                                                    )}
                                                    {(isDownloadModal || isBidirModal) && (
                                                        <span className="flex items-center gap-1 text-blue-400">
                                                            <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Received (Mbps)
                                                        </span>
                                                    )}
                                                    {!isUdpModal && (
                                                        <span className="flex items-center gap-1 text-cyan-400">
                                                            <span className="w-2 h-0.5 bg-cyan-400 inline-block" /> RTT (ms)
                                                        </span>
                                                    )}
                                                    <span className="flex items-center gap-1 text-amber-400">
                                                        <span className="w-2 h-2 rounded-sm bg-amber-500/60 inline-block" /> {isUdpModal ? 'Loss (%)' : 'Retrans'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="h-44 w-full">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <ComposedChart data={modalChartData}>
                                                        <defs>
                                                            <linearGradient id="colorSentModal" x1="0" y1="0" x2="0" y2="1">
                                                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                                                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                                            </linearGradient>
                                                            <linearGradient id="colorReceivedModal" x1="0" y1="0" x2="0" y2="1">
                                                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                                                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                                            </linearGradient>
                                                        </defs>
                                                        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" vertical={false} />
                                                        <XAxis
                                                            dataKey="time"
                                                            stroke="currentColor"
                                                            className="text-text-muted opacity-40"
                                                            fontSize={10}
                                                            tickFormatter={(val) => `${val}s`}
                                                            fontWeight="bold"
                                                        />
                                                        <YAxis
                                                            yAxisId="left"
                                                            stroke="currentColor"
                                                            className="text-text-muted opacity-40"
                                                            fontSize={10}
                                                            fontWeight="bold"
                                                            tickFormatter={(val) => `${Math.round(val)}M`}
                                                            width={42}
                                                        />
                                                        <YAxis
                                                            yAxisId="right"
                                                            orientation="right"
                                                            stroke="#06b6d4"
                                                            className="text-cyan-500 opacity-50"
                                                            fontSize={10}
                                                            fontWeight="bold"
                                                            tickFormatter={(val) => isUdpModal ? `${val}%` : `${Math.round(val)}ms`}
                                                            width={42}
                                                        />
                                                        <Tooltip
                                                            content={({ active, payload, label }) => {
                                                                if (active && payload && payload.length) {
                                                                    const data = payload[0].payload;
                                                                    return (
                                                                        <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl shadow-2xl space-y-1.5 backdrop-blur-md bg-opacity-90">
                                                                            <div className="flex items-center justify-between gap-4 border-b border-white/5 pb-1">
                                                                                <span className="text-[10px] font-black text-slate-400">Elapsed: {label}s</span>
                                                                                {data.time_str && <span className="text-[10px] font-mono text-blue-400 font-bold">{data.time_str}</span>}
                                                                            </div>
                                                                            <div className="space-y-1 pt-0.5">
                                                                                {(isUploadModal || isBidirModal) && data.sent_mbps !== undefined && (
                                                                                    <div className="flex items-center justify-between gap-4">
                                                                                        <span className="text-[10px] font-bold text-emerald-400">Sent:</span>
                                                                                        <span className="text-xs font-black text-emerald-400">{Math.round(data.sent_mbps)} Mbps</span>
                                                                                    </div>
                                                                                )}
                                                                                {(isDownloadModal || isBidirModal) && data.received_mbps !== undefined && (
                                                                                    <div className="flex items-center justify-between gap-4">
                                                                                        <span className="text-[10px] font-bold text-blue-400">Received:</span>
                                                                                        <span className="text-xs font-black text-blue-400">{Math.round(data.received_mbps)} Mbps</span>
                                                                                    </div>
                                                                                )}
                                                                                {!isUdpModal && data.rtt_ms !== undefined && (
                                                                                    <div className="flex items-center justify-between gap-4">
                                                                                        <span className="text-[10px] font-bold text-cyan-400">Latency (RTT):</span>
                                                                                        <span className="text-xs font-black text-cyan-300">{Number(data.rtt_ms).toFixed(1)} ms</span>
                                                                                    </div>
                                                                                )}
                                                                                {!isUdpModal && data.retransmits !== undefined && (
                                                                                    <div className="flex items-center justify-between gap-4">
                                                                                        <span className="text-[10px] font-bold text-amber-400">Retransmits:</span>
                                                                                        <span className="text-xs font-black text-amber-300">{data.retransmits}</span>
                                                                                    </div>
                                                                                )}
                                                                                {!isUdpModal && data.cwnd !== undefined && (
                                                                                    <div className="flex items-center justify-between gap-4 border-t border-white/5 pt-1 mt-1">
                                                                                        <span className="text-[10px] font-bold text-indigo-400">TCP Window:</span>
                                                                                        <span className="text-[10px] font-mono text-indigo-300">{formatCwnd(data.cwnd).val} {formatCwnd(data.cwnd).unit}</span>
                                                                                    </div>
                                                                                )}
                                                                                {isUdpModal && data.lost_percent !== undefined && (
                                                                                    <div className="flex items-center justify-between gap-4">
                                                                                        <span className="text-[10px] font-bold text-amber-400">Packet Loss:</span>
                                                                                        <span className="text-xs font-black text-amber-300">{data.lost_percent.toFixed(2)}%</span>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                }
                                                                return null;
                                                            }}
                                                        />
                                                        {(isUploadModal || isBidirModal) && (
                                                            <Area
                                                                yAxisId="left"
                                                                type="monotone"
                                                                dataKey="sent_mbps"
                                                                stroke="#10b981"
                                                                strokeWidth={2.5}
                                                                fillOpacity={1}
                                                                fill="url(#colorSentModal)"
                                                                isAnimationActive={false}
                                                            />
                                                        )}
                                                        {(isDownloadModal || isBidirModal) && (
                                                            <Area
                                                                yAxisId="left"
                                                                type="monotone"
                                                                dataKey="received_mbps"
                                                                stroke="#3b82f6"
                                                                strokeWidth={2.5}
                                                                fillOpacity={1}
                                                                fill="url(#colorReceivedModal)"
                                                                isAnimationActive={false}
                                                            />
                                                        )}
                                                        {!isUdpModal && (
                                                            <Line
                                                                yAxisId="right"
                                                                type="monotone"
                                                                dataKey="rtt_ms"
                                                                stroke="#06b6d4"
                                                                strokeWidth={2}
                                                                dot={false}
                                                                isAnimationActive={false}
                                                            />
                                                        )}
                                                        {!isUdpModal && (
                                                            <Bar
                                                                yAxisId="right"
                                                                dataKey="retransmits"
                                                                fill="#f59e0b"
                                                                opacity={0.4}
                                                                barSize={10}
                                                                radius={[3, 3, 0, 0]}
                                                                isAnimationActive={false}
                                                            />
                                                        )}
                                                        {isUdpModal && (
                                                            <Bar
                                                                yAxisId="right"
                                                                dataKey="lost_percent"
                                                                fill="#f59e0b"
                                                                opacity={0.4}
                                                                barSize={10}
                                                                radius={[3, 3, 0, 0]}
                                                                isAnimationActive={false}
                                                            />
                                                        )}
                                                    </ComposedChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* ── Clean 2-Row Summary Layout ── */}
                                {(() => {
                                    const isUpload = selectedJob.params.direction === 'client-to-server';
                                    const isDownload = selectedJob.params.direction === 'server-to-client';
                                    const isBidir = selectedJob.params.direction === 'bidirectional';
                                    const isUdp = selectedJob.params.protocol === 'udp';

                                    // Throughput values
                                    const sentMbps = selectedJob.summary?.sent_mbps ?? 0;
                                    const recvMbps = selectedJob.summary?.received_mbps ?? 0;
                                    const mainMbps = isDownload ? recvMbps : sentMbps;
                                    const peakMbps = selectedJob.intervals && selectedJob.intervals.length > 0
                                        ? Math.max(...selectedJob.intervals.map((i: any) => Math.max(i.sent_mbps || 0, i.received_mbps || 0)))
                                        : null;

                                    // Latency / Jitter (compute real Min/Max from intervals when summary min/max is 0)
                                    const rttSamples = (selectedJob.intervals || [])
                                        .map((i: any) => Number(i.rtt_ms))
                                        .filter((v: number) => !isNaN(v) && v > 0);
                                    const rttAvg = selectedJob.summary?.rtt_ms_avg || (rttSamples.length > 0 ? rttSamples.reduce((a: number, b: number) => a + b, 0) / rttSamples.length : 0);
                                    const rttMin = (selectedJob.summary?.rtt_ms_min && selectedJob.summary.rtt_ms_min > 0)
                                        ? selectedJob.summary.rtt_ms_min
                                        : (rttSamples.length > 0 ? Math.min(...rttSamples) : 0);
                                    const rttMax = (selectedJob.summary?.rtt_ms_max && selectedJob.summary.rtt_ms_max > 0)
                                        ? selectedJob.summary.rtt_ms_max
                                        : (rttSamples.length > 0 ? Math.max(...rttSamples) : 0);
                                    const jitterAvg = selectedJob.summary?.jitter_ms_avg ?? 0;

                                    // Integrity
                                    const retransmits = selectedJob.summary?.retransmits ?? 0;
                                    const lossPct = selectedJob.summary?.loss_percent ?? 0;
                                    const hasDegradation = isUdp ? lossPct > 0 : retransmits > 0;

                                    // Transfer volume
                                    let txBytes = 0;
                                    let rxBytes = 0;
                                    if (selectedJob.summary?.bytes_total) {
                                        if (isUpload) txBytes = selectedJob.summary.bytes_total;
                                        if (isDownload) rxBytes = selectedJob.summary.bytes_total;
                                        if (isBidir) {
                                            const totalRate = sentMbps + recvMbps;
                                            if (totalRate > 0) {
                                                txBytes = (sentMbps / totalRate) * selectedJob.summary.bytes_total;
                                                rxBytes = (recvMbps / totalRate) * selectedJob.summary.bytes_total;
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
                                        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
                                    };

                                    const totalBytes = txBytes + rxBytes;
                                    const cwndInfo = formatCwnd(selectedJob.summary?.cwnd);

                                    return (
                                        <div className="space-y-3">
                                            {/* Row 1: 4 Clean KPI Cards */}
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                                {/* Card 1: Throughput */}
                                                <div className="bg-card-secondary/50 rounded-xl border border-emerald-500/25 p-3.5 flex flex-col justify-between">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400">
                                                            {isBidir ? 'Combined Speed' : isDownload ? 'Download' : 'Upload'}
                                                        </span>
                                                        <Zap size={13} className="text-emerald-400/70" />
                                                    </div>
                                                    <div className="my-1.5 flex items-baseline gap-1.5">
                                                        <span className="text-2xl font-black tracking-tight text-text-primary">
                                                            {isBidir ? (sentMbps + recvMbps).toFixed(1) : mainMbps.toFixed(1)}
                                                        </span>
                                                        <span className="text-xs font-bold text-emerald-400">Mbps</span>
                                                    </div>
                                                    <div className="text-[11px] font-mono text-text-muted truncate">
                                                        {isBidir
                                                            ? `↑ ${sentMbps.toFixed(1)} • ↓ ${recvMbps.toFixed(1)} Mbps`
                                                            : peakMbps !== null
                                                                ? `Peak: ${peakMbps.toFixed(1)} Mbps`
                                                                : `Cap: ${selectedJob.params.bitrate || 'Max'}`}
                                                    </div>
                                                </div>

                                                {/* Card 2: Latency / Jitter */}
                                                <div className="bg-card-secondary/50 rounded-xl border border-cyan-500/25 p-3.5 flex flex-col justify-between">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] font-black uppercase tracking-wider text-cyan-400">
                                                            {isUdp ? 'Jitter' : 'Latency (RTT)'}
                                                        </span>
                                                        <Gauge size={13} className="text-cyan-400/70" />
                                                    </div>
                                                    <div className="my-1.5 flex items-baseline gap-1.5">
                                                        <span className="text-2xl font-black tracking-tight text-text-primary">
                                                            {isUdp ? jitterAvg.toFixed(2) : rttAvg.toFixed(1)}
                                                        </span>
                                                        <span className="text-xs font-bold text-cyan-400">ms</span>
                                                    </div>
                                                    <div className="text-[11px] font-mono text-text-muted truncate">
                                                        {isUdp
                                                            ? 'Avg packet delay var'
                                                            : `Min ${rttMin.toFixed(1)} • Max ${rttMax.toFixed(1)} ms`}
                                                    </div>
                                                </div>

                                                {/* Card 3: Retransmits / Packet Loss */}
                                                <div className={cn(
                                                    "bg-card-secondary/50 rounded-xl border p-3.5 flex flex-col justify-between",
                                                    hasDegradation ? "border-amber-500/30" : "border-border"
                                                )}>
                                                    <div className="flex items-center justify-between">
                                                        <span className={cn(
                                                            "text-[10px] font-black uppercase tracking-wider",
                                                            hasDegradation ? "text-amber-400" : "text-text-muted"
                                                        )}>
                                                            {isUdp ? 'Packet Loss' : 'Retransmits'}
                                                        </span>
                                                        <span className={cn(
                                                            "w-2 h-2 rounded-full",
                                                            hasDegradation ? "bg-amber-400" : "bg-emerald-400"
                                                        )} />
                                                    </div>
                                                    <div className="my-1.5 flex items-baseline gap-1.5">
                                                        <span className={cn(
                                                            "text-2xl font-black tracking-tight",
                                                            hasDegradation ? "text-amber-400" : "text-text-primary"
                                                        )}>
                                                            {isUdp ? `${lossPct.toFixed(1)}%` : retransmits.toLocaleString()}
                                                        </span>
                                                        <span className="text-xs font-bold text-text-muted">
                                                            {isUdp ? 'lost' : 'retries'}
                                                        </span>
                                                    </div>
                                                    <div className="text-[11px] font-mono text-text-muted truncate">
                                                        {isUdp
                                                            ? `${selectedJob.summary?.lost ?? 0} / ${selectedJob.summary?.packets_sent ?? 0} pkts`
                                                            : `Loss rate: ${lossPct.toFixed(2)}%`}
                                                    </div>
                                                </div>

                                                {/* Card 4: Data Transferred */}
                                                <div className="bg-card-secondary/50 rounded-xl border border-border p-3.5 flex flex-col justify-between">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] font-black uppercase tracking-wider text-blue-400">
                                                            Transferred
                                                        </span>
                                                        <ArrowUpRight size={13} className="text-blue-400/70" />
                                                    </div>
                                                    <div className="my-1.5 flex items-baseline gap-1.5">
                                                        <span className="text-2xl font-black tracking-tight text-text-primary">
                                                            {formatBytes(totalBytes).split(' ')[0]}
                                                        </span>
                                                        <span className="text-xs font-bold text-blue-400">
                                                            {formatBytes(totalBytes).split(' ')[1] || 'B'}
                                                        </span>
                                                    </div>
                                                    <div className="text-[11px] font-mono text-text-muted truncate">
                                                        {isBidir
                                                            ? `↑ ${formatBytes(txBytes)} • ↓ ${formatBytes(rxBytes)}`
                                                            : `Duration: ${selectedJob.params.duration_sec}s • Cap: ${selectedJob.params.bitrate || 'Max'}`}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Row 2: Single-Line Technical Parameters Strip */}
                                            <div className="bg-card-secondary/30 rounded-xl border border-border/70 px-4 py-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-xs">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-text-muted">Protocol:</span>
                                                    <span className="font-mono font-bold text-text-primary uppercase">
                                                        {selectedJob.params.protocol}
                                                        {!isUdp && ` (${selectedJob.params.congestion || 'Cubic'})`}
                                                    </span>
                                                </div>
                                                {!isUdp && (
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-text-muted">TCP Window:</span>
                                                        <span className="font-mono font-bold text-text-primary">
                                                            {cwndInfo.val} {cwndInfo.unit}
                                                        </span>
                                                    </div>
                                                )}
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-text-muted">Streams:</span>
                                                    <span className="font-mono font-bold text-text-primary">
                                                        {selectedJob.params.parallel_streams || selectedJob.params.streams || 1}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-text-muted">Direction:</span>
                                                    <span className="font-mono font-bold text-text-primary">
                                                        {isBidir ? 'Bidirectional' : isDownload ? 'Download (RX)' : 'Upload (TX)'}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-text-muted">DSCP:</span>
                                                    <span className="font-mono font-bold text-text-primary">
                                                        {selectedJob.params.dscp || 'Default (0)'}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-text-muted">Src Port:</span>
                                                    <span className="font-mono font-bold text-text-primary">
                                                        {selectedJob.params.cport || 'Auto'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {selectedJob.error && (
                                    <div className="bg-red-500/5 p-4 rounded-xl border border-red-500/20 flex flex-col gap-2">
                                        <span className="text-[9px] font-black text-red-500 tracking-widest">Diagnostic Error Signature</span>
                                        <pre className="text-xs font-mono text-red-500 whitespace-pre-wrap">{selectedJob.error}</pre>
                                    </div>
                                )}

                                {/* Actions */}
                                <div className="flex gap-2 pt-1">
                                    <button
                                        onClick={() => deleteJob(selectedJob)}
                                        className="py-2.5 px-3 bg-red-600/10 border border-red-500/20 hover:bg-red-500/20 text-red-500 rounded-xl text-[10px] font-black tracking-widest transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                                        title="Delete this test record"
                                    >
                                        <Trash2 size={13} />
                                        Delete
                                    </button>
                                    <button
                                        onClick={() => setShowDetailModal(false)}
                                        className="flex-1 py-2.5 bg-card-secondary border border-border hover:bg-card rounded-xl text-[10px] font-black text-text-primary tracking-widest transition-all"
                                    >
                                        Dismiss
                                    </button>
                                    <button
                                        onClick={() => {
                                            toast.success("Telemetry report exported to clipboard");
                                            navigator.clipboard.writeText(JSON.stringify(selectedJob, null, 2));
                                        }}
                                        className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-[10px] font-black tracking-widest transition-all hover:bg-blue-500"
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
