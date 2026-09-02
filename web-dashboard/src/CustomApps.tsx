/**
 * Stigix Custom TCP Inter-Site Applications — Operational Control Center
 */

import React, { useState, useEffect } from 'react';
import {
    Play, Square, RefreshCw, Server, Globe, Activity, Plus,
    Copy, Trash2, Edit3, Shield, AlertTriangle, CheckCircle2,
    Clock, Cpu, ArrowDownRight, ArrowUpRight, Zap, ExternalLink
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
        } catch (err) {
            // Background refresh error ignored
        }
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
        <div className="p-6 max-w-[1600px] mx-auto space-y-6 text-slate-100 animate-fadeIn">
            {/* Top Node Identity Bar */}
            <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800/80 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-xl backdrop-blur-md">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-indigo-400">
                        <Activity size={24} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-xl font-bold text-white tracking-wide">Custom TCP Applications</h1>
                            <span className="px-2 py-0.5 bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 rounded text-[10px] font-bold uppercase tracking-wider">
                                East-West SD-WAN Simulator
                            </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                            Simulate stateful multi-site application traffic across overlay tunnels with live RTT, failover observation, and chaos injection.
                        </p>
                    </div>
                </div>

                {instanceInfo && (
                    <div className="flex items-center gap-3 bg-slate-950/80 border border-slate-800 px-4 py-2 rounded-xl text-xs">
                        <div>
                            <span className="text-slate-500">Local Site:</span>{' '}
                            <span className="font-bold text-white uppercase">{instanceInfo.siteName}</span>
                        </div>
                        <div className="text-slate-700">|</div>
                        <div>
                            <span className="text-slate-500">UUID:</span>{' '}
                            <span className="font-mono text-indigo-300">{instanceInfo.instanceId.substring(0, 8)}...</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Application Selector & Control Header */}
            <div className="bg-[#0b1329]/90 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4 flex-1 min-w-[300px]">
                    <div className="w-full max-w-xs">
                        <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Select Application</label>
                        <select
                            value={selectedAppId}
                            onChange={e => setSelectedAppId(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-medium focus:outline-none focus:border-indigo-500 shadow-inner"
                        >
                            {applications.map(app => (
                                <option key={app.id} value={app.id}>
                                    {app.name} (Port :{app.listener?.port})
                                </option>
                            ))}
                        </select>
                    </div>

                    {metrics && (
                        <div className="flex items-center gap-2 pt-5">
                            <span className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5 ${
                                metrics.health === 'healthy'
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                    : metrics.health === 'degraded'
                                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                                    : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                            }`}>
                                <span className={`w-2 h-2 rounded-full ${
                                    metrics.health === 'healthy' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
                                }`} />
                                {metrics.health.toUpperCase()}
                            </span>

                            <span className="text-xs text-slate-400 bg-slate-900 border border-slate-800 px-3 py-1 rounded-lg">
                                Listener: <strong className="text-white uppercase">{metrics.listenerState}</strong>
                            </span>
                        </div>
                    )}
                </div>

                {/* Control Action Buttons */}
                <div className="flex items-center gap-2.5">
                    <button
                        onClick={handleToggleListener}
                        disabled={isActionLoading}
                        className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shadow-md ${
                            metrics?.listenerState === 'listening'
                                ? 'bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30'
                                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                        }`}
                    >
                        <Server size={15} />
                        {metrics?.listenerState === 'listening' ? 'Stop Listener' : 'Start Listener'}
                    </button>

                    <button
                        onClick={handleToggleClient}
                        disabled={isActionLoading || !currentApp?.peers?.length}
                        className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shadow-md ${
                            metrics?.clientWorkloadRunning
                                ? 'bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/40'
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
                        className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    >
                        <Edit3 size={15} /> Edit Profile
                    </button>

                    <button
                        onClick={() => {
                            setEditingApp(null);
                            setIsWizardOpen(true);
                        }}
                        className="px-3.5 py-2 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    >
                        <Plus size={15} /> New App
                    </button>
                </div>
            </div>

            {/* Metrics Overview Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 1. Incoming Sessions Card */}
                <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-4 shadow-lg flex flex-col justify-between">
                    <div className="flex items-center justify-between text-slate-400 text-xs">
                        <span className="font-semibold flex items-center gap-1.5 text-indigo-300">
                            <ArrowDownRight size={16} /> Incoming Sessions (Server)
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">:{currentApp?.listener?.port}</span>
                    </div>
                    <div className="mt-3 flex items-baseline justify-between">
                        <div className="text-2xl font-black text-white">{incomingSessions.length} <span className="text-xs font-normal text-slate-400">active</span></div>
                        <div className="text-right text-[11px] text-slate-400 font-mono">
                            RX: <span className="text-emerald-400">{formatBytes(metrics?.totalRxBytes || 0)}</span>
                        </div>
                    </div>
                    <div className="mt-2 text-[11px] text-slate-500 flex justify-between pt-2 border-t border-slate-800/60">
                        <span>Mode: <strong className="text-slate-300 capitalize">{currentApp?.serverBehavior?.mode.replace('_', ' ')}</strong></span>
                        <span>Handled: <strong className="text-slate-300">{metrics?.totalRequests || 0}</strong></span>
                    </div>
                </div>

                {/* 2. Outgoing Sessions Card */}
                <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-4 shadow-lg flex flex-col justify-between">
                    <div className="flex items-center justify-between text-slate-400 text-xs">
                        <span className="font-semibold flex items-center gap-1.5 text-emerald-400">
                            <ArrowUpRight size={16} /> Outgoing Sessions (Client)
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">{currentApp?.peers?.length || 0} peers</span>
                    </div>
                    <div className="mt-3 flex items-baseline justify-between">
                        <div className="text-2xl font-black text-white">{outgoingSessions.filter(s => s.state === 'connected').length} <span className="text-xs font-normal text-slate-400">active</span></div>
                        <div className="text-right text-[11px] text-slate-400 font-mono">
                            TX: <span className="text-indigo-400">{formatBytes(metrics?.totalTxBytes || 0)}</span>
                        </div>
                    </div>
                    <div className="mt-2 text-[11px] text-slate-500 flex justify-between pt-2 border-t border-slate-800/60">
                        <span>Mode: <strong className="text-slate-300 capitalize">{currentApp?.clientDefaults?.mode.replace(/_/g, ' ')}</strong></span>
                        <span>Replies: <strong className="text-slate-300">{metrics?.totalResponses || 0}</strong></span>
                    </div>
                </div>

                {/* 3. Application Latency Card */}
                <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-4 shadow-lg flex flex-col justify-between">
                    <div className="flex items-center justify-between text-slate-400 text-xs">
                        <span className="font-semibold flex items-center gap-1.5 text-amber-300">
                            <Zap size={16} /> App Latency (RTT)
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">Rolling Window</span>
                    </div>
                    <div className="mt-3 flex items-baseline justify-between">
                        <div className="text-2xl font-black text-amber-300">{metrics?.avgRttMs || 0} <span className="text-xs font-normal text-slate-400">ms avg</span></div>
                        <div className="text-right text-[11px] text-slate-400 font-mono">
                            p95: <span className="text-white font-bold">{metrics?.p95RttMs || 0} ms</span>
                        </div>
                    </div>
                    <div className="mt-2 text-[11px] text-slate-500 flex justify-between pt-2 border-t border-slate-800/60">
                        <span>Timeouts: <strong className="text-rose-400">{metrics?.totalTimeouts || 0}</strong></span>
                        <span>Errors: <strong className="text-rose-400">{metrics?.totalErrors || 0}</strong></span>
                    </div>
                </div>

                {/* 4. Stability & Simulation Card */}
                <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-4 shadow-lg flex flex-col justify-between">
                    <div className="flex items-center justify-between text-slate-400 text-xs">
                        <span className="font-semibold flex items-center gap-1.5 text-cyan-400">
                            <Activity size={16} /> Stability & Chaos
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">Failover</span>
                    </div>
                    <div className="mt-3 flex items-baseline justify-between">
                        <div className="text-2xl font-black text-white">{metrics?.totalReconnects || 0} <span className="text-xs font-normal text-slate-400">reconnects</span></div>
                        <div className="text-right text-[11px] text-slate-400 font-mono">
                            Drops: <span className="text-amber-400 font-bold">{metrics?.totalSimulatedDrops || 0}</span>
                        </div>
                    </div>
                    <div className="mt-2 text-[11px] text-slate-500 flex justify-between pt-2 border-t border-slate-800/60">
                        <span>TCP Keepalive: <strong className="text-slate-300">Enabled</strong></span>
                        <span>Backoff: <strong className="text-slate-300">Jittered</strong></span>
                    </div>
                </div>
            </div>

            {/* LIVE TABLES SECTION */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 📥 INCOMING SESSIONS TABLE */}
                <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col">
                    <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                        <div className="flex items-center gap-2.5">
                            <div className="p-2 bg-indigo-500/10 border border-indigo-500/30 rounded-lg text-indigo-400">
                                <ArrowDownRight size={18} />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-white">Incoming Client Sessions</h3>
                                <p className="text-[11px] text-slate-400">Remote Stigix nodes connecting to local port :{currentApp?.listener?.port}</p>
                            </div>
                        </div>
                        <span className="text-xs bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-lg text-indigo-300 font-bold">
                            {incomingSessions.length} Connected
                        </span>
                    </div>

                    <div className="overflow-x-auto mt-4 flex-1">
                        {incomingSessions.length === 0 ? (
                            <div className="py-12 text-center text-xs text-slate-500 italic">
                                No incoming sessions currently connected to this listener.
                            </div>
                        ) : (
                            <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-800 text-slate-400 font-medium text-[11px]">
                                        <th className="pb-2">Declared Origin</th>
                                        <th className="pb-2">Observed Socket IP</th>
                                        <th className="pb-2">Peer Match</th>
                                        <th className="pb-2">State</th>
                                        <th className="pb-2 text-right">RX / TX</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/60">
                                    {incomingSessions.map(s => (
                                        <tr key={s.sessionId} className="hover:bg-slate-900/50 transition-colors">
                                            <td className="py-2.5 font-semibold text-white">
                                                <div>{s.declaredSiteName}</div>
                                                <div className="text-[10px] text-slate-500 font-mono">{s.declaredHostname || s.sessionId}</div>
                                            </td>
                                            <td className="py-2.5 font-mono text-slate-300 text-[11px]">
                                                {s.remoteIp}:{s.remotePort}
                                            </td>
                                            <td className="py-2.5">
                                                {s.isConfiguredPeer ? (
                                                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-semibold">
                                                        Matched ({s.matchedPeerName})
                                                    </span>
                                                ) : (
                                                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 text-[10px]">
                                                        Unconfigured
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-2.5">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                    s.state === 'connected' ? 'bg-emerald-500/10 text-emerald-400' :
                                                    s.state === 'delayed' ? 'bg-amber-500/10 text-amber-400' : 'bg-slate-800 text-slate-400'
                                                }`}>
                                                    {s.state}
                                                </span>
                                            </td>
                                            <td className="py-2.5 text-right font-mono text-[11px] text-slate-300">
                                                <span className="text-emerald-400">{formatBytes(s.bytesReceived)}</span> / <span className="text-indigo-400">{formatBytes(s.bytesSent)}</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                {/* 📤 OUTGOING SESSIONS TABLE */}
                <div className="bg-[#0b1329] border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col">
                    <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                        <div className="flex items-center gap-2.5">
                            <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
                                <ArrowUpRight size={18} />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-white">Outgoing Client Workload</h3>
                                <p className="text-[11px] text-slate-400">Active sessions opened from this node to remote peers</p>
                            </div>
                        </div>
                        <span className="text-xs bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-lg text-emerald-300 font-bold">
                            {outgoingSessions.length} Targets
                        </span>
                    </div>

                    <div className="overflow-x-auto mt-4 flex-1">
                        {outgoingSessions.length === 0 ? (
                            <div className="py-12 text-center text-xs text-slate-500 italic">
                                {metrics?.clientWorkloadRunning
                                    ? 'Connecting to configured peers...'
                                    : 'Client workload is currently stopped. Click "Start Client Workload" above.'}
                            </div>
                        ) : (
                            <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-800 text-slate-400 font-medium text-[11px]">
                                        <th className="pb-2">Target Peer</th>
                                        <th className="pb-2">Remote Endpoint</th>
                                        <th className="pb-2">State</th>
                                        <th className="pb-2 text-right">RTT (Avg/p95)</th>
                                        <th className="pb-2 text-right">Reconnects</th>
                                        <th className="pb-2 text-center">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/60">
                                    {outgoingSessions.map(s => (
                                        <tr key={s.sessionId} className="hover:bg-slate-900/50 transition-colors">
                                            <td className="py-2.5 font-semibold text-white">
                                                {s.peerName}
                                            </td>
                                            <td className="py-2.5 font-mono text-slate-300 text-[11px]">
                                                {s.peerHost}:{s.peerPort}
                                            </td>
                                            <td className="py-2.5">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                    s.state === 'connected' ? 'bg-emerald-500/10 text-emerald-400' :
                                                    s.state === 'reconnecting' ? 'bg-amber-500/10 text-amber-400 animate-pulse' :
                                                    'bg-rose-500/10 text-rose-400'
                                                }`}>
                                                    {s.state}
                                                </span>
                                            </td>
                                            <td className="py-2.5 text-right font-mono text-[11px] text-amber-300">
                                                {s.rttMs.avg > 0 ? `${s.rttMs.avg} ms / ${s.rttMs.p95} ms` : '—'}
                                            </td>
                                            <td className="py-2.5 text-right font-mono text-[11px] text-slate-400">
                                                {s.reconnects}
                                            </td>
                                            <td className="py-2.5 text-center">
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
                                                    className="p-1 text-slate-400 hover:text-indigo-300 hover:bg-slate-800 rounded transition-colors"
                                                    title="Test Handshake"
                                                >
                                                    <Zap size={13} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </div>

            {/* Peer Handshake Test Modal */}
            {peerTestModal?.isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
                    <div className="bg-[#0b1329] border border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl text-slate-100 space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                <Zap size={16} className="text-amber-400" /> Handshake Test: {peerTestModal.peerName}
                            </h3>
                            <button onClick={() => setPeerTestModal(null)} className="text-slate-400 hover:text-white">
                                <Square size={16} />
                            </button>
                        </div>

                        <div className="bg-slate-950 p-3 rounded-lg text-xs font-mono text-slate-300">
                            Endpoint: {peerTestModal.host}:{peerTestModal.port}
                        </div>

                        <div className="py-4 text-center">
                            {peerTestResult?.loading ? (
                                <div className="flex flex-col items-center gap-2 text-xs text-indigo-300">
                                    <RefreshCw size={24} className="animate-spin" />
                                    <span>Executing TCP 3-way handshake + CLIENT_HELLO...</span>
                                </div>
                            ) : peerTestResult?.success ? (
                                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs space-y-1">
                                    <div className="font-bold flex items-center justify-center gap-1.5"><CheckCircle2 size={16} /> Handshake Successful!</div>
                                    <div>Measured RTT: <strong>{peerTestResult.rttMs} ms</strong></div>
                                </div>
                            ) : (
                                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs space-y-1">
                                    <div className="font-bold flex items-center justify-center gap-1.5"><AlertTriangle size={16} /> Handshake Failed</div>
                                    <div>{peerTestResult?.error}</div>
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                onClick={() => handleTestPeer(peerTestModal.peerId)}
                                disabled={peerTestResult?.loading}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold"
                            >
                                Retest
                            </button>
                            <button
                                onClick={() => setPeerTestModal(null)}
                                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold"
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
