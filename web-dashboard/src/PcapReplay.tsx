import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    Layers, Play, Square, Upload, Download, Trash2, RefreshCw,
    CheckCircle2, AlertTriangle, Shield, ShieldAlert, Activity,
    Terminal, ArrowRight, ArrowDownRight, Server, Globe, Search,
    Filter, Lock, FileCode, Check, Eye, HelpCircle, Sparkles,
    Cpu, Zap, Radio, Copy, ChevronRight, X, Headphones, Binary,
    FileSpreadsheet, ArrowUpRight, Edit3, Save, RotateCcw,
    Clock, BarChart2, ListFilter, SlidersHorizontal, Info, Compass
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
    const [editTiming, setEditTiming] = useState<'as_fast_as_possible' | 'original'>('as_fast_as_possible');
    const [isSavingEdit, setIsSavingEdit] = useState(false);

    // Console View Mode ('timeline' = SASE milestones, 'stream' = packet stream, 'raw' = json)
    const [consoleViewMode, setConsoleViewMode] = useState<'timeline' | 'stream' | 'raw'>('timeline');

    // Conversation Sequence Filters & Search
    const [turnFilter, setTurnFilter] = useState<'all' | 'client' | 'server'>('all');
    const [turnSearchQuery, setTurnSearchQuery] = useState('');
    const [turnDisplayLimit, setTurnDisplayLimit] = useState<number>(250);

    // Persistence keys
    const STORAGE_KEY_TARGET_IP = 'stigix_replay_target_ip';
    const STORAGE_KEY_SERVER_NODE = 'stigix_replay_server_node';

    // Import / Modal state
    const [isPcapModalOpen, setIsPcapModalOpen] = useState(false);
    const profileUploadInputRef = useRef<HTMLInputElement>(null);

    // Execution / Orchestrator state
    const [replayRole, setReplayRole] = useState<'client' | 'server'>('client');
    const [serverNodeId, setServerNodeId] = useState<string>(() => {
        return localStorage.getItem('stigix_replay_server_node') || '';
    });
    const [customTargetIp, setCustomTargetIp] = useState<string>(() => {
        return localStorage.getItem('stigix_replay_target_ip') || '';
    });
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
                const jobs: any[] = data.jobs || [];
                const sortedJobs = [...jobs].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
                const running = sortedJobs.find((j: any) => j.status === 'running');
                if (running) {
                    setActiveJob(running);
                    setTerminalLogs(running.recentEvents || []);
                } else if (sortedJobs.length > 0) {
                    const latest = sortedJobs[0];
                    setActiveJob(latest);
                    setTerminalLogs(latest.recentEvents || []);
                }
            }
        } catch (_) {}
    }, [gFetch, token]);

    useEffect(() => {
        checkStatus();
        fetchProfiles();
    }, [checkStatus, fetchProfiles]);

    useEffect(() => {
        if (selectedProfileFile) {
            fetchProfileDetails(selectedProfileFile);
            if (activeJob && activeJob.status !== 'running' && activeJob.profile_file !== selectedProfileFile) {
                setActiveJob(null);
                setTerminalLogs([]);
            }
        }
    }, [selectedProfileFile, fetchProfileDetails]);

    // Poll active jobs
    useEffect(() => {
        const interval = setInterval(pollActiveJobs, 1200);
        return () => clearInterval(interval);
    }, [pollActiveJobs]);

    // Auto-discover leader or remote peer when entering client mode without saved IP
    useEffect(() => {
        // If user already has a saved IP or explicitly entered one, do not override
        const savedIp = localStorage.getItem(STORAGE_KEY_TARGET_IP);
        if (savedIp && savedIp !== '127.0.0.1') {
            if (!customTargetIp) setCustomTargetIp(savedIp);
            const savedNode = localStorage.getItem(STORAGE_KEY_SERVER_NODE);
            if (savedNode && !serverNodeId) setServerNodeId(savedNode);
            return;
        }

        // 1. Try finding Leader or remote peer in peers list
        if (peers.length > 0) {
            const leaderPeer = peers.find(p => p.is_leader && p.instance_id !== activePeerId);
            const remotePeer = leaderPeer || peers.find(p => p.instance_id !== activePeerId);
            if (remotePeer && remotePeer.ip_private && remotePeer.ip_private !== '127.0.0.1') {
                setServerNodeId(remotePeer.instance_id);
                setCustomTargetIp(remotePeer.ip_private);
                localStorage.setItem(STORAGE_KEY_SERVER_NODE, remotePeer.instance_id);
                localStorage.setItem(STORAGE_KEY_TARGET_IP, remotePeer.ip_private);
                return;
            }
        }

        // 2. Query registry status to get Leader IP
        const detectLeaderFromRegistry = async () => {
            try {
                const res = await gFetch('/api/registry/status');
                if (res.ok) {
                    const status = await res.json();
                    let leaderIp = status?.leader_info?.ip
                        || status?.leader_tunnel_info?.ip
                        || status?.leader_tunnel_info?.remoteLeaderIp
                        || status?.remote_leader_ip;
                    if (!leaderIp && status?.static_leader_url) {
                        try {
                            leaderIp = new URL(status.static_leader_url).hostname;
                        } catch {}
                    }
                    if (!leaderIp && status?.controller_url) {
                        try {
                            leaderIp = new URL(status.controller_url).hostname;
                        } catch {}
                    }
                    if (leaderIp && leaderIp !== '127.0.0.1') {
                        setCustomTargetIp(leaderIp);
                        localStorage.setItem(STORAGE_KEY_TARGET_IP, leaderIp);
                        const leaderId = status?.leader_info?.id || status?.leader_tunnel_info?.remoteLeaderId || 'leader';
                        setServerNodeId(leaderId);
                        localStorage.setItem(STORAGE_KEY_SERVER_NODE, leaderId);
                    }
                }
            } catch {}
        };
        detectLeaderFromRegistry();
    }, [peers, activePeerId, gFetch]);

    const handleTargetPeerChange = (nodeId: string) => {
        setServerNodeId(nodeId);
        localStorage.setItem(STORAGE_KEY_SERVER_NODE, nodeId);
        if (nodeId === 'local') {
            setCustomTargetIp('127.0.0.1');
            localStorage.setItem(STORAGE_KEY_TARGET_IP, '127.0.0.1');
        } else if (nodeId === 'custom') {
            // Keep current custom target IP
        } else {
            const peer = peers.find(p => p.instance_id === nodeId);
            if (peer?.ip_private) {
                setCustomTargetIp(peer.ip_private);
                localStorage.setItem(STORAGE_KEY_TARGET_IP, peer.ip_private);
            }
        }
    };

    const handleCustomTargetIpChange = (ip: string) => {
        setCustomTargetIp(ip);
        localStorage.setItem(STORAGE_KEY_TARGET_IP, ip);
        const match = peers.find(p => p.ip_private === ip);
        if (match) {
            setServerNodeId(match.instance_id);
            localStorage.setItem(STORAGE_KEY_SERVER_NODE, match.instance_id);
        } else if (ip === '127.0.0.1') {
            setServerNodeId('local');
            localStorage.setItem(STORAGE_KEY_SERVER_NODE, 'local');
        } else {
            setServerNodeId('custom');
            localStorage.setItem(STORAGE_KEY_SERVER_NODE, 'custom');
        }
    };

    // ─── Actions: Profile Editing ─────────────────────────────────────────────

    const handleOpenEditModal = (profile: any) => {
        setEditingProfile(profile);
        setEditName(profile.name || profile.file_name.replace('.stx-replay', ''));
        setEditCategory(profile.category || 'CUSTOM');
        setEditPort(String(profile.primary_flow?.server_port || profile.server_port || 18443));
        setEditDescription(profile.description || '');
        setEditTiming(profile.replay_settings?.timing === 'original' ? 'original' : 'as_fast_as_possible');
        setIsEditModalOpen(true);
    };

    const formatBytes = (bytes: number): string => {
        if (!bytes || bytes <= 0) return '0 B';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    };

    const selectedProfileObj = useMemo(() => {
        return profiles.find((p: any) => p.file_name === selectedProfileFile) || null;
    }, [profiles, selectedProfileFile]);
    const selectedProfileName = selectedProfileObj?.name || selectedProfileFile?.replace('.stx-replay', '') || 'Scenario';

    const runningProfileObj = useMemo(() => {
        if (!activeJob?.profile_file) return null;
        return profiles.find((p: any) => p.file_name === activeJob.profile_file) || null;
    }, [profiles, activeJob]);
    const runningProfileName = runningProfileObj?.name || activeJob?.profile_file?.replace('.stx-replay', '') || activeJob?.profile_file || 'Active Job';

    const handleSaveEditProfile = async () => {
        if (!editingProfile) return;
        setIsSavingEdit(true);
        try {
            const parsedPort = parseInt(editPort, 10);
            const payload: any = {
                name: editName.trim(),
                category: editCategory.trim(),
                description: editDescription.trim(),
                timing: editTiming
            };
            if (!isNaN(parsedPort) && parsedPort > 0) {
                payload.server_port = parsedPort;
            }

            const res = await gFetch(`/api/pcap/profiles/${encodeURIComponent(editingProfile.file_name)}`, {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
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
            if (ev?.event === 'turn_completed' || ev?.event === 'client_turn_completed' || ev?.event === 'udp_datagram_sent') {
                if (typeof ev.seq === 'number' && ev.seq > maxSeq) {
                    maxSeq = ev.seq;
                }
            } else if (ev?.event === 'session_finished' || ev?.event === 'client_session_finished' || ev?.event === 'loop_cycle_completed') {
                if (typeof ev.completed_turns === 'number') {
                    maxSeq = Math.max(maxSeq, ev.completed_turns);
                }
            }
        }
        return maxSeq;
    }, [terminalLogs]);

    // Live SASE and Replay Telemetry with Loop and Cumulative byte counting
    const liveTelemetry = useMemo(() => {
        let txBytes = 0;
        let rxBytes = 0;
        let durationMs = 0;
        let lastVerdict = activeJob?.lastVerdict || null;
        let isFinished = false;
        let loopIteration = 1;
        let hasLoopEvent = false;

        for (const log of terminalLogs) {
            const ev = typeof log === 'string' ? null : log;
            if (!ev) continue;
            if (ev.iteration && ev.iteration > loopIteration) {
                loopIteration = ev.iteration;
            }
            if (ev.event === 'loop_cycle_completed') {
                hasLoopEvent = true;
                if (ev.iteration) loopIteration = Math.max(loopIteration, ev.iteration);
                if (ev.cumulative_tx_bytes !== undefined) txBytes = Math.max(txBytes, ev.cumulative_tx_bytes);
                if (ev.cumulative_rx_bytes !== undefined) rxBytes = Math.max(rxBytes, ev.cumulative_rx_bytes);
                if (ev.verdict) lastVerdict = ev.verdict;
                if (ev.duration_ms) durationMs = ev.duration_ms;
            } else if (ev.event === 'udp_datagram_sent') {
                txBytes += (ev.bytes || 0);
            } else if (ev.event === 'udp_datagram_received') {
                rxBytes += (ev.bytes || 0);
            } else if (ev.event === 'turn_completed' || ev.event === 'client_turn_completed') {
                if (ev.sender === 'client') txBytes += (ev.bytes || 0);
                else rxBytes += (ev.bytes || 0);
            } else if (ev.event === 'session_finished' || ev.event === 'client_session_finished') {
                isFinished = true;
                if (ev.cumulative_tx_bytes !== undefined) txBytes = Math.max(txBytes, ev.cumulative_tx_bytes);
                else if (ev.tx_bytes !== undefined) txBytes = Math.max(txBytes, ev.tx_bytes);
                if (ev.cumulative_rx_bytes !== undefined) rxBytes = Math.max(rxBytes, ev.cumulative_rx_bytes);
                else if (ev.rx_bytes !== undefined) rxBytes = Math.max(rxBytes, ev.rx_bytes);
                if (ev.duration_ms !== undefined) durationMs = ev.duration_ms;
                if (ev.verdict) lastVerdict = ev.verdict;
            }
        }

        const isRunning = activeJob?.status === 'running';
        const isLoopMode = isLooping || hasLoopEvent || loopIteration > 1;
        const totalTurns = activeJob?.total_turns || profileDetails?.flows?.[0]?.turns?.length || 0;
        const isSuccessVerdict = lastVerdict === 'Bypass' || (lastVerdict?.includes('Enforced') ?? false);
        const completedTurns = (isFinished && !isRunning && isSuccessVerdict)
            ? totalTurns
            : Math.min(totalTurns, lastCompletedTurnSeq);
        const progressPct = totalTurns > 0 ? Math.min(100, Math.round((completedTurns / totalTurns) * 100)) : 0;

        return {
            totalTurns,
            completedTurns,
            progressPct,
            txBytes,
            rxBytes,
            totalBytes: txBytes + rxBytes,
            durationMs,
            lastVerdict,
            isFinished,
            loopIteration,
            isLooping: isLoopMode,
            isRunning
        };
    }, [activeJob, terminalLogs, profileDetails, lastCompletedTurnSeq, isLooping]);

    const handleClearReplayHistory = async () => {
        try {
            await gFetch('/api/pcap/replay/clear', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch (_) {}
        setActiveJob(null);
        setTerminalLogs([]);
        setSelectedTurnIndex(0);
        toast.success('Replay state & execution history cleared');
    };

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
        setTerminalLogs([]);

        try {
            const payload: any = {
                role: replayRole,
                profile_file: selectedProfileFile,
                port: effectivePort
            };

            if (replayRole === 'client') {
                payload.target = customTargetIp || '127.0.0.1';
                payload.loop = isLooping;
                payload.interval = (loopInterval || 1) * 1000;
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
                setActiveJob({
                    id: data.job_id,
                    role: replayRole,
                    profile_file: selectedProfileFile,
                    target: payload.target,
                    port: effectivePort,
                    pid: data.pid,
                    startedAt: Date.now(),
                    status: 'running',
                    recentEvents: [
                        {
                            timestamp: Date.now() / 1000,
                            event: 'starting',
                            text: `Starting ${replayRole.toUpperCase()} process against ${payload.target || 'target'} (PID ${data.pid})...`
                        }
                    ]
                });
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

    // ─── Helpers: Advanced Payload Decoding & Protocol Intelligence ───────────

    const getTurnBytes = useCallback((turn: any): Uint8Array => {
        if (!turn) return new Uint8Array(0);
        if (turn.payload_b64) {
            try {
                const bin = atob(turn.payload_b64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) {
                    bytes[i] = bin.charCodeAt(i);
                }
                return bytes;
            } catch {}
        }
        const raw = turn.ascii_preview || turn.preview || '';
        const bytes: number[] = [];
        let i = 0;
        while (i < raw.length) {
            if (raw[i] === '\\' && raw[i + 1] === 'x' && i + 3 < raw.length) {
                const hex = raw.slice(i + 2, i + 4);
                bytes.push(parseInt(hex, 16) || 0);
                i += 4;
            } else {
                bytes.push(raw.charCodeAt(i));
                i++;
            }
        }
        return new Uint8Array(bytes);
    }, []);

    const formatWiresharkHexDump = useCallback((bytes: Uint8Array): string => {
        if (!bytes || bytes.length === 0) return 'No payload data available';
        const lines: string[] = [];
        for (let i = 0; i < bytes.length; i += 16) {
            const offset = i.toString(16).padStart(4, '0').toUpperCase();
            const chunk = bytes.slice(i, i + 16);
            const hexParts: string[] = [];
            let asciiStr = '';
            for (let j = 0; j < 16; j++) {
                if (j < chunk.length) {
                    const b = chunk[j];
                    hexParts.push(b.toString(16).padStart(2, '0').toUpperCase());
                    asciiStr += (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
                } else {
                    hexParts.push('  ');
                }
            }
            const group1 = hexParts.slice(0, 8).join(' ');
            const group2 = hexParts.slice(8, 16).join(' ');
            lines.push(`${offset}  ${group1}  ${group2}  |${asciiStr}|`);
        }
        return lines.join('\n');
    }, []);

    const formatCleanAscii = useCallback((bytes: Uint8Array): string => {
        if (!bytes || bytes.length === 0) return 'No payload data available';
        let str = '';
        for (let i = 0; i < bytes.length; i++) {
            const b = bytes[i];
            if (b === 10 || b === 13 || (b >= 32 && b <= 126)) {
                str += String.fromCharCode(b);
            } else {
                str += '.';
            }
        }
        return str;
    }, []);

    const analyzeTurn = useCallback((turn: any) => {
        if (!turn) {
            return {
                proto: 'Unknown',
                badge: 'bg-card text-text-muted border-border',
                snippet: 'Empty step',
                isBinary: false
            };
        }
        const bytes = getTurnBytes(turn);
        const len = turn.length || turn.payload_len || bytes.length || 0;
        const ascii = formatCleanAscii(bytes);

        // Check SIP (Voice Signaling)
        if (ascii.includes('SIP/2.0') || ascii.startsWith('INVITE ') || ascii.startsWith('REGISTER ') || ascii.startsWith('ACK ') || ascii.startsWith('BYE ') || ascii.startsWith('OPTIONS ')) {
            const firstLine = ascii.split(/[\r\n]+/)[0].trim().slice(0, 52);
            return {
                proto: 'SIP Signaling',
                badge: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
                snippet: firstLine,
                isBinary: false
            };
        }

        // Check HTTP (REST APIs / Web)
        if (ascii.startsWith('GET ') || ascii.startsWith('POST ') || ascii.startsWith('PUT ') || ascii.startsWith('DELETE ') || ascii.startsWith('HEAD ') || ascii.startsWith('HTTP/1.')) {
            const firstLine = ascii.split(/[\r\n]+/)[0].trim().slice(0, 52);
            return {
                proto: 'HTTP REST',
                badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
                snippet: firstLine,
                isBinary: false
            };
        }

        // Check TLS Record Layer
        if (bytes.length >= 3 && bytes[0] === 0x16 && bytes[1] === 0x03) {
            let tlsType = 'TLS Handshake';
            if (bytes.length >= 6 && bytes[5] === 0x01) tlsType = 'ClientHello';
            else if (bytes.length >= 6 && bytes[5] === 0x02) tlsType = 'ServerHello';
            return {
                proto: 'TLS Handshake',
                badge: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
                snippet: `${tlsType} (TLS 1.${bytes[2]}) - ${len}B`,
                isBinary: true
            };
        }
        if (bytes.length >= 3 && bytes[0] === 0x17 && bytes[1] === 0x03) {
            return {
                proto: 'TLS Encrypted',
                badge: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
                snippet: `Application Data (Encrypted L7) - ${len}B`,
                isBinary: true
            };
        }

        // Check RTP (VoIP voice payload)
        if (bytes.length >= 12 && (bytes[0] === 0x80 || bytes[0] === 0x81)) {
            const pt = bytes[1] & 0x7F;
            const ptName = pt === 0 ? 'PCMU (G.711u)' : pt === 8 ? 'PCMA (G.711a)' : pt === 9 ? 'G.722' : pt === 18 ? 'G.729' : `PT=${pt}`;
            const seq = (bytes[2] << 8) | bytes[3];
            return {
                proto: 'RTP Voice',
                badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
                snippet: `Media Payload: ${ptName}, Seq #${seq} (${len}B)`,
                isBinary: true
            };
        }

        // Check DNS
        if (ascii.includes('.com') || ascii.includes('.net') || ascii.includes('.org') || ascii.includes('.local')) {
            const clean = ascii.replace(/[^a-zA-Z0-9\.\-_]/g, ' ').trim().split(/\s+/).find(w => w.includes('.')) || 'Query/Answer';
            return {
                proto: 'DNS Datagram',
                badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
                snippet: `DNS Record: ${clean} (${len}B)`,
                isBinary: true
            };
        }

        // Check Plaintext / JSON
        let printableCount = 0;
        for (let j = 0; j < Math.min(bytes.length, 32); j++) {
            if (bytes[j] >= 32 && bytes[j] <= 126) printableCount++;
        }
        if (printableCount > Math.min(bytes.length, 32) * 0.7) {
            const clean = ascii.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 52);
            return {
                proto: 'Plaintext',
                badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
                snippet: clean || `${len} bytes payload`,
                isBinary: false
            };
        }

        // Default Binary
        const hexHead = Array.from(bytes.slice(0, 6)).map(b => b.toString(16).padStart(2, '0')).join(' ');
        return {
            proto: 'Binary L7',
            badge: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
            snippet: `Hex: ${hexHead}... (${len}B)`,
            isBinary: true
        };
    }, [getTurnBytes, formatCleanAscii]);

    // ─── Helpers: Filtering & Turns Computation ───────────────────────────────

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

    // Directional turns summary KPIs
    const turnsSummary = useMemo(() => {
        let clientTurns = 0;
        let serverTurns = 0;
        let clientBytes = 0;
        let serverBytes = 0;
        for (const t of turns) {
            const isClient = t.sender === 'client' || t.direction === 'client' || t.direction === 'client_to_server';
            const len = t.length || t.payload_len || 0;
            if (isClient) {
                clientTurns++;
                clientBytes += len;
            } else {
                serverTurns++;
                serverBytes += len;
            }
        }
        return {
            totalTurns: turns.length,
            clientTurns,
            serverTurns,
            clientBytes,
            serverBytes,
            totalBytes: clientBytes + serverBytes
        };
    }, [turns]);

    // Filtered turns list based on user filter pill and search box
    const filteredTurns = useMemo(() => {
        return turns.filter((turn: any, idx: number) => {
            const isClient = turn.sender === 'client' || turn.direction === 'client' || turn.direction === 'client_to_server';
            if (turnFilter === 'client' && !isClient) return false;
            if (turnFilter === 'server' && isClient) return false;
            if (!turnSearchQuery.trim()) return true;

            const q = turnSearchQuery.toLowerCase().trim();
            if (String(idx + 1) === q || `step #${idx + 1}`.includes(q) || `turn #${idx + 1}`.includes(q)) return true;
            if (String(turn.length || turn.payload_len) === q) return true;
            const preview = (turn.ascii_preview || turn.preview || '').toLowerCase();
            if (preview.includes(q)) return true;
            return false;
        });
    }, [turns, turnFilter, turnSearchQuery]);

    const selectedTurn = selectedTurnIndex !== null && turns[selectedTurnIndex] ? turns[selectedTurnIndex] : null;
    const selectedTurnBytes = useMemo(() => getTurnBytes(selectedTurn), [selectedTurn, getTurnBytes]);
    const selectedTurnAnalysis = useMemo(() => analyzeTurn(selectedTurn), [selectedTurn, analyzeTurn]);
    const selectedTurnHexDump = useMemo(() => formatWiresharkHexDump(selectedTurnBytes), [selectedTurnBytes, formatWiresharkHexDump]);
    const selectedTurnCleanAscii = useMemo(() => formatCleanAscii(selectedTurnBytes), [selectedTurnBytes, formatCleanAscii]);

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
                        ({log.total_turns} steps total)
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
                    <span className="font-black text-text-primary">Step #{log.seq}</span>
                    <span className="text-text-secondary font-mono">{log.bytes} bytes</span>
                    <span className="text-text-muted/70 text-[9px] font-mono">({log.duration_ms}ms)</span>
                </div>
            );
        }

        if (ev === 'udp_datagram_sent') {
            return (
                <div key={idx} className="flex items-center gap-2 py-0.5 text-[10px]">
                    <span className="text-text-muted/40 select-none text-[8px] font-mono">[{idx + 1}]</span>
                    <span className="px-1.5 py-0.2 rounded font-black uppercase text-[8px] flex items-center gap-1 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                        ⬆️ UDP ➔ {log.target_ip}:{log.target_port}
                    </span>
                    {log.seq !== undefined && <span className="font-black text-text-primary">Step #{log.seq}</span>}
                    <span className="text-text-secondary font-mono">{log.bytes} bytes</span>
                </div>
            );
        }

        if (ev === 'udp_datagram_received') {
            return (
                <div key={idx} className="flex items-center gap-2 py-0.5 text-[10px]">
                    <span className="text-text-muted/40 select-none text-[8px] font-mono">[{idx + 1}]</span>
                    <span className="px-1.5 py-0.2 rounded font-black uppercase text-[8px] flex items-center gap-1 bg-teal-500/20 text-teal-400 border border-teal-500/30">
                        ⬇️ UDP  {log.client_ip}:{log.client_port}
                    </span>
                    <span className="text-text-secondary font-mono">{log.bytes} bytes</span>
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
                        {log.completed_turns}/{log.total_turns} steps completed
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
                                    L7 Steps
                                </span>
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                                    <Sparkles size={9} /> Auto-Sync Fleet
                                </span>
                            </div>
                            <p className="text-[11px] text-text-muted mt-0.5 line-clamp-1 max-w-2xl">
                                Package raw PCAP traces into zero-config replay profiles, auto-scrub credentials, distribute across spokes & execute synchronized client/server steps with SASE verdict enforcement.
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

                {/* Integrated Stateful Replay Control Ribbon */}
                <div className="mt-3 pt-3 border-t border-border/60 flex flex-wrap items-center justify-between gap-3">
                    {/* Left: Role Switcher & Inline Parameters */}
                    <div className="flex flex-wrap items-center gap-2.5">
                        {/* Role Switcher */}
                        <div className="flex p-0.5 bg-black/40 border border-border rounded-xl">
                            <button
                                type="button"
                                onClick={() => setReplayRole('server')}
                                className={`py-1.5 px-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer ${
                                    replayRole === 'server'
                                        ? 'bg-purple-600 text-white shadow-sm shadow-purple-600/25'
                                        : 'text-text-muted hover:text-text-primary'
                                }`}
                            >
                                <Headphones size={13} />
                                <span>Server Mode</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setReplayRole('client')}
                                className={`py-1.5 px-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer ${
                                    replayRole === 'client'
                                        ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/25'
                                        : 'text-text-muted hover:text-text-primary'
                                }`}
                            >
                                <Play size={13} />
                                <span>Client Mode</span>
                            </button>
                        </div>

                        {/* Inline Role Parameters */}
                        {replayRole === 'server' ? (
                            <div className="flex items-center gap-2 text-xs">
                                <span className="text-[11px] text-text-muted font-bold font-mono bg-black/30 px-2 py-1 rounded-lg border border-border">
                                    Bind: 0.0.0.0
                                </span>
                                <div className="flex items-center gap-1.5 bg-black/30 px-2.5 py-1 rounded-lg border border-border">
                                    <span className="text-[10px] text-text-muted font-bold uppercase">Port:</span>
                                    <input
                                        type="number"
                                        value={portOverride}
                                        onChange={(e) => setPortOverride(e.target.value)}
                                        placeholder="18443"
                                        className="w-16 bg-transparent text-xs font-mono font-bold text-text-primary focus:outline-none"
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                                {/* Target Peer Selector */}
                                <div className="flex items-center gap-1.5 bg-black/30 px-2.5 py-1 rounded-lg border border-border">
                                    <Server size={11} className="text-purple-400" />
                                    <select
                                        value={serverNodeId}
                                        onChange={(e) => handleTargetPeerChange(e.target.value)}
                                        className="bg-transparent text-xs font-bold text-text-primary focus:outline-none cursor-pointer"
                                    >
                                        {peers.map((peer) => (
                                            <option key={peer.instance_id} value={peer.instance_id} className="bg-card text-text-primary">
                                                {peer.site || peer.instance_id} {peer.is_leader ? '(Leader)' : ''} ({peer.ip_private || 'No IP'})
                                            </option>
                                        ))}
                                        {serverNodeId === 'custom' && (
                                            <option value="custom" className="bg-card text-text-primary">Custom Host ({customTargetIp})</option>
                                        )}
                                        <option value="local" className="bg-card text-text-primary">Local Node (127.0.0.1)</option>
                                    </select>
                                </div>

                                {/* Destination IP */}
                                <div className="flex items-center gap-1.5 bg-black/30 px-2.5 py-1 rounded-lg border border-border">
                                    <Globe size={11} className="text-blue-400" />
                                    <input
                                        type="text"
                                        value={customTargetIp}
                                        onChange={(e) => handleCustomTargetIpChange(e.target.value)}
                                        placeholder="192.168.203.100"
                                        className="w-28 bg-transparent text-xs font-mono font-bold text-text-primary focus:outline-none"
                                    />
                                </div>

                                {/* Port */}
                                <div className="flex items-center gap-1.5 bg-black/30 px-2.5 py-1 rounded-lg border border-border">
                                    <span className="text-[10px] text-text-muted font-bold uppercase">Port:</span>
                                    <input
                                        type="number"
                                        value={portOverride}
                                        onChange={(e) => setPortOverride(e.target.value)}
                                        placeholder="Port"
                                        className="w-16 bg-transparent text-xs font-mono font-bold text-text-primary focus:outline-none"
                                    />
                                </div>

                                {/* Loop Toggle */}
                                <div className="flex items-center gap-1 bg-black/30 px-2 py-1 rounded-lg border border-border">
                                    <label className="flex items-center gap-1.5 cursor-pointer text-[10px] font-bold text-text-muted hover:text-text-primary">
                                        <input
                                            type="checkbox"
                                            checked={isLooping}
                                            onChange={(e) => setIsLooping(e.target.checked)}
                                            className="rounded border-border accent-emerald-500 cursor-pointer"
                                        />
                                        <span>Loop</span>
                                    </label>
                                    {isLooping && (
                                        <div className="flex items-center gap-0.5 text-[9px] font-mono text-text-muted border-l border-border/50 pl-1.5 ml-1">
                                            <input
                                                type="number"
                                                min={1}
                                                max={60}
                                                value={loopInterval}
                                                onChange={(e) => setLoopInterval(Math.max(1, parseInt(e.target.value) || 1))}
                                                className="w-7 bg-black/40 border border-border/80 rounded px-1 text-center text-text-primary focus:outline-none text-[9px]"
                                                title="Loop interval in seconds"
                                            />
                                            <span>s</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Telemetry Path Pill */}
                        <div className={`hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-mono ${
                            customTargetIp === '127.0.0.1' || serverNodeId === 'local'
                                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        }`}>
                            {customTargetIp === '127.0.0.1' || serverNodeId === 'local' ? (
                                <span>⚠️ Loopback 127.0.0.1</span>
                            ) : (
                                <span>⚡ SD-WAN: Local ➔ {serverNodeId} ({customTargetIp})</span>
                            )}
                        </div>
                    </div>

                    {/* Right: Primary Action Button */}
                    <div className="flex items-center gap-2">
                        {activeJob && activeJob.status !== 'running' && (
                            <button
                                type="button"
                                onClick={handleClearReplayHistory}
                                className="px-3 py-1.5 rounded-xl bg-card-secondary/80 hover:bg-card-secondary text-text-muted hover:text-text-primary border border-border/60 hover:border-border font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                                title="Clear previous execution verdict & reset conversation steps"
                            >
                                <RotateCcw size={12} />
                                <span>Reset / Clear</span>
                            </button>
                        )}
                        {activeJob?.status === 'running' ? (
                            <button
                                type="button"
                                onClick={handleStopReplay}
                                className="px-4 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black uppercase tracking-wider text-xs flex items-center gap-1.5 shadow-md shadow-red-600/20 cursor-pointer transition-all animate-pulse"
                                title={`Stop running ${activeJob.role} process (PID: ${activeJob.pid})`}
                            >
                                <Square size={13} />
                                <span>Stop {activeJob.role === 'server' ? 'Server' : 'Client'}: {runningProfileName} (PID: {activeJob.pid})</span>
                            </button>
                        ) : replayRole === 'server' ? (
                            <button
                                type="button"
                                onClick={handleLaunchReplay}
                                disabled={isStartingReplay || !selectedProfileFile}
                                className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-black uppercase tracking-wider text-xs flex items-center gap-1.5 shadow-md shadow-purple-600/20 cursor-pointer transition-all disabled:opacity-50"
                                title={`Start Server Listener for ${selectedProfileName}`}
                            >
                                <Headphones size={13} />
                                <span>{isStartingReplay ? 'Starting...' : `Start Server: ${selectedProfileName} (Port ${portOverride || activeFlow?.server_port || '10080'})`}</span>
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={handleLaunchReplay}
                                disabled={isStartingReplay || !selectedProfileFile}
                                className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-black uppercase tracking-wider text-xs flex items-center gap-1.5 shadow-md shadow-emerald-600/20 cursor-pointer transition-all disabled:opacity-50"
                                title={`Launch Client Replay for ${selectedProfileName}`}
                            >
                                <Play size={13} />
                                <span>{isStartingReplay ? 'Connecting...' : `Launch Client: ${selectedProfileName} ➔ ${customTargetIp || '192.168.203.100'}`}</span>
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* ─── Three-Column Main Workspace ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 h-[calc(100vh-215px)] min-h-[500px]">

                {/* ─── Column 1: Profiles Catalogue (Narrow: lg:col-span-3) ─── */}
                <div className="lg:col-span-3 flex flex-col h-full overflow-hidden">
                    <div className="bg-card border border-border rounded-2xl p-3 shadow-xl flex flex-col h-full overflow-hidden">
                        {/* Catalogue Header */}
                        <div className="flex items-center justify-between pb-2 border-b border-border shrink-0">
                            <div>
                                <h2 className="text-xs font-black text-text-primary uppercase tracking-tight flex items-center gap-1.5">
                                    <FileCode size={13} className="text-indigo-400" />
                                    <span>Profiles Catalogue</span>
                                </h2>
                                <p className="text-[9px] text-text-muted font-bold tracking-wider mt-0.5">
                                    {profiles.length} COMPILED
                                </p>
                            </div>
                            <span className="text-[8px] font-black text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20" title="Profiles up to this threshold are auto-synced across the Mesh tunnel.">
                                Mesh Sync: &le; {profiles[0]?.sync_threshold_mb || 10}MB
                            </span>
                        </div>

                        {/* Search and Category Filters */}
                        <div className="py-2 space-y-1.5 border-b border-border/50 shrink-0">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" size={11} />
                                <input
                                    type="text"
                                    placeholder="Search..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full bg-card-secondary/50 border border-border rounded-lg pl-7 pr-2 py-1 text-[11px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                                />
                            </div>

                            {/* Category Filter Pills */}
                            {categories.length > 2 && (
                                <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none">
                                    {categories.map(cat => (
                                        <button
                                            key={cat}
                                            onClick={() => setCategoryFilter(cat)}
                                            className={`px-1.5 py-0.2 rounded text-[8px] font-black uppercase tracking-wider transition-all whitespace-nowrap cursor-pointer ${
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

                        {/* Profile List Container */}
                        <div className="flex-1 min-h-0 overflow-y-auto pt-1.5 space-y-1.5 pr-1 scrollbar-thin scrollbar-thumb-border">
                            {isLoading ? (
                                <div className="flex flex-col items-center justify-center h-48 text-text-muted gap-2">
                                    <RefreshCw className="animate-spin" size={16} />
                                    <span className="text-[11px]">Loading catalogue...</span>
                                </div>
                            ) : filteredProfiles.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-48 text-text-muted text-center p-3 border-2 border-dashed border-border/60 rounded-xl">
                                    <FileCode size={22} className="opacity-30 mb-1" />
                                    <p className="text-[11px] font-bold">No Profiles Found</p>
                                </div>
                            ) : (
                                filteredProfiles.map(p => {
                                    const isSelected = selectedProfileFile === p.file_name;
                                    const isRunningThisJob = activeJob?.status === 'running' && activeJob?.profile_file === p.file_name;
                                    const flow = p.primary_flow;
                                    return (
                                        <div
                                            key={p.file_name}
                                            onClick={() => setSelectedProfileFile(p.file_name)}
                                            title={p.file_name}
                                            className={`py-1.5 px-2 rounded-xl border transition-all cursor-pointer relative group ${
                                                isSelected
                                                    ? 'bg-indigo-500/15 border-indigo-500/50 shadow-sm shadow-indigo-500/10'
                                                    : isRunningThisJob
                                                    ? 'bg-emerald-500/10 border-emerald-500/40 shadow-sm shadow-emerald-500/10'
                                                    : 'bg-card-secondary/25 hover:bg-card-secondary/60 border-border/60'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-1">
                                                <div className="flex items-center gap-1 min-w-0 flex-1">
                                                    <span className="text-[11px] font-bold text-text-primary truncate">
                                                        {p.name || p.file_name.replace('.stx-replay', '')}
                                                    </span>
                                                    {isRunningThisJob ? (
                                                        <span className="text-[7px] px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full font-black uppercase shrink-0 animate-pulse flex items-center gap-1">
                                                            <span className="w-1 h-1 rounded-full bg-emerald-400"></span>
                                                            {activeJob.role === 'server' ? 'Server' : 'Client'}
                                                        </span>
                                                    ) : p.category && (
                                                        <span className="text-[7px] px-1 py-0.2 bg-card-secondary text-text-secondary border border-border rounded font-black uppercase shrink-0">
                                                            {p.category}
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleOpenEditModal(p); }}
                                                        className="p-0.5 hover:bg-card-secondary rounded text-text-muted hover:text-indigo-400 transition-colors cursor-pointer"
                                                        title="Edit profile"
                                                    >
                                                        <Edit3 size={11} />
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleDownloadProfile(p.file_name); }}
                                                        className="p-0.5 hover:bg-card-secondary rounded text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                                                        title="Download"
                                                    >
                                                        <Download size={11} />
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleDeleteProfile(p.file_name); }}
                                                        className="p-0.5 hover:bg-red-500/20 rounded text-text-muted hover:text-red-400 transition-colors cursor-pointer"
                                                        title="Delete"
                                                    >
                                                        <Trash2 size={11} />
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 mt-0.5 text-[9px] text-text-muted">
                                                <span className="flex items-center gap-1 font-semibold text-text-secondary">
                                                    <Radio size={8} className="text-indigo-400" />
                                                    <span>{p.total_turns || 0} steps</span>
                                                </span>
                                                {flow?.server_port && (
                                                    <span className="font-mono text-purple-400 font-bold bg-purple-500/10 px-1 py-0.2 rounded border border-purple-500/20 text-[8px]">
                                                        Port {flow.server_port}
                                                    </span>
                                                )}
                                                {p.is_fleet_synced !== undefined && (
                                                    <span className={`text-[7px] px-1 py-0.2 rounded font-black uppercase shrink-0 border ${
                                                        p.is_fleet_synced
                                                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                                            : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                                                    }`} title={p.is_fleet_synced ? `Auto-synced across fleet (≤ ${p.sync_threshold_mb || 10}MB)` : `Local only (> ${p.sync_threshold_mb || 10}MB) — Export to sync manually`}>
                                                        {p.is_fleet_synced ? 'Synced' : 'Local Only'}
                                                    </span>
                                                )}
                                                {p.size_bytes && (
                                                    <span className="text-[8px] text-text-muted/60 font-mono ml-auto">
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

                {/* ─── Column 2: Selected Scenario & Step Sequence (lg:col-span-4) ─── */}
                <div className="lg:col-span-4 flex flex-col h-full overflow-hidden">
                    <div className="bg-card border border-border rounded-2xl p-3.5 shadow-xl flex flex-col h-full overflow-hidden">
                        {/* Background Active Job Alert if viewing another profile */}
                        {activeJob?.status === 'running' && activeJob?.profile_file !== selectedProfileFile && (
                            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-2.5 py-1.5 mb-2 flex items-center justify-between text-xs text-amber-300">
                                <span className="flex items-center gap-1.5 text-[10px] truncate">
                                    <Activity size={11} className="animate-spin text-amber-400 shrink-0" />
                                    <span className="truncate">
                                        Running {activeJob.role === 'server' ? 'Server' : 'Client'}: <b>{runningProfileName}</b> (PID {activeJob.pid})
                                    </span>
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setSelectedProfileFile(activeJob.profile_file)}
                                    className="text-[9px] font-bold text-amber-200 underline hover:text-white cursor-pointer ml-1.5 shrink-0"
                                >
                                    View
                                </button>
                            </div>
                        )}

                        {/* Header with High-Level Conversation KPIs */}
                        <div className="pb-2.5 border-b border-border shrink-0 space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                    <div className="p-1 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400">
                                        <Radio size={13} />
                                    </div>
                                    <div>
                                        <h3 className="text-xs font-black text-text-primary uppercase tracking-tight">
                                            Conversation Sequence
                                        </h3>
                                        <p className="text-[9px] text-text-muted font-bold tracking-wider">
                                            {profileDetails ? `${turns.length} DIRECTIONAL STEPS` : 'SELECT A PROFILE'}
                                        </p>
                                    </div>
                                </div>
                                {profileDetails && (
                                    <span className="text-[9px] font-mono text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-lg border border-purple-500/20 font-bold">
                                        {activeFlow?.transport?.toUpperCase() || 'TCP'}:{portOverride || activeFlow?.server_port || 18443}
                                    </span>
                                )}
                            </div>

                            {/* Conversation Summary Bar */}
                            {profileDetails && turns.length > 0 && (
                                <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-2 py-1 flex items-center justify-between text-[9px]">
                                        <span className="text-blue-400 font-bold flex items-center gap-1">
                                            <ArrowRight size={10} /> Client Sent
                                        </span>
                                        <span className="font-mono text-text-primary font-bold">
                                            {turnsSummary.clientTurns} steps · {(turnsSummary.clientBytes / 1024).toFixed(1)} KB
                                        </span>
                                    </div>
                                    <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg px-2 py-1 flex items-center justify-between text-[9px]">
                                        <span className="text-purple-400 font-bold flex items-center gap-1">
                                            <ArrowDownRight size={10} /> Server Sent
                                        </span>
                                        <span className="font-mono text-text-primary font-bold">
                                            {turnsSummary.serverTurns} steps · {(turnsSummary.serverBytes / 1024).toFixed(1)} KB
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* Turns Filter and Search Toolbar */}
                            {profileDetails && turns.length > 0 && (
                                <div className="flex items-center gap-1.5 pt-1">
                                    <div className="flex p-0.5 bg-black/40 border border-border/70 rounded-lg shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => setTurnFilter('all')}
                                            className={`px-2 py-0.5 rounded text-[8px] font-bold transition-all cursor-pointer ${
                                                turnFilter === 'all'
                                                    ? 'bg-purple-600 text-white shadow-sm'
                                                    : 'text-text-muted hover:text-text-primary'
                                            }`}
                                        >
                                            All ({turns.length})
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setTurnFilter('client')}
                                            className={`px-2 py-0.5 rounded text-[8px] font-bold transition-all cursor-pointer flex items-center gap-0.5 ${
                                                turnFilter === 'client'
                                                    ? 'bg-blue-600 text-white shadow-sm'
                                                    : 'text-text-muted hover:text-blue-400'
                                            }`}
                                        >
                                            <span>⬆️ Client</span>
                                            <span>({turnsSummary.clientTurns})</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setTurnFilter('server')}
                                            className={`px-2 py-0.5 rounded text-[8px] font-bold transition-all cursor-pointer flex items-center gap-0.5 ${
                                                turnFilter === 'server'
                                                    ? 'bg-purple-600 text-white shadow-sm'
                                                    : 'text-text-muted hover:text-purple-400'
                                            }`}
                                        >
                                            <span>⬇️ Server</span>
                                            <span>({turnsSummary.serverTurns})</span>
                                        </button>
                                    </div>

                                    <div className="relative flex-1">
                                        <Search size={10} className="absolute left-2 top-2 text-text-muted" />
                                        <input
                                            type="text"
                                            value={turnSearchQuery}
                                            onChange={(e) => setTurnSearchQuery(e.target.value)}
                                            placeholder="Search payload, hex, #..."
                                            className="w-full bg-black/40 border border-border/70 rounded-lg pl-6 pr-2 py-0.5 text-[9px] text-text-primary focus:outline-none focus:border-purple-500/50 transition-colors"
                                        />
                                        {turnSearchQuery && (
                                            <button
                                                type="button"
                                                onClick={() => setTurnSearchQuery('')}
                                                className="absolute right-1.5 top-1.5 text-text-muted hover:text-text-primary"
                                            >
                                                <X size={9} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {isLoadingDetails ? (
                            <div className="flex flex-col items-center justify-center flex-1 text-text-muted gap-2">
                                <RefreshCw className="animate-spin text-purple-400" size={18} />
                                <span className="text-xs">Unpacking steps...</span>
                            </div>
                        ) : !profileDetails ? (
                            <div className="flex flex-col items-center justify-center flex-1 text-center text-text-muted p-4">
                                <p className="text-xs font-bold">No Profile Selected</p>
                                <p className="text-[10px] opacity-70 mt-1">Select a profile on the left to inspect its step sequence.</p>
                            </div>
                        ) : (
                            <div className="flex-1 min-h-0 flex flex-col pt-2 gap-2">
                                {/* Step List with Informative Directional Cards */}
                                <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin scrollbar-thumb-border">
                                    {filteredTurns.length === 0 ? (
                                        <div className="text-center py-6 text-text-muted text-[10px] italic">
                                            No conversation steps match the current filter.
                                        </div>
                                    ) : (
                                        <>
                                            {filteredTurns.slice(0, turnDisplayLimit).map((turn: any) => {
                                                const originalIndex = turns.indexOf(turn);
                                                const idx = originalIndex >= 0 ? originalIndex : 0;
                                                const isClient = turn.sender === 'client' || turn.direction === 'client' || turn.direction === 'client_to_server';
                                                const isTurnSelected = selectedTurnIndex === idx;
                                                const isCompleted = (idx + 1) <= lastCompletedTurnSeq;
                                                const isActive = (idx + 1) === (lastCompletedTurnSeq + 1) && activeJob?.status === 'running';
                                                const analysis = analyzeTurn(turn);
                                                const len = turn.length || turn.payload_len || 0;

                                                return (
                                                    <div
                                                        key={idx}
                                                        onClick={() => setSelectedTurnIndex(idx)}
                                                        className={`p-1.5 px-2 rounded-xl border transition-all cursor-pointer flex flex-col gap-1 ${
                                                            isTurnSelected
                                                                ? 'bg-purple-500/15 border-purple-500/60 shadow-md ring-1 ring-purple-500/30'
                                                                : isCompleted
                                                                ? 'bg-emerald-500/5 hover:bg-emerald-500/10 border-emerald-500/25'
                                                                : isActive
                                                                ? 'bg-indigo-500/10 border-indigo-500/40 animate-pulse'
                                                                : 'bg-card-secondary/30 hover:bg-card-secondary/70 border-border/50'
                                                        }`}
                                                    >
                                                        <div className="flex items-center justify-between gap-1.5">
                                                            <div className="flex items-center gap-1.5 min-w-0">
                                                                <span className={`w-4 h-4 rounded border flex items-center justify-center font-mono text-[8px] font-black shrink-0 ${
                                                                    isCompleted
                                                                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                                                                        : isActive
                                                                        ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/40'
                                                                        : 'bg-card border-border text-text-muted'
                                                                }`}>
                                                                    {isCompleted ? '✓' : idx + 1}
                                                                </span>
                                                                <span className={`px-1.5 py-0.2 rounded text-[8px] font-black uppercase tracking-wider flex items-center gap-1 shrink-0 ${
                                                                    isClient
                                                                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                                                        : 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                                                                }`}>
                                                                    {isClient ? <ArrowRight size={8} /> : <ArrowDownRight size={8} />}
                                                                    <span>{isClient ? 'Client' : 'Server'}</span>
                                                                </span>
                                                                <span className="text-[9px] font-mono font-bold text-text-primary shrink-0">
                                                                    {len}B
                                                                </span>
                                                                {turn.delay_ms !== undefined && turn.delay_ms > 0 && (
                                                                    <span className="text-[8px] font-mono text-text-muted/70 shrink-0">
                                                                        +{turn.delay_ms}ms
                                                                    </span>
                                                                )}
                                                            </div>

                                                            <div className="flex items-center gap-1 shrink-0">
                                                                <span className={`text-[7px] px-1.5 py-0.2 rounded border font-bold uppercase ${analysis.badge}`}>
                                                                    {analysis.proto}
                                                                </span>
                                                                {isCompleted && (
                                                                    <span className="px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-black text-[7px] border border-emerald-500/30">
                                                                        DONE
                                                                    </span>
                                                                )}
                                                                {isActive && (
                                                                    <span className="px-1 py-0.2 rounded bg-indigo-500/20 text-indigo-400 font-black text-[7px] border border-indigo-500/30 animate-pulse">
                                                                        LIVE
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* Readable Payload Snippet */}
                                                        <div className="text-[9px] font-mono text-text-secondary truncate bg-black/35 px-1.5 py-0.5 rounded border border-border/40 leading-tight">
                                                            {analysis.snippet}
                                                        </div>
                                                    </div>
                                                );
                                            })}

                                            {filteredTurns.length > turnDisplayLimit && (
                                                <div className="p-2 text-center bg-card-secondary/40 border border-border/60 rounded-xl space-y-1">
                                                    <p className="text-[9px] text-text-muted">
                                                        Displaying first {turnDisplayLimit} of {filteredTurns.length} steps.
                                                    </p>
                                                    <div className="flex items-center justify-center gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => setTurnDisplayLimit(prev => prev + 250)}
                                                            className="px-2 py-0.5 rounded text-[8px] font-bold bg-purple-600/30 hover:bg-purple-600 text-purple-200 transition-colors cursor-pointer"
                                                        >
                                                            Load +250 steps
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setTurnDisplayLimit(filteredTurns.length)}
                                                            className="px-2 py-0.5 rounded text-[8px] font-bold bg-white/10 hover:bg-white/20 text-text-primary transition-colors cursor-pointer"
                                                        >
                                                            Load All ({filteredTurns.length})
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>

                                {/* Deep-Dive Wireshark Payload Inspector */}
                                {selectedTurn && (
                                    <div className="bg-card-secondary/40 border border-border rounded-xl p-2 font-mono text-xs space-y-1.5 shrink-0">
                                        <div className="flex items-center justify-between text-[8px] font-black uppercase tracking-wider text-text-muted">
                                            <div className="flex items-center gap-1.5">
                                                <span>Step #{selectedTurnIndex! + 1} Payload Inspector</span>
                                                <span className={`px-1.5 py-0.2 rounded border text-[7px] font-bold uppercase ${selectedTurnAnalysis.badge}`}>
                                                    {selectedTurnAnalysis.proto}
                                                </span>
                                                <span className="text-[8px] font-mono text-text-muted">
                                                    ({selectedTurn.length || selectedTurn.payload_len || selectedTurnBytes.length} bytes)
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-1.5">
                                                <div className="flex items-center bg-card p-0.5 rounded border border-border">
                                                    <button
                                                        onClick={() => setPayloadViewMode('hex')}
                                                        className={`px-1.5 py-0.2 rounded text-[7px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                                                            payloadViewMode === 'hex' ? 'bg-indigo-600 text-white' : 'text-text-muted hover:text-text-primary'
                                                        }`}
                                                    >
                                                        Hex Dump
                                                    </button>
                                                    <button
                                                        onClick={() => setPayloadViewMode('raw')}
                                                        className={`px-1.5 py-0.2 rounded text-[7px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                                                            payloadViewMode === 'raw' ? 'bg-indigo-600 text-white' : 'text-text-muted hover:text-text-primary'
                                                        }`}
                                                    >
                                                        Clean ASCII
                                                    </button>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const text = payloadViewMode === 'hex' ? selectedTurnHexDump : selectedTurnCleanAscii;
                                                        navigator.clipboard.writeText(text);
                                                        toast.success('Payload copied to clipboard');
                                                    }}
                                                    className="p-1 hover:bg-card rounded text-text-muted hover:text-text-primary border border-border/40 transition-colors cursor-pointer"
                                                    title="Copy payload"
                                                >
                                                    <Copy size={10} />
                                                </button>
                                            </div>
                                        </div>

                                        <div className="bg-black/60 border border-border/60 rounded-lg p-2 max-h-24 overflow-y-auto text-[9px] text-text-secondary font-mono leading-relaxed whitespace-pre font-normal scrollbar-thin scrollbar-thumb-border">
                                            {payloadViewMode === 'hex' ? selectedTurnHexDump : selectedTurnCleanAscii}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* ─── Column 3: Live Replay Console & SASE Verdict Hub (lg:col-span-5) ─── */}
                <div className="lg:col-span-5 flex flex-col gap-2.5 h-full overflow-hidden">
                    {/* Hero SASE Security Verdict Card */}
                    <div className="shrink-0">
                        <div className={`p-3 rounded-2xl border flex items-center justify-between shadow-xl transition-all ${
                            liveTelemetry.lastVerdict === 'Bypass'
                                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 shadow-emerald-500/10'
                                : liveTelemetry.lastVerdict?.includes('Reset')
                                ? 'bg-red-500/10 border-red-500/40 text-red-400 shadow-red-500/10'
                                : liveTelemetry.lastVerdict?.includes('Drop')
                                ? 'bg-orange-500/10 border-orange-500/40 text-orange-400 shadow-orange-500/10'
                                : liveTelemetry.isRunning
                                ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-300 shadow-indigo-500/10'
                                : 'bg-card border-border text-text-muted'
                        }`}>
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className={`p-2 rounded-xl shrink-0 ${
                                    liveTelemetry.lastVerdict === 'Bypass'
                                        ? 'bg-emerald-500/20 text-emerald-400'
                                        : liveTelemetry.lastVerdict?.includes('Reset')
                                        ? 'bg-red-500/20 text-red-400'
                                        : liveTelemetry.lastVerdict?.includes('Drop')
                                        ? 'bg-orange-500/20 text-orange-400'
                                        : liveTelemetry.isRunning
                                        ? 'bg-indigo-500/20 text-indigo-400'
                                        : 'bg-card-secondary text-text-muted'
                                }`}>
                                    {liveTelemetry.lastVerdict === 'Bypass' ? (
                                        <CheckCircle2 size={18} className="text-emerald-400" />
                                    ) : liveTelemetry.lastVerdict ? (
                                        <ShieldAlert size={18} className="text-red-400" />
                                    ) : liveTelemetry.isRunning ? (
                                        <Activity size={18} className="text-indigo-400 animate-pulse" />
                                    ) : (
                                        <Shield size={18} className="text-text-muted" />
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <div className="text-xs font-black uppercase tracking-wider truncate flex items-center gap-2">
                                        <span>
                                            {liveTelemetry.lastVerdict
                                                ? `SASE VERDICT: ${liveTelemetry.lastVerdict.toUpperCase()}`
                                                : liveTelemetry.isRunning
                                                ? (activeJob.role === 'server' ? 'Server Listening for Peers...' : `Replaying Steps (${liveTelemetry.progressPct}%)`)
                                                : 'SASE Policy Replay Engine Ready'}
                                        </span>
                                    </div>
                                    <p className="text-[10px] opacity-80 mt-0.5 line-clamp-1">
                                        {liveTelemetry.lastVerdict === 'Bypass'
                                            ? 'Full L7 application session completed without inspection drop or TCP RST. Palo Alto / SD-WAN policy allowed.'
                                            : liveTelemetry.lastVerdict?.includes('Reset')
                                            ? 'Session was abruptly terminated by TCP RST injection from firewall security enforcement.'
                                            : liveTelemetry.lastVerdict?.includes('Drop')
                                            ? 'Session timed out with silent packet drop. Firewall security rule prevented delivery.'
                                            : liveTelemetry.isRunning
                                            ? `Streaming bidirectional L7 steps to ${customTargetIp || 'target'}:${portOverride || 'port'} across SD-WAN`
                                            : 'Select a profile and start client replay to benchmark firewall policy enforcement.'}
                                    </p>
                                </div>
                            </div>

                            {activeJob && (
                                <div className="text-right font-mono text-[10px] font-bold shrink-0 pl-2">
                                    <div>PID {activeJob.pid}</div>
                                    <div className="text-[8px] opacity-60 uppercase">{activeJob.role} · {activeJob.status}</div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 4 Live Telemetry Tiles */}
                    <div className="grid grid-cols-4 gap-2 shrink-0">
                        {/* Steps Progress */}
                        <div className="bg-card border border-border rounded-xl p-2 flex flex-col justify-between">
                            <div className="flex items-center justify-between">
                                <span className="text-[8px] font-black uppercase tracking-wider text-text-muted">Steps Progress</span>
                                {liveTelemetry.isLooping && (
                                    <span className="px-1 py-0.2 rounded bg-indigo-500/20 text-indigo-300 text-[8px] font-bold border border-indigo-500/30 animate-pulse">
                                        Loop #{liveTelemetry.loopIteration}
                                    </span>
                                )}
                            </div>
                            <div className="mt-1 font-mono font-bold text-xs text-text-primary">
                                {liveTelemetry.completedTurns} <span className="text-[9px] font-normal text-text-muted">/ {liveTelemetry.totalTurns}</span>
                            </div>
                            <div className="w-full bg-black/40 h-1 rounded-full mt-1.5 overflow-hidden">
                                <div
                                    className={`h-full transition-all duration-300 ${
                                        liveTelemetry.lastVerdict === 'Bypass'
                                            ? 'bg-emerald-500'
                                            : liveTelemetry.lastVerdict
                                            ? 'bg-red-500'
                                            : 'bg-indigo-500'
                                    }`}
                                    style={{ width: `${liveTelemetry.progressPct}%` }}
                                />
                            </div>
                        </div>

                        {/* Data Transferred (Cumulative) */}
                        <div className="bg-card border border-border rounded-xl p-2 flex flex-col justify-between">
                            <div className="flex items-center justify-between">
                                <span className="text-[8px] font-black uppercase tracking-wider text-text-muted">Data Volume</span>
                                {liveTelemetry.isLooping && (
                                    <span className="text-[7px] font-mono text-cyan-400 font-bold tracking-tight">CUMULATIVE</span>
                                )}
                            </div>
                            <div className="mt-1 font-mono font-bold text-xs text-cyan-400">
                                {formatBytes(liveTelemetry.totalBytes || liveTelemetry.txBytes + liveTelemetry.rxBytes)}
                            </div>
                            <div className="text-[8px] font-mono text-text-muted/80 truncate">
                                {formatBytes(liveTelemetry.txBytes)} TX · {formatBytes(liveTelemetry.rxBytes)} RX
                            </div>
                        </div>

                        {/* Elapsed Duration */}
                        <div className="bg-card border border-border rounded-xl p-2 flex flex-col justify-between">
                            <span className="text-[8px] font-black uppercase tracking-wider text-text-muted">Replay Duration</span>
                            <div className="mt-1 font-mono font-bold text-xs text-text-primary">
                                {liveTelemetry.durationMs ? `${liveTelemetry.durationMs} ms` : liveTelemetry.isRunning ? 'Active...' : '—'}
                            </div>
                            <div className="text-[8px] font-mono text-text-muted/80 truncate">
                                {liveTelemetry.totalTurns > 0 && liveTelemetry.durationMs > 0
                                    ? `Avg ${(liveTelemetry.durationMs / liveTelemetry.totalTurns).toFixed(1)} ms/step`
                                    : 'Zero loss'}
                            </div>
                        </div>

                        {/* Destination Target */}
                        <div className="bg-card border border-border rounded-xl p-2 flex flex-col justify-between">
                            <span className="text-[8px] font-black uppercase tracking-wider text-text-muted">Target Host</span>
                            <div className="mt-1 font-mono font-bold text-[10px] text-purple-400 truncate">
                                {customTargetIp || '127.0.0.1'}
                            </div>
                            <div className="text-[8px] font-mono text-text-muted/80 truncate">
                                Port {portOverride || activeFlow?.server_port || 18443} · {activeFlow?.transport?.toUpperCase() || 'UDP'}
                            </div>
                        </div>
                    </div>

                    {/* Multi-Mode Live Activity & Timeline Console */}
                    <div className="bg-card border border-border rounded-2xl p-3 shadow-xl font-mono flex-1 min-h-0 flex flex-col overflow-hidden">
                        <div className="flex items-center justify-between pb-2 border-b border-border text-text-muted text-xs shrink-0">
                            <div className="flex items-center gap-1.5">
                                <Terminal size={13} className="text-emerald-400" />
                                <span className="font-black uppercase tracking-widest text-[9px]">Activity & SASE Console</span>
                                <span className="text-[9px] text-text-muted/60 font-mono">({terminalLogs.length})</span>
                            </div>

                            <div className="flex items-center gap-1.5">
                                <div className="flex items-center bg-black/40 rounded-lg p-0.5 border border-border/60">
                                    <button
                                        type="button"
                                        onClick={() => setConsoleViewMode('timeline')}
                                        className={`px-2 py-0.5 rounded text-[8px] font-bold transition-all cursor-pointer ${
                                            consoleViewMode === 'timeline'
                                                ? 'bg-primary text-black shadow-sm'
                                                : 'text-text-muted hover:text-text-primary'
                                        }`}
                                    >
                                        Timeline
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setConsoleViewMode('stream')}
                                        className={`px-2 py-0.5 rounded text-[8px] font-bold transition-all cursor-pointer ${
                                            consoleViewMode === 'stream'
                                                ? 'bg-primary text-black shadow-sm'
                                                : 'text-text-muted hover:text-text-primary'
                                        }`}
                                    >
                                        Stream Log
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setConsoleViewMode('raw')}
                                        className={`px-2 py-0.5 rounded text-[8px] font-bold transition-all cursor-pointer ${
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
                                        onClick={handleClearReplayHistory}
                                        className="px-1.5 py-0.5 rounded text-[8px] font-semibold text-text-muted hover:text-amber-400 hover:bg-amber-500/10 border border-border/40 hover:border-amber-500/30 transition-all cursor-pointer flex items-center gap-1"
                                        title="Clear console and reset replay status"
                                    >
                                        <RotateCcw size={9} />
                                        <span>Reset</span>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Console Viewport */}
                        <div className="mt-2 bg-black/50 border border-border/60 rounded-xl p-2.5 flex-1 min-h-0 overflow-y-auto space-y-1.5 text-[10px] scrollbar-thin scrollbar-thumb-border">
                            {consoleViewMode === 'timeline' ? (
                                /* 📊 Milestone Session Timeline View */
                                <div className="space-y-2.5 py-1">
                                    {/* Milestone 1: Initialization */}
                                    <div className="flex items-start gap-2.5">
                                        <div className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/40 flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5">
                                            1
                                        </div>
                                        <div className="flex-1 bg-card/40 border border-border/60 rounded-xl p-2">
                                            <div className="flex items-center justify-between">
                                                <span className="font-bold text-text-primary text-[10px]">Session Setup & Peer Binding</span>
                                                <span className="text-[8px] text-text-muted font-mono uppercase">{replayRole} mode</span>
                                            </div>
                                            <div className="text-[9px] text-text-secondary mt-1 flex flex-wrap gap-2">
                                                <span>Target: <strong className="text-purple-400 font-mono">{customTargetIp || '127.0.0.1'}:{portOverride || '10080'}</strong></span>
                                                <span>Transport: <strong className="text-text-primary">{activeFlow?.transport?.toUpperCase() || 'UDP'}</strong></span>
                                                <span>Scenario: <strong className="text-indigo-400">{profileDetails?.name || selectedProfileFile || 'Custom'}</strong></span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Milestone 2: Stateful Replay Execution */}
                                    <div className="flex items-start gap-2.5">
                                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5 ${
                                            liveTelemetry.completedTurns > 0
                                                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40'
                                                : 'bg-card border border-border text-text-muted'
                                        }`}>
                                            2
                                        </div>
                                        <div className="flex-1 bg-card/40 border border-border/60 rounded-xl p-2">
                                            <div className="flex items-center justify-between">
                                                <span className="font-bold text-text-primary text-[10px]">Bidirectional L7 Steps Exchange</span>
                                                <span className="text-[8px] font-mono text-purple-400">{liveTelemetry.progressPct}%</span>
                                            </div>
                                            <p className="text-[9px] text-text-muted mt-0.5">
                                                {liveTelemetry.isRunning
                                                    ? `Replaying packet sequence... ${liveTelemetry.completedTurns} of ${liveTelemetry.totalTurns} steps completed.`
                                                    : liveTelemetry.completedTurns > 0
                                                    ? `Completed ${liveTelemetry.completedTurns} steps (${(liveTelemetry.txBytes / 1024).toFixed(1)} KB transmitted across overlay).`
                                                    : 'Waiting for replay execution to begin.'}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Milestone 3: SASE Security Policy Verdict */}
                                    <div className="flex items-start gap-2.5">
                                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5 ${
                                            liveTelemetry.lastVerdict === 'Bypass'
                                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                                : liveTelemetry.lastVerdict
                                                ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                                                : 'bg-card border border-border text-text-muted'
                                        }`}>
                                            3
                                        </div>
                                        <div className={`flex-1 rounded-xl p-2 border ${
                                            liveTelemetry.lastVerdict === 'Bypass'
                                                ? 'bg-emerald-500/10 border-emerald-500/30'
                                                : liveTelemetry.lastVerdict
                                                ? 'bg-red-500/10 border-red-500/30'
                                                : 'bg-card/40 border-border/60'
                                        }`}>
                                            <div className="flex items-center justify-between">
                                                <span className="font-bold text-[10px]">
                                                    {liveTelemetry.lastVerdict ? `SASE Verdict: ${liveTelemetry.lastVerdict}` : 'Policy Enforcement Result'}
                                                </span>
                                                {liveTelemetry.durationMs > 0 && (
                                                    <span className="text-[8px] font-mono text-text-muted">{liveTelemetry.durationMs}ms</span>
                                                )}
                                            </div>
                                            <p className="text-[9px] mt-1 text-text-secondary">
                                                {liveTelemetry.lastVerdict === 'Bypass'
                                                    ? 'All conversation steps completed with zero packet drop and zero TCP RST resets. Security policies fully permit this application signature.'
                                                    : liveTelemetry.lastVerdict?.includes('Reset')
                                                    ? 'Traffic was terminated with TCP RST injection by firewall policy.'
                                                    : liveTelemetry.lastVerdict?.includes('Drop')
                                                    ? 'Traffic timed out waiting for server response. Silent drop policy detected.'
                                                    : 'Awaiting execution completion to render final SASE verdict.'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ) : consoleViewMode === 'stream' ? (
                                /* 📋 Stream Packet-by-Packet Real-Time Logs */
                                terminalLogs.length === 0 ? (
                                    <div className="flex items-center justify-center h-full text-text-muted/40 italic text-xs">
                                        Waiting for replay packet events...
                                    </div>
                                ) : (
                                    terminalLogs.map((log: any, idx: number) => formatLogEvent(log, idx))
                                )
                            ) : (
                                /* 💻 Raw JSON Telemetry */
                                terminalLogs.length === 0 ? (
                                    <div className="flex items-center justify-center h-full text-text-muted/40 italic text-xs">
                                        Waiting for replay events...
                                    </div>
                                ) : (
                                    terminalLogs.map((log: any, idx: number) => (
                                        <div key={idx} className="flex items-start gap-1.5 text-text-secondary leading-tight">
                                            <span className="text-text-muted/50 select-none text-[8px] font-mono">
                                                [{idx + 1}]
                                            </span>
                                            <span className={log.verdict ? 'text-emerald-400 font-bold' : log.event === 'error' || log.status === 'error' ? 'text-red-400' : 'text-text-primary'}>
                                                {typeof log === 'string' ? log : JSON.stringify(log)}
                                            </span>
                                        </div>
                                    ))
                                )
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
                                        Replay Timing Engine
                                    </label>
                                    <select
                                        value={editTiming}
                                        onChange={(e: any) => setEditTiming(e.target.value)}
                                        className="w-full bg-black/40 border border-border rounded-xl px-3 py-2 text-text-primary text-xs font-semibold focus:outline-none focus:border-primary/60 transition-colors cursor-pointer"
                                    >
                                        <option value="as_fast_as_possible" className="bg-card text-text-primary">⚡ Fastest (Zero-Delay DPI)</option>
                                        <option value="original" className="bg-card text-text-primary">⏱️ Original PCAP Delays (Real-Time)</option>
                                    </select>
                                </div>
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
                            </div>

                            <div className="grid grid-cols-2 gap-3">
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
                                <div>
                                    <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1">
                                        Timing Behavior Note
                                    </label>
                                    <div className="text-[10px] text-text-muted bg-black/20 border border-border/40 rounded-xl p-2 leading-tight">
                                        {editTiming === 'original' 
                                            ? 'Waits exact inter-packet delta_ms from PCAP between turns.'
                                            : 'Sends next step immediately upon receiving response.'}
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1">
                                    Description / Security Context
                                </label>
                                <textarea
                                    value={editDescription}
                                    onChange={(e) => setEditDescription(e.target.value)}
                                    rows={2}
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
                                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 hover:shadow-indigo-600/50 transition-all disabled:opacity-50 cursor-pointer"
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
