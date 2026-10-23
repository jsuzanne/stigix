import React, { useState, useEffect, useCallback } from 'react';
import { 
    Link2, Copy, Check, ShieldCheck, Clock, RefreshCw, 
    X, AlertTriangle, Trash2, Globe, Server, CheckCircle2,
    QrCode, Terminal, Sparkles, Sliders, Key, ExternalLink
} from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { StigixSelect } from './common/StigixSelect';

interface MagicJoinModalProps {
    isOpen: boolean;
    onClose: () => void;
    token?: string | null;
}

interface JoinTokenResponse {
    status: string;
    token: string;
    jti: string;
    expires_at: string;
    ttl_seconds: number;
    max_uses: number;
    endpoints: string[];
    realm: string;
    curl_command: string;
}

interface TokenListItem {
    jti: string;
    token_str: string;
    status: 'ACTIVE' | 'REDEEMED' | 'EXPIRED' | 'REVOKED';
    created_at: string;
    expires_at: string;
    uses_count: number;
    max_uses: number;
    payload: {
        site_hint?: string;
        endpoints: string[];
    };
    redeemed_by?: {
        instance_id: string;
        public_ip?: string;
        hostname?: string;
        site_name?: string;
        redeemed_at: string;
    }[];
}

export function MagicJoinModal({ isOpen, onClose, token }: MagicJoinModalProps) {
    const [activeTab, setActiveTab] = useState<'generate' | 'tokens'>('generate');
    const [siteName, setSiteName] = useState('');
    const [ttlSeconds, setTtlSeconds] = useState<number>(3600);
    const [maxUses, setMaxUses] = useState<number>(10);
    const [joinData, setJoinData] = useState<JoinTokenResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copiedCommand, setCopiedCommand] = useState(false);
    const [copiedToken, setCopiedToken] = useState(false);
    const [copiedUrl, setCopiedUrl] = useState(false);
    
    // Tokens list
    const [tokensList, setTokensList] = useState<TokenListItem[]>([]);
    const [loadingTokens, setLoadingTokens] = useState(false);
    const [revokingJti, setRevokingJti] = useState<string | null>(null);

    const [selectedEndpoints, setSelectedEndpoints] = useState<string[]>([]);
    const [allDetectedEndpoints, setAllDetectedEndpoints] = useState<string[]>([]);

    const authHeaders = useCallback((): Record<string, string> => {
        const t = token || (typeof window !== 'undefined' ? localStorage.getItem('token') : null);
        return t ? { Authorization: `Bearer ${t}` } : {};
    }, [token]);

    const generateToken = useCallback(async (customEndpoints?: string[], overrideMaxUses?: number, overrideTtl?: number) => {
        try {
            setLoading(true);
            setError(null);
            const params = new URLSearchParams();
            const effectiveMaxUses = overrideMaxUses ?? maxUses;
            params.set('ttl_seconds', (overrideTtl ?? ttlSeconds).toString());
            params.set('max_uses', effectiveMaxUses.toString());
            if (siteName.trim() && effectiveMaxUses <= 1) params.set('site_name', siteName.trim());

            const epsToUse = customEndpoints || selectedEndpoints;
            if (epsToUse && epsToUse.length > 0) {
                params.set('endpoints', epsToUse.join(','));
            }

            const res = await fetch(`/api/fleet/join-token?${params.toString()}`, {
                headers: authHeaders()
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.message || `Failed to generate token (HTTP ${res.status})`);
            }

            const data: any = await res.json();
            setJoinData(data);
            if (data.detected_endpoints && Array.isArray(data.detected_endpoints)) {
                setAllDetectedEndpoints(data.detected_endpoints);
                if (selectedEndpoints.length === 0) {
                    setSelectedEndpoints(data.endpoints || data.detected_endpoints);
                }
            }
        } catch (err: any) {
            setError(err.message || 'Error generating Magic Join token');
        } finally {
            setLoading(false);
        }
    }, [authHeaders, ttlSeconds, maxUses, siteName, selectedEndpoints]);

    const toggleEndpoint = (ep: string) => {
        let updated: string[];
        if (selectedEndpoints.includes(ep)) {
            if (selectedEndpoints.length <= 1) return; // keep at least one
            updated = selectedEndpoints.filter(e => e !== ep);
        } else {
            updated = [...selectedEndpoints, ep];
        }
        setSelectedEndpoints(updated);
        generateToken(updated);
    };

    const fetchTokensList = useCallback(async () => {
        try {
            setLoadingTokens(true);
            const res = await fetch('/api/fleet/join-tokens', {
                headers: authHeaders()
            });
            if (res.ok) {
                const data = await res.json();
                setTokensList(data.tokens || []);
            }
        } catch {} finally {
            setLoadingTokens(false);
        }
    }, [authHeaders]);

    const handleRevokeToken = async (jti: string) => {
        try {
            setRevokingJti(jti);
            const res = await fetch(`/api/fleet/join-tokens/${jti}`, {
                method: 'DELETE',
                headers: authHeaders()
            });
            if (res.ok) {
                fetchTokensList();
                if (joinData && joinData.jti === jti) {
                    setJoinData(null);
                }
            }
        } catch {} finally {
            setRevokingJti(null);
        }
    };

    const copyToClipboard = async (text: string): Promise<boolean> => {
        let success = false;
        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(text);
                success = true;
            } catch {}
        }
        if (!success) {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                success = document.execCommand('copy');
                document.body.removeChild(ta);
            } catch {}
        }
        return success;
    };

    const handleCopyCommand = async (e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        if (!joinData?.curl_command) return;
        await copyToClipboard(joinData.curl_command);
        setCopiedCommand(true);
        setTimeout(() => setCopiedCommand(false), 2500);
    };

    const handleCopyToken = async (customToken?: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        const t = customToken || joinData?.token;
        if (!t) return;
        await copyToClipboard(t);
        setCopiedToken(true);
        setTimeout(() => setCopiedToken(false), 2500);
    };

    const handleCopyUrl = async (customUrl?: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        const u = customUrl || (selectedEndpoints[0] || (joinData?.endpoints && joinData.endpoints[0]) || (typeof window !== 'undefined' ? window.location.origin : ''));
        if (!u) return;
        await copyToClipboard(u);
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2500);
    };

    useEffect(() => {
        if (isOpen && !joinData) {
            generateToken();
        }
        if (isOpen && activeTab === 'tokens') {
            fetchTokensList();
        }
    }, [isOpen, activeTab, generateToken, fetchTokensList, joinData]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
            <div className="relative w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="px-6 py-4 border-b border-border bg-card-secondary/80 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 shadow-inner">
                            <Sparkles size={20} className="text-blue-400 animate-pulse" />
                        </div>
                        <div>
                            <h2 className="text-base font-black text-text-primary flex items-center gap-2">
                                Stigix « Magic Join »
                                <span className="text-[10px] px-2 py-0.5 rounded-full font-extrabold uppercase bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                    Zero-Touch Onboarding
                                </span>
                            </h2>
                            <p className="text-xs text-text-muted mt-0.5">
                                Generate a cryptographic single-use token to onboard any local or cloud node in seconds.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-card-hover transition-all"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-border bg-card px-6 pt-2">
                    <button
                        onClick={() => setActiveTab('generate')}
                        className={twMerge(
                            "px-4 py-2.5 text-xs font-bold transition-all border-b-2 flex items-center gap-2",
                            activeTab === 'generate'
                                ? "border-blue-500 text-blue-400 bg-blue-500/5"
                                : "border-transparent text-text-muted hover:text-text-primary"
                        )}
                    >
                        <Terminal size={14} />
                        <span>Quick Onboard Command</span>
                    </button>
                    <button
                        onClick={() => {
                            setActiveTab('tokens');
                            fetchTokensList();
                        }}
                        className={twMerge(
                            "px-4 py-2.5 text-xs font-bold transition-all border-b-2 flex items-center gap-2",
                            activeTab === 'tokens'
                                ? "border-blue-500 text-blue-400 bg-blue-500/5"
                                : "border-transparent text-text-muted hover:text-text-primary"
                        )}
                    >
                        <ShieldCheck size={14} />
                        <span>Active Tokens & History</span>
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto flex-1 space-y-5">
                    {activeTab === 'generate' ? (
                        <>
                            {/* Optional Node Customization */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-text-secondary mb-1">
                                        Site Name / Hint (Optional)
                                    </label>
                                    <input
                                        type="text"
                                        placeholder={maxUses > 1 ? "Auto-preserved per node (Multi-Use)" : "e.g. Paris-Branch"}
                                        value={maxUses > 1 ? "" : siteName}
                                        onChange={(e) => setSiteName(e.target.value)}
                                        disabled={maxUses > 1}
                                        title={maxUses > 1 ? "Site Name is ignored in Multi-Use mode so each joining node preserves its own identity" : "Optional site name hint for fresh 1-use installations"}
                                        autoComplete="off"
                                        autoCapitalize="none"
                                        autoCorrect="off"
                                        spellCheck={false}
                                        data-lpignore="true"
                                        data-1p-ignore="true"
                                        className={`w-full bg-card-secondary border border-border rounded-xl px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 ${maxUses > 1 ? "opacity-50 cursor-not-allowed" : ""}`}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-text-secondary mb-1">
                                        Max Uses (Fleet Size)
                                    </label>
                                    <StigixSelect
                                        value={String(maxUses)}
                                        onChange={(val) => {
                                            const next = Number(val);
                                            setMaxUses(next);
                                            generateToken(undefined, next, undefined);
                                        }}
                                        size="sm"
                                        accent="blue"
                                        options={[
                                            { value: '1', label: '1 Node (Single-Use)', badge: '1x' },
                                            { value: '10', label: '10 Nodes (Multi-Use)', badge: '10x' },
                                            { value: '50', label: '50 Nodes (Full Fleet)', badge: '50x' },
                                            { value: '999', label: 'Unlimited (Within TTL)', badge: '∞' },
                                        ]}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-text-secondary mb-1">
                                        Token Validity (TTL)
                                    </label>
                                    <StigixSelect
                                        value={String(ttlSeconds)}
                                        onChange={(val) => {
                                            const next = Number(val);
                                            setTtlSeconds(next);
                                            generateToken(undefined, undefined, next);
                                        }}
                                        size="sm"
                                        accent="blue"
                                        options={[
                                            { value: '1800', label: '30 Minutes', badge: '30m' },
                                            { value: '3600', label: '1 Hour', badge: '1h' },
                                            { value: '21600', label: '6 Hours', badge: '6h' },
                                            { value: '86400', label: '24 Hours', badge: '24h' },
                                        ]}
                                    />
                                </div>
                            </div>

                            {/* Generate Trigger Button */}
                            <div className="flex justify-end">
                                <button
                                    onClick={() => generateToken()}
                                    disabled={loading}
                                    className="flex items-center gap-1.5 bg-card-secondary hover:bg-card-hover border border-border px-3 py-1.5 rounded-xl text-xs font-bold text-text-primary transition-all shadow-sm disabled:opacity-50"
                                >
                                    <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
                                    <span>Regenerate Token</span>
                                </button>
                            </div>

                            {/* Error Banner */}
                            {error && (
                                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs flex items-center gap-2">
                                    <AlertTriangle size={16} className="shrink-0" />
                                    <span>{error}</span>
                                </div>
                            )}

                            {/* Command & Token Boxes */}
                            {joinData && (
                                <div className="space-y-4">
                                    {/* Option A: Fresh Host Command */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between text-xs font-bold text-text-secondary">
                                            <span className="flex items-center gap-1.5">
                                                <Terminal size={14} className="text-blue-400" />
                                                Option A: Fresh Host (1-Line Remote Installer)
                                            </span>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={handleCopyCommand}
                                                    className={twMerge(
                                                        "px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border shadow-sm cursor-pointer",
                                                        copiedCommand
                                                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-semibold"
                                                            : "bg-card-secondary hover:bg-neutral-800 text-text-secondary hover:text-text-primary border-border/80 hover:border-border"
                                                    )}
                                                    title="Copy full curl install command"
                                                >
                                                    {copiedCommand ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} className="text-text-muted" />}
                                                    <span>{copiedCommand ? 'Command Copied !' : 'Copy Command'}</span>
                                                </button>
                                                <span className="text-[11px] text-amber-400 font-mono flex items-center gap-1 bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20">
                                                    <Clock size={11} />
                                                    Expires {new Date(joinData.expires_at).toLocaleTimeString()}
                                                </span>
                                            </div>
                                        </div>

                                        <div
                                            onClick={handleCopyCommand}
                                            title="Click anywhere to copy install command"
                                            className="group relative bg-neutral-950 border border-border/80 rounded-xl p-3.5 shadow-inner cursor-pointer hover:border-blue-500/40 transition-colors"
                                        >
                                            <pre className="text-xs font-mono text-emerald-400 whitespace-pre-wrap break-all select-all">
                                                {joinData.curl_command}
                                            </pre>
                                        </div>
                                    </div>

                                    {/* Option B: Join Token for Existing Peers / Dashboard / CLI */}
                                    <div className="bg-card-secondary/60 border border-border/80 rounded-xl p-3.5 space-y-2.5">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                                                <Key size={14} className="text-blue-400" />
                                                Option B: Existing Peer (Token / Dashboard Join)
                                            </span>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={(e) => handleCopyUrl(undefined, e)}
                                                    className={twMerge(
                                                        "px-2 py-1 rounded-lg text-[11px] font-medium transition-all flex items-center gap-1.5 border shadow-sm cursor-pointer",
                                                        copiedUrl
                                                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-semibold"
                                                            : "bg-card hover:bg-neutral-800 text-text-secondary hover:text-text-primary border-border"
                                                    )}
                                                    title="Copy Controller Endpoint URL"
                                                >
                                                    {copiedUrl ? <Check size={11} className="text-emerald-400" /> : <Globe size={11} className="text-text-muted" />}
                                                    <span>{copiedUrl ? 'URL Copied !' : 'Copy Leader URL'}</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => handleCopyToken(undefined, e)}
                                                    className={twMerge(
                                                        "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 border shadow-sm cursor-pointer",
                                                        copiedToken
                                                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                                            : "bg-blue-600 hover:bg-blue-500 text-white border-blue-500"
                                                    )}
                                                    title="Copy raw STX- join token"
                                                >
                                                    {copiedToken ? <Check size={12} className="text-emerald-300" /> : <Copy size={12} />}
                                                    <span>{copiedToken ? 'Token Copied !' : 'Copy Token'}</span>
                                                </button>
                                            </div>
                                        </div>

                                        {/* Token display box */}
                                        <div
                                            onClick={(e) => handleCopyToken(undefined, e)}
                                            title="Click to copy raw token"
                                            className="group relative bg-neutral-950 border border-border/70 hover:border-blue-500/50 rounded-lg p-2.5 cursor-pointer transition-colors flex items-center justify-between gap-2"
                                        >
                                            <div className="text-xs font-mono text-blue-300/90 truncate select-all flex-1">
                                                {joinData.token}
                                            </div>
                                            <span className="text-[10px] text-text-muted group-hover:text-blue-400 font-sans transition-colors shrink-0">
                                                {copiedToken ? 'Copied!' : 'Click to copy'}
                                            </span>
                                        </div>

                                        <p className="text-[11px] text-text-muted leading-relaxed">
                                            💡 <strong>Peer already deployed?</strong> Go to your peer dashboard under <span className="text-text-primary font-mono font-semibold">Settings &gt; Target Controller</span>, paste this token and click <span className="text-blue-400 font-bold">JOIN</span>. Or run <code className="text-text-secondary bg-neutral-900 px-1 py-0.5 rounded border border-border/40 font-mono">stigix-cli join &lt;token&gt;</code>.
                                        </p>
                                    </div>

                                    {/* Security & Endpoints Metadata */}
                                    <div className="p-3.5 bg-card-secondary/40 border border-border/70 rounded-xl space-y-2 text-xs">
                                        <div className="flex items-center justify-between text-[11px] text-text-muted">
                                            <span className="flex items-center gap-1.5 font-bold text-text-secondary">
                                                <ShieldCheck size={13} className="text-emerald-400" />
                                                {(joinData.max_uses || maxUses) > 1 ? 'Multi-Node Token Security:' : 'Single-Use Security:'}
                                            </span>
                                            <span className="font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                                {(joinData.max_uses || maxUses) >= 999
                                                    ? 'Multi-Use (Unlimited within TTL)'
                                                    : (joinData.max_uses || maxUses) > 1
                                                    ? `Multi-Use (${joinData.max_uses || maxUses} nodes max)`
                                                    : 'Burn-on-Redeem (1 use max)'}
                                            </span>
                                        </div>

                                        <div className="text-[11px] text-text-muted space-y-1.5">
                                            <div className="flex items-center justify-between">
                                                <span className="font-bold text-text-secondary">
                                                    Target Leader Endpoints (Click to toggle):
                                                </span>
                                                <span className="text-[10px] text-text-muted">
                                                    {selectedEndpoints.length} of {(allDetectedEndpoints.length > 0 ? allDetectedEndpoints : joinData.endpoints).length} included
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap gap-2 pt-0.5">
                                                {(allDetectedEndpoints.length > 0 ? allDetectedEndpoints : joinData.endpoints).map((ep, idx) => {
                                                    const isSelected = selectedEndpoints.includes(ep);
                                                    const isFirst = idx === 0;
                                                    return (
                                                        <button
                                                            key={idx}
                                                            type="button"
                                                            onClick={() => toggleEndpoint(ep)}
                                                            className={twMerge(
                                                                "flex items-center gap-1.5 font-mono text-[11px] px-2.5 py-1 rounded-lg border transition-all cursor-pointer select-none",
                                                                isSelected
                                                                    ? "bg-blue-500/15 border-blue-500/50 text-blue-400 font-semibold shadow-xs"
                                                                    : "bg-card-secondary/40 border-border/80 text-text-muted line-through opacity-50 hover:opacity-90 hover:line-through-none"
                                                            )}
                                                            title={isSelected ? "Click to exclude this IP from the token" : "Click to include this IP in the token"}
                                                        >
                                                            {isSelected ? (
                                                                <CheckCircle2 size={12} className="text-blue-400 shrink-0" />
                                                            ) : (
                                                                <X size={12} className="text-text-muted shrink-0" />
                                                            )}
                                                            <span>{ep}</span>
                                                            {isFirst && isSelected && (
                                                                <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-sans not-italic">
                                                                    Primary
                                                                </span>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            <p className="text-[10px] text-text-muted/80 leading-relaxed pt-1">
                                                💡 <strong>Keep all reachable interfaces selected</strong> to enable automatic multi-path failover and passive WebSocket RTT scoring. Only deselect an IP if you are certain no peer can ever route to it.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        /* Tokens List Tab */
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-text-secondary">
                                    Generated Join Tokens ({tokensList.length})
                                </span>
                                <button
                                    onClick={fetchTokensList}
                                    disabled={loadingTokens}
                                    className="p-1 rounded text-text-muted hover:text-text-primary transition-all"
                                >
                                    <RefreshCw size={13} className={loadingTokens ? "animate-spin" : ""} />
                                </button>
                            </div>

                            {tokensList.length === 0 ? (
                                <div className="p-8 text-center text-xs text-text-muted border border-dashed border-border rounded-xl">
                                    No join tokens generated yet.
                                </div>
                            ) : (
                                <div className="divide-y divide-border border border-border rounded-xl overflow-hidden bg-card-secondary/30">
                                    {tokensList.map((tok) => {
                                        const isExpired = new Date(tok.expires_at).getTime() < Date.now();
                                        return (
                                            <div key={tok.jti} className="p-3.5 flex items-center justify-between gap-3 text-xs">
                                                <div className="space-y-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-mono font-bold text-text-primary">{tok.jti}</span>
                                                        <span className={twMerge(
                                                            "text-[9.5px] px-2 py-0.5 rounded font-extrabold uppercase",
                                                            tok.status === 'ACTIVE' && !isExpired && "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
                                                            tok.status === 'REDEEMED' && "bg-blue-500/20 text-blue-300 border border-blue-500/30",
                                                            (tok.status === 'EXPIRED' || isExpired) && "bg-neutral-500/20 text-neutral-400 border border-neutral-500/30",
                                                            tok.status === 'REVOKED' && "bg-red-500/20 text-red-300 border border-red-500/30"
                                                        )}>
                                                            {isExpired && tok.status === 'ACTIVE' ? 'EXPIRED' : tok.status}
                                                        </span>
                                                        {tok.payload?.site_hint && (
                                                            <span className="text-[10px] text-text-muted font-mono">
                                                                Site: {tok.payload.site_hint}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-[10.5px] text-text-muted font-mono">
                                                        Created: {new Date(tok.created_at).toLocaleString()} • Expires: {new Date(tok.expires_at).toLocaleString()}
                                                    </div>
                                                    {tok.redeemed_by && tok.redeemed_by.length > 0 && (
                                                        <div className="text-[10.5px] text-blue-400 font-mono flex items-center gap-1">
                                                            <CheckCircle2 size={11} />
                                                            Enrolled Node: {tok.redeemed_by[0].instance_id} ({tok.redeemed_by[0].public_ip || 'LAN'})
                                                        </div>
                                                    )}
                                                </div>

                                                {tok.status === 'ACTIVE' && !isExpired && (
                                                    <div className="flex items-center gap-1.5">
                                                        {tok.token_str && (
                                                            <button
                                                                onClick={(e) => handleCopyToken(tok.token_str, e)}
                                                                className="px-2.5 py-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                                                                title="Copy raw token string"
                                                            >
                                                                <Key size={12} />
                                                                <span>Copy Token</span>
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => handleRevokeToken(tok.jti)}
                                                            disabled={revokingJti === tok.jti}
                                                            className="px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-bold transition-all flex items-center gap-1"
                                                            title="Revoke this token immediately"
                                                        >
                                                            <Trash2 size={12} />
                                                            <span>Revoke</span>
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-border bg-card-secondary/80 flex items-center justify-between text-xs text-text-muted">
                    <span className="flex items-center gap-1.5">
                        <Globe size={13} className="text-blue-400" />
                        Universal Zero-Touch Mesh Protocol (PRD v2.4)
                    </span>
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 bg-card hover:bg-card-hover border border-border text-text-primary rounded-xl font-bold transition-all shadow-sm"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
