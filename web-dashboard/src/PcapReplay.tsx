import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    Layers, Play, Square, Upload, Download, Trash2, RefreshCw,
    CheckCircle2, AlertTriangle, Shield, ShieldAlert, Activity,
    Terminal, ArrowRight, ArrowDownRight, Server, Globe, Search,
    Filter, Lock, FileCode, Check, Eye, HelpCircle, Sparkles,
    Cpu, Zap, Radio, Copy, ChevronRight, X, Headphones, Binary,
    FileSpreadsheet, ArrowUpRight, Edit3, Save, RotateCcw
} from 'lucide-react';
import toast from 'react-hot-toast';
import { usePeerContext } from './PeerContext';
import { PcapReplayModal } from './components/custom-tcp/PcapReplayModal';

interface PcapReplayProps {
    token: string | null;
}

export const PcapReplay: React.FC<PcapReplayProps> = ({ token }) => {
    const { gFetch, peers, activePeerId } = usePeerContext();

    // Feature status
    const [isPcapEnabled, setIsPcapEnabled] = useState(true);
    const [isLoading, setIsLoading] = useState(true);

    // Profile Catalogue
    const [profiles, setProfiles] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [selectedProfileFile, setSelectedProfileFile] = useState<string | null>(null);
    const [profileDetails, setProfileDetails] = useState<any | null>(null);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);
    const [selectedTurnIndex, setSelectedTurnIndex] = useState<number | null>(null);
    const [payloadViewMode, setPayloadViewMode] = useState<'hex' | 'raw'>('hex');

    // Profile Editing Modal
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingProfile, setEditingProfile] = useState<any | null>(null);
    const [editName, setEditName] = useState('');
    const [editCategory, setEditCategory] = useState('');
    const [editPort, setEditPort] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [isSavingEdit, setIsSavingEdit] = useState(false);

    // Console View Mode
    const [consoleViewMode, setConsoleViewMode] = useState<'formatted' | 'raw'>('formatted');

    // Import / Modal state
    const [isPcapModalOpen, setIsPcapModalOpen] = useState(false);
    const profileUploadInputRef = useRef<HTMLInputElement>(null);

    // Execution / Orchestrator state
    const [replayRole, setReplayRole] = useState<'client' | 'server'>('client');
    const [serverNodeId, setServerNodeId] = useState<string>('local');
    const [customTargetIp, setCustomTargetIp] = useState<string>('');
    const [portOverride, setPortOverride] = useState<string>('');
    const [isLooping, setIsLooping] = useState<boolean>(false);
    const [loopInterval, setLoopInterval] = useState<number>(3);
    const [isStartingReplay, setIsStartingReplay] = useState(false);
    const [activeJob, setActiveJob] = useState<any | null>(null);
    const [terminalLogs, setTerminalLogs] = useState<any[]>([]);

    // ─── Initial Load & Status Check ──────────────────────────────────────────

    const checkStatus = useCallback(async () => {
        try {
            const res = await gFetch('/api/pcap/status', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setIsPcapEnabled(Boolean(data.enabled));
            }
        } catch (_) {
            setIsPcapEnabled(false);
        }
    }, [gFetch, token]);

    const fetchProfiles = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await gFetch('/api/pcap/profiles', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                const list = data.profiles || [];
                setProfiles(list);
                if (list.length > 0 && !selectedProfileFile) {
                    setSelectedProfileFile(list[0].file_name);
                }
            }
        } catch (e: any) {
            toast.error(`Failed to load PCAP profiles: ${e.message}`);
        } finally {
            setIsLoading(false);
        }
    }, [gFetch, token, selectedProfileFile]);

    const fetchProfileDetails = useCallback(async (fileName: string) => {
        setIsLoadingDetails(true);
        try {
            const res = await gFetch(`/api/pcap/profiles/details/${encodeURIComponent(fileName)}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setProfileDetails(data.profile);
                // Pre-populate recommended port
                if (data.profile?.flows?.[0]?.server_port) {
                    setPortOverride(String(data.profile.flows[0].server_port));
                }
                setSelectedTurnIndex(0);
            } else {
                setProfileDetails(null);
            }
        } catch (e) {
            setProfileDetails(null);
        } finally {
            setIsLoadingDetails(false);
        }
    }, [gFetch, token]);

    const pollActiveJobs = useCallback(async () => {
        try {
            const res = await gFetch('/api/pcap/replay/jobs', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                const running = (data.jobs || []).find((j: any) => j.status === 'running');
                if (running) {
                    setActiveJob(running);
                    setTerminalLogs(running.recentEvents || []);
                } else {
                    const latest = (data.jobs || [])[0];
                    if (latest && activeJob?.status === 'running') {
                        setActiveJob(latest);
                        setTerminalLogs(latest.recentEvents || []);
                    }
                }
            }
        } catch (_) {}
    }, [gFetch, token, activeJob]);

    useEffect(() => {
        checkStatus();
        fetchProfiles();
    }, [checkStatus, fetchProfiles]);

    useEffect(() => {
        if (selectedProfileFile) {
            fetchProfileDetails(selectedProfileFile);
        }
    }, [selectedProfileFile, fetchProfileDetails]);

    // Poll active jobs
    useEffect(() => {
        const interval = setInterval(pollActiveJobs, 1200);
        return () => clearInterval(interval);
    }, [pollActiveJobs]);

    // Auto-select remote peer when entering client mode
    useEffect(() => {
        if (replayRole === 'client' && serverNodeId === 'local' && peers.length > 0) {
            const remotePeer = peers.find(p => p.instance_id !== activePeerId) || peers[0];
            if (remotePeer) {
                setServerNodeId(remotePeer.instance_id);
                setCustomTargetIp(remotePeer.ip_private || '127.0.0.1');
            }
        }
    }, [replayRole, peers, activePeerId, serverNodeId]);

    // Auto-detect default server IP when serverNodeId changes
    useEffect(() => {
        if (serverNodeId === 'local') {
            setCustomTargetIp('127.0.0.1');
        } else {
            const peer = peers.find(p => p.instance_id === serverNodeId);
            if (peer?.ip_private) {
                setCustomTargetIp(peer.ip_private);
            }
        }
    }, [serverNodeId, peers]);

    // ─── Actions: Profile Editing ─────────────────────────────────────────────

    const handleOpenEditModal = (profile: any) => {
        setEditingProfile(profile);
        setEditName(profile.name || profile.file_name.replace('.stx-replay', ''));
        setEditCategory(profile.category || 'CUSTOM');
        setEditPort(String(profile.primary_flow?.server_port || profile.server_port || 18443));
        setEditDescription(profile.description || '');
        setIsEditModalOpen(true);
    };

    const handleSaveEditProfile = async () => {
        if (!editingProfile) return;
        setIsSavingEdit(true);
        try {
            const res = await gFetch(`/api/pcap/profiles/${encodeURIComponent(editingProfile.file_name)}`, {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: editName.trim(),
                    category: editCategory.trim(),
                    server_port: parseInt(editPort, 10),
                    description: editDescription.trim()
                })
            });
            const data = await res.json();
            if (data.success) {
                toast.success(`Profile updated & broadcast to fleet: ${editName}`);
                setIsEditModalOpen(false);
                fetchProfiles();
                if (selectedProfileFile === editingProfile.file_name) {
                    fetchProfileDetails(editingProfile.file_name);
                }
            } else {
                toast.error(data.error || 'Failed to update profile');
            }
        } catch (e: any) {
            toast.error(e.message || 'Error updating profile');
        } finally {
            setIsSavingEdit(false);
        }
    };

    // Calculate real-time completed turn sequence index from logs
    const lastCompletedTurnSeq = useMemo(() => {
        let maxSeq = 0;
        for (const log of terminalLogs) {
            const ev = typeof log === 'string' ? null : log;
            if (ev?.event === 'turn_completed' || ev?.event === 'client_turn_completed') {
                if (typeof ev.seq === 'number' && ev.seq > maxSeq) {
                    maxSeq = ev.seq;
                }
            } else if (ev?.event === 'session_finished' || ev?.event === 'client_session_finished') {
                if (typeof ev.completed_turns === 'number') {
                    maxSeq = Math.max(maxSeq, ev.completed_turns);
                }
            }
        }
        return maxSeq;
    }, [terminalLogs]);

    // ─── Actions: Profile Management ──────────────────────────────────────────

    const handleDownloadProfile = async (fileName: string) => {
        try {
            const res = await gFetch(`/api/pcap/profiles/download/${encodeURIComponent(fileName)}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Download failed');
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            toast.success(`Downloaded ${fileName}`);
        } catch (e: any) {
            toast.error(e.message || 'Download failed');
        }
    };

    const handleDeleteProfile = async (fileName: string) => {
        if (!confirm(`Delete profile "${fileName}"? This will also remove it across the mesh.`)) return;
        try {
            const res = await gFetch(`/api/pcap/profiles/${encodeURIComponent(fileName)}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                toast.success(`Profile removed: ${fileName}`);
                if (selectedProfileFile === fileName) {
                    setSelectedProfileFile(null);
                    setProfileDetails(null);
                }
                fetchProfiles();
            } else {
                toast.error('Failed to delete profile');
            }
        } catch (e: any) {
            toast.error(e.message || 'Error deleting profile');
        }
    };

    const handleUploadStxReplay = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('profile', file);

        const toastId = toast.loading(`Uploading profile ${file.name}...`);
        try {
            const res = await gFetch('/api/pcap/profiles/upload', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                toast.success(`Zero-Config profile imported & synchronized: ${file.name}`, { id: toastId });
                fetchProfiles();
                setSelectedProfileFile(file.name);
            } else {
                toast.error(data.error || 'Failed to upload profile', { id: toastId });
            }
        } catch (err: any) {
            toast.error(err.message || 'Error uploading profile', { id: toastId });
        } finally {
            if (profileUploadInputRef.current) profileUploadInputRef.current.value = '';
        }
    };

    // ─── Actions: Launch & Stop Replay ─────────────────────────────────────────

    const handleLaunchReplay = async () => {
        if (!selectedProfileFile) {
            toast.error('Select a profile first');
            return;
        }

        const effectivePort = portOverride ? parseInt(portOverride, 10) : undefined;
        setIsStartingReplay(true);

        try {
            const payload: any = {
                role: replayRole,
                profile_file: selectedProfileFile,
                port: effectivePort
            };

            if (replayRole === 'client') {
                payload.target = customTargetIp || '127.0.0.1';
                payload.loop = isLooping;
                payload.interval = loopInterval;
            }

            const res = await gFetch('/api/pcap/replay/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (data.success) {
                if (replayRole === 'server') {
                    toast.success(`Server listener started on port ${effectivePort || 'default'}`);
                } else {
                    toast.success(`Client replay started against ${payload.target}:${effectivePort || 'default'}`);
                }
                pollActiveJobs();
            } else {
                toast.error(data.error || 'Failed to start replay');
            }
        } catch (e: any) {
            toast.error(e.message || 'Error starting replay');
        } finally {
            setIsStartingReplay(false);
        }
    };

    const handleStopReplay = async () => {
        if (!activeJob?.id) return;
        try {
            const res = await gFetch('/api/pcap/replay/stop', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ job_id: activeJob.id })
            });
            const data = await res.json();
            if (data.success) {
                toast.success('Replay stopped');
                pollActiveJobs();
            }
        } catch (e: any) {
            toast.error(e.message || 'Error stopping replay');
        }
    };

    // ─── Helpers: Payload Formatting & Detection ──────────────────────────────

    const formatPayload = (rawStr: string) => {
        if (!rawStr) return { type: 'Empty', badge: 'bg-card text-text-muted', hex: '', ascii: '' };

        // Detection: TLS Record Layer
        if (rawStr.startsWith('\\x16\\x03') || rawStr.includes('\\x16\\x03\\x01')) {
            return {
                type: 'TLS Record Layer (Handshake / Encrypted)',
                badge: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
                isBinary: true
            };
        }
        // Detection: HTTP
        if (rawStr.startsWith('HTTP/') || rawStr.startsWith('GET ') || rawStr.startsWith('POST ') || rawStr.startsWith('PUT ') || rawStr.startsWith('HEAD ')) {
            return {
                type: 'HTTP Application Protocol',
                badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
                isBinary: false
            };
        }
        // Binary Stream
        if (rawStr.includes('\\x')) {
            return {
                type: 'Binary L7 Stream',
                badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
                isBinary: true
            };
        }
        return {
            type: 'Plaintext Stream',
            badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
            isBinary: false
        };
    };

    const convertToCleanHex = (rawStr: string): string => {
        if (!rawStr) return '';
        // If string contains escaped \xNN sequences, format as clean hex pairs
        if (rawStr.includes('\\x')) {
            const tokens = rawStr.split(/(\\x[0-9a-fA-F]{2})/g).filter(Boolean);
            const hexParts: string[] = [];
            for (const token of tokens) {
                if (token.startsWith('\\x') && token.length === 4) {
                    hexParts.push(token.substring(2).toUpperCase());
                } else {
                    for (let i = 0; i < token.length; i++) {
                        hexParts.push(token.charCodeAt(i).toString(16).padStart(2, '0').toUpperCase());
                    }
                }
            }
            // Format into lines of 16 bytes
            const lines: string[] = [];
            for (let i = 0; i < hexParts.length; i += 16) {
                const chunk = hexParts.slice(i, i + 16);
                const offset = i.toString(16).padStart(4, '0').toUpperCase();
                lines.push(`${offset}  ${chunk.slice(0, 8).join(' ')}   ${chunk.slice(8).join(' ')}`);
            }
            return lines.join('\n');
        }
        return rawStr;
    };

    // ─── Helpers: Filtering ───────────────────────────────────────────────────

    const filteredProfiles = profiles.filter(p => {
        const matchesSearch = p.file_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (p.name && p.name.toLowerCase().includes(searchQuery.toLowerCase()));
        const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;
        return matchesSearch && matchesCategory;
    });

    const categories = ['all', ...Array.from(new Set(profiles.map(p => p.category).filter(Boolean)))];

    const flows = profileDetails?.flows || [];
    const activeFlow = flows[0];
    const turns = activeFlow?.turns || [];
    const selectedTurn = selectedTurnIndex !== null && turns[selectedTurnIndex] ? turns[selectedTurnIndex] : null;
    const selectedTurnRawPayload = selectedTurn?.ascii_preview || selectedTurn?.preview || selectedTurn?.payload_b64 || '';
    const turnAnalysis = formatPayload(selectedTurnRawPayload);

    // ─── Real-Time Console Formatter ──────────────────────────────────────────

    const formatLogEvent = (rawLog: any, idx: number) => {
        let log = rawLog;
        if (typeof rawLog === 'string') {
            try {
                log = JSON.parse(rawLog);
            } catch (_) {
                return (
                    <div key={idx} className="flex items-start gap-1.5 text-text-secondary leading-tight font-mono text-[10px]">
                        <span className="text-text-muted/40 select-none text-[8px]">[{idx + 1}]</span>
                        <span>{rawLog}</span>
                    </div>
                );
            }
        }

        const ev = log.event;

        if (ev === 'server_listening') {
            return (
                <div key={idx} className="flex items-center gap-2 py-0.5 text-[10px]">
                    <span className="text-text-muted/40 select-none text-[8px] font-mono">[{idx + 1}]</span>
                    <span className="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-400 font-bold uppercase text-[8px] border border-purple-500/30">
                        SERVER READY
                    </span>
                    <span className="font-semibold text-text-primary">
                        Listening on {log.bind_ip || '0.0.0.0'}:{log.port} ({log.transport?.toUpperCase() || 'TCP'})
                    </span>
                    <span className="text-text-muted text-[9px]">— Awaiting incoming spoke replay connection</span>
                </div>
            );
        }

        if (ev === 'session_started') {
            return (
                <div key={idx} className="flex items-center gap-2 py-0.5 text-[10px]">
                    <span className="text-text-muted/40 select-none text-[8px] font-mono">[{idx + 1}]</span>
                    <span className="px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-400 font-bold uppercase text-[8px] border border-blue-500/30">
                        SESSION OPEN
                    </span>
                    <span className="font-semibold text-text-primary">
                        {log.client_ip}:{log.client_port} ➔ {log.server_ip}:{log.server_port}
                    </span>
                    <span className="text-text-muted text-[9px]">
                        ({log.total_turns} turns total)
                    </span>
                </div>
            );
        }

        if (ev === 'turn_completed' || ev === 'client_turn_completed') {
            const isClient = log.sender === 'client';
            return (
                <div key={idx} className="flex items-center gap-2 py-0.5 text-[10px]">
                    <span className="text-text-muted/40 select-none text-[8px] font-mono">[{idx + 1}]</span>
                    <span className={`px-1.5 py-0.2 rounded font-black uppercase text-[8px] flex items-center gap-1 ${
                        isClient
                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                            : 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                    }`}>
                        {isClient ? '⬆️ CLIENT ➔ SERVER' : '⬇️ SERVER ➔ CLIENT'}
                    </span>
                    <span className="font-black text-text-primary">Turn #{log.seq}</span>
                    <span className="text-text-secondary font-mono">{log.bytes} bytes</span>
                    <span className="text-text-muted/70 text-[9px] font-mono">({log.duration_ms}ms)</span>
                </div>
            );
        }

        if (ev === 'session_finished' || ev === 'client_session_finished') {
            const isBypass = log.verdict === 'Bypass';
            const isReset = log.verdict?.includes('Reset');
            const isDrop = log.verdict?.includes('Drop');
            const isError = log.status === 'error' || Boolean(log.error);

            if (isError) {
                return (
                    <div key={idx} className="flex items-center gap-2 py-1 text-[10px] text-red-400 bg-red-500/10 px-2 rounded-lg border border-red-500/20">
                        <span className="text-red-400 select-none text-[8px] font-mono">[{idx + 1}]</span>
                        <span className="px-1.5 py-0.2 rounded bg-red-500/30 text-red-300 font-black uppercase text-[8px]">
                            FAILED
                        </span>
                        <span className="font-bold">{log.error || 'Connection Failed'}</span>
                        <span className="text-text-muted text-[9px]">— Verdict: {log.verdict || 'Inconclusive'}</span>
                    </div>
                );
            }

            return (
                <div key={idx} className={`flex items-center gap-2 py-1 text-[10px] px-2 rounded-lg border ${
                    isBypass
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                        : isReset
                        ? 'bg-red-500/15 border-red-500/30 text-red-400'
                        : 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                }`}>
                    <span className="select-none text-[8px] font-mono">[{idx + 1}]</span>
                    <span className="px-1.5 py-0.2 rounded font-black uppercase text-[8px] bg-black/30">
                        VERDICT: {log.verdict?.toUpperCase()}
                    </span>
                    <span className="font-bold">
                        {log.completed_turns}/{log.total_turns} turns completed
                    </span>
                    {log.tx_bytes !== undefined && (
                        <span className="text-[9px] opacity-80 font-mono">
                            TX: {log.tx_bytes}B • RX: {log.rx_bytes}B in {log.duration_ms}ms
                        </span>
                    )}
                </div>
            );
        }

        if (ev === 'session_error' || ev === 'stderr') {
            return (
                <div key={idx} className="flex items-center gap-2 py-0.5 text-[10px] text-red-400">
                    <span className="text-text-muted/40 select-none text-[8px] font-mono">[{idx + 1}]</span>
                    <span className="px-1.5 py-0.2 rounded bg-red-500/20 text-red-400 font-bold uppercase text-[8px]">STDERR</span>
                    <span>{log.error || log.text}</span>
                </div>
            );
        }

        return (
            <div key={idx} className="flex items-start gap-1.5 text-text-secondary leading-tight text-[10px] font-mono">
                <span className="text-text-muted/40 select-none text-[8px]">[{idx + 1}]</span>
                <span>{JSON.stringify(log)}</span>
            </div>
        );
    };

    return (
        <div className="space-y-3.5 animate-in fade-in duration-300">
            {/* ─── Top Banner / Header (Compact) ─── */}
            <div className="bg-card border border-border rounded-2xl p-3.5 px-5 shadow-lg relative overflow-hidden shrink-0">
                <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 relative z-10">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl text-white shadow-md shadow-indigo-500/25 shrink-0">
                            <Layers size={22} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-base font-black text-text-primary tracking-tight">
                                    Stateful PCAP Replay Engine
                                </h1>
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                    L7 Turns
                                </span>
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                                    <Sparkles size={9} /> Auto-Sync Fleet
                                </span>
                            </div>
                            <p className="text-[11px] text-text-muted mt-0.5 line-clamp-1 max-w-2xl">
                                Package raw PCAP traces into zero-config replay profiles, auto-scrub credentials, distribute across spokes & execute synchronized client/server turns with SASE verdict enforcement.
                            </p>
                        </div>
                    </div>

                    {/* Action Bar */}
                    <div className="flex items-center gap-2 shrink-0">
                        {/* Import / Parse Raw PCAP */}
                        <button
                            onClick={() => setIsPcapModalOpen(true)}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-md shadow-indigo-600/20 cursor-pointer"
                        >
                            <Upload size={13} /> Import & Parse PCAP
                        </button>

                        {/* Import Ready .stx-replay Profile */}
                        <input
                            type="file"
                            ref={profileUploadInputRef}
                            onChange={handleUploadStxReplay}
                            accept=".stx-replay,.gz"
                            className="hidden"
                        />
                        <button
                            onClick={() => profileUploadInputRef.current?.click()}
                            className="px-3 py-1.5 bg-card-secondary hover:bg-card-secondary/80 text-text-primary border border-border rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                            title="Import an existing .stx-replay profile directly with zero configuration"
                        >
                            <FileCode size={13} className="text-purple-400" />
                            <span>Import Profile</span>
                        </button>

                        {/* Refresh */}
                        <button
                            onClick={() => { fetchProfiles(); pollActiveJobs(); }}
                            className="p-1.5 hover:bg-card-secondary rounded-lg text-text-muted hover:text-text-primary border border-border transition-all cursor-pointer"
                            title="Refresh profiles catalogue"
                        >
                            <RefreshCw size={14} />
                        </button>
                    </div>
                </div>

                {!isPcapEnabled && (
                    <div className="mt-2.5 p-2 px-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-2.5 text-xs text-amber-400 font-medium">
                        <AlertTriangle size={15} className="shrink-0" />
                        <span>PCAP Replay is currently inactive. Ensure <code className="font-mono bg-black/30 px-1 py-0.5 rounded text-amber-300">ENABLE_PCAP_REPLAY=true</code> is defined in your environment file.</span>
                    </div>
                )}
            </div>

            {/* ─── Two-Column Main Content Grid ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">

                {/* ─── Left Column: Profiles Catalogue (Zero-Config) ─── */}
                <div className="lg:col-span-5 flex flex-col">
                    <div className="bg-card border border-border rounded-2xl p-3.5 shadow-xl flex flex-col h-[calc(100vh-175px)] min-h-[500px]">
                        {/* Catalogue Header */}
                        <div className="flex items-center justify-between pb-2.5 border-b border-border shrink-0">
                            <div>
                                <h2 className="text-xs font-black text-text-primary uppercase tracking-tight flex items-center gap-1.5">
                                    <FileCode size={14} className="text-indigo-400" />
                                    <span>Replay Profiles Catalogue</span>
                                </h2>
                                <p className="text-[9px] text-text-muted font-bold tracking-wider mt-0.5">
                                    {profiles.length} COMPILED PROFILES AVAILABLE
                                </p>
                            </div>
                            <span className="text-[9px] font-black text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">
                                Zero-Config
                            </span>
                        </div>

                        {/* Search and Category Filters */}
                        <div className="py-2 space-y-1.5 border-b border-border/50 shrink-0">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" size={12} />
                                <input
                                    type="text"
                                    placeholder="Search profiles..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full bg-card-secondary/50 border border-border rounded-lg pl-8 pr-2.5 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                                />
                            </div>

                            {/* Category Filter Pills */}
                            {categories.length > 2 && (
                                <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none">
                                    {categories.map(cat => (
                                        <button
                                            key={cat}
                                            onClick={() => setCategoryFilter(cat)}
                                            className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider transition-all whitespace-nowrap cursor-pointer ${
                                                categoryFilter === cat
                                                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/20'
                                                    : 'bg-card-secondary/50 hover:bg-card-secondary text-text-muted hover:text-text-primary'
                                            }`}
                                        >
                                            {cat}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Profile List Container (Compact 2-line cards, internal widget scroll) */}
                        <div className="flex-1 min-h-0 overflow-y-auto pt-2 space-y-1.5 pr-1 scrollbar-thin scrollbar-thumb-border">
                            {isLoading ? (
                                <div className="flex flex-col items-center justify-center h-48 text-text-muted gap-2">
                                    <RefreshCw className="animate-spin" size={18} />
                                    <span className="text-xs">Loading profile catalogue...</span>
                                </div>
                            ) : filteredProfiles.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-48 text-text-muted text-center p-4 border-2 border-dashed border-border/60 rounded-xl">
                                    <FileCode size={26} className="opacity-30 mb-2" />
                                    <p className="text-xs font-bold">No Replay Profiles Found</p>
                                    <p className="text-[10px] text-text-muted mt-1">Import a PCAP capture or upload an existing .stx-replay package to get started.</p>
                                </div>
                            ) : (
                                filteredProfiles.map(p => {
                                    const isSelected = selectedProfileFile === p.file_name;
                                    const flow = p.primary_flow;
                                    return (
                                        <div
                                            key={p.file_name}
                                            onClick={() => setSelectedProfileFile(p.file_name)}
                                            title={p.file_name}
                                            className={`py-2 px-2.5 rounded-xl border transition-all cursor-pointer relative group ${
                                                isSelected
                                                    ? 'bg-indigo-500/15 border-indigo-500/50 shadow-sm shadow-indigo-500/10'
                                                    : 'bg-card-secondary/25 hover:bg-card-secondary/60 border-border/60'
                                            }`}
                                        >
                                            {/* Line 1: Scenario Name + Category Badge + Quick Actions */}
                                            <div className="flex items-center justify-between gap-1.5">
                                                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                                    <span className="text-xs font-bold text-text-primary truncate">
                                                        {p.name || p.file_name.replace('.stx-replay', '')}
                                                    </span>
                                                    {p.category && (
                                                        <span className="text-[8px] px-1.5 py-0.2 bg-card-secondary text-text-secondary border border-border rounded font-black uppercase shrink-0">
                                                            {p.category}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Action Buttons (Edit / Download / Delete) */}
                                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleOpenEditModal(p); }}
                                                        className="p-1 hover:bg-card-secondary rounded text-text-muted hover:text-indigo-400 transition-colors cursor-pointer"
                                                        title="Edit profile parameters (Name, Port, Category, Description)"
                                                    >
                                                        <Edit3 size={11} />
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleDownloadProfile(p.file_name); }}
                                                        className="p-1 hover:bg-card-secondary rounded text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                                                        title="Download .stx-replay file"
                                                    >
                                                        <Download size={11} />
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleDeleteProfile(p.file_name); }}
                                                        className="p-1 hover:bg-red-500/20 rounded text-text-muted hover:text-red-400 transition-colors cursor-pointer"
                                                        title="Delete profile across mesh"
                                                    >
                                                        <Trash2 size={11} />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Line 2: Inline Metadata (Turns, Port, Size) */}
                                            <div className="flex items-center gap-2 mt-1 text-[10px] text-text-muted">
                                                <span className="flex items-center gap-1 font-semibold text-text-secondary">
                                                    <Radio size={9} className="text-indigo-400" />
                                                    <span>{p.total_turns || 0} turns</span>
                                                </span>
                                                {flow?.server_port && (
                                                    <span className="font-mono text-purple-400 font-bold bg-purple-500/10 px-1.5 py-0.2 rounded border border-purple-500/20 text-[9px]">
                                                        Port {flow.server_port}
                                                    </span>
                                                )}
                                                {p.size_bytes && (
                                                    <span className="text-[9px] text-text-muted/60 font-mono ml-auto">
                                                        {(p.size_bytes / 1024).toFixed(1)} KB
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>

                {/* ─── Right Column: Timeline Inspection & Orchestrator Execution ─── */}
                <div className="lg:col-span-7 flex flex-col gap-3.5 h-[calc(100vh-175px)] min-h-[500px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-border">

                    {/* 1. Execution & Multi-Node Orchestration Card */}
                    <div className="bg-card border border-border rounded-2xl p-4 shadow-xl relative overflow-hidden shrink-0">
                        <div className="flex items-center justify-between pb-3 border-b border-border">
                            <div>
                                <h2 className="text-xs font-black text-text-primary uppercase tracking-tight flex items-center gap-1.5">
                                    <Play size={14} className="text-emerald-400" />
                                    <span>Replay Orchestrator</span>
                                </h2>
                                <p className="text-[9px] text-text-muted font-bold tracking-wider mt-0.5">
                                    CHOOSE ROLE & EXECUTE CONVERSATION TURNS
                                </p>
                            </div>

                            {activeJob?.status === 'running' ? (
                                <span className={`px-2 py-0.5 border text-[9px] font-black uppercase tracking-wider rounded-lg flex items-center gap-1 animate-pulse ${
                                    activeJob.role === 'server'
                                        ? 'bg-purple-500/15 border-purple-500/30 text-purple-400'
                                        : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                                }`}>
                                    <Activity size={11} /> {activeJob.role === 'server' ? 'Server Listening' : 'Client Replaying'} (PID: {activeJob.pid})
                                </span>
                            ) : (
                                <span className="px-2 py-0.5 bg-card-secondary border border-border text-text-muted text-[9px] font-bold uppercase tracking-wider rounded-lg">
                                    Ready to Execute
                                </span>
                            )}
                        </div>

                        {/* Role Selector: Server (Listen) vs Client (Play) */}
                        <div className="pt-3">
                            <div className="flex p-0.5 bg-card-secondary/70 border border-border rounded-xl gap-1">
                                <button
                                    type="button"
                                    onClick={() => setReplayRole('server')}
                                    className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                        replayRole === 'server'
                                            ? 'bg-purple-600 text-white shadow-sm shadow-purple-600/25'
                                            : 'text-text-muted hover:text-text-primary'
                                    }`}
                                >
                                    <Headphones size={13} />
                                    <span>Server Role (Listen)</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setReplayRole('client')}
                                    className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                        replayRole === 'client'
                                            ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/25'
                                            : 'text-text-muted hover:text-text-primary'
                                    }`}
                                >
                                    <Play size={13} />
                                    <span>Client Role (Play)</span>
                                </button>
                            </div>
                        </div>

                        {/* Configuration Form based on Role */}
                        <div className="py-3 space-y-3">
                            {replayRole === 'server' ? (
                                /* Server Configuration */
                                <div className="space-y-2.5 bg-purple-500/5 border border-purple-500/20 rounded-xl p-3">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="font-bold text-text-secondary flex items-center gap-1.5 text-[11px]">
                                            <Server size={13} className="text-purple-400" />
                                            <span>Listening Interface:</span>
                                        </span>
                                        <span className="font-mono text-text-primary font-bold bg-card px-2 py-0.5 rounded border border-border text-[11px]">
                                            0.0.0.0 (All Interfaces)
                                        </span>
                                    </div>

                                    <div>
                                        <label className="text-[9px] font-black uppercase tracking-wider text-text-muted block mb-1">
                                            Server Listening Port
                                        </label>
                                        <input
                                            type="number"
                                            value={portOverride}
                                            onChange={(e) => setPortOverride(e.target.value)}
                                            placeholder="Port (e.g. 62910)"
                                            className="w-full bg-card border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-text-primary focus:outline-none focus:ring-1 focus:ring-purple-500"
                                        />
                                        <p className="text-[10px] text-text-muted mt-1 leading-normal">
                                            Starts a stateful socket listener on this node waiting for incoming client turns from remote peers.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                /* Client Configuration */
                                <div className="space-y-2.5">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                        {/* Server Node Selector */}
                                        <div>
                                            <label className="text-[9px] font-black uppercase tracking-wider text-text-muted block mb-1 flex items-center gap-1">
                                                <Server size={11} className="text-purple-400" />
                                                <span>Target Server Host / Peer</span>
                                            </label>
                                            <select
                                                value={serverNodeId}
                                                onChange={(e) => setServerNodeId(e.target.value)}
                                                className="w-full bg-card-secondary/70 border border-border rounded-lg px-2.5 py-1.5 text-xs font-bold text-text-primary focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                            >
                                                <option value="local">Local Node (127.0.0.1)</option>
                                                {peers.map(p => (
                                                    <option key={p.instance_id} value={p.instance_id}>
                                                        {p.site || p.instance_id} ({p.ip_private || 'No IP'})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* Target IP (Auto-filled or Custom) */}
                                        <div>
                                            <label className="text-[9px] font-black uppercase tracking-wider text-text-muted block mb-1 flex items-center gap-1">
                                                <Globe size={11} className="text-blue-400" />
                                                <span>Destination Server IP / VIP</span>
                                            </label>
                                            <input
                                                type="text"
                                                value={customTargetIp}
                                                onChange={(e) => setCustomTargetIp(e.target.value)}
                                                placeholder="192.168.203.1 or 127.0.0.1"
                                                className="w-full bg-card-secondary/70 border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-text-primary focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                            />
                                        </div>
                                    </div>

                                    {/* Traffic Path Telemetry Pill */}
                                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[10px] font-mono ${
                                        customTargetIp === '127.0.0.1' || serverNodeId === 'local'
                                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                                            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                    }`}>
                                        {customTargetIp === '127.0.0.1' || serverNodeId === 'local' ? (
                                            <>
                                                <AlertTriangle size={13} className="text-amber-400 shrink-0" />
                                                <span><strong>Loopback Mode:</strong> Replaying to this local node (127.0.0.1). Server role must be running locally. To test SD-WAN, select a remote peer above.</span>
                                            </>
                                        ) : (
                                            <>
                                                <Globe size={13} className="text-emerald-400 shrink-0" />
                                                <span><strong>SD-WAN Replay Path:</strong> Local Spoke ➔ Remote Peer <strong>{serverNodeId}</strong> ({customTargetIp}:{portOverride || 'Default'})</span>
                                            </>
                                        )}
                                    </div>

                                    {/* Port & Loop Controls */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                                        <div>
                                            <label className="text-[9px] font-black uppercase tracking-wider text-text-muted block mb-1">
                                                Target Port
                                            </label>
                                            <input
                                                type="number"
                                                value={portOverride}
                                                onChange={(e) => setPortOverride(e.target.value)}
                                                placeholder="Auto from profile"
                                                className="w-full bg-card-secondary/70 border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-text-primary focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                            />
                                        </div>

                                        <div>
                                            <label className="text-[9px] font-black uppercase tracking-wider text-text-muted block mb-1">
                                                Continuous Loop
                                            </label>
                                            <button
                                                type="button"
                                                onClick={() => setIsLooping(!isLooping)}
                                                className={`w-full py-1.5 px-2.5 border rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center justify-between cursor-pointer ${
                                                    isLooping
                                                        ? 'bg-indigo-600/20 text-indigo-400 border-indigo-500/40'
                                                        : 'bg-card-secondary/70 text-text-muted border-border hover:bg-card-secondary'
                                                }`}
                                            >
                                                <span>{isLooping ? 'Loop' : 'Single'}</span>
                                                <div className={`w-2.5 h-2.5 rounded-full ${isLooping ? 'bg-indigo-400 animate-pulse' : 'bg-border'}`} />
                                            </button>
                                        </div>

                                        <div>
                                            <label className="text-[9px] font-black uppercase tracking-wider text-text-muted block mb-1">
                                                Interval (s)
                                            </label>
                                            <input
                                                type="number"
                                                disabled={!isLooping}
                                                value={loopInterval}
                                                onChange={(e) => setLoopInterval(Math.max(1, parseInt(e.target.value, 10) || 1))}
                                                className="w-full bg-card-secondary/70 disabled:opacity-40 border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-text-primary focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Execution Triggers */}
                            <div className="pt-1 flex items-center gap-2">
                                {activeJob?.status === 'running' ? (
                                    <button
                                        onClick={handleStopReplay}
                                        className="flex-1 py-2 px-4 bg-red-600 hover:bg-red-500 text-white font-black uppercase tracking-wider text-xs rounded-xl transition-all shadow-md shadow-red-600/25 flex items-center justify-center gap-2 cursor-pointer"
                                    >
                                        <Square size={14} /> Stop Active {activeJob.role === 'server' ? 'Server Listener' : 'Client Replay'} (PID: {activeJob.pid})
                                    </button>
                                ) : replayRole === 'server' ? (
                                    <button
                                        onClick={handleLaunchReplay}
                                        disabled={isStartingReplay || !selectedProfileFile}
                                        className="flex-1 py-2.5 px-4 bg-purple-600 hover:bg-purple-500 text-white font-black uppercase tracking-wider text-xs rounded-xl transition-all shadow-md shadow-purple-600/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Headphones size={15} />
                                        <span>{isStartingReplay ? 'Starting Listener...' : `Start Server Listener (Port ${portOverride || 'Default'})`}</span>
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleLaunchReplay}
                                        disabled={isStartingReplay || !selectedProfileFile}
                                        className="flex-1 py-2.5 px-4 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-black uppercase tracking-wider text-xs rounded-xl transition-all shadow-md shadow-emerald-600/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Play size={15} />
                                        <span>{isStartingReplay ? 'Connecting Client...' : `Launch Client Replay ➔ ${customTargetIp || '127.0.0.1'}:${portOverride || 'Default'}`}</span>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Security Verdict Banner */}
                        {activeJob && (
                            <div className="mt-1 pt-2.5 border-t border-border">
                                <div className="text-[9px] font-black text-text-muted uppercase tracking-wider mb-1.5 flex items-center gap-1">
                                    <Shield size={11} />
                                    <span>SASE Security Verdict Telemetry</span>
                                </div>

                                <div className={`p-2.5 rounded-xl border flex items-center justify-between ${
                                    activeJob.lastVerdict === 'Bypass'
                                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                        : activeJob.lastVerdict?.includes('Reset')
                                        ? 'bg-red-500/10 border-red-500/30 text-red-400'
                                        : activeJob.lastVerdict?.includes('Drop')
                                        ? 'bg-orange-500/10 border-orange-500/30 text-orange-400'
                                        : activeJob.lastVerdict?.includes('Block Page')
                                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                                        : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'
                                }`}>
                                    <div className="flex items-center gap-2.5">
                                        <div className="p-1.5 rounded-lg bg-card">
                                            {activeJob.lastVerdict === 'Bypass' ? (
                                                <CheckCircle2 size={18} className="text-emerald-400" />
                                            ) : activeJob.lastVerdict ? (
                                                <ShieldAlert size={18} className="text-red-400" />
                                            ) : (
                                                <Activity size={18} className="text-indigo-400 animate-pulse" />
                                            )}
                                        </div>
                                        <div>
                                            <div className="text-xs font-black uppercase tracking-wider">
                                                {activeJob.lastVerdict || (activeJob.status === 'running' ? `${activeJob.role === 'server' ? 'Server Listening for connections...' : 'Client Executing turns...'}` : 'Replay Stopped')}
                                            </div>
                                            <p className="text-[9px] opacity-80 mt-0.5">
                                                {activeJob.lastVerdict === 'Bypass'
                                                    ? 'All L7 conversation turns completed successfully with no enforcement drop.'
                                                    : activeJob.lastVerdict?.includes('Reset')
                                                    ? 'TCP Connection was abruptly RST by Prisma SASE or Security Gateway.'
                                                    : activeJob.lastVerdict?.includes('Block Page')
                                                    ? 'Firewall returned HTTP 403 Access Denied block page.'
                                                    : activeJob.role === 'server'
                                                    ? 'Socket bound and awaiting incoming traffic from Stigix spoke client...'
                                                    : 'Executing turns with synchronous byte comparison...'}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="text-right font-mono text-[11px] font-bold shrink-0">
                                        <div>PID {activeJob.pid}</div>
                                        <div className="text-[9px] opacity-60 uppercase">{activeJob.role} · {activeJob.status}</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 2. Zero-Config Profile Sequence Inspector (Turns Timeline) */}
                    <div className="bg-card border border-border rounded-2xl p-4 shadow-xl shrink-0">
                        <div className="flex items-center justify-between pb-2.5 border-b border-border">
                            <div>
                                <h3 className="text-xs font-black text-text-primary uppercase tracking-tight flex items-center gap-1.5">
                                    <Radio size={14} className="text-purple-400" />
                                    <span>Conversation Turns Sequence</span>
                                </h3>
                                <p className="text-[9px] text-text-muted font-bold tracking-wider mt-0.5">
                                    {profileDetails ? `${turns.length} DIRECTIONAL APPLICATION TURNS COMPILED` : 'SELECT A PROFILE TO INSPECT'}
                                </p>
                            </div>
                            {profileDetails && (
                                <span className="text-[9px] font-mono text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
                                    Transport: {activeFlow?.transport || 'TCP'}
                                </span>
                            )}
                        </div>

                        {isLoadingDetails ? (
                            <div className="flex flex-col items-center justify-center h-32 text-text-muted gap-2">
                                <RefreshCw className="animate-spin text-purple-400" size={20} />
                                <span className="text-xs">Unpacking profile turns...</span>
                            </div>
                        ) : !profileDetails ? (
                            <div className="py-6 text-center text-text-muted">
                                <p className="text-xs font-bold">No Profile Selected</p>
                                <p className="text-[10px] opacity-70 mt-1">Select a profile from the left catalogue to view its full conversation turn sequence.</p>
                            </div>
                        ) : (
                            <div className="py-2.5 space-y-2.5">
                                {/* Turns Step List */}
                                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-border">
                                    {turns.map((turn: any, idx: number) => {
                                        const isClient = turn.direction === 'client_to_server';
                                        const isTurnSelected = selectedTurnIndex === idx;
                                        const isCompleted = (idx + 1) <= lastCompletedTurnSeq;
                                        const isActive = (idx + 1) === (lastCompletedTurnSeq + 1) && activeJob?.status === 'running';
                                        const previewText = turn.ascii_preview || turn.preview || '';
                                        const info = formatPayload(previewText);

                                        return (
                                            <div
                                                key={idx}
                                                onClick={() => setSelectedTurnIndex(idx)}
                                                className={`p-1.5 px-2 rounded-lg border transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                                    isTurnSelected
                                                        ? 'bg-purple-500/15 border-purple-500/50 shadow-sm'
                                                        : isCompleted
                                                        ? 'bg-emerald-500/5 border-emerald-500/30'
                                                        : isActive
                                                        ? 'bg-indigo-500/10 border-indigo-500/40 animate-pulse'
                                                        : 'bg-card-secondary/25 hover:bg-card-secondary/60 border-border/50'
                                                }`}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span className={`w-5 h-5 rounded border flex items-center justify-center font-mono text-[9px] font-black ${
                                                        isCompleted
                                                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                                                            : isActive
                                                            ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/40'
                                                            : 'bg-card-secondary border-border text-text-muted'
                                                    }`}>
                                                        {isCompleted ? '✓' : idx + 1}
                                                    </span>
                                                    <div className="flex items-center gap-1.5">
                                                        <span className={`px-1.5 py-0.2 rounded text-[8px] font-black uppercase tracking-wider flex items-center gap-1 ${
                                                            isClient
                                                                ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                                                                : 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                                                        }`}>
                                                            {isClient ? <ArrowRight size={9} /> : <ArrowDownRight size={9} />}
                                                            <span>{isClient ? 'Client ➔ Server' : 'Server ➔ Client'}</span>
                                                        </span>
                                                        <span className="text-[9px] font-mono text-text-muted">
                                                            {turn.payload_len || turn.length || 0} bytes
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-1.5">
                                                    {isCompleted && (
                                                        <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-black text-[8px] border border-emerald-500/30 flex items-center gap-0.5">
                                                            <Check size={8} /> DONE
                                                        </span>
                                                    )}
                                                    {isActive && (
                                                        <span className="px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-400 font-black text-[8px] border border-indigo-500/30 flex items-center gap-0.5 animate-pulse">
                                                            <Activity size={8} /> LIVE
                                                        </span>
                                                    )}
                                                    <span className={`text-[8px] px-1 py-0.2 rounded border font-bold uppercase ${info.badge}`}>
                                                        {info.type.split(' ')[0]}
                                                    </span>
                                                    <span className="text-[9px] text-text-muted font-mono truncate max-w-[150px]">
                                                        {previewText || 'Binary Data'}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Turn Detail Preview */}
                                {selectedTurn && (
                                    <div className="bg-card-secondary/40 border border-border rounded-xl p-2.5 font-mono text-xs space-y-1.5">
                                        <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-wider text-text-muted">
                                            <div className="flex items-center gap-1.5">
                                                <span>Turn #{selectedTurnIndex! + 1} Payload Preview</span>
                                                <span className={`px-1 py-0.2 rounded border text-[8px] font-bold uppercase ${turnAnalysis.badge}`}>
                                                    {turnAnalysis.type}
                                                </span>
                                            </div>

                                            {/* View Mode Toggle: Hex Dump vs Raw ASCII */}
                                            <div className="flex items-center gap-1 bg-card p-0.5 rounded border border-border">
                                                <button
                                                    onClick={() => setPayloadViewMode('hex')}
                                                    className={`px-1.5 py-0.2 rounded text-[8px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                                                        payloadViewMode === 'hex' ? 'bg-indigo-600 text-white' : 'text-text-muted hover:text-text-primary'
                                                    }`}
                                                >
                                                    Hex Dump
                                                </button>
                                                <button
                                                    onClick={() => setPayloadViewMode('raw')}
                                                    className={`px-1.5 py-0.2 rounded text-[8px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                                                        payloadViewMode === 'raw' ? 'bg-indigo-600 text-white' : 'text-text-muted hover:text-text-primary'
                                                    }`}
                                                >
                                                    Raw Escaped
                                                </button>
                                            </div>
                                        </div>

                                        <div className="bg-black/40 border border-border/60 rounded-lg p-2 max-h-24 overflow-y-auto text-[10px] text-text-secondary font-mono leading-normal whitespace-pre-wrap break-all">
                                            {payloadViewMode === 'hex'
                                                ? convertToCleanHex(selectedTurnRawPayload)
                                                : (selectedTurnRawPayload || 'No preview available')}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* 3. Live Replay Terminal Logs */}
                    <div className="bg-card border border-border rounded-2xl p-3.5 shadow-xl font-mono shrink-0">
                        <div className="flex items-center justify-between pb-2 border-b border-border text-text-muted text-xs">
                            <div className="flex items-center gap-2">
                                <Terminal size={13} className="text-emerald-400" />
                                <span className="font-black uppercase tracking-widest text-[9px]">Real-Time Replay Socket Console</span>
                                <span className="text-[9px] text-text-muted/60 font-mono">({terminalLogs.length} events)</span>
                            </div>
                            
                            <div className="flex items-center gap-2">
                                <div className="flex items-center bg-black/40 rounded-lg p-0.5 border border-border/60">
                                    <button
                                        type="button"
                                        onClick={() => setConsoleViewMode('formatted')}
                                        className={`px-2 py-0.5 rounded text-[9px] font-bold transition-all ${
                                            consoleViewMode === 'formatted'
                                                ? 'bg-primary text-black shadow-sm'
                                                : 'text-text-muted hover:text-text-primary'
                                        }`}
                                    >
                                        Live Activity
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setConsoleViewMode('raw')}
                                        className={`px-2 py-0.5 rounded text-[9px] font-bold transition-all ${
                                            consoleViewMode === 'raw'
                                                ? 'bg-primary text-black shadow-sm'
                                                : 'text-text-muted hover:text-text-primary'
                                        }`}
                                    >
                                        Raw JSON
                                    </button>
                                </div>
                                {terminalLogs.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setTerminalLogs([])}
                                        className="px-2 py-0.5 rounded text-[9px] font-semibold text-text-muted hover:text-red-400 hover:bg-red-500/10 border border-border/40 hover:border-red-500/30 transition-all"
                                        title="Clear console logs"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="mt-2 bg-black/50 border border-border/60 rounded-xl p-2.5 h-32 overflow-y-auto space-y-1 text-[10px] scrollbar-thin scrollbar-thumb-border">
                            {terminalLogs.length === 0 ? (
                                <div className="flex items-center justify-center h-full text-text-muted/40 italic text-xs">
                                    Waiting for replay events...
                                </div>
                            ) : (
                                terminalLogs.map((log: any, idx: number) => (
                                    consoleViewMode === 'formatted' ? (
                                        formatLogEvent(log, idx)
                                    ) : (
                                        <div key={idx} className="flex items-start gap-1.5 text-text-secondary leading-tight">
                                            <span className="text-text-muted/50 select-none text-[8px] font-mono">
                                                [{idx + 1}]
                                            </span>
                                            <span className={log.verdict ? 'text-emerald-400 font-bold' : log.event === 'error' || log.status === 'error' ? 'text-red-400' : 'text-text-primary'}>
                                                {typeof log === 'string' ? log : JSON.stringify(log)}
                                            </span>
                                        </div>
                                    )
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* ─── Edit Replay Profile Modal ─── */}
            {isEditModalOpen && editingProfile && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-card border border-border/80 rounded-2xl w-full max-w-lg p-5 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-border">
                            <div className="flex items-center gap-2">
                                <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary">
                                    <Edit3 size={16} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-text-primary">Edit Replay Profile</h3>
                                    <p className="text-[11px] text-text-muted font-mono">{editingProfile.file_name}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsEditModalOpen(false)}
                                className="text-text-muted hover:text-text-primary p-1 rounded-lg hover:bg-white/5 transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="space-y-3 text-xs">
                            <div>
                                <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1">
                                    Scenario Name
                                </label>
                                <input
                                    type="text"
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    placeholder="e.g. TLS App Identification Bypass"
                                    className="w-full bg-black/40 border border-border rounded-xl px-3 py-2 text-text-primary text-xs focus:outline-none focus:border-primary/60 transition-colors"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1">
                                        Category Tag
                                    </label>
                                    <input
                                        type="text"
                                        value={editCategory}
                                        onChange={(e) => setEditCategory(e.target.value)}
                                        placeholder="e.g. CUSTOM, TLS, SASE"
                                        className="w-full bg-black/40 border border-border rounded-xl px-3 py-2 text-text-primary text-xs focus:outline-none focus:border-primary/60 transition-colors"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1">
                                        Default Server Port
                                    </label>
                                    <input
                                        type="number"
                                        value={editPort}
                                        onChange={(e) => setEditPort(e.target.value)}
                                        placeholder="18443"
                                        className="w-full bg-black/40 border border-border rounded-xl px-3 py-2 text-text-primary text-xs font-mono focus:outline-none focus:border-primary/60 transition-colors"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1">
                                    Description / Security Context
                                </label>
                                <textarea
                                    value={editDescription}
                                    onChange={(e) => setEditDescription(e.target.value)}
                                    rows={3}
                                    placeholder="Describe the application protocol, expected firewall policy, or SASE inspection behavior..."
                                    className="w-full bg-black/40 border border-border rounded-xl px-3 py-2 text-text-primary text-xs focus:outline-none focus:border-primary/60 transition-colors resize-none"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                            <button
                                type="button"
                                onClick={() => setIsEditModalOpen(false)}
                                className="px-3.5 py-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveEditProfile}
                                disabled={isSavingEdit || !editName.trim()}
                                className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-primary text-black font-bold text-xs hover:opacity-90 transition-all disabled:opacity-50 shadow-md"
                            >
                                {isSavingEdit ? (
                                    <>
                                        <RotateCcw size={13} className="animate-spin" />
                                        <span>Saving...</span>
                                    </>
                                ) : (
                                    <>
                                        <Save size={13} />
                                        <span>Save Changes</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── PCAP Raw Capture Parser Modal ─── */}
            <PcapReplayModal
                isOpen={isPcapModalOpen}
                onClose={() => {
                    setIsPcapModalOpen(false);
                    fetchProfiles();
                }}
                onProfileCreated={(newProfile) => {
                    fetchProfiles();
                    setSelectedProfileFile(newProfile);
                }}
                token={token}
                isPcapEnabled={isPcapEnabled}
            />
        </div>
    );
};
