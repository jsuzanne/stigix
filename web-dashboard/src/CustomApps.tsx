/**
 * Stigix Custom TCP Inter-Site Applications — Operational Control Center
 */

import React, { useState, useEffect } from 'react';
import {
    Play, Square, RefreshCw, Server, Globe, Activity, Plus,
    Copy, Trash2, Edit3, Shield, AlertTriangle, CheckCircle2,
    Clock, Cpu, ArrowDownRight, ArrowUpRight, Zap, ExternalLink,
    Layers, Cloud, Search, X, Info
} from 'lucide-react';
import toast from 'react-hot-toast';
import type {
    CustomTcpApplicationConfig,
    AppRuntimeMetrics,
    IncomingSessionState,
    OutgoingSessionState
} from '../custom-tcp-apps/types.js';
import { CustomAppWizardModal } from './components/custom-tcp/CustomAppWizardModal';
import { PrismaAppSyncModal } from './components/custom-tcp/PrismaAppSyncModal';
import { MicroSparkline } from './components/custom-tcp/MicroSparkline';
import { SessionDeepDiveDrawer } from './components/custom-tcp/SessionDeepDiveDrawer';

interface CustomAppsProps {
    token: string | null;
}

export const CustomApps: React.FC<CustomAppsProps> = ({ token }) => {
    const [applications, setApplications] = useState<CustomTcpApplicationConfig[]>([]);
    const [allAppSummaries, setAllAppSummaries] = useState<Record<string, any>>({});
    const [instanceInfo, setInstanceInfo] = useState<{ instanceId: string; siteName: string; hostname: string } | null>(null);
    const [selectedAppId, setSelectedAppId] = useState<string>('');
    const [metrics, setMetrics] = useState<AppRuntimeMetrics | null>(null);
    const [incomingSessions, setIncomingSessions] = useState<IncomingSessionState[]>([]);
    const [outgoingSessions, setOutgoingSessions] = useState<OutgoingSessionState[]>([]);
    const [sessionSearch, setSessionSearch] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [isActionLoading, setIsActionLoading] = useState(false);

    // Deep Dive Drawer Session
    const [deepDiveSession, setDeepDiveSession] = useState<(IncomingSessionState & { isIncoming?: boolean }) | (OutgoingSessionState & { isIncoming?: boolean }) | null>(null);

    // Modals
    const [isWizardOpen, setIsWizardOpen] = useState(false);
    const [isPrismaModalOpen, setIsPrismaModalOpen] = useState(false);
    const [editingApp, setEditingApp] = useState<CustomTcpApplicationConfig | null>(null);
    const [peerTestModal, setPeerTestModal] = useState<{ isOpen: boolean; peerId: string; peerName: string; host: string; port: number } | null>(null);
    const [peerTestResult, setPeerTestResult] = useState<{ loading: boolean; success?: boolean; rttMs?: number; error?: string } | null>(null);

    // Auto-refresh interval (1.5s)
    useEffect(() => {
        loadConfig();
    }, [token]);

    useEffect(() => {
        if (!selectedAppId || !token) return;
        loadAppStatus(selectedAppId);
        const timer = setInterval(() => {
            loadAppStatus(selectedAppId);
        }, 1500);
        return () => clearInterval(timer);
    }, [selectedAppId, token]);

    const loadConfig = async () => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/custom-tcp-apps', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setApplications(data.applications || []);
                setInstanceInfo(data.instance || null);
                if (data.applications?.length > 0 && !selectedAppId) {
                    setSelectedAppId(data.applications[0].id);
                }
                loadAllSummaries();
            }
        } catch (err: any) {
            console.error('Failed to load Custom TCP Apps config:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const loadAllSummaries = async () => {
        try {
            const res = await fetch('/api/custom-tcp-apps/summary/all', { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                const data = await res.json();
                const map: Record<string, any> = {};
                const list = data.statuses || data.applications || [];
                list.forEach((app: any) => {
                    const key = app.appId || app.id;
                    if (key) map[key] = app;
                });
                setAllAppSummaries(map);
            }
        } catch {}
    };

    const loadAppStatus = async (appId: string) => {
        try {
            const [statusRes, inRes, outRes] = await Promise.all([
                fetch(`/api/custom-tcp-apps/${appId}/status`, { headers: { 'Authorization': `Bearer ${token}` } }),
                fetch(`/api/custom-tcp-apps/${appId}/sessions/incoming`, { headers: { 'Authorization': `Bearer ${token}` } }),
                fetch(`/api/custom-tcp-apps/${appId}/sessions/outgoing`, { headers: { 'Authorization': `Bearer ${token}` } })
            ]);

            if (statusRes.ok) {
                const statusData = await statusRes.json();
                setMetrics(statusData);
            }
            if (inRes.ok) {
                const inData = await inRes.json();
                const incList: IncomingSessionState[] = inData.sessions || [];
                setIncomingSessions(incList);
                setDeepDiveSession(curr => {
                    if (curr && ('declaredSiteName' in curr || curr.isIncoming)) {
                        const found = incList.find(s => s.sessionId === curr.sessionId);
                        return found ? { ...found, isIncoming: true } : curr;
                    }
                    return curr;
                });
            }
            if (outRes.ok) {
                const outData = await outRes.json();
                const outList: OutgoingSessionState[] = outData.sessions || [];
                setOutgoingSessions(outList);
                setDeepDiveSession(curr => {
                    if (curr && (!('declaredSiteName' in curr) && !curr.isIncoming)) {
                        const found = outList.find(s => s.sessionId === curr.sessionId);
                        return found ? { ...found, isIncoming: false } : curr;
                    }
                    return curr;
                });
            }
            loadAllSummaries();
        } catch (err) {
            // Background refresh error ignored
        }
    };

    const calculateHealthScore = () => {
        if (!currentApp) return { score: 100, label: 'HEALTHY', color: 'emerald', reason: 'Ready' };
        let score = 0;
        const isListening = metrics?.listenerState === 'listening';
        const hasPeers = (currentApp.peers || []).length > 0;
        const isClientRunning = metrics?.clientWorkloadRunning;

        // 1. Listener Availability (25 pts)
        if (isListening) score += 25;

        // 2. Client Connectivity (35 pts)
        if (!hasPeers) {
            if (isListening) score += 35;
        } else if (isClientRunning) {
            const totalSessions = outgoingSessions.length || (currentApp.peers.length * (currentApp.clientDefaults?.connectionsPerPeer || 1));
            const connectedSessions = outgoingSessions.filter(s => s.state === 'connected').length;
            if (totalSessions > 0) {
                score += Math.round((connectedSessions / totalSessions) * 35);
            }
        } else {
            score += 15;
        }

        // 3. Request/Reply Success Rate (25 pts)
        const totalReqs = (metrics?.totalRequests || 0);
        const timeouts = (metrics?.totalTimeouts || 0);
        const errors = (metrics?.totalErrors || 0);
        const drops = (metrics?.totalSimulatedDrops || 0);
        if (totalReqs > 0) {
            const badRatio = (timeouts + errors + drops) / totalReqs;
            score += Math.max(0, Math.round((1 - badRatio) * 25));
        } else {
            score += 25;
        }

        // 4. Latency SLA (15 pts)
        const avgRtt = metrics?.avgRttMs || 0;
        if (avgRtt > 0 && avgRtt < 50) score += 15;
        else if (avgRtt >= 50 && avgRtt < 150) score += 10;
        else if (avgRtt >= 150 && avgRtt < 300) score += 5;
        else if (avgRtt === 0) score += 10;

        // Status classification
        let label = 'OPTIMAL';
        let color = 'emerald';
        let reason = 'Listener active & traffic nominal';

        if (hasPeers && isClientRunning && outgoingSessions.length > 0 && outgoingSessions.every(s => s.state !== 'connected')) {
            score = Math.min(score, 25);
            label = 'CRITICAL';
            color = 'rose';
            reason = 'All outbound peers unreachable (Reconnecting)';
        } else if (!isListening) {
            score = Math.min(score, 45);
            label = 'LISTENER DOWN';
            color = 'amber';
            reason = 'TCP port not listening';
        } else if (score >= 90) {
            label = 'OPTIMAL';
            color = 'emerald';
            reason = 'Listener active & all peers connected';
        } else if (score >= 75) {
            label = 'HEALTHY';
            color = 'emerald';
            reason = 'Good performance';
        } else if (score >= 50) {
            label = 'DEGRADED';
            color = 'amber';
            reason = 'Partial reconnects or high latency';
        } else {
            label = 'CRITICAL';
            color = 'rose';
            reason = 'Service degraded or peer errors';
        }

        return { score, label, color, reason };
    };

    const handleToggleListener = async () => {
        if (!selectedAppId || isActionLoading) return;
        setIsActionLoading(true);
        const isListening = metrics?.listenerState === 'listening';
        const action = isListening ? 'stop' : 'start';

        try {
            const res = await fetch(`/api/custom-tcp-apps/${selectedAppId}/listener/${action}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok) {
                toast.success(isListening ? 'Listener stopped' : 'Listener started on host port');
                loadAppStatus(selectedAppId);
            } else {
                toast.error(data.error || `Failed to ${action} listener`);
            }
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setIsActionLoading(false);
        }
    };

    const handleToggleClient = async () => {
        if (!selectedAppId || isActionLoading) return;
        const isRunning = metrics?.clientWorkloadRunning;

        if (!isRunning && (!currentApp?.peers || currentApp.peers.length === 0)) {
            toast.error('No target peers configured for this application. Please click "Edit Profile" or "Add Target Peer" to configure remote endpoints.', {
                icon: '⚠️',
                duration: 4500
            });
            return;
        }

        setIsActionLoading(true);
        const action = isRunning ? 'stop' : 'start';

        try {
            const res = await fetch(`/api/custom-tcp-apps/${selectedAppId}/client/${action}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok) {
                toast.success(isRunning ? 'Client traffic stopped' : 'Client traffic started towards peers');
                loadAppStatus(selectedAppId);
            } else {
                toast.error(data.error || `Failed to ${action} client`);
            }
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setIsActionLoading(false);
        }
    };

    const handleSaveApp = async (app: CustomTcpApplicationConfig) => {
        const isEdit = !!editingApp;
        const method = isEdit ? 'PUT' : 'POST';
        const url = isEdit ? `/api/custom-tcp-apps/${app.id}` : '/api/custom-tcp-apps';

        const res = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(app)
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to save application');
        }

        toast.success(isEdit ? 'Application profile updated' : 'Application created');
        await loadConfig();
        if (!isEdit) setSelectedAppId(app.id);
    };

    const handleTestPeer = async (peerId: string) => {
        if (!selectedAppId) return;
        setPeerTestResult({ loading: true });
        try {
            const res = await fetch(`/api/custom-tcp-apps/${selectedAppId}/peers/${peerId}/test`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setPeerTestResult({ loading: false, success: true, rttMs: data.rttMs });
            } else {
                setPeerTestResult({ loading: false, success: false, error: data.error || 'Handshake failed' });
            }
        } catch (e: any) {
            setPeerTestResult({ loading: false, success: false, error: e.message });
        }
    };

    const currentApp = applications.find(a => a.id === selectedAppId);

    const formatBytes = (bytes: number) => {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const formatBitrate = (bps?: number) => {
        if (!bps || bps <= 0) return '0 bps';
        if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
        if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} Kbps`;
        return `${bps} bps`;
    };

    const formatUptime = (seconds?: number) => {
        if (!seconds || seconds <= 0) return '< 1m';
        const mins = Math.floor(seconds / 60);
const secs = seconds % 60;
        if (mins < 60) return `${mins}m ${secs}s`;
        const hours = Math.floor(mins / 60);
        const remMins = mins % 60;
        return `${hours}h ${remMins}m`;
    };

    const filteredIncomingSessions = incomingSessions.filter(s => {
        if (!sessionSearch.trim()) return true;
        const q = sessionSearch.toLowerCase().trim();
        const originName = (s.declaredSiteName && s.declaredSiteName !== 'Handshaking...') ? s.declaredSiteName : (s.declaredHostname || 'external client');
        return (
            originName.toLowerCase().includes(q) ||
            (s.declaredSiteName && s.declaredSiteName.toLowerCase().includes(q)) ||
            (s.declaredHostname && s.declaredHostname.toLowerCase().includes(q)) ||
            (s.remoteIp && s.remoteIp.toLowerCase().includes(q)) ||
            String(s.remotePort).includes(q) ||
            (s.matchedPeerName && s.matchedPeerName.toLowerCase().includes(q)) ||
            (s.state && s.state.toLowerCase().includes(q)) ||
            (s.sessionId && s.sessionId.toLowerCase().includes(q))
        );
    });

    const filteredOutgoingSessions = outgoingSessions.filter(s => {
        if (!sessionSearch.trim()) return true;
        const q = sessionSearch.toLowerCase().trim();
        return (
            (s.peerName && s.peerName.toLowerCase().includes(q)) ||
            (s.peerHost && s.peerHost.toLowerCase().includes(q)) ||
            String(s.peerPort).includes(q) ||
            (s.state && s.state.toLowerCase().includes(q)) ||
            (s.sessionId && s.sessionId.toLowerCase().includes(q))
        );
    });

    return (
        <div className="p-6 max-w-[1700px] w-full mx-auto space-y-6 text-text-primary animate-fadeIn">
            {/* Top Node Identity Bar */}
            <div className="bg-card border border-border rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4 shadow-sm">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-600 dark:text-indigo-400">
                        <Activity size={24} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-xl font-bold text-text-primary tracking-wide">
                                Custom TCP Applications
                            </h1>
                            <span className="px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 rounded text-[10px] font-bold uppercase tracking-wider">
                                East-West SD-WAN Simulator
                            </span>
                        </div>
                        <p className="text-xs text-text-muted mt-0.5">
                            Simulate stateful multi-site application traffic across overlay tunnels with live RTT, failover observation, and chaos injection.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {instanceInfo && (
                        <div className="flex items-center gap-2 bg-card-secondary border border-border px-3.5 py-1.5 rounded-xl text-xs shadow-sm">
                            <span className="text-text-muted font-medium">Local Site:</span>
                            <span className="font-bold text-text-primary font-mono">{instanceInfo.siteName}</span>
                            {instanceInfo.instanceId && (
                                <>
                                    <span className="text-text-muted">•</span>
                                    <span className="text-text-muted font-mono text-[11px]" title={instanceInfo.instanceId}>
                                        UUID: {instanceInfo.instanceId.substring(0, 8)}...
                                    </span>
                                </>
                            )}
                        </div>
                    )}

                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-card-secondary border border-border rounded-xl text-xs font-mono text-text-secondary shadow-sm">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>Live Telemetry: 1.5s</span>
                    </div>

                    <button
                        onClick={() => loadAppStatus(selectedAppId)}
                        className="p-2 bg-card-secondary hover:bg-card-hover border border-border rounded-xl text-text-muted hover:text-text-primary transition-colors cursor-pointer shadow-sm"
                        title="Refresh Telemetry Now"
                    >
                        <RefreshCw size={14} className={isActionLoading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Application Switcher Tab Bar (All Applications with Live Traffic Badges) */}
            <div className="bg-card border border-border rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs shadow-sm">
                <div className="flex items-center gap-2 text-text-primary font-semibold">
                    <Layers size={16} className="text-indigo-500" />
                    <span className="text-xs font-bold uppercase tracking-wider text-text-muted">Applications ({applications.length}):</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap flex-1 justify-start">
                    {applications.map(app => {
                        const isSel = app.id === selectedAppId;
                        const sum = allAppSummaries[app.id];
                        const inSess = (app.id === selectedAppId ? incomingSessions.length : 0) || sum?.activeIncomingSessions || 0;
                        const outSess = (app.id === selectedAppId ? outgoingSessions.filter(s => s.state === 'connected').length : 0) || sum?.activeOutgoingSessions || 0;
                        const totalSess = inSess + outSess;
                        const isL = (app.id === selectedAppId ? metrics?.listenerState : sum?.listenerState) === 'listening';
                        const isC = (app.id === selectedAppId ? metrics?.clientWorkloadRunning : sum?.clientWorkloadRunning);
                        const hasRxTraffic = inSess > 0;
                        const hasTxTraffic = outSess > 0;

                        return (
                            <button
                                key={app.id}
                                onClick={() => setSelectedAppId(app.id)}
                                className={`px-3.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                                    isSel
                                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                                        : 'bg-card-secondary hover:bg-card-hover border-border text-text-secondary hover:text-text-primary'
                                }`}
                            >
                                <span className={`w-2 h-2 rounded-full ${isL ? 'bg-emerald-400' : 'bg-text-muted'}`} />
                                <span>{app.name}</span>
                                <span className={`text-[10px] font-mono ${isSel ? 'text-indigo-200' : 'text-amber-500'}`}>
                                    Port {app.listener?.port}
                                </span>

                                {/* Traffic flow badges */}
                                {hasRxTraffic && hasTxTraffic ? (
                                    <span
                                        className={`text-[9px] px-1.5 py-0.5 rounded-md font-mono font-bold flex items-center gap-1 ${
                                            isSel ? 'bg-white/20 text-white' : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                                        }`}
                                        title={`Active RX & TX: ${inSess} incoming session(s), ${outSess} outgoing session(s)`}
                                    >
                                        <Activity size={10} className="animate-pulse" />
                                        RX+TX on {totalSess > 0 ? `(${totalSess})` : ''}
                                    </span>
                                ) : hasRxTraffic ? (
                                    <span
                                        className={`text-[9px] px-1.5 py-0.5 rounded-md font-mono font-bold flex items-center gap-1 ${
                                            isSel ? 'bg-white/20 text-white' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                        }`}
                                        title={`Receiving Server Traffic: ${inSess} active incoming session(s)`}
                                    >
                                        <ArrowDownRight size={10} className="animate-pulse" />
                                        RX on {inSess > 0 ? `(${inSess})` : ''}
                                    </span>
                                ) : hasTxTraffic || isC ? (
                                    <span
                                        className={`text-[9px] px-1.5 py-0.5 rounded-md font-mono font-bold flex items-center gap-1 ${
                                            isSel ? 'bg-white/20 text-white' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                        }`}
                                        title={`Transmitting Client Traffic: ${outSess} active outgoing session(s)`}
                                    >
                                        <ArrowUpRight size={10} className={outSess > 0 ? "animate-pulse" : ""} />
                                        TX on {outSess > 0 ? `(${outSess})` : ''}
                                    </span>
                                ) : null}
                            </button>
                        );
                    })}
                </div>
                <button
                    onClick={() => {
                        setEditingApp(null);
                        setIsWizardOpen(true);
                    }}
                    className="h-[32px] px-3 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer shrink-0"
                >
                    <Plus size={14} /> New App
                </button>
            </div>

            {/* Application Toolbar & Primary Controls */}
            <div className="bg-card border border-border rounded-2xl p-4 lg:p-5 shadow-sm space-y-3.5">
                {/* Row 1: Selected App Overview & Primary Actions */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5">
                    {/* Left: Active App Identity */}
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-600 dark:text-indigo-400">
                            <Server size={20} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-base font-bold text-text-primary">{currentApp?.name}</h2>
                                <span className="font-mono text-xs text-indigo-500 font-bold bg-indigo-500/10 border border-indigo-500/30 px-2 py-0.5 rounded-lg">
                                    Port {currentApp?.listener?.port}
                                </span>
                            </div>
                            <p className="text-[11px] text-text-muted mt-0.5">
                                {currentApp?.peers?.length || 0} Target Peer(s) • Mode: <span className="capitalize">{currentApp?.clientDefaults?.mode?.replace(/_/g, ' ')}</span>
                            </p>
                        </div>
                    </div>

                    {/* Right: Primary Control & Config Buttons */}
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            onClick={handleToggleListener}
                            disabled={isActionLoading}
                            className={`h-[38px] px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shadow-sm cursor-pointer ${
                                metrics?.listenerState === 'listening'
                                    ? 'bg-card-secondary hover:bg-card-hover text-amber-600 dark:text-amber-400 border border-amber-500/30'
                                    : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                            }`}
                        >
                            <Server size={14} />
                            {metrics?.listenerState === 'listening' ? 'Stop Listener' : 'Start Listener'}
                        </button>

                        <button
                            onClick={handleToggleClient}
                            disabled={isActionLoading}
                            title={!currentApp?.peers?.length ? 'No target peers configured — click to configure peers' : metrics?.clientWorkloadRunning ? 'Stop outgoing traffic generation' : 'Start outgoing traffic generation to configured targets'}
                            className={`h-[38px] px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shadow-sm cursor-pointer ${
                                metrics?.clientWorkloadRunning
                                    ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/40'
                                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
                            }`}
                        >
                            {metrics?.clientWorkloadRunning ? <Square size={14} /> : <Play size={14} />}
                            {metrics?.clientWorkloadRunning ? 'Stop Client' : 'Start Client'}
                        </button>

                        <div className="h-5 w-px bg-border mx-1 hidden sm:block" />

                        <button
                            onClick={() => {
                                setEditingApp(currentApp || null);
                                setIsWizardOpen(true);
                            }}
                            className="h-[38px] px-3 py-2 bg-card-secondary hover:bg-card-hover text-text-primary border border-border rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
                        >
                            <Edit3 size={14} /> Edit Profile
                        </button>

                        <button
                            onClick={() => setIsPrismaModalOpen(true)}
                            className="h-[38px] px-3.5 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
                            title="Push and register this custom application definition to Prisma SD-WAN via Cloud Controller API"
                        >
                            <Cloud size={14} />
                            <span>Push to Prisma SD-WAN</span>
                        </button>
                    </div>
                </div>

                {/* Row 2: Live Status Badges & Quick Context Details */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border/70 text-xs">
                    {/* Live Status Badges */}
                    <div className="flex flex-wrap items-center gap-2">
                        {metrics && (() => {
                            const health = calculateHealthScore();
                            return (
                                <>
                                    <div
                                        title={health.reason}
                                        className={`h-8 px-3 rounded-lg text-xs font-black border flex items-center gap-1.5 cursor-help transition-all shadow-sm ${
                                            health.color === 'emerald'
                                                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                                                : health.color === 'amber'
                                                ? 'bg-amber-500/10 border-amber-500/40 text-amber-600 dark:text-amber-400'
                                                : 'bg-rose-500/15 border-rose-500/50 text-rose-600 dark:text-rose-400 animate-pulse'
                                        }`}
                                    >
                                        <div className="flex items-center gap-1 font-mono">
                                            <span className="text-[12px]">{health.score}</span>
                                            <span className="text-[9px] opacity-70">/100</span>
                                        </div>
                                        <span className="text-[10px] uppercase tracking-wider font-extrabold">{health.label}</span>
                                    </div>

                                    <span className="h-8 text-xs text-text-muted bg-card-secondary border border-border px-3 rounded-lg flex items-center gap-1.5 shadow-sm">
                                        <Server size={12} className={metrics.listenerState === 'listening' ? 'text-emerald-500' : 'text-text-muted'} />
                                        <span>Listener:</span>
                                        <strong className={`uppercase font-bold ${metrics.listenerState === 'listening' ? 'text-emerald-600 dark:text-emerald-400' : 'text-text-muted'}`}>
                                            {metrics.listenerState}
                                        </strong>
                                    </span>

                                    {incomingSessions.length > 0 && (
                                        <span className="h-8 text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/30 px-3 rounded-lg flex items-center gap-1.5 shadow-sm font-bold" title={`${incomingSessions.length} active incoming session(s) currently connected and receiving traffic`}>
                                            <ArrowDownRight size={12} className="animate-pulse" />
                                            <span>{incomingSessions.length} Incoming Connected</span>
                                        </span>
                                    )}

                                    {metrics.clientWorkloadRunning && (
                                        <span className="h-8 text-xs text-indigo-400 bg-indigo-500/10 border border-indigo-500/30 px-3 rounded-lg flex items-center gap-1.5 shadow-sm font-bold" title={`${outgoingSessions.filter(s => s.state === 'connected').length} active outgoing session(s) transmitting traffic`}>
                                            <ArrowUpRight size={12} className="animate-pulse" />
                                            <span>{outgoingSessions.filter(s => s.state === 'connected').length} Outgoing Connected</span>
                                        </span>
                                    )}

                                    {currentApp?.startup?.startClientWorkload && (
                                        <span className="h-8 text-xs text-amber-500 bg-amber-500/10 border border-amber-500/30 px-3 rounded-lg flex items-center gap-1.5 shadow-sm font-bold" title="Zero-Touch Auto-Start enabled: client workload starts automatically on sync and boot">
                                            <Zap size={12} className="fill-amber-500" />
                                            <span>ZTP Auto-Start</span>
                                        </span>
                                    )}
                                </>
                            );
                        })()}
                    </div>

                    {/* Quick Metadata Info */}
                    <div className="flex items-center gap-3 text-text-muted text-[11px] font-mono">
                        <span className="bg-card-secondary px-2 py-0.5 rounded border border-border font-semibold text-text-primary">
                            TCP Port {currentApp?.listener?.port}
                        </span>
                        <span>•</span>
                        <span>{currentApp?.peers?.length || 0} Target Peer(s)</span>
                        <span>•</span>
                        <span className="capitalize">{currentApp?.clientDefaults?.mode?.replace(/_/g, ' ')}</span>
                    </div>
                </div>
            </div>

            {/* Metrics Overview Cards */}
            {(() => {
                const serverRx = incomingSessions.reduce((acc, s) => acc + (s.bytesReceived || 0), 0) || (metrics?.serverRxBytes ?? 0);
                const serverTx = incomingSessions.reduce((acc, s) => acc + (s.bytesSent || 0), 0) || (metrics?.serverTxBytes ?? 0);
                const liveServerRxBps = incomingSessions.reduce((acc, s) => acc + (s.rxBps || 0), 0) || (metrics?.liveRxBps ?? 0);
                const liveServerTps = Number((incomingSessions.reduce((acc, s) => acc + (s.tps || 0), 0) || (metrics?.liveTps ?? 0)).toFixed(1));

                const clientTx = outgoingSessions.reduce((acc, s) => acc + (s.bytesSent || 0), 0) || (metrics?.clientTxBytes ?? 0);
                const clientRx = outgoingSessions.reduce((acc, s) => acc + (s.bytesReceived || 0), 0) || (metrics?.clientRxBytes ?? 0);
                const liveClientTxBps = outgoingSessions.reduce((acc, s) => acc + (s.txBps || 0), 0) || (metrics?.liveTxBps ?? 0);
                const liveClientTps = Number((outgoingSessions.reduce((acc, s) => acc + (s.tps || 0), 0) || (metrics?.liveTps ?? 0)).toFixed(1));

                const avgJitter = metrics?.jitterMs ?? (outgoingSessions.length > 0
                    ? Number((outgoingSessions.reduce((acc, s) => acc + (s.rttMs?.jitterMs || 0), 0) / outgoingSessions.length).toFixed(1))
                    : 0);

                return (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {/* 1. Incoming Sessions Card */}
                        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
                            <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
                                    <ArrowDownRight size={16} /> Incoming Sessions
                                </span>
                                <span className="font-mono text-[11px] text-text-muted">Port {currentApp?.listener?.port}</span>
                            </div>
                            <div className="mt-3 flex items-baseline justify-between">
                                <div className="text-3xl font-black text-text-primary">{incomingSessions.length} <span className="text-xs font-normal text-text-muted">active</span></div>
                                <div className="text-right text-[11px] font-mono space-y-0.5">
                                    <div className="text-text-muted">RX: <span className="text-emerald-500 font-bold">{formatBytes(serverRx)}</span></div>
                                    <div className="text-text-muted">TX: <span className="text-indigo-400 font-bold">{formatBytes(serverTx)}</span></div>
                                    {liveServerRxBps > 0 && (
                                        <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold tracking-tight">
                                            ⚡ {formatBitrate(liveServerRxBps)}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="mt-2 text-[11px] text-text-muted flex justify-between pt-2.5 border-t border-border">
                                <span>Mode: <strong className="text-text-secondary capitalize">{currentApp?.serverBehavior?.mode.replace('_', ' ')}</strong></span>
                                <span>Handled: <strong className="text-text-secondary">{metrics?.totalRequests || 0}</strong> {liveServerTps > 0 && <span className="text-indigo-500 font-mono text-[10px]">({liveServerTps} tps)</span>}</span>
                            </div>
                        </div>

                        {/* 2. Outgoing Sessions Card */}
                        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
                            <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                                    <ArrowUpRight size={16} /> Outgoing Sessions
                                </span>
                                <span className="font-mono text-[11px] text-text-muted">{currentApp?.peers?.length || 0} peers</span>
                            </div>
                            <div className="mt-3 flex items-baseline justify-between">
                                <div className="text-3xl font-black text-text-primary">{outgoingSessions.filter(s => s.state === 'connected').length} <span className="text-xs font-normal text-text-muted">active</span></div>
                                <div className="text-right text-[11px] font-mono space-y-0.5">
                                    <div className="text-text-muted">TX: <span className="text-indigo-400 font-bold">{formatBytes(clientTx)}</span></div>
                                    <div className="text-text-muted">RX: <span className="text-emerald-500 font-bold">{formatBytes(clientRx)}</span></div>
                                    {liveClientTxBps > 0 && (
                                        <div className="text-[10px] text-indigo-500 font-bold tracking-tight">
                                            ⚡ {formatBitrate(liveClientTxBps)}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="mt-2 text-[11px] text-text-muted flex items-center justify-between pt-2.5 border-t border-border">
                                <span className="truncate max-w-[55%]">
                                    Mode: <strong className="text-text-secondary font-medium">
                                        {currentApp?.clientDefaults?.mode?.replace(/_/g, ' ')}
                                    </strong>
                                </span>
                                <span className="whitespace-nowrap">
                                    Replies: <strong className="text-text-secondary">{metrics?.totalResponses || 0}</strong>{' '}
                                    {liveClientTps > 0 && <span className="text-emerald-500 font-mono text-[10px] font-bold">({liveClientTps} tps)</span>}
                                </span>
                            </div>
                        </div>

                        {/* 3. Latency & Jitter Card */}
                        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
                            <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold flex items-center gap-1.5 text-amber-500">
                                    <Zap size={16} /> App Latency (RTT)
                                </span>
                                <span className="font-mono text-[11px] text-text-muted">Rolling Window</span>
                            </div>
                            <div className="mt-3 flex items-baseline justify-between">
                                <div className="text-3xl font-black text-amber-500 font-mono">
                                    {metrics?.avgRttMs || 0} <span className="text-xs font-normal text-text-muted">ms avg</span>
                                </div>
                                <div className="text-right text-[11px] font-mono space-y-0.5">
                                    <div className="text-text-muted">
                                        p50: <span className="text-text-primary font-bold">{metrics?.p50RttMs || 0} ms</span> | p95: <span className="text-amber-500 font-bold">{metrics?.p95RttMs || 0} ms</span>
                                    </div>
                                    <div className="text-cyan-500 font-bold text-[10px]">
                                        Jitter: ± {avgJitter} ms
                                    </div>
                                </div>
                            </div>
                            <div className="mt-2 text-[11px] text-text-muted flex justify-between pt-2.5 border-t border-border">
                                <span>Timeouts: <strong className={metrics?.totalTimeouts ? 'text-rose-500 font-bold' : 'text-text-secondary'}>{metrics?.totalTimeouts || 0}</strong></span>
                                <span>Errors: <strong className={metrics?.totalErrors ? 'text-rose-500 font-bold' : 'text-text-secondary'}>{metrics?.totalErrors || 0}</strong></span>
                            </div>
                        </div>

                        {/* 4. Chaos & Stability Card */}
                        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
                            <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold flex items-center gap-1.5 text-cyan-500">
                                    <Activity size={16} /> Stability & Chaos
                                </span>
                                <span className="font-mono text-[11px] text-text-muted">Failover</span>
                            </div>
                            <div className="mt-3 flex items-baseline justify-between">
                                <div className="text-3xl font-black text-text-primary font-mono">
                                    {metrics?.totalReconnects || 0} <span className="text-xs font-normal text-text-muted">reconnects</span>
                                </div>
                                <div className="text-right text-[11px] font-mono space-y-0.5">
                                    <div className="text-text-muted">Drops: <span className={metrics?.totalSimulatedDrops ? 'text-rose-500 font-bold' : 'text-text-primary font-bold'}>{metrics?.totalSimulatedDrops || 0}</span></div>
                                </div>
                            </div>
                            <div className="mt-2 text-[11px] text-text-muted flex justify-between pt-2.5 border-t border-border">
                                <span>TCP Keepalive: <strong className="text-text-secondary">Enabled</strong></span>
                                <span>Backoff: <strong className="text-text-secondary">Jittered</strong></span>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* REAL-TIME SESSION SEARCH & FILTER BAR */}
            <div className="bg-card border border-border rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-sm">
                <div className="relative flex-1 min-w-[280px]">
                    <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                    <input
                        type="text"
                        value={sessionSearch}
                        onChange={e => setSessionSearch(e.target.value)}
                        placeholder="Filter sessions in real-time by origin, site, peer, IP, port, or state (e.g. DC1, BR5, connected, 8443)..."
                        className="w-full pl-9 pr-8 py-2 bg-card-secondary/70 border border-border focus:border-indigo-500 rounded-xl text-xs text-text-primary placeholder:text-text-muted outline-none transition-all font-sans"
                    />
                    {sessionSearch && (
                        <button
                            onClick={() => setSessionSearch('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary rounded-md"
                            title="Clear filter"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>

            {/* LIVE TABLES SECTION */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 📥 INCOMING SESSIONS TABLE */}
                <div className="bg-card border border-border rounded-2xl p-5 shadow-sm flex flex-col">
                    <div className="flex items-center justify-between pb-4 border-b border-border">
                        <div className="flex items-center gap-2.5">
                            <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-indigo-600 dark:text-indigo-400">
                                <ArrowDownRight size={18} />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-text-primary">Incoming Sessions</h3>
                                <p className="text-[11px] text-text-muted">Remote nodes connecting to local port {currentApp?.listener?.port}</p>
                            </div>
                        </div>
                        <span className="text-xs bg-card-secondary border border-border px-3 py-1 rounded-xl text-indigo-600 dark:text-indigo-400 font-bold shadow-sm">
                            {sessionSearch ? `${filteredIncomingSessions.length} / ${incomingSessions.length}` : `${incomingSessions.length}`} Connected
                        </span>
                    </div>

                    <div className="overflow-x-auto mt-4 flex-1">
                        {incomingSessions.length === 0 ? (
                            <div className="py-14 text-center text-xs text-text-muted italic">
                                No incoming sessions currently connected to this listener.
                            </div>
                        ) : filteredIncomingSessions.length === 0 ? (
                            <div className="py-14 text-center text-xs text-text-muted italic">
                                No incoming sessions match "{sessionSearch}".
                            </div>
                        ) : (
                            <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                    <tr className="border-b border-border text-text-muted font-semibold text-[11px]">
                                        <th className="pb-3 px-3 whitespace-nowrap">Declared Origin</th>
                                        <th className="pb-3 px-3 whitespace-nowrap">Source IP</th>
                                        <th className="pb-3 px-3 whitespace-nowrap">State & Uptime</th>
                                        <th className="pb-3 px-4 text-right whitespace-nowrap">RX / TX</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/60">
                                    {filteredIncomingSessions.map(s => {
                                        const isStigixPeer = Boolean((s.declaredSiteName && s.declaredSiteName !== 'Handshaking...') || s.declaredHostname || s.matchedPeerName);
                                        const originLabel = isStigixPeer
                                            ? ((s.declaredSiteName && s.declaredSiteName !== 'Handshaking...' ? s.declaredSiteName : (s.declaredHostname || s.matchedPeerName)) || s.sessionId)
                                            : (s.state === 'handshaking' ? 'Handshaking...' : 'External Client');

                                        return (
                                            <tr
                                                key={s.sessionId}
                                                onClick={() => setDeepDiveSession({ ...s, isIncoming: true })}
                                                className="hover:bg-card-secondary/70 cursor-pointer transition-colors group"
                                                title="Click to open full Session Deep Dive"
                                            >
                                                <td className="py-3 px-3 font-semibold text-text-primary whitespace-nowrap">
                                                    {isStigixPeer ? (
                                                        <span className="group-hover:text-indigo-500 transition-colors" title={`Hostname: ${s.declaredHostname || 'n/a'} | ID: ${s.sessionId}`}>
                                                            {originLabel}
                                                        </span>
                                                    ) : (
                                                        <span className="text-text-muted italic font-normal" title={`External TCP client connection | ID: ${s.sessionId}`}>
                                                            {originLabel}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="py-3 px-3 font-mono text-text-secondary text-[11px] whitespace-nowrap">
                                                    {s.remoteIp}:{s.remotePort}
                                                </td>
                                                <td className="py-3 px-3 whitespace-nowrap">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                                            s.state === 'connected' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' :
                                                            s.state === 'delayed' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30' : 'bg-card-secondary text-text-muted border border-border'
                                                        }`}>
                                                            {s.state}
                                                        </span>
                                                        {(s.uptimeSec ?? 0) > 0 && (
                                                            <span className="text-[10px] text-text-muted font-mono whitespace-nowrap">
                                                                {formatUptime(s.uptimeSec)}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="py-3 px-4 text-right font-mono text-[11px] whitespace-nowrap">
                                                    <div>
                                                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">{formatBytes(s.bytesReceived)}</span> / <span className="text-indigo-600 dark:text-indigo-400 font-bold">{formatBytes(s.bytesSent)}</span>
                                                    </div>
                                                    {(s.rxBps ?? 0) > 0 && (
                                                        <div className="text-[10px] text-emerald-500 font-bold tracking-tight">
                                                            ⚡ {formatBitrate(s.rxBps)}
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                {/* 📤 OUTGOING SESSIONS TABLE */}
                <div className="bg-card border border-border rounded-2xl p-5 shadow-sm flex flex-col">
                    <div className="flex items-center justify-between pb-4 border-b border-border">
                        <div className="flex items-center gap-2.5">
                            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-600 dark:text-emerald-400">
                                <ArrowUpRight size={18} />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-text-primary">Outgoing Sessions</h3>
                                <p className="text-[11px] text-text-muted">Active streams opened from this node to remote peers</p>
                            </div>
                        </div>
                        <span className="text-xs bg-card-secondary border border-border px-3 py-1 rounded-xl text-emerald-600 dark:text-emerald-400 font-bold shadow-sm">
                            {sessionSearch ? `${filteredOutgoingSessions.length} / ${outgoingSessions.length}` : `${outgoingSessions.length}`} Targets
                        </span>
                    </div>

                    <div className="overflow-x-auto mt-4 flex-1">
                        {outgoingSessions.length === 0 ? (
                            <div className="py-12 text-center text-xs text-text-muted">
                                {metrics?.clientWorkloadRunning ? (
                                    <div className="italic">Connecting to configured peers...</div>
                                ) : (!currentApp?.peers || currentApp.peers.length === 0) ? (
                                    <div className="space-y-3">
                                        <p className="text-text-muted">No remote target peers configured for this application.</p>
                                        <button
                                            onClick={() => {
                                                 setEditingApp(currentApp || null);
                                                 setIsWizardOpen(true);
                                            }}
                                            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
                                        >
                                            <Plus size={14} /> Add Target Peer
                                        </button>
                                    </div>
                                ) : (
                                    <div className="italic">Client is currently stopped. Click "Start Client" above.</div>
                                )}
                            </div>
                        ) : filteredOutgoingSessions.length === 0 ? (
                            <div className="py-12 text-center text-xs text-text-muted italic">
                                No outgoing sessions match "{sessionSearch}".
                            </div>
                        ) : (
                            <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                    <tr className="border-b border-border text-text-muted font-semibold text-[11px]">
                                        <th className="pb-3 px-3 whitespace-nowrap">Target Peer</th>
                                        <th className="pb-3 px-3 whitespace-nowrap">Remote Endpoint</th>
                                        <th className="pb-3 px-3 whitespace-nowrap">State & Uptime</th>
                                        <th className="pb-3 px-4 text-right whitespace-nowrap">RTT Wave & Latency</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/60">
                                    {filteredOutgoingSessions.map(s => {
                                        const peerSessions = outgoingSessions.filter(x => x.peerId === s.peerId || x.peerName === s.peerName);
                                        const sessionIndex = peerSessions.findIndex(x => x.sessionId === s.sessionId) + 1;
                                        const streamBadge = peerSessions.length > 1 ? `#${sessionIndex}` : null;
                                        return (
                                            <tr
                                                key={s.sessionId}
                                                onClick={() => setDeepDiveSession({ ...s, isIncoming: false })}
                                                className="hover:bg-card-secondary/70 cursor-pointer transition-colors group"
                                                title="Click to open full Session Deep Dive"
                                            >
                                                <td className="py-3 px-3 font-semibold text-text-primary whitespace-nowrap">
                                                    <div className="flex items-center gap-2">
                                                        <span className="group-hover:text-emerald-500 transition-colors">{s.peerName}</span>
                                                        {streamBadge && (
                                                            <span className="px-1.5 py-0.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 rounded text-[9px] font-mono font-bold">
                                                                {streamBadge}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="py-3 px-3 font-mono text-text-secondary text-[11px] whitespace-nowrap">
                                                    {s.peerHost}:{s.peerPort}
                                                </td>
                                                <td className="py-3 px-3 whitespace-nowrap">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                                            s.state === 'connected' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' :
                                                            s.state === 'reconnecting' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 animate-pulse' :
                                                            'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                                                        }`}>
                                                            {s.state}
                                                        </span>
                                                        {(s.uptimeSec ?? 0) > 0 && (
                                                            <span className="text-[10px] text-text-muted font-mono whitespace-nowrap">
                                                                {formatUptime(s.uptimeSec)}
                                                            </span>
                                                        )}
                                                        {(s.reconnects ?? 0) > 0 && (
                                                            <span className="text-[10px] text-amber-500 font-mono font-semibold whitespace-nowrap" title={`${s.reconnects} reconnect(s)`}>
                                                                • {s.reconnects} rec
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="py-3 px-4 text-right font-mono text-[11px] whitespace-nowrap">
                                                    <div className="flex items-center justify-end gap-3">
                                                        {s.rttMs.recentSamples && s.rttMs.recentSamples.length >= 2 ? (
                                                            <div className="w-[56px] shrink-0 flex items-center justify-center">
                                                                <MicroSparkline samples={s.rttMs.recentSamples} width={56} height={18} />
                                                            </div>
                                                        ) : (
                                                            <div className="w-[56px] shrink-0" />
                                                        )}
                                                        <div className="w-[135px] shrink-0 text-right">
                                                            <div className="text-amber-600 dark:text-amber-400 font-semibold whitespace-nowrap tabular-nums">
                                                                {s.rttMs.avg > 0 ? `${s.rttMs.avg} / ${s.rttMs.p50} / ${s.rttMs.p95} ms` : '—'}
                                                            </div>
                                                            {s.rttMs.avg > 0 && (
                                                                <div className="text-[10px] text-cyan-500 flex items-center justify-end gap-1 font-sans mt-0.5 whitespace-nowrap tabular-nums">
                                                                    <span>Jitter: ± {s.rttMs.jitterMs ?? 0} ms</span>
                                                                    {(s.txBps ?? 0) > 0 && (
                                                                        <>
                                                                            <span className="text-text-muted">•</span>
                                                                            <span className="text-indigo-400 font-mono font-bold">{formatBitrate(s.txBps)}</span>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </div>

            {/* Peer Handshake Test Modal */}
            {peerTestModal?.isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
                    <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full shadow-2xl text-text-primary space-y-4">
                        <div className="flex items-center justify-between border-b border-border pb-3">
                            <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                                <Zap size={16} className="text-amber-500" /> Handshake Test: {peerTestModal.peerName}
                            </h3>
                            <button onClick={() => setPeerTestModal(null)} className="text-text-muted hover:text-text-primary p-1 rounded-lg hover:bg-card-secondary transition-colors">
                                <Square size={16} />
                            </button>
                        </div>

                        <div className="bg-card-secondary border border-border p-3 rounded-xl text-xs font-mono text-text-secondary">
                            Endpoint: {peerTestModal.host}:{peerTestModal.port}
                        </div>

                        <div className="py-4 text-center">
                            {peerTestResult?.loading ? (
                                <div className="flex flex-col items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400">
                                    <RefreshCw size={24} className="animate-spin" />
                                    <span>Executing TCP 3-way handshake + CLIENT_HELLO...</span>
                                </div>
                            ) : peerTestResult?.success ? (
                                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-600 dark:text-emerald-400 text-xs space-y-1">
                                    <div className="font-bold flex items-center justify-center gap-1.5"><CheckCircle2 size={16} /> Handshake Successful!</div>
                                    <div>Measured RTT: <strong>{peerTestResult.rttMs} ms</strong></div>
                                </div>
                            ) : (
                                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-600 dark:text-rose-400 text-xs space-y-1">
                                    <div className="font-bold flex items-center justify-center gap-1.5"><AlertTriangle size={16} /> Handshake Failed</div>
                                    <div>{peerTestResult?.error}</div>
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                onClick={() => handleTestPeer(peerTestModal.peerId)}
                                disabled={peerTestResult?.loading}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-sm"
                            >
                                Retest
                            </button>
                            <button
                                onClick={() => setPeerTestModal(null)}
                                className="px-4 py-2 bg-card-secondary hover:bg-card-hover text-text-secondary rounded-xl text-xs font-semibold border border-border"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Session Deep Dive Drawer (Side panel) */}
            <SessionDeepDiveDrawer
                session={deepDiveSession}
                appPort={currentApp?.listener?.port}
                appName={currentApp?.name}
                onClose={() => setDeepDiveSession(null)}
                onTestPeer={(peerId) => {
                    if (currentApp) {
                        const p = currentApp.peers?.find(x => x.id === peerId);
                        if (p) {
                            setPeerTestModal({
                                isOpen: true,
                                peerId: p.id,
                                peerName: p.name,
                                host: p.host,
                                port: p.port
                            });
                            handleTestPeer(p.id);
                        }
                    }
                }}
            />

            {/* Creation / Edition Wizard Modal */}
            <CustomAppWizardModal
                isOpen={isWizardOpen}
                onClose={() => {
                    setIsWizardOpen(false);
                    setEditingApp(null);
                }}
                onSave={handleSaveApp}
                editingApp={editingApp}
                token={token}
            />

            {/* Prisma SD-WAN Appdef Sync Modal */}
            <PrismaAppSyncModal
                isOpen={isPrismaModalOpen}
                onClose={() => setIsPrismaModalOpen(false)}
                token={token}
                applications={applications}
            />
        </div>
    );
};
