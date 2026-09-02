/**
 * Stigix Custom TCP Inter-Site Applications — Operational Control Center
 */

import React, { useState, useEffect } from 'react';
import {
    Play, Square, RefreshCw, Server, Globe, Activity, Plus,
    Copy, Trash2, Edit3, Shield, AlertTriangle, CheckCircle2,
    Clock, Cpu, ArrowDownRight, ArrowUpRight, Zap, ExternalLink,
    Layers
} from 'lucide-react';
import toast from 'react-hot-toast';
import type {
    CustomTcpApplicationConfig,
    AppRuntimeMetrics,
    IncomingSessionState,
    OutgoingSessionState
} from '../custom-tcp-apps/types.js';
import { CustomAppWizardModal } from './components/custom-tcp/CustomAppWizardModal';

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
    const [isLoading, setIsLoading] = useState(false);
    const [isActionLoading, setIsActionLoading] = useState(false);

    // Modals
    const [isWizardOpen, setIsWizardOpen] = useState(false);
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
                (data.applications || []).forEach((app: any) => {
                    map[app.id] = app;
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
                setIncomingSessions(inData.sessions || []);
            }
            if (outRes.ok) {
                const outData = await outRes.json();
                setOutgoingSessions(outData.sessions || []);
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
        setIsActionLoading(true);
        const isRunning = metrics?.clientWorkloadRunning;
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

    return (
        <div className="p-6 max-w-[1600px] mx-auto space-y-6 text-text-primary animate-fadeIn">
            {/* Top Node Identity Bar */}
            <div className="bg-card border border-border rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4 shadow-sm">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-600 dark:text-indigo-400">
                        <Activity size={24} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-xl font-bold text-text-primary tracking-wide">Custom TCP Applications</h1>
                            <span className="px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 rounded text-[10px] font-bold uppercase tracking-wider">
                                East-West SD-WAN Simulator
                            </span>
                        </div>
                        <p className="text-xs text-text-muted mt-0.5">
                            Simulate stateful multi-site application traffic across overlay tunnels with live RTT, failover observation, and chaos injection.
                        </p>
                    </div>
                </div>

                {instanceInfo && (
                    <div className="flex items-center gap-3 bg-card-secondary border border-border px-4 py-2 rounded-xl text-xs shadow-sm">
                        <div>
                            <span className="text-text-muted">Local Site:</span>{' '}
                            <span className="font-bold text-text-primary">{instanceInfo.siteName}</span>
                        </div>
                        <div className="text-border">|</div>
                        <div>
                            <span className="text-text-muted">UUID:</span>{' '}
                            <span className="font-mono text-indigo-600 dark:text-indigo-400 font-medium">{instanceInfo.instanceId.substring(0, 8)}...</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Multi-App Global Overview Matrix */}
            {applications.length > 1 && (
                <div className="bg-card border border-border rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs shadow-sm">
                    <div className="flex items-center gap-2 text-text-primary font-semibold">
                        <Layers size={15} className="text-indigo-500" />
                        <span>Active Multi-App Matrix ({applications.length} apps configured):</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        {applications.map(app => {
                            const sum = allAppSummaries[app.id];
                            const isL = sum?.listener?.state === 'listening';
                            const isC = sum?.clientWorkload?.state === 'running';
                            const isSel = app.id === selectedAppId;
                            return (
                                <button
                                    key={app.id}
                                    onClick={() => setSelectedAppId(app.id)}
                                    className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all ${
                                        isSel
                                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                                            : 'bg-card-secondary hover:bg-card-hover border-border text-text-secondary hover:text-text-primary'
                                    }`}
                                >
                                    <span className={`w-2 h-2 rounded-full ${isL ? 'bg-emerald-500' : 'bg-text-muted/40'}`} />
                                    <span>{app.name}</span>
                                    <span className={`text-[10px] font-mono ${isSel ? 'text-indigo-100' : 'text-amber-600 dark:text-amber-400'}`}>:{app.listener?.port}</span>
                                    {isC && <span className={`text-[9px] px-1 rounded font-mono font-bold ${isSel ? 'bg-white/20 text-white' : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'}`}>TX</span>}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Application Selector & Control Header */}
            <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
                <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-2">Select Application</label>
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[300px]">
                        <div className="w-full max-w-xs">
                            <select
                                value={selectedAppId}
                                onChange={e => setSelectedAppId(e.target.value)}
                                className="w-full h-[38px] bg-card-secondary border border-border rounded-xl px-3.5 py-2 text-sm text-text-primary font-medium focus:outline-none focus:border-indigo-500 shadow-sm"
                            >
                                {applications.map(app => {
                                    const sum = allAppSummaries[app.id];
                                    const isL = sum?.listener?.state === 'listening';
                                    return (
                                        <option key={app.id} value={app.id}>
                                            {isL ? '🟢' : '⚪'} {app.name} (Port :{app.listener?.port})
                                        </option>
                                    );
                                })}
                            </select>
                        </div>

                        {metrics && (() => {
                            const health = calculateHealthScore();
                            return (
                                <div className="flex items-center gap-2.5">
                                    <div
                                        title={health.reason}
                                        className={`h-[38px] px-3.5 py-2 rounded-xl text-xs font-black border flex items-center gap-2 cursor-help transition-all shadow-sm ${
                                            health.color === 'emerald'
                                                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                                                : health.color === 'amber'
                                                ? 'bg-amber-500/10 border-amber-500/40 text-amber-600 dark:text-amber-400'
                                                : 'bg-rose-500/15 border-rose-500/50 text-rose-600 dark:text-rose-400 animate-pulse'
                                        }`}
                                    >
                                        <div className="flex items-center gap-1.5 font-mono">
                                            <span className="text-[13px]">{health.score}</span>
                                            <span className="text-[10px] opacity-70">/100</span>
                                        </div>
                                        <span className="text-[11px] uppercase tracking-wider font-extrabold">{health.label}</span>
                                    </div>

                                    <span className="h-[38px] text-xs text-text-muted bg-card-secondary border border-border px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-sm">
                                        <Server size={13} className={metrics.listenerState === 'listening' ? 'text-emerald-500' : 'text-text-muted'} />
                                        <span>Listener:</span>
                                        <strong className={`uppercase ${metrics.listenerState === 'listening' ? 'text-emerald-600 dark:text-emerald-400' : 'text-text-muted'}`}>
                                            {metrics.listenerState}
                                        </strong>
                                    </span>
                                </div>
                            );
                        })()}
                    </div>

                    {/* Control Action Buttons */}
                    <div className="flex items-center gap-2.5">
                        <button
                            onClick={handleToggleListener}
                            disabled={isActionLoading}
                            className={`h-[38px] px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shadow-sm ${
                                metrics?.listenerState === 'listening'
                                    ? 'bg-card-secondary hover:bg-card-hover text-amber-600 dark:text-amber-400 border border-amber-500/30'
                                    : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                            }`}
                        >
                            <Server size={15} />
                            {metrics?.listenerState === 'listening' ? 'Stop Listener' : 'Start Listener'}
                        </button>

                        <button
                            onClick={handleToggleClient}
                            disabled={isActionLoading || !currentApp?.peers?.length}
                            className={`h-[38px] px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shadow-sm ${
                                metrics?.clientWorkloadRunning
                                    ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/40'
                                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
                            }`}
                        >
                            {metrics?.clientWorkloadRunning ? <Square size={15} /> : <Play size={15} />}
                            {metrics?.clientWorkloadRunning ? 'Stop Client Workload' : 'Start Client Workload'}
                        </button>

                        <button
                            onClick={() => {
                                setEditingApp(currentApp || null);
                                setIsWizardOpen(true);
                            }}
                            className="h-[38px] px-3.5 py-2 bg-card-secondary hover:bg-card-hover text-text-primary border border-border rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
                        >
                            <Edit3 size={15} /> Edit Profile
                        </button>

                        <button
                            onClick={() => {
                                setEditingApp(null);
                                setIsWizardOpen(true);
                            }}
                            className="h-[38px] px-3.5 py-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
                        >
                            <Plus size={15} /> New App
                        </button>
                    </div>
                </div>
            </div>

            {/* Metrics Overview Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 1. Incoming Sessions Card */}
                <div className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
                    <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
                            <ArrowDownRight size={16} /> Incoming Sessions (Server)
                        </span>
                        <span className="font-mono text-[11px] text-text-muted">:{currentApp?.listener?.port}</span>
                    </div>
                    <div className="mt-3 flex items-baseline justify-between">
                        <div className="text-3xl font-black text-text-primary">{incomingSessions.length} <span className="text-xs font-normal text-text-muted">active</span></div>
                        <div className="text-right text-[11px] text-text-muted font-mono">
                            RX: <span className="text-emerald-600 dark:text-emerald-400 font-bold">{formatBytes(metrics?.totalRxBytes || 0)}</span>
                        </div>
                    </div>
                    <div className="mt-2 text-[11px] text-text-muted flex justify-between pt-2.5 border-t border-border">
                        <span>Mode: <strong className="text-text-secondary capitalize">{currentApp?.serverBehavior?.mode.replace('_', ' ')}</strong></span>
                        <span>Handled: <strong className="text-text-secondary">{metrics?.totalRequests || 0}</strong></span>
                    </div>
                </div>

                {/* 2. Outgoing Sessions Card */}
                <div className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
                    <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                            <ArrowUpRight size={16} /> Outgoing Sessions (Client)
                        </span>
                        <span className="font-mono text-[11px] text-text-muted">{currentApp?.peers?.length || 0} peers</span>
                    </div>
                    <div className="mt-3 flex items-baseline justify-between">
                        <div className="text-3xl font-black text-text-primary">{outgoingSessions.filter(s => s.state === 'connected').length} <span className="text-xs font-normal text-text-muted">active</span></div>
                        <div className="text-right text-[11px] text-text-muted font-mono">
                            TX: <span className="text-indigo-600 dark:text-indigo-400 font-bold">{formatBytes(metrics?.totalTxBytes || 0)}</span>
                        </div>
                    </div>
                    <div className="mt-2 text-[11px] text-text-muted flex justify-between pt-2.5 border-t border-border">
                        <span>Mode: <strong className="text-text-secondary capitalize">{currentApp?.clientDefaults?.mode.replace(/_/g, ' ')}</strong></span>
                        <span>Replies: <strong className="text-text-secondary">{metrics?.totalResponses || 0}</strong></span>
                    </div>
                </div>

                {/* 3. Application Latency Card */}
                <div className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
                    <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                            <Zap size={16} /> App Latency (RTT)
                        </span>
                        <span className="font-mono text-[11px] text-text-muted">Rolling Window</span>
                    </div>
                    <div className="mt-3 flex items-baseline justify-between">
                        <div className="text-3xl font-black text-amber-600 dark:text-amber-400">{metrics?.avgRttMs || 0} <span className="text-xs font-normal text-text-muted">ms avg</span></div>
                        <div className="text-right text-[11px] text-text-muted font-mono">
                            p95: <span className="text-text-primary font-bold">{metrics?.p95RttMs || 0} ms</span>
                        </div>
                    </div>
                    <div className="mt-2 text-[11px] text-text-muted flex justify-between pt-2.5 border-t border-border">
                        <span>Timeouts: <strong className="text-rose-500 font-bold">{metrics?.totalTimeouts || 0}</strong></span>
                        <span>Errors: <strong className="text-rose-500 font-bold">{metrics?.totalErrors || 0}</strong></span>
                    </div>
                </div>

                {/* 4. Stability & Simulation Card */}
                <div className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
                    <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold flex items-center gap-1.5 text-cyan-600 dark:text-cyan-400">
                            <Activity size={16} /> Stability & Chaos
                        </span>
                        <span className="font-mono text-[11px] text-text-muted">Failover</span>
                    </div>
                    <div className="mt-3 flex items-baseline justify-between">
                        <div className="text-3xl font-black text-text-primary">{metrics?.totalReconnects || 0} <span className="text-xs font-normal text-text-muted">reconnects</span></div>
                        <div className="text-right text-[11px] text-text-muted font-mono">
                            Drops: <span className="text-amber-600 dark:text-amber-400 font-bold">{metrics?.totalSimulatedDrops || 0}</span>
                        </div>
                    </div>
                    <div className="mt-2 text-[11px] text-text-muted flex justify-between pt-2.5 border-t border-border">
                        <span>TCP Keepalive: <strong className="text-text-secondary">Enabled</strong></span>
                        <span>Backoff: <strong className="text-text-secondary">Jittered</strong></span>
                    </div>
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
                                <h3 className="text-sm font-bold text-text-primary">Incoming Client Sessions</h3>
                                <p className="text-[11px] text-text-muted">Remote Stigix nodes connecting to local port :{currentApp?.listener?.port}</p>
                            </div>
                        </div>
                        <span className="text-xs bg-card-secondary border border-border px-3 py-1 rounded-xl text-indigo-600 dark:text-indigo-400 font-bold shadow-sm">
                            {incomingSessions.length} Connected
                        </span>
                    </div>

                    <div className="overflow-x-auto mt-4 flex-1">
                        {incomingSessions.length === 0 ? (
                            <div className="py-14 text-center text-xs text-text-muted italic">
                                No incoming sessions currently connected to this listener.
                            </div>
                        ) : (
                            <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                    <tr className="border-b border-border text-text-muted font-semibold text-[11px]">
                                        <th className="pb-2.5">Declared Origin</th>
                                        <th className="pb-2.5">Observed Socket IP</th>
                                        <th className="pb-2.5">Peer Match</th>
                                        <th className="pb-2.5">State</th>
                                        <th className="pb-2.5 text-right">RX / TX</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/60">
                                    {incomingSessions.map(s => (
                                        <tr key={s.sessionId} className="hover:bg-card-secondary/50 transition-colors">
                                            <td className="py-3 font-semibold text-text-primary">
                                                <div>{s.declaredSiteName}</div>
                                                <div className="text-[10px] text-text-muted font-mono">{s.declaredHostname || s.sessionId}</div>
                                            </td>
                                            <td className="py-3 font-mono text-text-secondary text-[11px]">
                                                {s.remoteIp}:{s.remotePort}
                                            </td>
                                            <td className="py-3">
                                                {s.isConfiguredPeer ? (
                                                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-[10px] font-semibold">
                                                        Matched ({s.matchedPeerName})
                                                    </span>
                                                ) : (
                                                    <span className="px-2 py-0.5 rounded bg-card-secondary text-text-muted border border-border text-[10px]">
                                                        Unconfigured
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-3">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                    s.state === 'connected' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' :
                                                    s.state === 'delayed' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30' : 'bg-card-secondary text-text-muted border border-border'
                                                }`}>
                                                    {s.state}
                                                </span>
                                            </td>
                                            <td className="py-3 text-right font-mono text-[11px]">
                                                <span className="text-emerald-600 dark:text-emerald-400 font-bold">{formatBytes(s.bytesReceived)}</span> / <span className="text-indigo-600 dark:text-indigo-400 font-bold">{formatBytes(s.bytesSent)}</span>
                                            </td>
                                        </tr>
                                    ))}
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
                                <h3 className="text-sm font-bold text-text-primary">Outgoing Client Workload</h3>
                                <p className="text-[11px] text-text-muted">Active sessions opened from this node to remote peers</p>
                            </div>
                        </div>
                        <span className="text-xs bg-card-secondary border border-border px-3 py-1 rounded-xl text-emerald-600 dark:text-emerald-400 font-bold shadow-sm">
                            {outgoingSessions.length} Targets
                        </span>
                    </div>

                    <div className="overflow-x-auto mt-4 flex-1">
                        {outgoingSessions.length === 0 ? (
                            <div className="py-14 text-center text-xs text-text-muted italic">
                                {metrics?.clientWorkloadRunning
                                    ? 'Connecting to configured peers...'
                                    : 'Client workload is currently stopped. Click "Start Client Workload" above.'}
                            </div>
                        ) : (
                            <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                    <tr className="border-b border-border text-text-muted font-semibold text-[11px]">
                                        <th className="pb-2.5">Target Peer</th>
                                        <th className="pb-2.5">Remote Endpoint</th>
                                        <th className="pb-2.5">State</th>
                                        <th className="pb-2.5 text-right">RTT (Avg/p95)</th>
                                        <th className="pb-2.5 text-right">Reconnects</th>
                                        <th className="pb-2.5 text-center">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/60">
                                    {outgoingSessions.map(s => {
                                        const peerSessions = outgoingSessions.filter(x => x.peerId === s.peerId || x.peerName === s.peerName);
                                        const sessionIndex = peerSessions.findIndex(x => x.sessionId === s.sessionId) + 1;
                                        const streamBadge = peerSessions.length > 1 ? `Stream #${sessionIndex}` : null;
                                        return (
                                            <tr key={s.sessionId} className="hover:bg-card-secondary/50 transition-colors">
                                                <td className="py-3 font-semibold text-text-primary">
                                                    <div className="flex items-center gap-2">
                                                        <span>{s.peerName}</span>
                                                        {streamBadge && (
                                                            <span className="px-1.5 py-0.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 rounded text-[9px] font-mono font-bold">
                                                                {streamBadge}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="py-3 font-mono text-text-secondary text-[11px]">
                                                    {s.peerHost}:{s.peerPort}
                                                </td>
                                                <td className="py-3">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                        s.state === 'connected' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' :
                                                        s.state === 'reconnecting' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 animate-pulse' :
                                                        'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                                                    }`}>
                                                        {s.state}
                                                    </span>
                                                </td>
                                                <td className="py-3 text-right font-mono text-[11px] text-amber-600 dark:text-amber-400 font-semibold">
                                                    {s.rttMs.avg > 0 ? `${s.rttMs.avg} ms / ${s.rttMs.p95} ms` : '—'}
                                                </td>
                                                <td className="py-3 text-right font-mono text-[11px] text-text-muted">
                                                    {s.reconnects}
                                                </td>
                                                <td className="py-3 text-center">
                                                    <button
                                                        onClick={() => {
                                                            setPeerTestModal({
                                                                isOpen: true,
                                                                peerId: s.peerId,
                                                                peerName: s.peerName,
                                                                host: s.peerHost,
                                                                port: s.peerPort
                                                            });
                                                            handleTestPeer(s.peerId);
                                                        }}
                                                        className="p-1.5 text-text-muted hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-card-secondary rounded-lg transition-colors"
                                                        title="Test Handshake"
                                                    >
                                                        <Zap size={14} />
                                                    </button>
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
        </div>
    );
};
