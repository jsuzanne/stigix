import React, { useState, useEffect } from 'react';
import { 
    X, Check, AlertTriangle, Globe, Server, 
    Sparkles, ArrowRight, RefreshCw, Unlink, 
    Radio, Shield, Terminal, Zap, CheckCircle2, Plus
} from 'lucide-react';
import { twMerge } from 'tailwind-merge';

interface NodeRoleModalProps {
    isOpen: boolean;
    onClose: () => void;
    token?: string | null;
    registryStatus: any;
    onRefreshStatus: () => Promise<void>;
    onOpenMagicJoin?: () => void;
}

export function NodeRoleModal({ 
    isOpen, 
    onClose, 
    token, 
    registryStatus, 
    onRefreshStatus,
    onOpenMagicJoin 
}: NodeRoleModalProps) {
    const [joinTokenInput, setJoinTokenInput] = useState('');
    const [showManualUrl, setShowManualUrl] = useState(false);
    const [manualLeaderUrl, setManualLeaderUrl] = useState('');
    const [isJoining, setIsJoining] = useState(false);
    const [isSwitching, setIsSwitching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            onRefreshStatus();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const isLeader = registryStatus?.mode === 'leader' || registryStatus?.current_mode === 'leader';
    const isEnrolledPeer = !isLeader && Boolean(registryStatus?.is_cluster_enrolled || registryStatus?.static_leader_url);
    const isStandalone = !isLeader && !isEnrolledPeer;

    const activeControllerOrigin = (
        registryStatus?.active_leader_endpoint ||
        registryStatus?.enrolled_leader_url ||
        registryStatus?.static_leader_url ||
        ''
    ).replace(/\/api\/registry\/?$/, '').replace(/\/$/, '');

    const candidateEndpointsList: string[] = (() => {
        const list = Array.isArray(registryStatus?.candidate_endpoints) ? registryStatus.candidate_endpoints : [];
        const cleaned = list.map((ep: string) => ep.replace(/\/api\/registry\/?$/, '').replace(/\/$/, '')).filter(Boolean);
        if (activeControllerOrigin && !cleaned.includes(activeControllerOrigin)) {
            return [activeControllerOrigin, ...cleaned];
        }
        return Array.from(new Set(cleaned));
    })();

    const authHeaders = {
        'Authorization': `Bearer ${token || localStorage.getItem('token') || ''}`,
        'Content-Type': 'application/json'
    };

    // Decode preview endpoints from STX- token
    const tokenPreview = (() => {
        const trimmed = joinTokenInput.trim();
        if (!trimmed.startsWith('STX-')) return null;
        try {
            const parts = trimmed.slice(4).split('.');
            if (parts.length >= 2) {
                const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                const decoded = JSON.parse(atob(b64));
                return {
                    siteHint: decoded.sub || decoded.site_name || decoded.site_hint,
                    endpoints: decoded.endpoints || (decoded.controller_url ? [decoded.controller_url] : []),
                    relayUrl: decoded.relay_url || null
                };
            }
        } catch { }
        return null;
    })();

    const handleJoinWithToken = async () => {
        const trimmed = joinTokenInput.trim();
        if (!trimmed) return;
        setIsJoining(true);
        setError(null);
        setSuccessMsg(null);
        try {
            const res = await fetch('/api/registry/join-with-token', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ token: trimmed, force: true })
            });
            const data = await res.json();
            if (res.ok && (data.success || data.status === 'ok')) {
                setSuccessMsg(`Enrolled successfully to ${data.leader_url || 'Cluster Leader'}! WebSocket tunnel established.`);
                setJoinTokenInput('');
                await onRefreshStatus();
                setTimeout(() => {
                    onClose();
                }, 1600);
            } else {
                setError(data.message || data.error || 'Failed to join cluster with token');
            }
        } catch (e: any) {
            setError(e.message || String(e));
        } finally {
            setIsJoining(false);
        }
    };

    const handleSaveManualLeader = async (overrideUrl?: string, addOnly = false) => {
        const trimmed = (overrideUrl ?? manualLeaderUrl).trim();
        if (!trimmed) return;
        setIsJoining(true);
        setError(null);
        setSuccessMsg(null);
        try {
            const res = await fetch('/api/registry/static-leader', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ url: trimmed, addOnly })
            });
            const d = await res.json().catch(() => ({}));
            if (res.ok) {
                setSuccessMsg(d.message || (addOnly ? `Added backup Leader endpoint(s): ${trimmed}` : `Leader endpoint updated to ${trimmed}! Reconnecting WebSocket...`));
                setManualLeaderUrl('');
                if (!addOnly) setShowManualUrl(false);
                await onRefreshStatus();
            } else {
                setError(d.message || d.error || 'Failed to configure static Leader URL');
            }
        } catch (e: any) {
            setError(e.message || String(e));
        } finally {
            setIsJoining(false);
        }
    };

    const handleRemoveCandidateEndpoint = async (epToRemove: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setIsJoining(true);
        setError(null);
        setSuccessMsg(null);
        try {
            const res = await fetch('/api/registry/static-leader', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ removeUrl: epToRemove })
            });
            if (res.ok) {
                setSuccessMsg(`Removed candidate endpoint ${epToRemove}`);
                await onRefreshStatus();
            }
        } catch (err: any) {
            setError(err.message || String(err));
        } finally {
            setIsJoining(false);
        }
    };

    const handlePromoteToLeader = async () => {
        if (!window.confirm("Promote this node to Cluster Leader?\n\nThis will activate the central fleet registry and allow this node to manage peers and generate join tokens.")) return;
        setIsSwitching(true);
        setError(null);
        setSuccessMsg(null);
        try {
            const res = await fetch('/api/config/system-settings', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ registry_mode: 'leader' })
            });
            if (res.ok) {
                setSuccessMsg("Node promoted to Cluster Leader!");
                await onRefreshStatus();
                setTimeout(() => {
                    onClose();
                }, 1400);
            } else {
                const d = await res.json().catch(() => ({}));
                setError(d.message || 'Failed to promote node to Leader');
            }
        } catch (e: any) {
            setError(e.message || String(e));
        } finally {
            setIsSwitching(false);
        }
    };

    const handleUnenroll = async () => {
        if (!window.confirm("Disconnect this node from the cluster and return to Standalone mode?")) return;
        setIsSwitching(true);
        setError(null);
        setSuccessMsg(null);
        try {
            const res = await fetch('/api/registry/unenroll', {
                method: 'POST',
                headers: authHeaders
            });
            if (res.ok) {
                setSuccessMsg("Node disconnected and reverted to Standalone mode.");
                await onRefreshStatus();
                setTimeout(() => {
                    onClose();
                }, 1400);
            } else {
                const d = await res.json().catch(() => ({}));
                setError(d.message || 'Failed to unenroll node');
            }
        } catch (e: any) {
            setError(e.message || String(e));
        } finally {
            setIsSwitching(false);
        }
    };

    const handleDemoteLeaderToStandalone = async () => {
        if (!window.confirm("Switch this Leader back to Standalone mode?\n\nConnected peers will no longer receive central updates from this node until reconfigured.")) return;
        setIsSwitching(true);
        setError(null);
        setSuccessMsg(null);
        try {
            const res = await fetch('/api/config/system-settings', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ registry_mode: 'standalone' })
            });
            if (res.ok) {
                await fetch('/api/registry/unenroll', { method: 'POST', headers: authHeaders }).catch(() => {});
                setSuccessMsg("Leader demoted to Standalone mode.");
                await onRefreshStatus();
                setTimeout(() => {
                    onClose();
                }, 1400);
            } else {
                const d = await res.json().catch(() => ({}));
                setError(d.message || 'Failed to demote Leader');
            }
        } catch (e: any) {
            setError(e.message || String(e));
        } finally {
            setIsSwitching(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
            <div className="relative w-full max-w-xl bg-card border border-border/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                
                {/* Header */}
                <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-card-secondary/40">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
                            <Radio size={18} />
                        </div>
                        <div>
                            <h3 className="text-sm font-black text-text-primary uppercase tracking-wider flex items-center gap-2">
                                Stigix Node Mode
                                <span className={twMerge(
                                    "px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-tight",
                                    isLeader ? "bg-purple-500/15 text-purple-400 border border-purple-500/30" :
                                    isEnrolledPeer ? "bg-blue-500/15 text-blue-400 border border-blue-500/30" :
                                    "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                )}>
                                    {isLeader ? '👑 Leader' : isEnrolledPeer ? '📡 Peer' : '⚡ Standalone'}
                                </span>
                            </h3>
                            <p className="text-xs text-text-muted mt-0.5">
                                Select how this Stigix node participates in your SD-WAN mesh
                            </p>
                        </div>
                    </div>
                    <button 
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-card-hover transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Notifications */}
                {error && (
                    <div className="mx-6 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
                        <AlertTriangle size={15} className="shrink-0" />
                        <span>{error}</span>
                    </div>
                )}
                {successMsg && (
                    <div className="mx-6 mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2">
                        <CheckCircle2 size={15} className="shrink-0" />
                        <span>{successMsg}</span>
                    </div>
                )}

                {/* Body Content */}
                <div className="p-6 overflow-y-auto space-y-6">
                    
                    {/* Current Mode Description Card */}
                    <div className="p-4 rounded-xl border border-border/60 bg-card-secondary/30 flex items-start justify-between gap-4">
                        <div>
                            <div className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-1">
                                Current Lifecycle Status
                            </div>
                            <div className="text-sm text-text-primary font-medium">
                                {isLeader && "This node is acting as the central Cluster Leader (Hub Controller). It distributes configurations, collects fleet telemetry, and issues Magic Join tokens."}
                                {isEnrolledPeer && `This node is enrolled as a managed Spoke Peer connected to Leader: ${activeControllerOrigin || 'Cluster Leader'}.`}
                                {isStandalone && "This node is running in Standalone Autonomous mode. Probes, speedtests, traffic generator, and packet captures execute locally without central control."}
                            </div>
                        </div>
                    </div>

                    {/* MODE SPECIFIC ACTIONS */}

                    {/* 1. STANDALONE NODE ACTIONS */}
                    {isStandalone && (
                        <div className="space-y-4">
                            {/* Option A: Join a Fleet */}
                            <div className="p-4 rounded-xl border border-blue-500/30 bg-blue-500/5 space-y-3">
                                <div className="flex items-center gap-2">
                                    <Sparkles size={16} className="text-blue-400" />
                                    <h4 className="text-xs font-black text-text-primary uppercase tracking-wider">
                                        Option 1: Connect to a Stigix Fleet (Spoke Peer)
                                    </h4>
                                </div>
                                <p className="text-xs text-text-muted">
                                    Paste a Magic Join token generated on your Leader node (via <strong>+ Add Node</strong>) to enroll instantly via reverse WebSocket tunnel:
                                </p>

                                <div className="space-y-2">
                                    <input 
                                        type="text"
                                        value={joinTokenInput}
                                        onChange={(e) => setJoinTokenInput(e.target.value)}
                                        placeholder="STX-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                                        className="w-full px-3 py-2 text-xs font-mono bg-card border border-border rounded-lg text-text focus:outline-none focus:border-blue-500 placeholder:text-text-muted/40"
                                    />

                                    {tokenPreview && (
                                        <div className="p-2.5 rounded-lg bg-card-secondary border border-border/60 text-[11px] font-mono text-text-secondary space-y-1">
                                            {tokenPreview.siteHint && (
                                                <div>Site Hint: <span className="text-blue-400 font-bold">{tokenPreview.siteHint}</span></div>
                                            )}
                                            {tokenPreview.endpoints.length > 0 && (
                                                <div>Target Leader: <span className="text-emerald-400 font-bold">{tokenPreview.endpoints[0]}</span></div>
                                            )}
                                            {tokenPreview.relayUrl && (
                                                <div>Cloudflare Relay: <span className="text-amber-400 font-bold">{tokenPreview.relayUrl}</span> <span className="text-[10px] text-text-muted">(WAN traversal ready)</span></div>
                                            )}
                                        </div>
                                    )}

                                    <button
                                        onClick={handleJoinWithToken}
                                        disabled={isJoining || !joinTokenInput.trim().startsWith('STX-')}
                                        className="w-full py-2 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2"
                                    >
                                        {isJoining ? (
                                            <>
                                                <RefreshCw size={14} className="animate-spin" />
                                                Verifying & Establishing Tunnel...
                                            </>
                                        ) : (
                                            <>
                                                <ArrowRight size={14} />
                                                Join Fleet Cluster
                                            </>
                                        )}
                                    </button>

                                    <div className="pt-2 border-t border-border/50">
                                        <button
                                            type="button"
                                            onClick={() => setShowManualUrl(!showManualUrl)}
                                            className="text-[11px] font-bold text-text-muted hover:text-text-primary transition-colors flex items-center gap-1"
                                        >
                                            <span>{showManualUrl ? '▾ Hide manual Leader IP / URL' : '▸ Or configure manual Leader IP / URL'}</span>
                                        </button>
                                        {showManualUrl && (
                                            <div className="mt-2 flex gap-2">
                                                <input
                                                    type="text"
                                                    value={manualLeaderUrl}
                                                    onChange={(e) => setManualLeaderUrl(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && handleSaveManualLeader()}
                                                    placeholder="e.g. 192.168.1.50 or http://leader:8080"
                                                    className="flex-1 px-3 py-1.5 text-xs font-mono bg-card border border-border rounded-lg text-text focus:outline-none focus:border-blue-500 placeholder:text-text-muted/40"
                                                />
                                                <button
                                                    onClick={() => handleSaveManualLeader()}
                                                    disabled={isJoining || !manualLeaderUrl.trim()}
                                                    className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-bold transition-all"
                                                >
                                                    Save
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Option B: Promote to Leader */}
                            <div className="p-4 rounded-xl border border-purple-500/30 bg-purple-500/5 flex items-center justify-between gap-4">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <Globe size={16} className="text-purple-400" />
                                        <h4 className="text-xs font-black text-text-primary uppercase tracking-wider">
                                            Option 2: Promote to Cluster Leader
                                        </h4>
                                    </div>
                                    <p className="text-xs text-text-muted mt-1">
                                        Make this node the orchestrator to aggregate metrics and onboard other nodes.
                                    </p>
                                </div>
                                <button
                                    onClick={handlePromoteToLeader}
                                    disabled={isSwitching}
                                    className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 shadow-sm"
                                >
                                    {isSwitching ? <RefreshCw size={13} className="animate-spin" /> : <Globe size={13} />}
                                    Become Leader
                                </button>
                            </div>
                        </div>
                    )}

                    {/* 2. ENROLLED PEER ACTIONS */}
                    {isEnrolledPeer && (
                        <div className="space-y-4">
                            <div className="p-4 rounded-xl border border-border bg-card-secondary/40 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="text-xs font-bold text-text-secondary uppercase tracking-wider">
                                        Enrolled Cluster Information
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!showManualUrl) {
                                                setManualLeaderUrl('');
                                            }
                                            setShowManualUrl(!showManualUrl);
                                        }}
                                        className="text-[11px] font-bold text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
                                    >
                                        <span>{showManualUrl ? '▾ Hide Endpoint Editor' : '✎ Change / Add Leader URLs'}</span>
                                    </button>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                                    <div className="p-2.5 rounded-lg bg-card border border-border/60">
                                        <span className="text-[10px] text-text-muted block font-sans uppercase">Active Controller URL</span>
                                        <span className="text-text-primary font-bold break-all">
                                            {activeControllerOrigin || '—'}
                                        </span>
                                    </div>
                                    <div className="p-2.5 rounded-lg bg-card border border-border/60">
                                        <span className="text-[10px] text-text-muted block font-sans uppercase">Token Prefix</span>
                                        <span className="text-text-primary">{registryStatus?.enrolled_token_prefix || 'Active Session'}</span>
                                    </div>
                                </div>

                                {/* Candidate Endpoints & Smart Failover Metrics (always rendered for stable height) */}
                                <div className="p-3 rounded-lg bg-card border border-border/60 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
                                            Known Leader Endpoints ({candidateEndpointsList.length}) — Click to switch
                                        </span>
                                        <span className="text-[10px] text-emerald-400 font-mono">
                                            Smart Failover Active
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                                        {candidateEndpointsList.map((cleanEp: string) => {
                                            const isActive = activeControllerOrigin === cleanEp;
                                            const metric = Array.isArray(registryStatus?.candidate_endpoint_metrics)
                                                ? registryStatus.candidate_endpoint_metrics.find((m: any) => m.url?.replace(/\/$/, '') === cleanEp)
                                                : null;
                                            const scoreVal = metric?.score ?? 100;
                                            return (
                                                <div
                                                    key={cleanEp}
                                                    className={twMerge(
                                                        "px-2.5 py-1 rounded-lg border text-[11px] font-mono flex items-center gap-1.5 transition-all",
                                                        isActive
                                                            ? "bg-blue-500/15 border-blue-500/50 text-blue-400 font-bold"
                                                            : "bg-card-secondary/50 border-border hover:border-blue-500/40 text-text-secondary"
                                                    )}
                                                >
                                                    <button
                                                        type="button"
                                                        disabled={isJoining}
                                                        onClick={() => handleSaveManualLeader(cleanEp, false)}
                                                        className="flex items-center gap-1.5 text-left"
                                                        title={isActive ? "Currently active Leader endpoint" : "Click to switch WebSocket connection to this endpoint immediately"}
                                                    >
                                                        <span className={twMerge("w-1.5 h-1.5 rounded-full shrink-0", isActive ? "bg-emerald-400" : "bg-text-muted/50")} />
                                                        <span>{cleanEp}</span>
                                                        {metric?.ewmaRttMs != null && (
                                                            <span className="text-[9px] px-1 rounded bg-emerald-500/15 text-emerald-300">
                                                                {metric.ewmaRttMs}ms
                                                            </span>
                                                        )}
                                                        <span className="text-[9px] text-text-muted">
                                                            (score {scoreVal})
                                                        </span>
                                                    </button>
                                                    {candidateEndpointsList.length > 1 && (
                                                        <button
                                                            type="button"
                                                            disabled={isJoining}
                                                            onClick={(e) => handleRemoveCandidateEndpoint(cleanEp, e)}
                                                            className="ml-0.5 text-text-muted hover:text-red-400 transition-colors"
                                                            title="Remove this endpoint from candidate failover list"
                                                        >
                                                            <X size={11} />
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* In-place manual URL editor for Enrolled Peer (supports single or multiple URLs) */}
                                {showManualUrl && (
                                    <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/30 space-y-2">
                                        <label className="text-[10px] font-bold text-blue-400 uppercase tracking-wider block">
                                            Switch Active URL or Add Multiple Candidate Endpoints (comma-separated)
                                        </label>
                                        <div className="flex flex-col sm:flex-row gap-2">
                                            <input
                                                type="text"
                                                value={manualLeaderUrl}
                                                onChange={(e) => setManualLeaderUrl(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && handleSaveManualLeader(undefined, false)}
                                                placeholder="e.g. http://192.168.122.51:8080, https://sdwandc1.carenaje.fr"
                                                className="flex-1 px-3 py-1.5 text-xs font-mono bg-card border border-border rounded-lg text-text focus:outline-none focus:border-blue-500 placeholder:text-text-muted/40"
                                            />
                                            <div className="flex gap-1.5 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => handleSaveManualLeader(undefined, false)}
                                                    disabled={isJoining || !manualLeaderUrl.trim()}
                                                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-bold transition-all flex items-center gap-1"
                                                    title="Make the first URL active immediately and keep all URLs in the candidate list"
                                                >
                                                    {isJoining ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                                                    Switch Now
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSaveManualLeader(undefined, true)}
                                                    disabled={isJoining || !manualLeaderUrl.trim()}
                                                    className="px-2.5 py-1.5 rounded-lg bg-card hover:bg-card-hover border border-blue-500/40 text-blue-400 disabled:opacity-40 text-xs font-bold transition-all flex items-center gap-1"
                                                    title="Add URL(s) to the backup candidate pool without disconnecting the current active tunnel"
                                                >
                                                    <Plus size={12} />
                                                    Add Backup
                                                </button>
                                            </div>
                                        </div>
                                        <p className="text-[10px] text-text-muted">
                                            Tip: Enter one or several URLs separated by commas. Use <strong>Switch Now</strong> to reconnect immediately, or <strong>+ Add Backup</strong> to register secondary failover URLs without interrupting the current tunnel.
                                        </p>
                                    </div>
                                )}

                                <div className="pt-2 flex justify-end">
                                    <button
                                        onClick={handleUnenroll}
                                        disabled={isSwitching}
                                        className="px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-bold transition-all flex items-center gap-1.5"
                                    >
                                        {isSwitching ? <RefreshCw size={13} className="animate-spin" /> : <Unlink size={13} />}
                                        Disconnect & Return to Standalone
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 3. LEADER ACTIONS */}
                    {isLeader && (
                        <div className="space-y-4">
                            <div className="p-4 rounded-xl border border-purple-500/30 bg-purple-500/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                <div>
                                    <h4 className="text-xs font-black text-text-primary uppercase tracking-wider flex items-center gap-2">
                                        <Globe size={15} className="text-purple-400" />
                                        Fleet Management
                                    </h4>
                                    <p className="text-xs text-text-muted mt-1">
                                        Generate Magic Join tokens to securely onboard new branch sites into this cluster.
                                    </p>
                                </div>
                                {onOpenMagicJoin && (
                                    <button
                                        onClick={() => {
                                            onClose();
                                            onOpenMagicJoin();
                                        }}
                                        className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm shrink-0"
                                    >
                                        <Sparkles size={14} />
                                        + Add Node (Magic Join)
                                    </button>
                                )}
                            </div>

                            <div className="pt-2 flex justify-end">
                                <button
                                    onClick={handleDemoteLeaderToStandalone}
                                    disabled={isSwitching}
                                    className="px-4 py-2 rounded-lg bg-card-secondary hover:bg-card-hover text-text-muted hover:text-text-primary border border-border text-xs font-bold transition-all flex items-center gap-1.5"
                                >
                                    {isSwitching ? <RefreshCw size={13} className="animate-spin" /> : <Unlink size={13} />}
                                    Switch back to Standalone
                                </button>
                            </div>
                        </div>
                    )}

                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-border flex items-center justify-between bg-card-secondary/20">
                    <span className="text-[11px] text-text-muted">
                        Changes apply immediately without container reboot.
                    </span>
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 rounded-lg bg-card-secondary hover:bg-card-hover text-text-primary text-xs font-bold border border-border transition-colors"
                    >
                        Close
                    </button>
                </div>

            </div>
        </div>
    );
}
