import React, { useState } from 'react';
import { 
    X, Check, AlertTriangle, Globe, Server, 
    Sparkles, ArrowRight, RefreshCw, Unlink, 
    Radio, Shield, Terminal, Zap, CheckCircle2
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

    if (!isOpen) return null;

    const isLeader = registryStatus?.mode === 'leader' || registryStatus?.current_mode === 'leader';
    const isEnrolledPeer = !isLeader && Boolean(registryStatus?.is_cluster_enrolled || registryStatus?.static_leader_url);
    const isStandalone = !isLeader && !isEnrolledPeer;

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

    const handleSaveManualLeader = async () => {
        const trimmed = manualLeaderUrl.trim();
        if (!trimmed) return;
        setIsJoining(true);
        setError(null);
        setSuccessMsg(null);
        try {
            const res = await fetch('/api/registry/static-leader', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ url: trimmed })
            });
            if (res.ok) {
                setSuccessMsg(`Static Leader configured (${trimmed})!`);
                setManualLeaderUrl('');
                await onRefreshStatus();
                setTimeout(() => {
                    onClose();
                }, 1400);
            } else {
                const d = await res.json().catch(() => ({}));
                setError(d.message || d.error || 'Failed to configure static Leader URL');
            }
        } catch (e: any) {
            setError(e.message || String(e));
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
                                {isEnrolledPeer && `This node is enrolled as a managed Spoke Peer connected to Leader: ${registryStatus?.enrolled_leader_url || registryStatus?.static_leader_url || 'Cluster Leader'}.`}
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
                                                    onClick={handleSaveManualLeader}
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
                                <div className="text-xs font-bold text-text-secondary uppercase tracking-wider">
                                    Enrolled Cluster Information
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                                    <div className="p-2.5 rounded-lg bg-card border border-border/60">
                                        <span className="text-[10px] text-text-muted block font-sans uppercase">Controller URL</span>
                                        <span className="text-text-primary font-bold">{registryStatus?.enrolled_leader_url || registryStatus?.static_leader_url || '—'}</span>
                                    </div>
                                    <div className="p-2.5 rounded-lg bg-card border border-border/60">
                                        <span className="text-[10px] text-text-muted block font-sans uppercase">Token Prefix</span>
                                        <span className="text-text-primary">{registryStatus?.enrolled_token_prefix || 'Active Session'}</span>
                                    </div>
                                </div>

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
