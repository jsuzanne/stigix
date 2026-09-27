/**
 * PeerContext — Fleet Gateway Context Switcher (M2)
 *
 * Provides a global React context for the active Stigix Target peer.
 * When `activePeerId` is null, the dashboard operates in local (Leader) mode.
 * When set to a peer instance_id, all API calls are routed through the
 * Leader BFF Gateway (/api/gateway/:peerId/*) — see M3.
 */

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Globe, X, ChevronDown, Network } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PeerEntry {
    instance_id: string;
    site?: string;
    ip_private?: string;
    status: 'online' | 'offline';
    is_leader: boolean;
    meta?: { site?: string; region?: string };
    summary?: { probes_global_health?: number; traffic_state?: string };
}

interface PeerContextValue {
    activePeerId: string | null;       // null = local (Leader)
    activePeer: PeerEntry | null;
    peers: PeerEntry[];
    setActivePeerId: (id: string | null) => void;
    refreshPeers: () => Promise<void>;
    /** Rewrites /api/* paths to /api/gateway/:peerId/* when in remote context. */
    gFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    /** Empty string in local mode, '/api/gateway/:peerId' in remote mode. */
    apiBase: string;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const PeerContext = createContext<PeerContextValue>({
    activePeerId: null,
    activePeer: null,
    peers: [],
    setActivePeerId: () => {},
    refreshPeers: async () => {},
    gFetch: (input, init) => fetch(input, init),
    apiBase: ''
});

export function usePeerContext() {
    return useContext(PeerContext);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

interface PeerContextProviderProps {
    token: string | null;
    isLeader: boolean;
    children: React.ReactNode;
}

export function PeerContextProvider({ token, isLeader, children }: PeerContextProviderProps) {
    const [activePeerId, setActivePeerIdRaw] = useState<string | null>(null);
    const [peers, setPeers] = useState<PeerEntry[]>([]);

    const refreshPeers = useCallback(async () => {
        if (!token || !isLeader) return;
        try {
            const res = await fetch('/api/fleet/overview', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) return;
            const data = await res.json();
            const mapped: PeerEntry[] = (data.instances || []).map((inst: any) => ({
                instance_id: inst.instance_id,
                site: inst.meta?.site || inst.instance_id,
                ip_private: inst.ip_private,
                status: inst.status,
                is_leader: inst.is_leader,
                meta: inst.meta,
                summary: inst.summary
            }));
            setPeers(mapped);
        } catch {}
    }, [token, isLeader]);

    // Auto-refresh peer list every 30 s when Leader
    useEffect(() => {
        if (!isLeader) return;
        refreshPeers();
        const interval = setInterval(refreshPeers, 30_000);
        return () => clearInterval(interval);
    }, [isLeader, refreshPeers]);

    // Reset to local context when Leader status changes
    useEffect(() => {
        if (!isLeader) setActivePeerIdRaw(null);
    }, [isLeader]);

    const setActivePeerId = useCallback((id: string | null) => {
        setActivePeerIdRaw(id);
    }, []);

    const activePeer = peers.find(p => p.instance_id === activePeerId) ?? null;

    // M3 — Gateway-aware fetch wrapper
    // When activePeerId is set, rewrites /api/* → /api/gateway/:peerId/*
    // In local mode (activePeerId = null), behaves exactly like window.fetch.
    const apiBase = activePeerId ? `/api/gateway/${activePeerId}` : '';

    const gFetch = useCallback((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (!activePeerId) {
            return fetch(input, init);
        }
        // Rewrite URL: prepend gateway prefix for /api/* paths
        let url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
        if (url.startsWith('/api/')) {
            url = `/api/gateway/${activePeerId}${url}`;
        }
        // Rebuild input preserving Request properties if needed
        const newInput = typeof input === 'string' || input instanceof URL ? url : new Request(url, input as Request);
        return fetch(newInput, init);
    }, [activePeerId]);

    return (
        <PeerContext.Provider value={{ activePeerId, activePeer, peers, setActivePeerId, refreshPeers, gFetch, apiBase }}>
            {children}
        </PeerContext.Provider>
    );
}

// ─── GatewayDropdown ──────────────────────────────────────────────────────────

/**
 * Dropdown widget placed in the top navbar (Leader only).
 * Shows the active peer context and lets the operator switch to any registered peer.
 */
interface GatewayDropdownProps {
    isLeader: boolean;
}

export function GatewayDropdown({ isLeader }: GatewayDropdownProps) {
    const { activePeerId, activePeer, peers, setActivePeerId } = usePeerContext();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Close when clicking outside
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    if (!isLeader) return null;

    const localPeer = peers.find(p => p.is_leader);
    const localLabel = localPeer?.site || localPeer?.instance_id || 'Local (Leader)';
    const activeLabel = activePeerId
        ? (activePeer?.site || activePeer?.instance_id || activePeerId)
        : localLabel;

    const remotePeers = peers.filter(p => !p.is_leader);
    const isRemote = activePeerId !== null;

    return (
        <div ref={ref} className="relative">
            <button
                id="peer-context-switcher"
                onClick={() => setOpen(o => !o)}
                className={`
                    flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold
                    transition-all shadow-sm select-none
                    ${isRemote
                        ? 'bg-amber-500/10 border-amber-500/40 text-amber-400 hover:bg-amber-500/20'
                        : 'bg-card-secondary border-border text-text-secondary hover:text-text-primary hover:bg-card-hover'
                    }
                `}
                title="Switch active Stigix Target context"
            >
                <Network size={14} className={isRemote ? 'text-amber-400' : 'text-blue-400'} />
                <span className="hidden sm:inline max-w-[120px] truncate">
                    {isRemote ? '\u26a1 ' : ''}{activeLabel}
                </span>
                <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <div
                    id="peer-context-dropdown"
                    className="
                        absolute right-0 top-full mt-2 w-72 rounded-xl border border-border
                        bg-card shadow-2xl z-[200] overflow-hidden
                    "
                >
                    {/* Header */}
                    <div className="px-4 py-2.5 border-b border-border bg-card-secondary">
                        <p className="text-[10px] font-black uppercase tracking-widest text-text-muted flex items-center gap-1.5">
                            <Globe size={11} /> Switch Stigix Target
                        </p>
                    </div>

                    {/* Local Leader */}
                    <div className="px-2 pt-2">
                        <p className="px-2 pb-1 text-[9px] font-black uppercase tracking-widest text-text-muted/60">
                            Local Controller
                        </p>
                        <button
                            onClick={() => { setActivePeerId(null); setOpen(false); }}
                            className={`
                                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm
                                transition-all hover:bg-card-hover
                                ${!activePeerId ? 'bg-blue-600/10 text-blue-400 font-bold' : 'text-text-primary'}
                            `}
                        >
                            <span className="w-2 h-2 rounded-full bg-purple-500 flex-shrink-0" />
                            <span className="flex-1 truncate">{localLabel}</span>
                            {!activePeerId && <span className="text-[9px] font-black text-blue-400 ml-auto">ACTIVE</span>}
                        </button>
                    </div>

                    {/* Remote Peers */}
                    {remotePeers.length > 0 && (
                        <div className="px-2 pb-2 mt-2">
                            <p className="px-2 pb-1 text-[9px] font-black uppercase tracking-widest text-text-muted/60">
                                Remote Sites
                            </p>
                            {remotePeers.map(peer => (
                                <button
                                    key={peer.instance_id}
                                    onClick={() => { setActivePeerId(peer.instance_id); setOpen(false); }}
                                    className={`
                                        w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm
                                        transition-all hover:bg-card-hover
                                        ${peer.instance_id === activePeerId
                                            ? 'bg-amber-500/10 text-amber-400 font-bold'
                                            : 'text-text-primary'
                                        }
                                        ${peer.status === 'offline' ? 'opacity-50' : ''}
                                    `}
                                >
                                    <span className={`
                                        w-2 h-2 rounded-full flex-shrink-0
                                        ${peer.status === 'online' ? 'bg-emerald-500' : 'bg-red-500'}
                                    `} />
                                    <span className="flex-1 truncate">
                                        {peer.site || peer.instance_id}
                                    </span>
                                    <span className="text-[9px] text-text-muted font-mono ml-auto">
                                        {peer.ip_private || ''}
                                    </span>
                                    {peer.instance_id === activePeerId && (
                                        <span className="text-[9px] font-black text-amber-400 ml-1">ACTIVE</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}

                    {remotePeers.length === 0 && (
                        <div className="px-4 py-4 text-center text-text-muted text-xs">
                            No remote peers registered yet.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── RemoteViewBanner ─────────────────────────────────────────────────────────

/**
 * High-visibility banner shown below the navbar when a remote peer is selected.
 * Prevents operator disorientation and provides a one-click exit back to local.
 */
export function RemoteViewBanner() {
    const { activePeerId, activePeer, setActivePeerId } = usePeerContext();

    if (!activePeerId) return null;

    const label = activePeer?.site || activePeerId;
    const ip = activePeer?.ip_private;

    return (
        <div
            id="remote-view-banner"
            className="
                w-full mb-4 px-4 py-2.5 rounded-xl
                bg-amber-500/10 border border-amber-500/30
                flex items-center justify-between gap-4
            "
        >
            <div className="flex items-center gap-2.5 text-amber-400 text-sm font-bold">
                <Globe size={16} className="flex-shrink-0 animate-pulse" />
                <span>
                    Remote View: <strong>{label}</strong>
                    {ip && <span className="text-amber-400/60 font-normal ml-1">— {ip}</span>}
                </span>
                <span className="text-[10px] font-normal text-amber-400/60 border border-amber-500/20 rounded px-2 py-0.5">
                    Connected via Leader Gateway
                </span>
            </div>
            <button
                onClick={() => setActivePeerId(null)}
                title="Exit remote view — return to local Leader"
                className="
                    flex items-center gap-1.5 px-3 py-1 rounded-lg
                    text-xs font-bold text-amber-400
                    border border-amber-500/30
                    hover:bg-amber-500/20 transition-colors
                    flex-shrink-0
                "
            >
                <X size={12} /> Exit to Local
            </button>
        </div>
    );
}
