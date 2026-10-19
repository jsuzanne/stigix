import React, { useState, useEffect, useMemo } from 'react';
import {
    ShieldAlert,
    ShieldX,
    ShieldCheck,
    X,
    Plus,
    Trash2,
    RotateCcw,
    Loader2,
    AlertCircle,
    CheckCircle2,
    Server,
    Zap,
    ArrowRight,
    Search
} from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { clsx } from 'clsx';

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

export interface DiscoveredSiteTarget {
    siteName: string;
    ip: string;
    ipCidr?: string;
    network?: string;
    interfaceName?: string;
}

export interface BlockedRoute {
    prefix: string;
    description?: string;
}

interface VyosTrafficControlModalProps {
    isOpen: boolean;
    onClose: () => void;
    router: {
        id: string;
        name: string;
        host: string;
        status?: string;
        blackholeBlocks?: BlockedRoute[];
    } | null;
    discoveredSites?: DiscoveredSiteTarget[];
    onExecuteAction: (
        routerName: string,
        command: 'deny-traffic' | 'allow-traffic' | 'clear-all-blocks',
        params?: any
    ) => Promise<{ success: boolean; durationMs?: number; error?: string }>;
    isExecuting?: boolean;
}

export const VyosTrafficControlModal: React.FC<VyosTrafficControlModalProps> = ({
    isOpen,
    onClose,
    router,
    discoveredSites = [],
    onExecuteAction,
    isExecuting = false
}) => {
    const [ipInput, setIpInput] = useState('');
    const [filterQuery, setFilterQuery] = useState('');
    const [actionFeedback, setActionFeedback] = useState<{
        type: 'success' | 'error';
        message: string;
        durationMs?: number;
    } | null>(null);
    const [confirmClearAll, setConfirmClearAll] = useState(false);
    const [localExecutingAction, setLocalExecutingAction] = useState<string | null>(null);

    // Reset local state when opened or router changes
    useEffect(() => {
        if (isOpen) {
            setIpInput('');
            setFilterQuery('');
            setActionFeedback(null);
            setConfirmClearAll(false);
            setLocalExecutingAction(null);
        }
    }, [isOpen, router?.id]);

    // Close on Escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const activeBlocks: BlockedRoute[] = useMemo(() => {
        return router?.blackholeBlocks || [];
    }, [router?.blackholeBlocks]);

    // Map blocked prefix to matching discovered site if available
    const getMatchingSite = (prefix: string) => {
        const cleanPrefix = prefix.replace(/\/32$/, '');
        return discoveredSites.find(s => {
            const cleanIp = s.ip.replace(/\/32$/, '');
            if (cleanIp === cleanPrefix) return true;
            if (s.network && s.network === prefix) return true;
            if (s.ipCidr && s.ipCidr === prefix) return true;
            return false;
        });
    };

    const filteredBlocks = useMemo(() => {
        if (!filterQuery.trim()) return activeBlocks;
        const q = filterQuery.toLowerCase();
        return activeBlocks.filter(b => {
            const matchSite = getMatchingSite(b.prefix);
            return (
                b.prefix.toLowerCase().includes(q) ||
                (b.description && b.description.toLowerCase().includes(q)) ||
                (matchSite && matchSite.siteName.toLowerCase().includes(q))
            );
        });
    }, [activeBlocks, filterQuery, discoveredSites]);

    if (!isOpen || !router) return null;

    const handleDeny = async (targetIp?: string) => {
        const candidate = (targetIp || ipInput).trim();
        if (!candidate) {
            setActionFeedback({ type: 'error', message: 'Please specify an IP address or CIDR prefix' });
            return;
        }

        setLocalExecutingAction(`deny:${candidate}`);
        setActionFeedback(null);

        try {
            const res = await onExecuteAction(router.name, 'deny-traffic', { ip: candidate });
            if (res.success) {
                setActionFeedback({
                    type: 'success',
                    message: `Blocked traffic for ${candidate} on ${router.name}`,
                    durationMs: res.durationMs
                });
                setIpInput('');
            } else {
                setActionFeedback({
                    type: 'error',
                    message: res.error || 'Failed to apply traffic deny rule'
                });
            }
        } catch (err: any) {
            setActionFeedback({ type: 'error', message: err.message || 'Error executing action' });
        } finally {
            setLocalExecutingAction(null);
        }
    };

    const handleAllow = async (prefix: string) => {
        setLocalExecutingAction(`allow:${prefix}`);
        setActionFeedback(null);

        try {
            const res = await onExecuteAction(router.name, 'allow-traffic', { ip: prefix });
            if (res.success) {
                setActionFeedback({
                    type: 'success',
                    message: `Unblocked ${prefix} on ${router.name}`,
                    durationMs: res.durationMs
                });
            } else {
                setActionFeedback({
                    type: 'error',
                    message: res.error || `Failed to unblock ${prefix}`
                });
            }
        } catch (err: any) {
            setActionFeedback({ type: 'error', message: err.message || 'Error executing action' });
        } finally {
            setLocalExecutingAction(null);
        }
    };

    const handleClearAll = async () => {
        if (!confirmClearAll) {
            setConfirmClearAll(true);
            return;
        }

        setLocalExecutingAction('clear-all');
        setActionFeedback(null);
        setConfirmClearAll(false);

        try {
            const res = await onExecuteAction(router.name, 'clear-all-blocks', {});
            if (res.success) {
                setActionFeedback({
                    type: 'success',
                    message: `All traffic blocks cleared on ${router.name}`,
                    durationMs: res.durationMs
                });
            } else {
                setActionFeedback({
                    type: 'error',
                    message: res.error || 'Failed to clear blocks'
                });
            }
        } catch (err: any) {
            setActionFeedback({ type: 'error', message: err.message || 'Error executing action' });
        } finally {
            setLocalExecutingAction(null);
        }
    };

    const isGlobalBusy = isExecuting || localExecutingAction !== null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-md animate-fadeIn">
            {/* Modal Box */}
            <div
                className="relative w-full max-w-2xl bg-card border border-border/80 shadow-2xl rounded-3xl overflow-hidden flex flex-col max-h-[90vh] transition-all"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-5 sm:p-6 border-b border-border/60 bg-card-secondary/40 flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-500/20 to-rose-500/20 border border-amber-500/40 flex items-center justify-center text-amber-500 dark:text-amber-400 shadow-sm">
                            <ShieldX size={22} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-base sm:text-lg font-black text-text-primary tracking-tight">
                                    VyOS Underlay Traffic Control
                                </h3>
                            </div>
                            <p className="text-xs text-text-muted mt-0.5 font-mono">
                                Router: <span className="text-text-primary font-bold">{router.name}</span> ({router.host})
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isGlobalBusy}
                        className="w-9 h-9 rounded-xl bg-card-secondary hover:bg-card-hover border border-border text-text-muted hover:text-text-primary flex items-center justify-center transition-all cursor-pointer disabled:opacity-50"
                        title="Close modal (Esc)"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Body - Scrollable */}
                <div className="p-5 sm:p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar">

                    {/* Feedback Banner */}
                    {actionFeedback && (
                        <div
                            className={cn(
                                "p-3.5 rounded-2xl text-xs font-mono flex items-center justify-between border animate-fadeIn",
                                actionFeedback.type === 'success'
                                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                                    : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30"
                            )}
                        >
                            <div className="flex items-center gap-2">
                                {actionFeedback.type === 'success' ? (
                                    <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                                ) : (
                                    <AlertCircle size={16} className="text-rose-500 shrink-0" />
                                )}
                                <span className="font-medium">{actionFeedback.message}</span>
                            </div>
                            {actionFeedback.durationMs !== undefined && (
                                <span className="text-[10px] px-2 py-0.5 rounded bg-card/80 border border-border font-bold">
                                    {actionFeedback.durationMs}ms
                                </span>
                            )}
                        </div>
                    )}

                    {/* Progress Bar when executing */}
                    {isGlobalBusy && (
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 space-y-2 animate-fadeIn">
                            <div className="flex items-center justify-between text-xs font-mono">
                                <span className="flex items-center gap-2 font-bold text-amber-700 dark:text-amber-300">
                                    <Loader2 size={14} className="animate-spin text-amber-500" />
                                    Executing VyOS firewall action via API...
                                </span>
                                <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold">~2-4s</span>
                            </div>
                            <div className="h-1.5 w-full bg-amber-500/20 rounded-full overflow-hidden relative">
                                <div className="h-full bg-amber-500 rounded-full animate-laser w-3/4" />
                            </div>
                        </div>
                    )}

                    {/* Section 1: Top Status & Quick Clear Strip */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Router Info Card */}
                        <div className="p-3.5 rounded-2xl bg-card-secondary/50 border border-border flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <div className="p-2 rounded-xl bg-card text-text-primary border border-border/60">
                                    <Server size={16} />
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase font-black text-text-muted tracking-wider">
                                        VyOS Router
                                    </div>
                                    <div className="text-xs font-bold text-text-primary mt-0.5 flex items-center gap-1.5">
                                        <span>{router.name}</span>
                                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                                    </div>
                                </div>
                            </div>
                            <span className="text-[10px] font-mono px-2 py-1 rounded-lg bg-card text-text-muted border border-border">
                                {router.host}
                            </span>
                        </div>

                        {/* Active Impairment Card */}
                        <div className="p-3.5 rounded-2xl bg-card-secondary/50 border border-border flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <div className={cn(
                                    "p-2 rounded-xl border",
                                    activeBlocks.length > 0
                                        ? "bg-rose-500/15 text-rose-500 border-rose-500/30"
                                        : "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
                                )}>
                                    {activeBlocks.length > 0 ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />}
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase font-black text-text-muted tracking-wider">
                                        Active Blackhole Blocks
                                    </div>
                                    <div className="text-xs font-black text-text-primary mt-0.5">
                                        {activeBlocks.length} Blocked Route{activeBlocks.length !== 1 ? 's' : ''}
                                    </div>
                                </div>
                            </div>

                            {activeBlocks.length > 0 && (
                                <button
                                    type="button"
                                    onClick={handleClearAll}
                                    disabled={isGlobalBusy}
                                    className={cn(
                                        "px-2.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all border cursor-pointer disabled:opacity-50",
                                        confirmClearAll
                                            ? "bg-rose-600 text-white border-rose-700 animate-pulse"
                                            : "bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-500/30"
                                    )}
                                    title="Remove all blackhole routes from VyOS"
                                >
                                    <Trash2 size={12} />
                                    <span>{confirmClearAll ? 'Confirm Clear?' : 'Clear All'}</span>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Section 2: Inject New Traffic Deny Rule */}
                    <div className="p-4 sm:p-5 rounded-2xl bg-card-secondary/40 border border-amber-500/30 space-y-3.5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-black uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                                <Zap size={14} className="fill-amber-500" /> Block Traffic (Deny Route)
                            </span>
                            <span className="text-[10px] text-text-muted">
                                Injects static blackhole route on VyOS
                            </span>
                        </div>

                        {/* Input Row */}
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                            <div className="relative flex-1">
                                <input
                                    type="text"
                                    value={ipInput}
                                    onChange={e => setIpInput(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && ipInput.trim() && !isGlobalBusy) {
                                            handleDeny();
                                        }
                                    }}
                                    placeholder="Enter IP or CIDR (e.g. 192.168.203.10 or 192.168.101.0/24)"
                                    disabled={isGlobalBusy}
                                    className="w-full h-10 px-3.5 rounded-xl bg-card border border-border text-text-primary text-xs font-mono placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 transition-all disabled:opacity-60"
                                />
                            </div>

                            <button
                                type="button"
                                onClick={() => handleDeny()}
                                disabled={isGlobalBusy || !ipInput.trim()}
                                className="h-10 px-4 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm shadow-rose-900/30 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                            >
                                {localExecutingAction?.startsWith('deny:') ? (
                                    <Loader2 size={14} className="animate-spin" />
                                ) : (
                                    <ShieldX size={14} />
                                )}
                                <span>Deny Traffic</span>
                            </button>
                        </div>
                    </div>

                    {/* Section 3: Active Denied Traffic Table */}
                    <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <h4 className="text-xs font-black uppercase tracking-wider text-text-primary">
                                    Active Blocked Rules ({activeBlocks.length})
                                </h4>
                                {activeBlocks.length > 0 && (
                                    <span className="px-2 py-0.5 rounded-md text-[9px] font-mono font-bold bg-rose-500/15 text-rose-500 border border-rose-500/30">
                                        Drop Policy Active
                                    </span>
                                )}
                            </div>

                            {activeBlocks.length > 3 && (
                                <div className="relative">
                                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                                    <input
                                        type="text"
                                        value={filterQuery}
                                        onChange={e => setFilterQuery(e.target.value)}
                                        placeholder="Filter rules..."
                                        className="h-7 pl-7 pr-2.5 rounded-lg bg-card-secondary border border-border text-[11px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-1 focus:ring-amber-500"
                                    />
                                </div>
                            )}
                        </div>

                        {/* List / Empty State */}
                        {activeBlocks.length === 0 ? (
                            <div className="p-8 rounded-2xl bg-card-secondary/30 border border-border/60 text-center space-y-2">
                                <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center mx-auto">
                                    <ShieldCheck size={20} />
                                </div>
                                <div className="text-xs font-bold text-text-primary">
                                    No Active Traffic Blocks
                                </div>
                                <p className="text-[11px] text-text-muted max-w-sm mx-auto">
                                    All packets flow normally through this VyOS underlay router. Use the form above to inject a simulated blackout on any site IP.
                                </p>
                            </div>
                        ) : filteredBlocks.length === 0 ? (
                            <div className="p-6 rounded-2xl bg-card-secondary/30 border border-border/60 text-center text-xs text-text-muted">
                                No blocked rules match "{filterQuery}"
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {filteredBlocks.map((block, idx) => {
                                    const matchSite = getMatchingSite(block.prefix);
                                    const isRowBusy = localExecutingAction === `allow:${block.prefix}`;

                                    return (
                                        <div
                                            key={`${block.prefix}-${idx}`}
                                            className="p-3.5 rounded-2xl bg-card border border-rose-500/30 hover:border-rose-500/50 flex items-center justify-between gap-3 transition-all shadow-sm group"
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-8 h-8 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-500 flex items-center justify-center shrink-0">
                                                    <ShieldX size={15} />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-xs font-mono font-black text-text-primary tracking-tight">
                                                            {block.prefix}
                                                        </span>
                                                        {matchSite && (
                                                            <span className="px-2 py-0.5 rounded-md text-[9.5px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 truncate">
                                                                Site: {matchSite.siteName}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {block.description && (
                                                        <p className="text-[10px] text-text-muted font-mono mt-0.5 truncate">
                                                            {block.description}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Unblock (Allow) Button */}
                                            <button
                                                type="button"
                                                onClick={() => handleAllow(block.prefix)}
                                                disabled={isGlobalBusy}
                                                className="px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-black text-[10px] uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 shrink-0 shadow-sm"
                                                title={`Remove blackhole route for ${block.prefix}`}
                                            >
                                                {isRowBusy ? (
                                                    <Loader2 size={12} className="animate-spin text-emerald-500" />
                                                ) : (
                                                    <ShieldCheck size={12} />
                                                )}
                                                <span>{isRowBusy ? 'Unblocking...' : 'Allow Traffic'}</span>
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 sm:p-5 border-t border-border/60 bg-card-secondary/30 flex items-center justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isGlobalBusy}
                        className="px-4 py-2 rounded-xl bg-card hover:bg-card-hover border border-border text-xs font-bold text-text-primary transition-all cursor-pointer disabled:opacity-50 shadow-sm"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};
