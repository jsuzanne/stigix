import React, { useState, useEffect, useCallback } from 'react';
import { 
    Link2, Copy, Check, ShieldCheck, Clock, RefreshCw, 
    X, AlertTriangle, Trash2, Globe, Server, CheckCircle2,
    QrCode, Terminal, Sparkles, Sliders
} from 'lucide-react';
import { twMerge } from 'tailwind-merge';

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
    const [joinData, setJoinData] = useState<JoinTokenResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    
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

    const generateToken = useCallback(async (customEndpoints?: string[]) => {
        try {
            setLoading(true);
            setError(null);
            const params = new URLSearchParams();
            params.set('ttl_seconds', ttlSeconds.toString());
            if (siteName.trim()) params.set('site_name', siteName.trim());

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
    }, [authHeaders, ttlSeconds, siteName, selectedEndpoints]);

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

    const handleCopyCommand = () => {
        if (!joinData?.curl_command) return;
        navigator.clipboard.writeText(joinData.curl_command);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
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
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-text-secondary mb-1">
                                        Site Name / Hint (Optional)
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Paris-Branch, Hetzner-VM"
                                        value={siteName}
                                        onChange={(e) => setSiteName(e.target.value)}
                                        autoComplete="off"
                                        autoCapitalize="none"
                                        autoCorrect="off"
                                        spellCheck={false}
                                        data-lpignore="true"
                                        data-1p-ignore="true"
                                        className="w-full bg-card-secondary border border-border rounded-xl px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-text-secondary mb-1">
                                        Token Validity (TTL)
                                    </label>
                                    <select
                                        value={ttlSeconds}
                                        onChange={(e) => setTtlSeconds(Number(e.target.value))}
                                        className="w-full bg-card-secondary border border-border rounded-xl px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    >
                                        <option value={1800}>30 Minutes (Recommended)</option>
                                        <option value={3600}>1 Hour</option>
                                        <option value={21600}>6 Hours</option>
                                        <option value={86400}>24 Hours</option>
                                    </select>
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

                            {/* Command Box */}
                            {joinData && (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between text-xs font-bold text-text-secondary">
                                        <span className="flex items-center gap-1.5">
                                            <Terminal size={14} className="text-blue-400" />
                                            Run this command on your remote Linux / Docker host:
                                        </span>
                                        <span className="text-[11px] text-amber-400 font-mono flex items-center gap-1 bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20">
                                            <Clock size={11} />
                                            Expires {new Date(joinData.expires_at).toLocaleTimeString()}
                                        </span>
                                    </div>

                                    <div className="relative group bg-neutral-950 border border-border/80 rounded-xl p-3.5 shadow-inner">
                                        <pre className="text-xs font-mono text-emerald-400 whitespace-pre-wrap break-all select-all">
                                            {joinData.curl_command}
                                        </pre>
                                        <button
                                            onClick={handleCopyCommand}
                                            className={twMerge(
                                                "absolute top-2.5 right-2.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-md",
                                                copied
                                                    ? "bg-emerald-600 text-white"
                                                    : "bg-blue-600 hover:bg-blue-500 text-white"
                                            )}
                                        >
                                            {copied ? <Check size={13} /> : <Copy size={13} />}
                                            <span>{copied ? 'Copied!' : 'Copy Command'}</span>
                                        </button>
                                    </div>

                                    {/* Security & Endpoints Metadata */}
                                    <div className="p-3.5 bg-card-secondary/40 border border-border/70 rounded-xl space-y-2 text-xs">
                                        <div className="flex items-center justify-between text-[11px] text-text-muted">
                                            <span className="flex items-center gap-1.5 font-bold text-text-secondary">
                                                <ShieldCheck size={13} className="text-emerald-400" />
                                                Single-Use Security:
                                            </span>
                                            <span className="font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                                Burn-on-Redeem (1 use max)
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
                                                    <button
                                                        onClick={() => handleRevokeToken(tok.jti)}
                                                        disabled={revokingJti === tok.jti}
                                                        className="px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-bold transition-all flex items-center gap-1"
                                                        title="Revoke this token immediately"
                                                    >
                                                        <Trash2 size={12} />
                                                        <span>Revoke</span>
                                                    </button>
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
