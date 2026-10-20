import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { usePeerContext } from './PeerContext';
import {
    ReactFlow,
    Controls,
    Background,
    useNodesState,
    useEdgesState,
    addEdge,
    MarkerType,
    type Node,
    type Edge,
    Panel,
    Handle,
    Position,
    getBezierPath,
    EdgeLabelRenderer,
    BaseEdge,
    ReactFlowProvider,
    useReactFlow
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
    Network,
    Cloud,
    Server,
    Home,
    Share2,
    Download,
    FileText,
    RefreshCw,
    X,
    Info,
    Zap,
    CheckCircle,
    AlertCircle,
    ArrowRight,
    Search,
    Filter,
    Check,
    Square,
    CheckSquare,
    ChevronRight,
    LayoutGrid,
    Layers,
    MapPin,
    Router,
    GitBranch,
    ShieldCheck,
    Shield,
    HelpCircle,
    AlertTriangle,
    Table,
    ExternalLink,
    Eye,
    Activity,
    Globe,
    Power,
    RotateCcw,
    Sliders,
    Gauge,
    Route,
    Loader2,
    Maximize,
    ShieldAlert,
    ShieldX,
    Copy,
    Terminal
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { TracerouteModal } from './components/TracerouteModal';
import { VyosTrafficControlModal } from './components/VyosTrafficControlModal';

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

function formatTunnelDuration(sec?: number | null): string {
    if (sec === undefined || sec === null || !Number.isFinite(sec) || sec < 0) return 'N/A';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const hms = `${String(h)}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    if (d > 0) return `${d}d ${hms}`;
    return hms;
}

// Robust QoS normalization helper
function normalizeQos(raw: any): { latency?: number; loss?: number } | null {
    if (!raw || typeof raw !== 'object') return null;
    let lat: number | undefined = undefined;
    let los: number | undefined = undefined;

    // Extract latency / delay
    const rawLat = raw.latency ?? raw.delay_ms ?? raw.delay ?? raw.ms;
    if (rawLat !== undefined && rawLat !== null) {
        const parsed = typeof rawLat === 'number' ? rawLat : parseFloat(String(rawLat).replace(/[^\d.]/g, ''));
        if (!isNaN(parsed) && parsed > 0) lat = parsed;
    }

    // Extract loss / loss_pct
    const rawLoss = raw.loss ?? raw.loss_pct ?? raw.lossPct ?? raw.percent;
    if (rawLoss !== undefined && rawLoss !== null) {
        const parsed = typeof rawLoss === 'number' ? rawLoss : parseFloat(String(rawLoss).replace(/[^\d.]/g, ''));
        if (!isNaN(parsed) && parsed > 0) los = parsed;
    }

    if (lat !== undefined || los !== undefined) {
        return { latency: lat, loss: los };
    }
    return null;
}

// --- Underlay types (mirror of server-side UnderlayPayload) ---
type UnderlayResolutionStatus = 'matched' | 'no_match' | 'ambiguous' | 'wan_ip_unavailable' | 'vyos_unavailable';
type UnderlayResolution = {
    id: string;
    status: UnderlayResolutionStatus;
    scope?: 'wan' | 'lan';
    prismaWan: {
        elementId: string; elementName?: string; siteId?: string; siteName?: string;
        interfaceId?: string; interfaceName?: string; ipCidr?: string | null;
        ip?: string | null; network?: string | null; linkType?: string | null; ipType?: string | null;
    };
    vyos?: {
        routerId: string; routerName: string; location?: string | null; interfaceName: string;
        description?: string | null; ipCidr: string; ip: string; network: string; routerStatus?: string | null;
        status?: string | null;
        qos?: { latency?: number; loss?: number } | null;
    };
    candidates?: Array<{
        routerId: string; routerName: string; location?: string | null; interfaceName: string;
        description?: string | null; ipCidr: string; ip: string; network: string; routerStatus?: string | null;
        status?: string | null;
        qos?: { latency?: number; loss?: number } | null;
    }>;
    matchMethod?: 'same_subnet'; matchedNetwork?: string; diagnostic?: string;
};
type UnderlayRouterSummary = {
    id: string;
    name: string;
    host: string;
    location?: string | null;
    status?: string | null;
    blackholeBlocks?: Array<{ prefix: string; description?: string }>;
    interfaces: Array<{
        name: string;
        description?: string | null;
        address: string[];
        status: string;
        qos?: { latency?: number; loss?: number } | null;
    }>;
};

type UnderlayPayload = {
    available: boolean;
    vyosConfigAvailable: boolean;
    summary: {
        wanInterfacesSeen: number;
        matched: number;
        noMatch: number;
        ambiguous: number;
        wanIpUnavailable: number;
        lanMatched?: number;
    };
    resolutions: UnderlayResolution[];
    lanResolutions?: UnderlayResolution[];
    routers?: UnderlayRouterSummary[];
};


// --- Custom Edge Components ---

const SiteEdge = ({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style = {},
    markerEnd,
    data,
}: any) => {
    const [edgePath, labelX, labelY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
    });

    const isMpls = Boolean(data?.wan_network?.toLowerCase().includes('mpls'));

    // Determine color based on edge type
    let strokeColor = style?.stroke;
    if (!strokeColor) {
        if (data?.isSaseEdge) {
            const isUp = data?.operational_state === 'up';
            const isAct = data?.role === 'active';
            strokeColor = isUp ? (isAct ? '#10b981' : '#06b6d4') : '#ef4444';
        } else if (data?.isUnderlayEdge) {
            strokeColor = data?.resolution?.status === 'matched' ? '#f59e0b' : '#64748b';
        } else {
            const isMpls = data?.wan_network?.toLowerCase().includes('mpls');
            strokeColor = isMpls ? '#a855f7' : (data?.ip && !data?.ip.includes('Pending') ? '#3b82f6' : '#94a3b8');
        }
    }

    // Determine if we should show the label - ONLY if hideLabel is not set
    const showLabel = !data?.hideLabel;

    return (
        <>
            <BaseEdge path={edgePath} markerEnd={markerEnd} style={{ ...style, stroke: strokeColor }} interactionWidth={24} />
            {showLabel && (
                <EdgeLabelRenderer>
                    <div
                        style={{
                            position: 'absolute',
                            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                            pointerEvents: 'all',
                        }}
                        className="animate-in fade-in zoom-in duration-500"
                    >
                        <div className={cn(
                            "px-2 py-0.5 rounded-full border shadow-xl backdrop-blur-md text-[9px] font-black uppercase tracking-tighter whitespace-nowrap",
                            isMpls ? "bg-purple-500/10 border-purple-500/40 text-purple-400" : "bg-blue-500/10 border-blue-500/40 text-blue-400"
                        )}>
                            {data?.circuit_label}
                        </div>
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    );
};

// --- Custom Arched Bridge Edge Component (Spoke-to-Spoke Celestial Arches) ---
const ArchedBridgeEdge = ({
    sourceX,
    sourceY,
    targetX,
    targetY,
    style = {},
    markerEnd,
    data,
}: any) => {
    const deltaX = Math.abs(targetX - sourceX);
    const isTopRow = sourceY < 0 && targetY < 0;
    // Dynamic arch peak based on span distance
    // Shorter spans rise ~100px, longer spans gracefully rise up to ~280px into the open central canvas
    const archHeight = Math.min(280, Math.max(90, deltaX * 0.22));
    const peakY = isTopRow
        ? Math.max(sourceY, targetY) + archHeight
        : Math.min(sourceY, targetY) - archHeight;

    const edgePath = `M ${sourceX} ${sourceY} C ${sourceX} ${peakY}, ${targetX} ${peakY}, ${targetX} ${targetY}`;
    const midX = (sourceX + targetX) / 2;
    const midY = peakY + (isTopRow ? -14 : 14);

    const isMpls = Boolean(data?.wan_network?.toLowerCase().includes('mpls') || data?.isMplsCircuit);
    let strokeColor = style?.stroke;
    if (!strokeColor) {
        if (data?.active) {
            strokeColor = isMpls ? '#c084fc' : '#22c55e';
        } else if (data?.usable) {
            strokeColor = isMpls ? '#9333ea' : '#3b82f6';
        } else if (data?.status === 'DOWN') {
            strokeColor = '#ef4444';
        } else {
            strokeColor = '#64748b';
        }
    }

    const showLabel = !data?.hideLabel && data?.circuit_label;

    return (
        <>
            <BaseEdge path={edgePath} markerEnd={markerEnd} style={{ ...style, stroke: strokeColor }} interactionWidth={24} />
            {showLabel && (
                <EdgeLabelRenderer>
                    <div
                        style={{
                            position: 'absolute',
                            transform: `translate(-50%, -50%) translate(${midX}px,${midY}px)`,
                            pointerEvents: 'all',
                        }}
                        className="animate-in fade-in zoom-in duration-500"
                    >
                        <div className={cn(
                            "px-2 py-0.5 rounded-full border shadow-xl backdrop-blur-md text-[9px] font-black uppercase tracking-tighter whitespace-nowrap",
                            isMpls ? "bg-purple-500/15 border-purple-500/45 text-purple-800 dark:text-purple-300" : "bg-blue-500/15 border-blue-500/45 text-blue-800 dark:text-blue-300"
                        )}>
                            {data?.circuit_label}
                        </div>
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    );
};

// --- Custom Port Marker component ---
const Port = ({
    num,
    label,
    status = 'unknown',
    labelPosition = 'bottom',
}: {
    num: string;
    label?: string;
    status?: 'up' | 'down' | 'unknown';
    labelPosition?: 'top' | 'bottom';
}) => {
    let bgClass = "bg-card border-border text-text-muted";

    // Status color coding for port badges (high contrast in both Light and Dark modes)
    if (status === 'up') bgClass = "bg-green-500/20 border-green-600/55 dark:border-green-500/50 text-green-800 dark:text-green-400";
    if (status === 'down') bgClass = "bg-red-500/20 border-red-600/55 dark:border-red-500/50 text-red-700 dark:text-red-500";

    return (
        <div className="flex flex-col items-center gap-1 relative z-20 group">
            {label && labelPosition === 'top' && (
                <div className="absolute -top-[20px] whitespace-nowrap bg-card/90 backdrop-blur-sm px-1.5 py-0.5 rounded text-[8px] font-mono font-bold text-text-muted uppercase tracking-tighter shadow-sm border border-border/50 text-center pointer-events-none">
                    {label}
                </div>
            )}
            <div className={cn(
                "w-5 h-5 rounded-md border flex items-center justify-center text-[9px] font-black shadow-sm",
                bgClass
            )}>
                {num}
            </div>
            {label && labelPosition === 'bottom' && (
                <div className="absolute top-[22px] whitespace-nowrap bg-card/90 backdrop-blur-sm px-1.5 py-0.5 rounded text-[8px] font-mono font-bold text-text-muted uppercase tracking-tighter shadow-sm border border-border/50 text-center pointer-events-none">
                    {label}
                </div>
            )}
        </div>
    );
};

// Helper to check if an IP is inside a CIDR subnet (e.g. 192.168.207.10 in 192.168.207.0/24)
function isIpInSubnet(ip?: string | null, subnet?: string | null): boolean {
    if (!ip || !subnet) return false;
    const cleanIp = ip.split('/')[0].trim();
    const [subIp, maskStr] = subnet.trim().split('/');
    if (!subIp) return false;
    const mask = maskStr ? parseInt(maskStr, 10) : 24;

    const ipToLong = (v: string) => {
        const parts = v.split('.').map(Number);
        if (parts.length !== 4 || parts.some(isNaN)) return null;
        return ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + (parts[3] >>> 0);
    };

    const ipNum = ipToLong(cleanIp);
    const subNum = ipToLong(subIp);
    if (ipNum === null || subNum === null) return false;

    if (mask === 0) return true;
    const netmask = mask === 32 ? 0xFFFFFFFF : (((0xFFFFFFFF << (32 - mask)) >>> 0));
    return (ipNum & netmask) === (subNum & netmask);
}

function normalizeSiteName(name?: string | null): string {
    if (!name) return '';
    return name
        .replace(/[-_]?(ubuntu|node|linux|srv|core|hub).*$/i, '')
        .replace(/[^A-Z0-9]/gi, '')
        .toUpperCase();
}

function isExactSiteMatch(siteName?: string | null, nodeName?: string | null): boolean {
    if (!siteName || !nodeName) return false;
    const s1 = normalizeSiteName(siteName);
    const s2 = normalizeSiteName(nodeName);
    if (!s1 || !s2) return false;
    return s1 === s2;
}

// Helper to filter out loopback / virtual / /32 interfaces on ION devices and keep only physical LAN interfaces
function isPhysicalLanInterface(l: any): boolean {
    if (!l || !l.ip) return false;
    const name = String(l.interface_name || l.name || '').toLowerCase().trim();
    const desc = String(l.interface_description || l.description || '').toLowerCase().trim();
    const label = String(l.interface_label || '').toLowerCase().trim();
    const type = String(l.type || '').toLowerCase().trim();
    const net = String(l.network || l.ip || '').trim();
    const cleanIp = String(l.ip).split('/')[0].trim();

    if (
        type === 'loopback' ||
        name.includes('loopback') ||
        name.startsWith('lo') ||
        desc.includes('loopback') ||
        label.includes('loopback') ||
        net.endsWith('/32') ||
        cleanIp.startsWith('20.0.') ||
        cleanIp.startsWith('127.')
    ) {
        return false;
    }
    return true;
}

// Helper to filter out loopback / dummy / tunnel interfaces on VyOS routers and keep only physical interfaces
function isPhysicalVyosInterface(iface: any): boolean {
    if (!iface || !iface.name) return false;
    const name = String(iface.name).toLowerCase().trim();
    const desc = String(iface.description || '').toLowerCase().trim();
    const type = String(iface.type || '').toLowerCase().trim();
    const ipCidr = String(iface.ipCidr || iface.address?.[0] || iface.ip || '').trim();

    if (
        type === 'loopback' ||
        type === 'dummy' ||
        name === 'lo' ||
        name.startsWith('lo') ||
        name.startsWith('loopback') ||
        name.startsWith('dum') ||
        name.startsWith('vti') ||
        name.startsWith('tun') ||
        name.startsWith('wg') ||
        desc.includes('loopback') ||
        ipCidr.endsWith('/32') ||
        ipCidr.startsWith('127.')
    ) {
        return false;
    }
    return true;
}

// --- Custom Site Node Component (The "Physical" Schematic) ---
const SiteNode = ({ data }: any) => {
    const isHub = data.role === 'HUB';
    const isGateway = data.role === 'GATEWAY';
    const devices = data.devices || [];

    // Map circuit data for the "Circuit Blocks" (intermediaries to clouds)
    const wanCircuits = devices.flatMap((d: any) =>
        (d.wan_interfaces || []).map((w: any) => ({ ...w, devName: d.device_name }))
    );

    const getPrimaryPhysicalLan = (dev: any) =>
        (dev.lan_interfaces || []).find(isPhysicalLanInterface) ||
        (dev.lan_interfaces || []).find((l: any) => l?.ip && !String(l.ip).startsWith('20.0.'));

    // Aggregate physical LAN subnets across all devices in this site (excluding loopbacks)
    const allLanSubnets = new Set<string>();
    devices.forEach((d: any) => {
        (d.lan_interfaces || []).filter(isPhysicalLanInterface).forEach((l: any) => {
            if (l.network && String(l.network).includes('/') && !String(l.network).endsWith('/32')) {
                allLanSubnets.add(String(l.network));
            } else if (l.ip) {
                const subnet = l.ip.includes('/') ? l.ip : l.ip.replace(/\.\d+$/, '.0/24');
                allLanSubnets.add(subnet);
            }
        });
    });

    // Fallback if none found
    if (allLanSubnets.size === 0) {
        allLanSubnets.add("192.168.201.0/24");
    }

    const uniqueSubeNets = Array.from(allLanSubnets);

    const getStatus = (iface: any) => {
        if (!iface) return 'unknown';
        if (iface.link_up === false || iface.admin_up === false) return 'down';
        if (iface.status?.toLowerCase() === 'down') return 'down';
        return 'up';
    };
    const shortIp = (ip?: string) => ip ? ip.split('/')[0] : '';

    // Stigix Fleet Node matching
    const fleetNodes = (data.fleetNodes as any[]) || [];

    // Underlay badge helpers
    const underlayMode = data.underlayMode as ('off' | 'badges') | undefined;
    const underlayResolutionMap = data.underlayResolutionMap as Map<string, any> | undefined;
    const onInspectUnderlayCircuit = data.onInspectUnderlayCircuit as ((r: any) => void) | undefined;
    const lanVyosRouters = (data.lanVyosRouters as any[]) || [];
    const onInspectLanVyos = data.onInspectLanVyos as ((r: any) => void) | undefined;

    const getUnderlayBadge = (wan: any) => {
        if (underlayMode !== 'badges' || !underlayResolutionMap) return null;
        const r = underlayResolutionMap.get(wan.wan_if_id);
        if (!r) return null;
        const cfg: Record<string, { cls: string; label: string }> = {
            matched: { cls: 'bg-green-500/80 text-white border-green-400', label: '⬡' },
            no_match: { cls: 'bg-slate-500/60 text-slate-200 border-slate-400', label: '–' },
            ambiguous: { cls: 'bg-amber-500/80 text-white border-amber-400', label: '?' },
            wan_ip_unavailable: { cls: 'bg-slate-600/60 text-slate-300 border-slate-500', label: '?' },
            vyos_unavailable: { cls: 'bg-slate-600/60 text-slate-300 border-slate-500', label: '!' },
        };
        const c = cfg[r.status] || { cls: 'bg-slate-500/40 text-slate-300 border-slate-400', label: '?' };
        return { r, c };
    };

    // Identify the primary shared physical LAN subnet (matching Port 3 of the IONs / LAN VyOS)
    const matchedVyosLanSubnet = lanVyosRouters[0]?.resolutions?.[0]?.matchedNetwork;
    const primaryLanSubnet = (matchedVyosLanSubnet && uniqueSubeNets.includes(matchedVyosLanSubnet))
        ? matchedVyosLanSubnet
        : (uniqueSubeNets[0] || "192.168.201.0/24");
    const secondarySubnets = uniqueSubeNets.filter((s) => s !== primaryLanSubnet);
    const hasLanVyos = lanVyosRouters.length > 0;

    // Resolve Stigix SASE Agent for this site (either directly on ION LAN, or behind LAN VyOS, or matched by site name)
    const siteStigixNode = fleetNodes.find((n: any) => {
        if (uniqueSubeNets.some((s) => isIpInSubnet(n.ip, s) || isIpInSubnet(n.ip_private, s))) return true;
        if (lanVyosRouters.some((lr: any) => (lr.interfaceItems || []).some((it: any) => isIpInSubnet(n.ip, it.ipCidr) || isIpInSubnet(n.ip_private, it.ipCidr)))) return true;
        if (isExactSiteMatch(data.name, n.name || n.id || n.site)) return true;
        return false;
    });

    const isStigixLeader = Boolean(
        siteStigixNode && (
            siteStigixNode.is_leader ||
            siteStigixNode.role === 'LEADER' ||
            (siteStigixNode.id && siteStigixNode.id.toLowerCase().includes('dc1') && !siteStigixNode.id.toLowerCase().includes('dc2'))
        )
    );

    // Extra vertical height in the Hub top section when the 2-tier [Stigix -> VyOS] -> [Shared LAN] hierarchy is displayed
    const hubExtraY = (isHub && hasLanVyos) ? 42 : 0;

    // Render any additional physical LAN subnet pill
    const renderSecondarySubnetPill = (subnet: string, sIdx: number) => (
        <div
            key={`sec-${sIdx}`}
            className="bg-emerald-500/15 dark:bg-emerald-500/10 px-2.5 py-0.5 rounded-lg border border-emerald-600/40 dark:border-emerald-500/25 text-[10px] font-mono font-bold text-emerald-800 dark:text-emerald-400/80 shadow-sm h-[24px] flex items-center whitespace-nowrap"
            title={`Physical LAN Subnet: ${subnet}`}
        >
            {subnet}
        </div>
    );

    // Render the Stigix Probe badge (wired to the LAN VyOS router when present)
    const renderStigixBadge = (compactForVyosChain = false) => {
        if (!siteStigixNode) return null;
        const stigixIp = siteStigixNode.ip_private || siteStigixNode.ip || '';
        return (
            <div
                className={cn(
                    "bg-blue-500/15 dark:bg-blue-600/20 px-2 py-0.5 rounded-lg border-2 border-blue-500 dark:border-blue-400 text-[9.5px] font-mono font-bold text-blue-800 dark:text-blue-200 shadow-md shadow-blue-500/20 dark:shadow-blue-500/25 relative z-20 transition-all hover:scale-105 hover:bg-blue-500/25 dark:hover:bg-blue-500/30 hover:border-blue-600 dark:hover:border-blue-300 flex items-center gap-1 cursor-default whitespace-nowrap",
                    compactForVyosChain ? "h-[26px]" : "h-[28px]"
                )}
                title={`⚡ Stigix SASE Agent: ${siteStigixNode.name || siteStigixNode.id}${stigixIp ? ` (${stigixIp})` : ''} • ${isStigixLeader ? 'LEADER' : 'PEER'}${hasLanVyos ? ` • Connected via ${lanVyosRouters[0]?.name || 'VyOS'}` : ''}`}
            >
                <span className="relative flex h-1.5 w-1.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-600 dark:bg-blue-400"></span>
                </span>
                <Zap size={11} className="text-blue-600 dark:text-blue-300 shrink-0" />
                <span className="font-black tracking-tight text-blue-900 dark:text-blue-100">STIGIX</span>
                <span className="text-[7.5px] px-1 py-0.1 rounded bg-blue-500/20 dark:bg-blue-400/25 border border-blue-600/40 dark:border-blue-300/40 text-blue-950 dark:text-blue-100 uppercase font-black tracking-wider">
                    {isStigixLeader ? 'LEADER' : 'PEER'}
                </span>
            </div>
        );
    };

    // Render the Primary Shared LAN Bus pill (always green for LAN subnet; embeds a compact blue Stigix capsule when no LAN VyOS is present)
    const renderPrimaryLanBus = () => {
        const hasEmbeddedStigix = !hasLanVyos && Boolean(siteStigixNode);
        const stigixIp = siteStigixNode ? (siteStigixNode.ip_private || siteStigixNode.ip || '') : '';

        return (
            <div className="relative flex items-center justify-center">
                <div
                    className={cn(
                        "bg-emerald-500/15 py-1 rounded-xl border-2 border-emerald-600/55 dark:border-emerald-500/45 text-[11px] font-mono font-black text-emerald-800 dark:text-emerald-300 shadow-md shadow-emerald-500/15 relative z-10 transition-all hover:border-emerald-600 dark:hover:border-emerald-400 flex items-center gap-2 cursor-default whitespace-nowrap",
                        hasEmbeddedStigix ? "pl-3 pr-1.5 h-[32px]" : (hasLanVyos ? "px-3.5 h-[30px]" : "px-3.5 h-[32px]")
                    )}
                    title={
                        hasEmbeddedStigix
                            ? `ION LAN Segment: ${primaryLanSubnet} • ⚡ Stigix SASE Agent: ${siteStigixNode.name || siteStigixNode.id}${stigixIp ? ` (${stigixIp})` : ''} (${isStigixLeader ? 'LEADER' : 'PEER'})`
                            : `Shared ION LAN Segment: ${primaryLanSubnet}${devices.length > 1 ? ` (${devices.map((d: any) => d.device_name).join(' + ')})` : ''}`
                    }
                >
                    <span className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)] shrink-0" />
                    <span>{primaryLanSubnet}</span>
                    {devices.length > 1 && (
                        <span className="text-[8px] px-1.5 py-0.2 rounded bg-emerald-600/20 dark:bg-emerald-500/20 border border-emerald-600/45 dark:border-emerald-400/35 text-emerald-900 dark:text-emerald-200 uppercase font-black tracking-wider">
                            LAN BUS
                        </span>
                    )}
                    {hasEmbeddedStigix && (
                        <div
                            className="ml-0.5 pl-1.5 pr-1.5 py-0.5 rounded-lg bg-blue-500/20 dark:bg-blue-500/25 border border-blue-500/60 dark:border-blue-400/50 text-blue-900 dark:text-blue-100 shadow-sm shadow-blue-500/20 flex items-center gap-1 transition-all hover:bg-blue-500/30 dark:hover:bg-blue-500/35"
                            title={`⚡ Stigix SASE Agent: ${siteStigixNode.name || siteStigixNode.id}${stigixIp ? ` (${stigixIp})` : ''} • ${isStigixLeader ? 'LEADER' : 'PEER'}`}
                        >
                            <span className="relative flex h-1.5 w-1.5 shrink-0">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-600 dark:bg-blue-400"></span>
                            </span>
                            <Zap size={10} className="text-blue-600 dark:text-blue-300 shrink-0" />
                            <span className="text-[9px] font-black tracking-tight text-blue-900 dark:text-blue-100">STIGIX</span>
                            <span className="text-[7.5px] px-1 py-0.1 rounded bg-blue-600/20 dark:bg-blue-400/25 border border-blue-600/40 dark:border-blue-300/40 text-blue-950 dark:text-blue-100 uppercase font-black tracking-wider">
                                {isStigixLeader ? 'LEADER' : 'PEER'}
                            </span>
                        </div>
                    )}
                </div>
                {secondarySubnets.length > 0 && (
                    <div className="absolute left-full ml-2 flex items-center gap-1.5">
                        {secondarySubnets.map((subnet, sIdx) => renderSecondarySubnetPill(subnet, sIdx))}
                    </div>
                )}
            </div>
        );
    };

    // Discreet LAN VyOS Badge Renderer: centered on the LAN bus, with Stigix wired directly into the VyOS badge
    const renderLanVyosChain = () => {
        if (!hasLanVyos) return null;
        const lr = lanVyosRouters[0];
        const hasShut = Boolean(lr.hasShut);
        const activeQos = lr.primaryQos;
        const blockedCount = lr.blockedCount || 0;
        const hasImpairment = hasShut || Boolean(activeQos) || blockedCount > 0;
        const shortVyosIp = lr.lanIp ? lr.lanIp.split('/')[0].replace(/^\d+\.\d+\./, '.') : '';

        return (
            <div className="relative flex items-center justify-center">
                {/* Stigix Agent wired horizontally into the left of the VyOS LAN router */}
                {siteStigixNode && (
                    <div className="absolute right-full flex items-center">
                        {renderStigixBadge(true)}
                        <div className="w-2.5 h-[2px] bg-gradient-to-r from-blue-500 to-amber-500 dark:from-blue-400 dark:to-amber-400 shadow-[0_0_6px_rgba(59,130,246,0.6)]" />
                    </div>
                )}

                <div
                    onClick={(e) => {
                        e.stopPropagation();
                        if (onInspectLanVyos && lr.defaultResolution) {
                            onInspectLanVyos(lr.defaultResolution);
                        }
                    }}
                    title={`VyOS LAN Router: ${lr.name} (${lr.lanInterfaceName || 'LAN'} • ${lr.lanIp || ''}) — Connected to ${primaryLanSubnet} — Click to inject Egress/LAN latency, packet loss, shut port, or filter traffic`}
                    className={cn(
                        "px-3 py-1 rounded-xl border-2 text-[10px] font-mono font-black relative z-20 transition-all hover:scale-105 flex items-center gap-1.5 cursor-pointer h-[30px] shadow-md whitespace-nowrap",
                        hasShut || blockedCount > 0
                            ? "bg-rose-500/15 dark:bg-rose-500/20 border-rose-600/60 dark:border-rose-500/60 text-rose-800 dark:text-rose-200 hover:bg-rose-500/25 dark:hover:bg-rose-500/30 hover:border-rose-600 dark:hover:border-rose-400 shadow-rose-500/20"
                            : activeQos
                                ? "bg-amber-500/20 dark:bg-amber-500/25 border-amber-600/70 dark:border-amber-400/70 text-amber-950 dark:text-amber-100 hover:bg-amber-500/30 dark:hover:bg-amber-500/35 hover:border-amber-600 dark:hover:border-amber-300 shadow-amber-500/20"
                                : "bg-amber-500/15 border-amber-600/55 dark:border-amber-500/45 text-amber-900 dark:text-amber-300 hover:bg-amber-500/25 hover:border-amber-600 dark:hover:border-amber-400/80 shadow-amber-500/15"
                    )}
                >
                    <span className={cn(
                        "w-2 h-2 rounded-full shrink-0",
                        hasShut ? "bg-rose-500 animate-pulse" : activeQos ? "bg-amber-500 dark:bg-amber-400 animate-pulse" : "bg-emerald-500 dark:bg-emerald-400"
                    )} />
                    <Server size={11} className="text-amber-600 dark:text-amber-400 shrink-0" />
                    <span className="tracking-wider uppercase">{lr.name || 'VyOS'}</span>
                    <span className="text-[8.5px] px-1.5 py-0.2 rounded bg-amber-600/20 dark:bg-amber-500/20 border border-amber-600/45 dark:border-amber-400/30 text-amber-950 dark:text-amber-200 font-bold">
                        {lr.lanInterfaceName || 'LAN'}{shortVyosIp ? ` (${shortVyosIp})` : ''}
                    </span>
                    {(activeQos?.latency ?? 0) > 0 && (
                        <span className="px-1.5 py-0.2 rounded bg-amber-600/25 dark:bg-amber-500/35 border border-amber-600/50 dark:border-amber-300/60 text-[8.5px] text-amber-950 dark:text-amber-100 font-black whitespace-nowrap">
                            ⏱️ +{activeQos?.latency}ms
                        </span>
                    )}
                    {(activeQos?.loss ?? 0) > 0 && (
                        <span className="px-1.5 py-0.2 rounded bg-orange-600/25 dark:bg-orange-500/35 border border-orange-600/50 dark:border-orange-300/60 text-[8.5px] text-orange-950 dark:text-orange-100 font-black whitespace-nowrap">
                            📉 {activeQos?.loss}%
                        </span>
                    )}
                    {hasShut && (
                        <span className="px-1.5 py-0.2 rounded bg-rose-600/25 dark:bg-rose-500/35 border border-rose-600/50 dark:border-rose-400/60 text-[8.5px] text-rose-900 dark:text-rose-100 font-black">
                            SHUT
                        </span>
                    )}
                    {blockedCount > 0 && !hasShut && (
                        <span className="px-1.5 py-0.2 rounded bg-rose-600/25 dark:bg-rose-500/35 border border-rose-600/50 dark:border-rose-400/60 text-[8.5px] text-rose-900 dark:text-rose-100 font-black">
                            {blockedCount} BLK
                        </span>
                    )}
                    {!hasImpairment && (
                        <span className="text-[8px] opacity-60 hidden group-hover:inline">⚙</span>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className={cn(
            "flex items-center",
            isGateway ? "flex-row gap-5" : (isHub ? "flex-col-reverse items-center w-full gap-5" : "flex-col items-center w-full gap-5")
        )}>

            {/* Circuit Blocks Section: Top (Spoke) or Bottom (Hub) */}
            {!isGateway && (
                <div className="flex gap-4 z-10 relative">
                    {wanCircuits.map((w: any, idx: number) => {
                        const badge = getUnderlayBadge(w);
                        const isSelectedCircuit = data.selectedCircuitKey === `${data.site_id || data.id}:${w.devName}:${w.name}`;
                        return (
                            <div key={idx} className="relative flex flex-col items-center">
                                <div
                                    className={cn(
                                        "px-3.5 py-1.5 rounded-xl border shadow-2xl backdrop-blur-md flex flex-col items-center justify-center gap-0.5 min-w-[120px] h-[48px] transition-all hover:scale-105 group cursor-pointer",
                                        isSelectedCircuit
                                            ? "ring-2 ring-blue-400 bg-blue-500/25 border-blue-400 shadow-lg shadow-blue-500/30 scale-105"
                                            : (w.wan_network?.toLowerCase().includes('mpls')
                                                ? "bg-purple-500/10 border-purple-500/35 text-purple-700 dark:text-purple-400 hover:border-purple-500 dark:hover:border-purple-400/60"
                                                : "bg-blue-500/10 border-blue-500/35 text-blue-700 dark:text-blue-400 hover:border-blue-500 dark:hover:border-blue-400/60")
                                    )}
                                    title={`Click to inspect tunnels for ${w.circuit_label || w.name}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (data.onSelectCircuit) {
                                            data.onSelectCircuit({
                                                siteId: data.site_id || data.id,
                                                siteName: data.site_name || data.name,
                                                wan: w,
                                                devName: w.devName,
                                                circuitKey: `${data.site_id || data.id}:${w.devName}:${w.name}`
                                            });
                                        }
                                    }}
                                >
                                    <div className="text-[10px] font-black uppercase tracking-tight overflow-hidden text-ellipsis whitespace-nowrap max-w-[105px]">
                                        {w.circuit_label || w.name}
                                    </div>
                                    <div className="text-[9px] font-mono text-text-muted opacity-60">
                                        {w.ip || 'DHCP...'}
                                    </div>
                                    <Handle
                                        type="source"
                                        position={isHub ? Position.Bottom : Position.Top}
                                        id={`circuit:${w.devName}:${w.name}`}
                                        className="!w-full !h-1 !opacity-0"
                                    />
                                    {/* Hidden target handle for direct site-to-site overlay edges. Terminate at BOTTOM for Hubs too. */}
                                    <Handle
                                        type="target"
                                        position={isHub ? Position.Bottom : Position.Top}
                                        id={`target-circuit:${w.devName}:${w.name}`}
                                        className="!w-full !h-1 !opacity-0"
                                    />
                                    {/* Underlay status badge */}
                                    {badge && (
                                        <div
                                            className={cn(
                                                "absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full border flex items-center justify-center text-[9px] font-black shadow-md z-30 transition-transform hover:scale-125 cursor-pointer",
                                                badge.c.cls
                                            )}
                                            title="Inspect Underlay Mapping (VyOS)"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (onInspectUnderlayCircuit) {
                                                    onInspectUnderlayCircuit(badge.r);
                                                }
                                            }}
                                        >
                                            {badge.c.label}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}


            {/* Site Rectangle (Physical Box) */}
            <div className={cn(
                "px-8 py-7 rounded-[36px] border-2 transition-all shadow-2xl backdrop-blur-3xl bg-card/40 flex flex-col relative",
                isGateway
                    ? "border-amber-500/35 shadow-amber-500/10 shadow-[0_0_50px_-12px_rgba(245,158,11,0.2)]"
                    : isHub
                        ? "border-blue-500/30 shadow-blue-500/5 shadow-[0_0_50px_-12px_rgba(59,130,246,0.15)] w-full"
                        : "border-border shadow-black/40 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.5)] w-full"
            )}>
                {/* Peripheral LAN Handle (Top for Hub, Bottom for Spoke/Gateway) */}
                <Handle
                    type="source"
                    position={isHub ? Position.Top : Position.Bottom}
                    id="lan-periphery"
                    className="!w-3 !h-1.5 !opacity-0"
                />

                {/* SVG Layer for ALL internal wiring (1:1 Exact Math Coordinates) */}
                <svg className="absolute top-0 left-1/2 overflow-visible z-0" width="1" height="1">
                    {devices.map((dev: any, dIdx: number) => {
                        const deviceCount = devices.length;
                        const devX = (dIdx - (deviceCount - 1) / 2) * 272; // 208 (w-52) + 64 (gap-16)

                        return (
                            <React.Fragment key={dIdx}>
                                {/* WAN Wiring (Port -> Circuit Block) - only for Hub and Spoke */}
                                {!isGateway && dev.wan_interfaces?.map((wan: any, wIdx: number) => {
                                    const isMpls = wan.wan_network?.toLowerCase().includes('mpls');
                                    const globalIdx = wanCircuits.findIndex((c: any) => c.devName === dev.device_name && c.name === wan.name);
                                    if (globalIdx === -1) return null;

                                    const circuitCount = wanCircuits.length;
                                    const blockX = (globalIdx - (circuitCount - 1) / 2) * 136; // 120 (min-w) + 16 (gap-4)
                                    const portX = devX + (wIdx - (dev.wan_interfaces.length - 1) / 2) * 36; // 20 (w-5) + 16 (gap-4)

                                    return (
                                        <path
                                            key={wan.name}
                                            d={isHub
                                                ? `M ${portX} ${362 + hubExtraY} L ${blockX} ${432 + hubExtraY}` // Hub: Bottom Port down to Circuit Block
                                                : `M ${portX} 18 L ${blockX} -20`  // Spoke: Top Port up to Circuit Block
                                            }
                                            stroke={isMpls ? "rgba(168, 85, 247, 0.4)" : "rgba(59, 130, 246, 0.4)"}
                                            strokeWidth="2.5"
                                            fill="none"
                                            strokeDasharray="6 4"
                                            className="animate-in fade-in duration-1000"
                                        />
                                    );
                                })}

                                {/* LAN Wiring: Port 3 of each ION -> Centered Shared LAN Bus (192.168.201.0/24) */}
                                {isHub ? (
                                    <path
                                        d={deviceCount === 1
                                            ? `M 0 ${98 + hubExtraY} L 0 ${126 + hubExtraY}`
                                            : `M 0 ${98 + hubExtraY} L 0 ${113 + hubExtraY} M 0 ${113 + hubExtraY} L ${devX} ${113 + hubExtraY} L ${devX} ${126 + hubExtraY}`
                                        }
                                        stroke="rgba(52, 211, 153, 0.65)"
                                        strokeWidth="2.5"
                                        fill="none"
                                        strokeLinejoin="round"
                                        strokeLinecap="round"
                                        strokeDasharray="4 4"
                                    />
                                ) : (
                                    <path
                                        d={deviceCount === 1
                                            ? `M 0 248 L 0 274`
                                            : `M ${devX} 248 L ${devX} 262 L 0 262 M 0 262 L 0 274`
                                        }
                                        stroke={isGateway ? "rgba(245, 158, 11, 0.55)" : "rgba(52, 211, 153, 0.65)"}
                                        strokeWidth="2.5"
                                        fill="none"
                                        strokeLinejoin="round"
                                        strokeLinecap="round"
                                        strokeDasharray="4 4"
                                    />
                                )}
                            </React.Fragment>
                        );
                    })}
                </svg>

                {/* Hub-Specific: Shared LAN Bus at bottom, wired up to VyOS, wired to Stigix */}
                {isHub && (
                    <div className="flex flex-col items-center justify-end mb-9 relative z-10">
                        <div className="absolute inset-x-0 -top-6 flex justify-center w-full z-0 overflow-hidden pointer-events-none">
                            <div className="text-[72px] font-black text-white/[0.02] select-none uppercase tracking-[0.2em] whitespace-nowrap px-6">{data.name}</div>
                        </div>
                        <div className="text-[20px] font-black text-text-primary uppercase tracking-[0.4em] opacity-85 mb-3 drop-shadow-lg relative z-10">{data.name}</div>
                        {hasLanVyos ? (
                            <div className="flex flex-col items-center w-full">
                                {renderLanVyosChain()}
                                {/* Vertical wire connecting VyOS LAN interface down to Shared ION LAN Bus */}
                                <div className="w-[2px] h-3 bg-gradient-to-b from-amber-400/90 to-emerald-400/90 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
                                {renderPrimaryLanBus()}
                            </div>
                        ) : (
                            <div className="flex items-center justify-center w-full">
                                {renderPrimaryLanBus()}
                            </div>
                        )}
                    </div>
                )}

                {/* Gateway-Specific Header */}
                {isGateway && (
                    <div className="flex flex-col items-center justify-center mb-5 relative z-10">
                        <div className="flex items-center gap-2 mb-1.5">
                            <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-[9px] font-black uppercase tracking-widest text-amber-800 dark:text-amber-300 shadow-sm flex items-center gap-1.5">
                                <GitBranch size={11} className="text-amber-600 dark:text-amber-400" />
                                Branch Gateway
                            </span>
                        </div>
                        <div className="text-[19px] font-black text-text-primary uppercase tracking-[0.35em] opacity-90 drop-shadow-lg">
                            {data.name}
                        </div>
                    </div>
                )}

                {/* Horizontal Device Clusters */}
                <div className="flex items-center justify-center gap-16 relative z-10 w-full mb-8">
                    {devices.map((dev: any, dIdx: number) => (
                        <div key={dIdx} className="flex flex-col items-center group relative">

                            {/* Router Block (Fixed Height h-[220px]) */}
                            <div className={cn(
                                "w-52 h-[220px] rounded-[40px] border-2 flex flex-col items-center justify-center gap-4 transition-all group-hover:scale-105 relative z-10",
                                isGateway
                                    ? "bg-amber-500/10 border-amber-500/35 shadow-amber-500/10 group-hover:border-amber-400/60 group-hover:shadow-[0_20px_50px_-10px_rgba(245,158,11,0.25)]"
                                    : isHub
                                        ? "bg-blue-600/10 border-blue-500/30 shadow-blue-500/10 group-hover:border-blue-500/50 group-hover:shadow-[0_20px_50px_-10px_rgba(59,130,246,0.3)]"
                                        : "bg-card-secondary/40 border-border/80 group-hover:border-blue-500/50 group-hover:shadow-[0_20px_50px_-10px_rgba(59,130,246,0.3)]"
                            )}>

                                {/* HUB: LAN Port Top */}
                                {isHub && (
                                    <div className="absolute -top-[10px] w-full flex justify-center z-20">
                                        <Port num="3" label={shortIp(getPrimaryPhysicalLan(dev)?.ip)} status={getStatus(getPrimaryPhysicalLan(dev))} labelPosition="bottom" />
                                    </div>
                                )}

                                {/* SPOKE & GATEWAY: WAN Ports Top */}
                                {!isHub && (
                                    <div className="absolute -top-[10px] w-full flex justify-center gap-4 z-20">
                                        {dev.wan_interfaces?.map((wan: any, wIdx: number) => (
                                            <Port key={wIdx} num={(wIdx + 1).toString()} status={getStatus(wan)} labelPosition="bottom" />
                                        ))}
                                    </div>
                                )}

                                {/* Icon */}
                                <div className={cn(
                                    "p-4 rounded-2xl shadow-xl transition-transform group-hover:rotate-12",
                                    isGateway
                                        ? "bg-amber-500 text-white shadow-amber-500/40"
                                        : isHub
                                            ? "bg-blue-500 text-white shadow-blue-500/40"
                                            : "bg-card text-blue-500 shadow-black/20"
                                )}>
                                    {isGateway ? <GitBranch size={28} /> : (isHub ? <Server size={28} /> : <Home size={28} />)}
                                </div>

                                {/* Text */}
                                <div className="text-center px-4">
                                    <div className="text-[15px] font-black text-text-primary tracking-tight leading-none uppercase">{dev.device_name}</div>
                                    <div className="text-[10px] text-text-muted font-bold opacity-40 mt-1.5 uppercase tracking-widest">{dev.model}</div>
                                </div>

                                {/* HUB: WAN Ports Bottom */}
                                {isHub && (
                                    <div className="absolute -bottom-[10px] w-full flex justify-center gap-4 z-20">
                                        {dev.wan_interfaces?.map((wan: any, wIdx: number) => (
                                            <Port key={wIdx} num={(wIdx + 1).toString()} status={getStatus(wan)} labelPosition="top" />
                                        ))}
                                    </div>
                                )}

                                {/* SPOKE & GATEWAY: LAN Port Bottom */}
                                {!isHub && (
                                    <div className="absolute -bottom-[10px] w-full flex justify-center z-20">
                                        <Port num="3" label={shortIp(getPrimaryPhysicalLan(dev)?.ip)} status={getStatus(getPrimaryPhysicalLan(dev))} labelPosition="top" />
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Spoke-Specific: Shared LAN Bus at top of footer, wired down to VyOS & Stigix */}
                {!isHub && !isGateway && (
                    <div className="flex flex-col items-center relative z-20 w-full mb-2">
                        {hasLanVyos ? (
                            <div className="flex flex-col items-center w-full">
                                {renderPrimaryLanBus()}
                                <div className="w-[2px] h-3 bg-gradient-to-b from-emerald-400/90 to-amber-400/90 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
                                {renderLanVyosChain()}
                            </div>
                        ) : (
                            <div className="flex items-center justify-center w-full">
                                {renderPrimaryLanBus()}
                            </div>
                        )}
                        <div className="absolute inset-x-0 -bottom-6 flex justify-center w-full z-0 overflow-hidden pointer-events-none">
                            <div className="text-[72px] font-black text-white/[0.02] select-none uppercase tracking-[0.2em] whitespace-nowrap px-6">{data.name}</div>
                        </div>
                        <div className="text-[20px] font-black text-text-primary uppercase tracking-[0.4em] opacity-85 mt-4 drop-shadow-lg relative z-10">{data.name}</div>
                    </div>
                )}

                {/* Gateway-Specific: LAN Subnets at the Bottom */}
                {isGateway && (
                    <div className="flex flex-col items-center relative z-20 w-full mb-1">
                        {hasLanVyos ? (
                            <div className="flex flex-col items-center w-full">
                                {renderPrimaryLanBus()}
                                <div className="w-[2px] h-3 bg-gradient-to-b from-emerald-400/90 to-amber-400/90 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
                                {renderLanVyosChain()}
                            </div>
                        ) : (
                            <div className="flex items-center justify-center w-full">
                                {renderPrimaryLanBus()}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Right-Side Circuit Blocks Column for Gateway */}
            {isGateway && (
                <div className="flex flex-col justify-center gap-3.5 z-10 relative">
                    {wanCircuits.map((w: any, idx: number) => {
                        const badge = getUnderlayBadge(w);
                        const isSelectedCircuit = data.selectedCircuitKey === `${data.site_id || data.id}:${w.devName}:${w.name}`;
                        return (
                            <div key={idx} className="relative flex items-center">
                                <div
                                    className={cn(
                                        "px-3.5 py-2 rounded-2xl border shadow-2xl backdrop-blur-md flex flex-col items-center justify-center gap-0.5 min-w-[125px] h-[52px] transition-all hover:scale-105 group cursor-pointer",
                                        isSelectedCircuit
                                            ? "ring-2 ring-blue-400 bg-blue-500/25 border-blue-400 shadow-lg shadow-blue-500/30 scale-105"
                                            : (w.wan_network?.toLowerCase().includes('mpls')
                                                ? "bg-purple-500/10 border-purple-500/35 text-purple-700 dark:text-purple-400 hover:border-purple-400/60"
                                                : "bg-blue-500/10 border-blue-500/35 text-blue-700 dark:text-blue-400 hover:border-blue-400/60")
                                    )}
                                    title={`Click to inspect tunnels for ${w.circuit_label || w.name}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (data.onSelectCircuit) {
                                            data.onSelectCircuit({
                                                siteId: data.site_id || data.id,
                                                siteName: data.site_name || data.name,
                                                wan: w,
                                                devName: w.devName,
                                                circuitKey: `${data.site_id || data.id}:${w.devName}:${w.name}`
                                            });
                                        }
                                    }}
                                >
                                    <div className="text-[10px] font-black uppercase tracking-tight overflow-hidden text-ellipsis whitespace-nowrap max-w-[110px]">
                                        {w.circuit_label || w.name}
                                    </div>
                                    <div className="text-[9px] font-mono text-text-muted opacity-60">
                                        {w.ip || 'DHCP...'}
                                    </div>
                                    <Handle
                                        type="source"
                                        position={Position.Right}
                                        id={`circuit:${w.devName}:${w.name}`}
                                        className="!opacity-0 !w-2 !h-2"
                                    />
                                    <Handle
                                        type="target"
                                        position={Position.Right}
                                        id={`target-circuit:${w.devName}:${w.name}`}
                                        className="!opacity-0 !w-2 !h-2"
                                    />
                                    {badge && (
                                        <div
                                            className={cn(
                                                "absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full border flex items-center justify-center text-[9px] font-black shadow-md z-30 transition-transform hover:scale-125 cursor-pointer",
                                                badge.c.cls
                                            )}
                                            title="Inspect Underlay Mapping (VyOS)"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (onInspectUnderlayCircuit) {
                                                    onInspectUnderlayCircuit(badge.r);
                                                }
                                            }}
                                        >
                                            {badge.c.label}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

const CloudNode = ({ data }: any) => {
    const isInternet = data.name === 'INTERNET';
    const isSelected = data.isSelected;
    const tunnelsUp = data.tunnelsUp;
    const tunnelsTotal = data.tunnelsTotal;
    const viewMode = data.viewMode;

    return (
        <div className={cn(
            "px-8 py-5 rounded-[40px] border-2 transition-all shadow-2xl backdrop-blur-3xl flex flex-col items-center gap-2.5 min-w-[230px] cursor-pointer group select-none",
            isInternet
                ? (isSelected 
                    ? "bg-sky-500/25 border-sky-400 ring-4 ring-sky-500/40 shadow-sky-500/30 scale-105" 
                    : "bg-sky-500/10 border-sky-500/30 hover:border-sky-400/80 hover:bg-sky-500/15 shadow-sky-500/10")
                : (isSelected 
                    ? "bg-purple-500/25 border-purple-400 ring-4 ring-purple-500/40 shadow-purple-500/30 scale-105" 
                    : "bg-purple-500/10 border-purple-500/30 hover:border-purple-400/80 hover:bg-purple-500/15 shadow-purple-500/10")
        )}>
            <Handle type="target" position={Position.Top} id="target-top" className="!opacity-0" />
            <Handle type="target" position={Position.Bottom} id="target-bottom" className="!opacity-0" />

            <div className={cn(
                "p-3.5 rounded-full shadow-inner transition-transform group-hover:scale-110",
                isInternet ? "bg-sky-500 text-white shadow-sky-500/40" : "bg-purple-500 text-white shadow-purple-500/40"
            )}>
                <Cloud size={26} />
            </div>
            <div className="text-center">
                <div className="text-base font-black text-text-primary tracking-tight uppercase leading-none">{data.name}</div>
                <div className="text-[9px] text-text-muted font-bold tracking-[0.2em] mt-1.5 opacity-60 uppercase">
                    {viewMode === 'overlay' ? 'SD-WAN Overlay' : 'Underlay Network'}
                </div>
            </div>

            {tunnelsTotal !== undefined && tunnelsTotal > 0 && (
                <div className={cn(
                    "px-3 py-1 rounded-full text-[9px] font-mono font-bold border flex items-center gap-1.5 mt-0.5 shadow-sm",
                    isInternet
                        ? (isSelected ? "bg-sky-500/30 border-sky-400 text-sky-900 dark:text-sky-200" : "bg-sky-500/15 border-sky-500/30 text-sky-800 dark:text-sky-300")
                        : (isSelected ? "bg-purple-500/30 border-purple-400 text-purple-900 dark:text-purple-200" : "bg-purple-500/15 border-purple-500/30 text-purple-800 dark:text-purple-300")
                )}>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
                    <span>{tunnelsUp || 0} / {tunnelsTotal} Tunnels</span>
                </div>
            )}
        </div>
    );
};

const VyOSRouterNode = ({ data }: any) => {
    const { router, connectedCount = 0, resolutions = [], siteOrder = new Map(), onSelectResolution, onOpenRouterControl } = data;
    const isOnline = router.status !== 'down';
    const blackholeBlocks: Array<{ prefix: string; description?: string }> = Array.isArray(router.blackholeBlocks) ? router.blackholeBlocks : [];
    const blockedCount = blackholeBlocks.length;

    // Helper to check if a resolution's IP or network is in the router's blackhole blocks
    const isResolutionBlocked = (res?: any) => {
        if (!res || blockedCount === 0) return false;
        const wanIp = (res.prismaWan?.ip || '').replace(/\/32$/, '');
        const wanCidr = res.prismaWan?.ipCidr || '';
        const wanNet = res.prismaWan?.network || '';
        return blackholeBlocks.some(b => {
            const cleanPrefix = b.prefix.replace(/\/32$/, '');
            if (wanIp && cleanPrefix === wanIp) return true;
            if (wanCidr && b.prefix === wanCidr) return true;
            if (wanNet && b.prefix === wanNet) return true;
            return false;
        });
    };

    // Group resolutions into Hub-connected and Spoke-connected
    const hubResolutions = resolutions.filter((r: any) => r.isHub);
    const spokeResolutions = resolutions.filter((r: any) => !r.isHub);

    // Identify physical interfaces for this router (exclude loopbacks/dummy/virtual /32)
    const allIfaces = (router.interfaces || []).filter(isPhysicalVyosInterface);

    // Sorting comparator: Sort by connected site's horizontal X position (left to right), then INET before MPLS
    const sortIfacesBySite = (ifaceA: any, ifaceB: any) => {
        const resA = resolutions.find((r: any) => r.vyos?.interfaceName === ifaceA.name);
        const resB = resolutions.find((r: any) => r.vyos?.interfaceName === ifaceB.name);

        const siteA = resA?.prismaWan?.siteName || '';
        const siteB = resB?.prismaWan?.siteName || '';

        const posA = siteOrder.has(siteA) ? siteOrder.get(siteA) : 9999;
        const posB = siteOrder.has(siteB) ? siteOrder.get(siteB) : 9999;

        if (posA !== posB) return posA - posB;

        // Within same site, INET before MPLS
        const linkA = (resA?.prismaWan?.interfaceName || ifaceA.description || '').toLowerCase();
        const linkB = (resB?.prismaWan?.interfaceName || ifaceB.description || '').toLowerCase();
        const isMplsA = linkA.includes('mpls');
        const isMplsB = linkB.includes('mpls');
        if (isMplsA !== isMplsB) return isMplsA ? 1 : -1;

        return ifaceA.name.localeCompare(ifaceB.name);
    };

    // Separate into top (Hub) and bottom (Spoke) interfaces with spatial left-to-right alignment
    const hubIfaces = allIfaces
        .filter((iface: any) => hubResolutions.some((r: any) => r.vyos?.interfaceName === iface.name))
        .sort(sortIfacesBySite);

    const spokeIfaces = allIfaces
        .filter((iface: any) => spokeResolutions.some((r: any) => r.vyos?.interfaceName === iface.name))
        .sort(sortIfacesBySite);

    const displayTopIfaces = hubIfaces;
    const displayBottomIfaces = spokeIfaces.length > 0 ? spokeIfaces : (hubIfaces.length === 0 ? allIfaces : []);

    const renderPortChip = (iface: any, isTop: boolean) => {
        const matchedRes = resolutions.find((r: any) => r.vyos?.interfaceName === iface.name);
        const isConnected = !!matchedRes;
        const isIfaceUp = iface.status !== 'down';
        const isBlocked = isResolutionBlocked(matchedRes);
        const fullIp = iface.address?.[0] || iface.ipCidr || iface.ip || matchedRes?.vyos?.ipCidr || matchedRes?.vyos?.ip || '—';
        const portQos = normalizeQos(iface.qos || matchedRes?.vyos?.qos);
        const hasQos = !!portQos;

        return (
            <div
                key={iface.name}
                onClick={(e) => {
                    e.stopPropagation();
                    if (matchedRes && onSelectResolution) {
                        onSelectResolution(matchedRes);
                    }
                }}
                className={cn(
                    "relative px-4 py-3 rounded-2xl border text-[11px] transition-all flex flex-col justify-between group/port min-w-[205px] max-w-[260px] min-h-[76px] gap-1.5 shadow-sm",
                    isConnected 
                        ? (isBlocked
                            ? "bg-rose-950/20 border-rose-500 hover:border-rose-400 hover:bg-rose-950/30 shadow-md shadow-rose-500/20 ring-1 ring-rose-500/50 cursor-pointer"
                            : isIfaceUp
                                ? "bg-card border-amber-500/50 hover:border-amber-400 hover:bg-card-secondary/70 shadow-md shadow-amber-500/10 cursor-pointer"
                                : "bg-rose-950/20 border-rose-500/50 hover:border-rose-400 hover:bg-rose-950/30 shadow-md shadow-rose-500/10 cursor-pointer") 
                        : "bg-card-secondary/40 border-border text-text-muted opacity-40 cursor-default"
                )}
                title={matchedRes ? `Connected to ${matchedRes.prismaWan.siteName} (${matchedRes.prismaWan.interfaceName})${isBlocked ? ' · 🚫 TRAFFIC BLOCKED' : ''} · Click to inspect` : (iface.description || iface.name)}
            >
                {/* Dedicated ReactFlow Handle for direct 1:1 cable termination */}
                <Handle
                    type="target"
                    position={isTop ? Position.Top : Position.Bottom}
                    id={`vyos-port:${iface.name}`}
                    className="!w-3.5 !h-1.5 !bg-amber-500 dark:!bg-amber-400 !border !border-card !rounded-sm"
                />

                <div className="flex items-center justify-between pb-1 border-b border-border/50 gap-1.5">
                    <span className="font-mono font-black text-amber-700 dark:text-amber-400 flex items-center gap-1.5 shrink-0">
                        <span className={cn("w-2.5 h-2.5 rounded-full", isConnected ? (isIfaceUp ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.8)]" : "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]") : "bg-slate-400 dark:bg-slate-600")} />
                        {iface.name}
                    </span>
                    <div className="flex items-center gap-1 flex-wrap justify-end">
                        {isBlocked && (
                            <span className="text-[8px] font-black px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-700 dark:text-rose-400 border border-rose-500/40 flex items-center gap-0.5 animate-pulse whitespace-nowrap" title="Traffic to this endpoint is blocked by router-level blackhole rule">
                                <ShieldAlert size={9} /> DENIED
                            </span>
                        )}
                        {hasQos && (portQos?.latency ?? 0) > 0 && (
                            <span className="text-[8px] font-black px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-600/45 dark:border-amber-500/40 whitespace-nowrap" title={`Injected Latency: +${portQos?.latency}ms`}>
                                ⏱️ +{portQos?.latency}ms
                            </span>
                        )}
                        {hasQos && (portQos?.loss ?? 0) > 0 && (
                            <span className="text-[8px] font-black px-1.5 py-0.2 rounded bg-orange-500/20 text-orange-800 dark:text-orange-300 border border-orange-600/45 dark:border-orange-500/40 whitespace-nowrap" title={`Injected Packet Loss: ${portQos?.loss}%`}>
                                📉 {portQos?.loss}%
                            </span>
                        )}
                        {isConnected && (
                            <span className="text-[9px] font-black px-1.5 py-0.2 rounded bg-green-500/15 text-green-800 dark:text-green-300 border border-green-600/35 dark:border-green-500/30 truncate max-w-[85px]">
                                {matchedRes.prismaWan.siteName}
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center justify-between font-mono">
                    <span className="text-text-primary font-black text-[11px] whitespace-nowrap tracking-tight">
                        {fullIp}
                    </span>
                </div>

                {iface.description && (
                    <div className="text-[9px] text-text-muted truncate font-mono" title={iface.description}>
                        {iface.description}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="bg-card/95 backdrop-blur-2xl border-2 border-amber-500/50 hover:border-amber-400 rounded-[36px] p-7 shadow-2xl shadow-amber-500/10 dark:shadow-amber-500/20 transition-all group relative flex flex-col justify-between gap-6 min-h-[440px]">
            
            {/* TOP ROW: Hub-facing Physical Ports (Facing DCs at top) */}
            {displayTopIfaces.length > 0 && (
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-[10px] font-black text-amber-700 dark:text-amber-400/90 uppercase tracking-wider px-1">
                        <span>▲ DC & Hub Uplinks ({displayTopIfaces.length})</span>
                        <span className="font-mono text-text-muted">Top Transit</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        {displayTopIfaces.map((iface: any) => renderPortChip(iface, true))}
                    </div>
                </div>
            )}

            {/* CENTER CHASSIS BANNER */}
            <div className="flex items-center justify-between gap-4 p-4.5 bg-card-secondary/80 border border-amber-500/30 rounded-2xl shadow-inner">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-gradient-to-br from-amber-500 to-amber-600 rounded-xl text-white dark:text-slate-950 shadow-lg shadow-amber-500/30 font-black">
                        <Server size={24} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-base font-black text-text-primary tracking-tight uppercase">{router.name}</span>
                            <span className={cn(
                                "w-2.5 h-2.5 rounded-full",
                                isOnline ? "bg-green-500 dark:bg-green-400 shadow-[0_0_8px_rgba(34,197,94,0.8)]" : "bg-red-500"
                            )} />
                            <span className="text-[9px] font-bold text-green-700 dark:text-green-400 uppercase tracking-widest">
                                {isOnline ? 'ONLINE' : 'OFFLINE'}
                            </span>
                        </div>
                        <div className="text-xs text-amber-700 dark:text-amber-400 font-mono font-bold mt-0.5">
                            Mgmt IP: {router.host}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Traffic Control Button */}
                    {onOpenRouterControl && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onOpenRouterControl(router);
                            }}
                            className={cn(
                                "px-3 py-1.5 rounded-xl font-black text-[11px] flex items-center gap-1.5 border transition-all cursor-pointer shadow-sm",
                                blockedCount > 0
                                    ? "bg-rose-500/20 hover:bg-rose-500/30 text-rose-700 dark:text-rose-400 border-rose-500/50 shadow-rose-500/20 ring-1 ring-rose-500/40"
                                    : "bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-300 border-amber-600/45 dark:border-amber-500/40 hover:border-amber-400"
                            )}
                            title="Manage router-level Allow/Deny traffic policies"
                        >
                            {blockedCount > 0 ? (
                                <>
                                    <ShieldAlert size={14} className="text-rose-500 animate-pulse" />
                                    <span>{blockedCount} BLOCKED</span>
                                </>
                            ) : (
                                <>
                                    <Shield size={14} />
                                    <span>TRAFFIC CONTROL</span>
                                </>
                            )}
                        </button>
                    )}

                    <div className="text-right">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-600/45 dark:border-amber-500/40 text-amber-800 dark:text-amber-300 text-[10px] font-black uppercase tracking-wider">
                            <span>{connectedCount} Circuits</span>
                        </div>
                        {router.location && (
                            <div className="text-[10px] text-text-muted mt-1 font-mono">
                                {router.location}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* BOTTOM ROW: Spoke-facing Physical Ports (Facing Branches at bottom) */}
            {displayBottomIfaces.length > 0 && (
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-[10px] font-black text-amber-700 dark:text-amber-400/90 uppercase tracking-wider px-1">
                        <span>▼ Branch & Spoke Downlinks ({displayBottomIfaces.length})</span>
                        <span className="font-mono text-text-muted">Bottom Transit</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        {displayBottomIfaces.map((iface: any) => renderPortChip(iface, false))}
                    </div>
                </div>
            )}
        </div>
    );
};

// --- Peripheral LAN VyOS Router Node (Positioned above DC/Hub LAN or below Branch/Spoke LAN in Underlay mode) ---
const VyOSLanRouterNode = ({ data }: any) => {
    const {
        router,
        siteName,
        isAboveSite = false,
        interfaceItems = [],
        onSelectResolution,
        onOpenRouterControl
    } = data;

    const isOnline = router?.status !== 'down' && router?.status !== 'unreachable' && router?.status !== 'error';
    const blackholeBlocks: Array<{ prefix: string }> = Array.isArray(router?.blackholeBlocks) ? router.blackholeBlocks : [];
    const blockedCount = blackholeBlocks.length;

    const lanLinks = interfaceItems.filter((it: any) => Boolean(it.isIonLan));
    const egressLinks = interfaceItems.filter((it: any) => !it.isIonLan);

    const renderInterfaceChip = (item: any) => {
        const isIfaceUp = item.status !== 'down';
        const portQos = normalizeQos(item.qos);
        const hasQos = !!portQos;
        const isIonLan = Boolean(item.isIonLan);
        const roleLabel = item.roleLabel || (isIonLan ? `${siteName} LAN` : 'EGRESS / NAT');
        const roleTone = item.roleTone || (isIonLan ? 'emerald' : 'blue');

        const badgeClass =
            roleTone === 'emerald'
                ? 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border-emerald-600/45 dark:border-emerald-500/40'
                : roleTone === 'cyan'
                    ? 'bg-cyan-500/20 text-cyan-800 dark:text-cyan-300 border-cyan-600/45 dark:border-cyan-500/40'
                    : roleTone === 'purple'
                        ? 'bg-purple-500/20 text-purple-800 dark:text-purple-300 border-purple-600/45 dark:border-purple-500/40'
                        : roleTone === 'amber'
                            ? 'bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-600/45 dark:border-amber-500/40'
                            : 'bg-blue-500/15 text-blue-800 dark:text-blue-300 border-blue-600/40 dark:border-blue-500/35';

        return (
            <div
                key={item.name}
                onClick={(e) => {
                    e.stopPropagation();
                    if (onSelectResolution && item.resolution) {
                        onSelectResolution(item.resolution);
                    }
                }}
                className={cn(
                    "relative px-3 py-2 rounded-xl border text-[11px] transition-all flex flex-col justify-between min-w-[160px] flex-1 gap-1 shadow-sm cursor-pointer",
                    !isIfaceUp
                        ? "bg-rose-950/25 border-rose-500/60 hover:border-rose-400 shadow-rose-500/10"
                        : hasQos
                            ? "bg-amber-500/15 border-amber-400/70 hover:border-amber-300 shadow-amber-500/15 ring-1 ring-amber-500/30"
                            : isIonLan
                                ? "bg-emerald-500/10 border-emerald-500/45 hover:border-emerald-400 hover:bg-emerald-500/15 shadow-emerald-500/10"
                                : "bg-card border-amber-500/35 hover:border-amber-400 hover:bg-card-secondary/70 shadow-amber-500/10"
                )}
                title={`${item.name} (${item.ipCidr || item.ip || '—'}) • ${isIonLan ? `Connected to ${siteName} Shared LAN` : (item.description || roleLabel)} — Click to configure QoS or Shut`}
            >
                <div className="flex items-center justify-between pb-1 border-b border-border/50 gap-1.5">
                    <span className="font-mono font-black text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                        <span className={cn(
                            "w-2 h-2 rounded-full",
                            isIfaceUp ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.8)]" : "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]"
                        )} />
                        {item.name}
                    </span>
                    <div className="flex items-center gap-1 flex-wrap justify-end">
                        {!isIfaceUp && (
                            <span className="text-[8px] font-black px-1.5 py-0.2 rounded bg-rose-500/25 text-rose-700 dark:text-rose-400 border border-rose-500/40 whitespace-nowrap">
                                SHUT
                            </span>
                        )}
                        {hasQos && (portQos?.latency ?? 0) > 0 && (
                            <span className="text-[8px] font-black px-1.5 py-0.2 rounded bg-amber-500/25 text-amber-800 dark:text-amber-300 border border-amber-600/45 dark:border-amber-500/40 whitespace-nowrap" title={`Injected Latency: +${portQos?.latency}ms`}>
                                ⏱️ +{portQos?.latency}ms
                            </span>
                        )}
                        {hasQos && (portQos?.loss ?? 0) > 0 && (
                            <span className="text-[8px] font-black px-1.5 py-0.2 rounded bg-orange-500/25 text-orange-800 dark:text-orange-300 border border-orange-600/45 dark:border-orange-500/40 whitespace-nowrap" title={`Injected Packet Loss: ${portQos?.loss}%`}>
                                📉 {portQos?.loss}%
                            </span>
                        )}
                        <span className={cn("text-[8px] font-black px-1.5 py-0.2 rounded border uppercase whitespace-nowrap", badgeClass)}>
                            {roleLabel}
                        </span>
                    </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-text-primary font-black text-[11px] whitespace-nowrap tracking-tight">
                        {item.ipCidr || item.ip || '—'}
                    </span>
                    <span className="text-[9px] text-text-muted truncate font-mono max-w-[140px]" title={item.description || roleLabel}>
                        {item.description || (isIonLan ? `Shared LAN (${siteName})` : roleLabel)}
                    </span>
                </div>
            </div>
        );
    };

    const renderEgressSection = () => {
        if (egressLinks.length === 0) return null;
        return (
            <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[9px] font-black text-amber-700 dark:text-amber-400/90 uppercase tracking-wider px-1">
                    <span>{isAboveSite ? '▲ Egress / Transit / Local Subnets' : '▼ Egress / Transit / Local Subnets'}</span>
                    <span className="font-mono text-text-muted">{egressLinks.length} Ports</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                    {egressLinks.map(renderInterfaceChip)}
                </div>
            </div>
        );
    };

    const renderLanDownlinkSection = () => {
        if (lanLinks.length === 0) return null;
        return (
            <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[9px] font-black text-emerald-700 dark:text-emerald-400 uppercase tracking-wider px-1">
                    <span>{isAboveSite ? `▼ ${siteName} Shared LAN Downlink (ION Facing)` : `▲ ${siteName} Shared LAN Uplink (ION Facing)`}</span>
                    <span className="font-mono text-text-muted">{lanLinks.map((l: any) => l.ipCidr?.replace(/\.\d+\//, '.0/') || '').filter(Boolean)[0] || 'LAN Bus'}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {lanLinks.map(renderInterfaceChip)}
                </div>
            </div>
        );
    };

    return (
        <div className="bg-card/95 backdrop-blur-2xl border-2 border-emerald-500/45 hover:border-amber-400 rounded-[26px] p-4 shadow-2xl shadow-emerald-500/10 dark:shadow-amber-500/15 transition-all group relative flex flex-col gap-3 w-[580px] max-w-[600px]">
            {/* Target Handle facing the Site's LAN block (Bottom if router is above a Hub, Top if router is below a Spoke) */}
            <Handle
                type="target"
                position={isAboveSite ? Position.Bottom : Position.Top}
                id="lan-link"
                className="!w-4 !h-2 !bg-emerald-500 dark:!bg-emerald-400 !border !border-card !rounded-sm"
            />

            {/* When above a Hub (DC1/DC2): Egress/Subnets on top (outer), Chassis in middle, ION LAN on bottom (facing DC) */}
            {isAboveSite ? renderEgressSection() : renderLanDownlinkSection()}

            {/* Center Banner: VyOS LAN Router Identity & Traffic Control */}
            <div className="flex items-center justify-between gap-4 px-3.5 py-2.5 bg-card-secondary/80 border border-amber-500/30 rounded-2xl shadow-inner">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl text-white dark:text-slate-950 shadow-md shadow-amber-500/30 font-black">
                        <Server size={17} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-text-primary tracking-tight uppercase">{router?.name || 'VyOS-LAN'}</span>
                            <span className={cn(
                                "w-2 h-2 rounded-full",
                                isOnline ? "bg-green-500 dark:bg-green-400 shadow-[0_0_8px_rgba(34,197,94,0.8)]" : "bg-red-500"
                            )} />
                            <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-600/40 dark:border-emerald-500/35 text-emerald-800 dark:text-emerald-400 text-[9px] font-black uppercase tracking-wider">
                                {siteName} LAN Router
                            </span>
                        </div>
                        <div className="text-[10px] text-amber-700 dark:text-amber-400 font-mono font-bold mt-0.5">
                            Mgmt IP: {router?.host || '—'}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {onOpenRouterControl && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onOpenRouterControl(router);
                            }}
                            className={cn(
                                "px-2.5 py-1.5 rounded-xl font-black text-[10px] flex items-center gap-1.5 border transition-all cursor-pointer shadow-sm",
                                blockedCount > 0
                                    ? "bg-rose-500/20 hover:bg-rose-500/30 text-rose-500 dark:text-rose-400 border-rose-500/50 shadow-rose-500/20 ring-1 ring-rose-500/40"
                                    : "bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 border-amber-500/40 hover:border-amber-400"
                            )}
                            title="Manage router-level Allow/Deny traffic policies"
                        >
                            {blockedCount > 0 ? (
                                <>
                                    <ShieldAlert size={13} className="text-rose-500 animate-pulse" />
                                    <span>{blockedCount} BLOCKED</span>
                                </>
                            ) : (
                                <>
                                    <Shield size={13} />
                                    <span>TRAFFIC CONTROL</span>
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>

            {/* When above a Hub (DC1/DC2): ION LAN on bottom right at the green LAN cable handle */}
            {isAboveSite ? renderLanDownlinkSection() : renderEgressSection()}
        </div>
    );
};

// --- Custom Underlay Peer Gateway Node (Direct 1:1 Interface Block in vis-à-vis) ---
const UnderlayGatewayNode = ({ data }: any) => {
    const { resolution, isHubPeer = false, onInspect } = data;
    const isMatched = resolution?.status === 'matched';
    const vyos = resolution?.vyos;
    const prismaWan = resolution?.prismaWan;

    return (
        <div
            onClick={(e) => {
                e.stopPropagation();
                if (onInspect && resolution) onInspect(resolution);
            }}
            className={cn(
                "p-3 rounded-2xl border-2 shadow-xl backdrop-blur-xl transition-all hover:scale-105 cursor-pointer min-w-[170px] max-w-[210px] flex flex-col gap-1.5 group relative",
                isMatched 
                    ? "bg-card border-amber-500/50 hover:border-amber-400 shadow-amber-500/10" 
                    : "bg-card-secondary border-border hover:border-border-hover shadow-black/20"
            )}
        >
            <Handle
                type="target"
                position={isHubPeer ? Position.Top : Position.Bottom}
                id="target-peer"
                className="!opacity-0"
            />

            {/* Header: Router Name & Status */}
            <div className="flex items-center justify-between pb-1.5 border-b border-border/50">
                <div className="flex items-center gap-1.5 overflow-hidden">
                    <Server size={13} className={isMatched ? "text-amber-500 dark:text-amber-400 shrink-0" : "text-text-muted shrink-0"} />
                    <span className="text-[10px] font-black uppercase text-text-primary tracking-tight truncate">
                        {isMatched ? vyos.routerName : 'External Provider'}
                    </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    <span className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        isMatched ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.8)]" : "bg-slate-400"
                    )} />
                </div>
            </div>

            {/* Interface Name & Tag */}
            <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-black text-amber-500 dark:text-amber-400">
                    {isMatched ? vyos.interfaceName : 'WAN Port'}
                </span>
                <span className={cn(
                    "text-[8px] font-mono font-bold px-1.5 py-0.2 rounded",
                    isMatched ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30" : "bg-card-secondary text-text-muted"
                )}>
                    {isMatched ? (vyos.interfaceType || 'ETH') : 'EXT'}
                </span>
            </div>

            {/* IP Address */}
            <div className="font-mono text-[10px] font-bold text-text-primary">
                {isMatched ? (vyos.ipCidr || vyos.ip || '—') : '—'}
            </div>

            {/* Description / Network */}
            <div className="text-[9px] text-text-muted truncate font-mono" title={isMatched ? (vyos.description || vyos.network) : 'External Network'}>
                {isMatched ? (vyos.description || vyos.network || 'VyOS Interface') : 'External Transit'}
            </div>
        </div>
    );
};

// Helper to format ServiceLink names into clean human-friendly labels
function formatServiceLinkDetails(rawName: string, role?: string, provider?: string, circuitName?: string) {
    if (!rawName) return { title: 'ServiceLink Tunnel', subtitle: '', techName: '' };
    const isZscaler = provider === 'Zscaler' || rawName.toLowerCase().includes('zscaler');
    if (isZscaler) {
        const isPri = role === 'active' || rawName.toLowerCase().includes('primary') || rawName.toLowerCase().includes('pri');
        const roleLabel = isPri ? 'Primary' : 'Backup';
        const prefix = circuitName ? `${circuitName} · ` : '';
        return {
            title: `${prefix}Zscaler ${roleLabel} Path`,
            subtitle: 'Direct ZIA Secure Cloud Gateway',
            techName: rawName
        };
    }
    const n = rawName.toUpperCase();
    let medium = circuitName || '';
    if (!medium) {
        if (n.includes('ETHERNET')) medium = 'Ethernet WAN';
        else if (n.includes('CABLE')) medium = 'Cable Broadband';
        else if (n.includes('LTE') || n.includes('4G')) medium = 'Cellular LTE';
        else if (n.includes('MPLS')) medium = 'Private MPLS';
        else medium = 'Internet';
    }

    const isAct = role === 'active' || n.includes('_ACT');
    const isBkp = role === 'backup' || n.includes('_BKP');
    const roleLabel = isAct ? 'Active Path' : (isBkp ? 'Backup Path' : 'Path');
    return {
        title: `${medium} · ${roleLabel}`,
        subtitle: `Prisma Access IPsec (${roleLabel})`,
        techName: rawName
    };
}

const SasePopNode = ({ data, selected }: any) => {
    const isPrisma = data.provider === 'Prisma Access';
    const isHealthy = data.status === 'healthy';

    return (
        <div className={cn(
            "px-7 py-6 rounded-[32px] border-2 transition-all shadow-2xl backdrop-blur-2xl flex flex-col items-center gap-3.5 w-[480px] max-w-[480px] cursor-pointer hover:scale-105 duration-200 select-none",
            isPrisma
                ? (isHealthy 
                    ? "bg-white/95 dark:bg-purple-950/45 border-purple-300 dark:border-purple-500/55 shadow-purple-500/15 dark:shadow-purple-500/30 hover:border-purple-500" 
                    : "bg-white/90 dark:bg-purple-950/25 border-purple-200 dark:border-purple-500/35")
                : (isHealthy 
                    ? "bg-white/95 dark:bg-blue-950/45 border-blue-300 dark:border-blue-500/55 shadow-blue-500/15 dark:shadow-blue-500/30 hover:border-blue-500" 
                    : "bg-white/90 dark:bg-rose-950/35 border-rose-300 dark:border-rose-500/45 shadow-rose-500/15"),
            selected && (isPrisma 
                ? "ring-4 ring-purple-400 dark:ring-purple-400 shadow-purple-500/40 dark:shadow-purple-500/60" 
                : "ring-4 ring-blue-400 dark:ring-blue-400 shadow-blue-500/40 dark:shadow-blue-500/60")
        )}>
            <Handle type="target" position={Position.Top} id="target-top" className="!opacity-0" />
            <Handle type="target" position={Position.Bottom} id="target-bottom" className="!opacity-0" />

            {/* Provider & Health Header */}
            <div className="flex items-center justify-between w-full gap-3">
                <div className="flex items-center gap-2">
                    {isPrisma ? (
                        <span className="px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider border bg-purple-100 text-purple-700 border-purple-300/80 dark:bg-purple-500/20 dark:text-purple-300 dark:border-purple-500/30 flex items-center gap-2 shadow-sm">
                            <span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />
                            Palo Alto &bull; Prisma Access
                        </span>
                    ) : (
                        <span className="px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider border bg-blue-100 text-blue-700 border-blue-300/80 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/30 flex items-center gap-2 shadow-sm">
                            <span className="w-2 h-2 rounded-full bg-cyan-500 inline-block" />
                            Zscaler &bull; ZIA Cloud
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2 bg-slate-100/80 dark:bg-white/5 px-2.5 py-1 rounded-full border border-slate-200/70 dark:border-white/10">
                    <span className={cn("w-2.5 h-2.5 rounded-full", isHealthy ? "bg-emerald-500 animate-pulse" : "bg-rose-500")} />
                    <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-200">
                        {data.tunnels_up || 0}/{data.tunnels_total || 0} Up
                    </span>
                </div>
            </div>

            {/* Center Icon & Title with Official Logos */}
            <div className="flex items-center gap-4 w-full my-1">
                <div className={cn(
                    "p-3 rounded-2xl shrink-0 flex items-center justify-center border shadow-md transition-colors",
                    isPrisma 
                        ? "bg-purple-50/90 border-purple-200 text-purple-600 dark:bg-white/10 dark:border-purple-500/30 dark:shadow-purple-900/50" 
                        : "bg-blue-50/90 border-blue-200 text-blue-600 dark:bg-white/10 dark:border-blue-500/30 dark:shadow-blue-900/50"
                )}>
                    {isPrisma ? (
                        <img src="/prisma-access.png" alt="Prisma Access" className="w-12 h-12 object-contain filter drop-shadow-sm" />
                    ) : (
                        <img src="/zscaler-logo.png" alt="Zscaler" className="w-12 h-12 object-contain rounded-xl filter drop-shadow-sm" />
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-base font-black text-slate-900 dark:text-text-primary tracking-tight truncate leading-snug" title={data.name}>
                        {data.short_name || data.name}
                    </div>
                    {data.spn_name ? (
                        <div className="text-xs text-slate-500 dark:text-text-muted font-mono truncate font-semibold mt-0.5">
                            SPN: {data.spn_name}
                        </div>
                    ) : (
                        <div className="text-xs text-slate-500 dark:text-text-muted font-mono truncate font-semibold mt-0.5">
                            Region: {data.region || 'global'}
                        </div>
                    )}
                </div>
            </div>

            {/* IP & Telemetry Footer */}
            <div className="w-full pt-3 border-t border-slate-200 dark:border-border/60 flex items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-1.5 text-purple-700 dark:text-cyan-400 font-bold truncate">
                    <span className="text-slate-400 dark:text-slate-400 text-[11px] font-semibold">GW:</span>
                    <span className="truncate">{data.primary_peer_ip || 'Anycast'}</span>
                </div>
                {data.liveliness_probe_ip ? (
                    <div className="text-slate-500 dark:text-text-muted text-[11px] shrink-0 font-medium" title="Liveliness ICMP probe">
                        Probe: {data.liveliness_probe_ip}
                    </div>
                ) : (
                    <div className="text-slate-500 dark:text-text-muted text-[11px] shrink-0 font-medium">
                        {data.connected_sites?.length || 0} Sites
                    </div>
                )}
            </div>
        </div>
    );
};

const nodeTypes = {
    site: SiteNode,
    cloud: CloudNode,
    vyosRouter: VyOSRouterNode,
    vyosLanRouter: VyOSLanRouterNode,
    underlayGateway: UnderlayGatewayNode,
    sasePop: SasePopNode,
};

const edgeTypes = {
    site: SiteEdge,
    archedBridge: ArchedBridgeEdge,
};

// --- Main Topology Component ---

interface TopologyProps {
    token: string;
    theme?: 'light' | 'dark';
}

export default function Topology(props: TopologyProps) {
    return (
        <ReactFlowProvider>
            <TopologyContent {...props} />
        </ReactFlowProvider>
    );
}

function TopologyContent({ token, theme }: TopologyProps) {
    const isDark = (theme ?? (typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light')) === 'dark';
    const [topology, setTopology] = useState<any>(null);
    const { gFetch, activePeerId } = usePeerContext();
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [staleRevalidating, setStaleRevalidating] = useState(false);
    const [buildProgress, setBuildProgress] = useState<{
        stage: number;
        stageKey: string;
        stageLabel: string;
        elapsedMs: number;
        lastDurationMs: number | null;
    }>({
        stage: 1,
        stageKey: 'auth',
        stageLabel: 'Authenticating with Prisma SASE OAuth2 API...',
        elapsedMs: 0,
        lastDurationMs: null,
    });
    const [error, setError] = useState<string | null>(null);
    const [selectedObject, setSelectedObject] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [pathFilter, setPathFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE' | 'DOWN' | 'HUB'>('ALL');
    const [overlaySearchQuery, setOverlaySearchQuery] = useState('');
    const [logicalViewSiteId, setLogicalViewSiteId] = useState<string | null>(null);
    const [bgLayout, setBgLayout] = useState<'flank' | 'top'>('flank');
    const [showBranchMesh, setShowBranchMesh] = useState<boolean>(false);

    // Filter state
    const [visibleSiteIds, setVisibleSiteIds] = useState<string[] | null>(() => {
        try {
            const saved = localStorage.getItem('stigix_topology_visible_sites');
            return saved ? JSON.parse(saved) : null;
        } catch {
            return null;
        }
    });
    const [showFilter, setShowFilter] = useState(false);
    const [filterSearch, setFilterSearch] = useState('');

    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const { fitView, getViewport, setViewport } = useReactFlow();

    // Stigix Fleet Nodes State
    const [fleetNodes, setFleetNodes] = useState<any[]>([]);

    // View & Underlay state
    const [topologyViewMode, setTopologyViewMode] = useState<'physical' | 'overlay' | 'sase' | 'underlay'>('physical');
    const [selectedNetwork, setSelectedNetwork] = useState<'INTERNET' | 'MPLS' | null>(null);
    const [networkTunnelFilter, setNetworkTunnelFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE' | 'DOWN'>('ALL');
    const [overlayTunnelStateFilter, setOverlayTunnelStateFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE' | 'DOWN'>('ALL');
    const [networkTunnelSearch, setNetworkTunnelSearch] = useState('');
    const [underlayData, setUnderlayData] = useState<UnderlayPayload | null>(null);
    const [underlayMode, setUnderlayMode] = useState<'off' | 'badges'>('off');
    const [showUnderlayPanel, setShowUnderlayPanel] = useState(false);
    const [underlayPanelResolution, setUnderlayPanelResolution] = useState<UnderlayResolution | null>(null);
    const [underlayDrawerResolution, setUnderlayDrawerResolution] = useState<UnderlayResolution | null>(null);
    const [showUnderlayMenu, setShowUnderlayMenu] = useState(false);
    const [showUnderlayDiagnostics, setShowUnderlayDiagnostics] = useState(false);
    const [diagnosticsFilter, setDiagnosticsFilter] = useState<'ALL' | 'matched' | 'no_match' | 'ambiguous' | 'wan_ip_unavailable'>('ALL');
    const [diagnosticsSearch, setDiagnosticsSearch] = useState('');
    const [tracerouteTarget, setTracerouteTarget] = useState<string | null>(null);
    const [inspectedLink, setInspectedLink] = useState<any | null>(null);
    const [isInspectingLink, setIsInspectingLink] = useState(false);

    // On-demand live VPN tunnel & LQM telemetry inspection (triggered on tunnel selection or manual Refresh LQM click)
    const inspectedVpnId = inspectedLink?.isOverlayTunnel
        ? String(inspectedLink.debug_vpn_id || inspectedLink.id || '').trim()
        : '';

    const probeLiveTunnelLqm = useCallback((targetVpnId: string, linkSnapshot: any) => {
        if (!targetVpnId || targetVpnId === 'N/A' || !token) return () => {};
        let cancelled = false;
        setIsInspectingLink(true);
        const params = new URLSearchParams();
        if (linkSnapshot?.sourceSiteName) params.set('srcSiteName', String(linkSnapshot.sourceSiteName));
        if (linkSnapshot?.peer_site_name) params.set('dstSiteName', String(linkSnapshot.peer_site_name));
        if (linkSnapshot?.sourceSiteId) params.set('srcSiteId', String(linkSnapshot.sourceSiteId));
        if (linkSnapshot?.peer_site_id) params.set('dstSiteId', String(linkSnapshot.peer_site_id));
        params.set('_t', String(Date.now()));

        gFetch(`/api/topology/vpn-link/${encodeURIComponent(targetVpnId)}/inspect?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
            .then(r => (r.ok ? r.json() : null))
            .then(liveData => {
                if (cancelled || !liveData) return;
                setInspectedLink((prev: any) => {
                    if (!prev) return prev;
                    const curId = String(prev.debug_vpn_id || prev.id || '').trim();
                    if (curId !== targetVpnId) return prev;
                    return {
                        ...prev,
                        _liveInspectedVpnId: targetVpnId,
                        inspectedAt: liveData.inspectedAt,
                        status_reason: liveData.status_reason ?? prev.status_reason,
                        status_reason_code: liveData.status_reason_code ?? prev.status_reason_code,
                        status_reason_detail: liveData.status_reason_detail ?? prev.status_reason_detail,
                        uptime_sec: liveData.uptime_sec ?? prev.uptime_sec,
                        flap_count: liveData.flap_count ?? prev.flap_count,
                        cipher: liveData.cipher || prev.cipher,
                        keepalive_interval_ms: liveData.keepalive_interval_ms ?? prev.keepalive_interval_ms,
                        keepalive_retries: liveData.keepalive_retries ?? prev.keepalive_retries,
                        anynet_type: liveData.anynet_type || prev.anynet_type,
                        local_vep_id: liveData.src_vep_id || prev.local_vep_id,
                        peer_vep_id: liveData.dst_vep_id || prev.peer_vep_id,
                        latency: liveData.latency ?? prev.latency,
                        packet_loss: liveData.packet_loss ?? prev.packet_loss,
                        packet_loss_ingress: liveData.packet_loss_ingress ?? prev.packet_loss_ingress,
                        packet_loss_egress: liveData.packet_loss_egress ?? prev.packet_loss_egress,
                        jitter: liveData.jitter ?? prev.jitter,
                        jitter_ingress: liveData.jitter_ingress ?? prev.jitter_ingress,
                        jitter_egress: liveData.jitter_egress ?? prev.jitter_egress,
                        mos: liveData.mos ?? prev.mos,
                        mos_ingress: liveData.mos_ingress ?? prev.mos_ingress,
                        mos_egress: liveData.mos_egress ?? prev.mos_egress,
                    };
                });
            })
            .catch(() => {})
            .finally(() => {
                if (!cancelled) setIsInspectingLink(false);
            });

        return () => {
            cancelled = true;
        };
    }, [token, gFetch]);

    useEffect(() => {
        if (!inspectedVpnId || inspectedVpnId === 'N/A') return;
        return probeLiveTunnelLqm(inspectedVpnId, inspectedLink);
    }, [inspectedVpnId, probeLiveTunnelLqm]);

    const [hoveredEdge, setHoveredEdge] = useState<{ data: any; x: number; y: number } | null>(null);
    const [popTunnelFilter, setPopTunnelFilter] = useState<'ALL' | 'ACTIVE' | 'BACKUP' | 'DOWN'>('ALL');
    const [saseTunnelTypeFilter, setSaseTunnelTypeFilter] = useState<'ALL' | 'ACTIVE' | 'BACKUP' | 'DOWN'>('ALL');
    const [selectedCircuit, setSelectedCircuit] = useState<any | null>(null);
    const [circuitTunnelFilter, setCircuitTunnelFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE' | 'DOWN'>('ALL');
    const [circuitTunnelSearch, setCircuitTunnelSearch] = useState('');

    const handleSelectCircuit = useCallback((circuitInfo: any) => {
        if (selectedCircuit?.circuitKey === circuitInfo.circuitKey) {
            setSelectedCircuit(null);
            setSelectedObject(null);
        } else {
            setSelectedCircuit(circuitInfo);
            setSelectedObject({
                type: 'circuit_tunnels',
                siteId: circuitInfo.siteId,
                siteName: circuitInfo.siteName,
                devName: circuitInfo.devName,
                circuitKey: circuitInfo.circuitKey,
                wan: circuitInfo.wan,
                name: `${circuitInfo.siteName} · ${circuitInfo.wan?.circuit_label || circuitInfo.wan?.name}`,
                circuitName: circuitInfo.wan?.circuit_label || circuitInfo.wan?.name,
            });
            setCircuitTunnelFilter('ALL');
            setCircuitTunnelSearch('');
        }
    }, [selectedCircuit]);

    const handleViewModeChange = useCallback((mode: 'physical' | 'overlay' | 'sase' | 'underlay') => {
        setTopologyViewMode(mode);
        setSelectedNetwork(null);
        setLogicalViewSiteId(null);
        setInspectedLink(null);
        setHoveredEdge(null);
        setSelectedCircuit(null);
        setSelectedObject(null);
        setEdges([]); // Clean React Flow canvas edges immediately to avoid stale cross-mode edge persistence
    }, [setEdges]);

    // VyOS Direct Action State (Interactive Topology Controls)
    const [isVyosExecuting, setIsVyosExecuting] = useState(false);
    const [vyosExecutingAction, setVyosExecutingAction] = useState<string | null>(null);
    const [vyosActionResult, setVyosActionResult] = useState<{ success: boolean; message: string; durationMs?: number } | null>(null);
    const [showNetemModal, setShowNetemModal] = useState(false);
    const [netemLatency, setNetemLatency] = useState(100);
    const [netemLoss, setNetemLoss] = useState(0);
    const [netemTarget, setNetemTarget] = useState<{ routerName: string; interfaceName: string; siteName?: string } | null>(null);
    const [portShutStates, setPortShutStates] = useState<Record<string, boolean>>({});
    const [portQosStates, setPortQosStates] = useState<Record<string, { latency?: number; loss?: number }>>({});
    const [selectedRouterForTrafficControl, setSelectedRouterForTrafficControl] = useState<any | null>(null);

    // Discovered unique lab sites and IP endpoints for quick selection in traffic control
    const discoveredSitesForVyos = useMemo(() => {
        const seen = new Set<string>();
        const list: Array<{ siteName: string; ip: string; ipCidr?: string; network?: string; interfaceName?: string }> = [];
        (underlayData?.resolutions || []).forEach(res => {
            const ip = res.prismaWan?.ip;
            const siteName = res.prismaWan?.siteName;
            if (ip && siteName && !seen.has(ip)) {
                seen.add(ip);
                list.push({
                    siteName,
                    ip,
                    ipCidr: res.prismaWan?.ipCidr || undefined,
                    network: res.prismaWan?.network || undefined,
                    interfaceName: res.prismaWan?.interfaceName || undefined
                });
            }
        });
        return list;
    }, [underlayData?.resolutions]);

    // Dynamic helper to resolve the true current status of any VyOS interface
    const getVyosInterfaceStatus = useCallback((routerName?: string | null, ifaceName?: string | null): 'up' | 'down' => {
        if (!routerName || !ifaceName) return 'up';
        const portKey = `${routerName}:${ifaceName}`;
        if (portShutStates[portKey] !== undefined) {
            return portShutStates[portKey] ? 'down' : 'up';
        }
        // Check router in underlayData
        const rObj = (underlayData?.routers || []).find(r => 
            (r.name && r.name.toLowerCase() === routerName.toLowerCase()) || 
            (r.id && r.id.toLowerCase() === routerName.toLowerCase())
        );
        const ifObj = rObj?.interfaces?.find(i => i.name.toLowerCase() === ifaceName.toLowerCase());
        if (ifObj?.status) {
            return ifObj.status.toLowerCase() === 'down' ? 'down' : 'up';
        }
        // Check resolutions (WAN + LAN)
        const allRes = [...(underlayData?.resolutions || []), ...(underlayData?.lanResolutions || [])];
        const resObj = allRes.find(r => 
            r.vyos?.routerName.toLowerCase() === routerName.toLowerCase() && 
            r.vyos?.interfaceName.toLowerCase() === ifaceName.toLowerCase()
        );
        if (resObj?.vyos?.status) {
            return resObj.vyos.status.toLowerCase() === 'down' ? 'down' : 'up';
        }
        return 'up';
    }, [portShutStates, underlayData]);

    // Dynamic helper to resolve the true current QoS impairment of any VyOS interface
    const getVyosInterfaceQos = useCallback((routerName?: string | null, ifaceName?: string | null): { latency?: number; loss?: number } | null => {
        if (!routerName || !ifaceName) return null;
        const portKey = `${routerName}:${ifaceName}`;
        if (portQosStates[portKey] !== undefined) {
            return normalizeQos(portQosStates[portKey]);
        }
        // Check router in underlayData
        const rObj = (underlayData?.routers || []).find(r => 
            (r.name && r.name.toLowerCase() === routerName.toLowerCase()) || 
            (r.id && r.id.toLowerCase() === routerName.toLowerCase())
        );
        const ifObj = rObj?.interfaces?.find(i => i.name.toLowerCase() === ifaceName.toLowerCase());
        if (ifObj?.qos) {
            const norm = normalizeQos(ifObj.qos);
            if (norm) return norm;
        }
        // Check resolutions (WAN + LAN)
        const allRes = [...(underlayData?.resolutions || []), ...(underlayData?.lanResolutions || [])];
        const resObj = allRes.find(r => 
            r.vyos?.routerName.toLowerCase() === routerName.toLowerCase() && 
            r.vyos?.interfaceName.toLowerCase() === ifaceName.toLowerCase()
        );
        if (resObj?.vyos?.qos) {
            const norm = normalizeQos(resObj.vyos.qos);
            if (norm) return norm;
        }
        return null;
    }, [portQosStates, underlayData]);

    // Periodic light background refresh of underlay interface statuses every 6 seconds
    useEffect(() => {
        if (!token) return;
        const interval = setInterval(() => {
            gFetch('/api/topology/underlay-debug', {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            .then(r => r.json())
            .then(d => {
                if (d?.underlay) {
                    setUnderlayData(d.underlay);
                }
            })
            .catch(() => {});
        }, 6000);
        return () => clearInterval(interval);
    }, [token, activePeerId]);

    // 1-Click Copy ION CLI command helper
    const [copiedCliKey, setCopiedCliKey] = useState<string | null>(null);

    const handleCopyCli = useCallback((key: string, text: string) => {
        if (!text) return;
        navigator.clipboard?.writeText(text).catch(() => {});
        setCopiedCliKey(key);
        setTimeout(() => {
            setCopiedCliKey(prev => (prev === key ? null : prev));
        }, 1800);
    }, []);

    const handleVyosDirectAction = async (
        routerName: string,
        iface?: string,
        command: string = '',
        params: any = {},
        siteName?: string
    ): Promise<{ success: boolean; durationMs?: number; error?: string }> => {
        setIsVyosExecuting(true);
        setVyosExecutingAction(command);
        setVyosActionResult(null);
        try {
            const res = await gFetch('/api/vyos/direct-action', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    routerName,
                    interface: iface || undefined,
                    command,
                    params,
                    source: `Topology: ${siteName || 'Router'} ${iface ? `(${iface})` : ''}`
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to execute VyOS action');
            }

            if (iface) {
                const portKey = `${routerName}:${iface}`;
                if (command === 'shut') {
                    setPortShutStates(prev => ({ ...prev, [portKey]: true }));
                } else if (command === 'no-shut') {
                    setPortShutStates(prev => ({ ...prev, [portKey]: false }));
                } else if (command === 'set-qos') {
                    setPortQosStates(prev => ({ ...prev, [portKey]: { latency: params.latency, loss: params.loss } }));
                } else if (command === 'clear-qos') {
                    setPortQosStates(prev => {
                        const copy = { ...prev };
                        delete copy[portKey];
                        return copy;
                    });
                }
            }

            // Immediately poll /api/topology/underlay-debug to refresh underlay routers, interface statuses, and blackhole blocks
            gFetch('/api/topology/underlay-debug', {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            .then(r => r.json())
            .then(d => {
                if (d?.underlay) {
                    setUnderlayData(d.underlay);
                    // Also refresh the router selected in traffic control modal if open
                    if (d.underlay.routers) {
                        setSelectedRouterForTrafficControl((prev: any) => {
                            if (!prev) return null;
                            const found = d.underlay.routers.find((r: any) => 
                                (r.name && r.name.toLowerCase() === prev.name?.toLowerCase()) || 
                                (r.id && r.id.toLowerCase() === prev.id?.toLowerCase())
                            );
                            return found ? { ...found } : prev;
                        });
                    }
                }
            })
            .catch(() => {});

            let successMsg = `Action ${command} executed successfully`;
            if (command === 'shut') successMsg = `Port ${iface} disabled (SHUT)`;
            else if (command === 'no-shut') successMsg = `Port ${iface} enabled (NO SHUT)`;
            else if (command === 'clear-qos') successMsg = `QoS cleared on ${iface}`;
            else if (command === 'set-qos') successMsg = `Applied QoS (+${params.latency || 0}ms, ${params.loss || 0}% loss) on ${iface}`;
            else if (command === 'deny-traffic') successMsg = `Traffic blocked for ${params.ip || 'target'} on ${routerName}`;
            else if (command === 'allow-traffic') successMsg = `Traffic unblocked for ${params.ip || 'target'} on ${routerName}`;
            else if (command === 'clear-all-blocks') successMsg = `All traffic blocks cleared on ${routerName}`;

            setVyosActionResult({
                success: true,
                message: successMsg,
                durationMs: data.durationMs
            });

            setTimeout(() => setVyosActionResult(null), 5000);
            setShowNetemModal(false);
            return { success: true, durationMs: data.durationMs };
        } catch (err: any) {
            setVyosActionResult({
                success: false,
                message: err.message
            });
            return { success: false, error: err.message };
        } finally {
            setIsVyosExecuting(false);
            setVyosExecutingAction(null);
        }
    };

    const renderVyosControls = (res: UnderlayResolution) => {
        if (!res.vyos) return null;
        const routerName = res.vyos.routerName;
        const iface = res.vyos.interfaceName;
        const isShut = getVyosInterfaceStatus(routerName, iface) === 'down';
        const activeQos = getVyosInterfaceQos(routerName, iface);
        const hasActiveQos = !!activeQos;

        const isShutting = isVyosExecuting && (vyosExecutingAction === 'shut' || vyosExecutingAction === 'no-shut');
        const isInjecting = isVyosExecuting && vyosExecutingAction === 'set-qos';
        const isClearing = isVyosExecuting && vyosExecutingAction === 'clear-qos';

        return (
            <div className="bg-card-secondary/80 border border-amber-500/30 rounded-2xl p-3.5 space-y-3 shadow-inner">
                {/* Actions Header */}
                <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase text-amber-600 dark:text-amber-400 tracking-wider flex items-center gap-1.5">
                        <Zap size={13} className="fill-amber-500" /> VyOS Interactive Actions
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        {hasActiveQos && (activeQos?.latency ?? 0) > 0 && (
                            <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/40 text-[9px] font-mono font-bold flex items-center gap-1 whitespace-nowrap">
                                ⏱️ +{activeQos?.latency}ms
                            </span>
                        )}
                        {hasActiveQos && (activeQos?.loss ?? 0) > 0 && (
                            <span className="px-2 py-0.5 rounded-md bg-orange-500/20 text-orange-400 border border-orange-500/40 text-[9px] font-mono font-bold flex items-center gap-1 whitespace-nowrap">
                                📉 {activeQos?.loss}% loss
                            </span>
                        )}
                        {isShut && (
                            <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-500 border border-rose-500/30 text-[9px] font-mono font-bold flex items-center gap-1 whitespace-nowrap">
                                <Power size={10} /> SHUT
                            </span>
                        )}
                        <span className="text-[9px] font-mono px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300 font-bold border border-amber-500/20 whitespace-nowrap">
                            {routerName}:{iface}
                        </span>
                    </div>
                </div>

                {/* Real-time Progress Bar while VyOS API executes */}
                {isVyosExecuting && (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-2.5 space-y-1.5 animate-fadeIn">
                        <div className="flex items-center justify-between text-[11px] font-mono">
                            <span className="flex items-center gap-1.5 font-bold text-amber-700 dark:text-amber-300">
                                <Loader2 size={13} className="animate-spin text-amber-500" />
                                {vyosExecutingAction === 'shut'
                                    ? `Disabling ${iface} via VyOS API...`
                                    : vyosExecutingAction === 'no-shut'
                                    ? `Restoring ${iface} via VyOS API...`
                                    : vyosExecutingAction === 'clear-qos'
                                    ? `Clearing QoS on ${iface} via VyOS API...`
                                    : `Applying Netem QoS to ${iface} via VyOS API...`}
                            </span>
                            <span className="text-[9.5px] text-amber-600 dark:text-amber-400 font-mono font-bold">~3-4s</span>
                        </div>
                        <div className="h-1.5 w-full bg-amber-500/20 rounded-full overflow-hidden relative">
                            <div className="h-full bg-amber-500 rounded-full animate-laser w-2/3" />
                        </div>
                    </div>
                )}

                {/* 3 Action Buttons */}
                <div className="grid grid-cols-3 gap-2">
                    {/* 1. Shut / No-Shut Toggle */}
                    <button
                        type="button"
                        onClick={() => handleVyosDirectAction(
                            routerName,
                            iface,
                            isShut ? 'no-shut' : 'shut',
                            {},
                            res.prismaWan.siteName
                        )}
                        disabled={isVyosExecuting}
                        className={cn(
                            "h-[54px] rounded-xl font-bold flex flex-col items-center justify-center gap-1 transition-all border shadow-sm cursor-pointer disabled:opacity-60 disabled:cursor-wait relative overflow-hidden",
                            isShut
                                ? "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 ring-1 ring-emerald-500/40"
                                : "bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-400 border-rose-500/30",
                            isShutting && "ring-2 ring-amber-500/60 bg-amber-500/15"
                        )}
                        title={isShut ? "Restore link (no-shut)" : "Simulate link cut (shut interface)"}
                    >
                        {isShutting ? (
                            <Loader2 size={15} className="animate-spin text-amber-500" />
                        ) : (
                            <Power size={14} />
                        )}
                        <span className="text-[10px] tracking-wide font-black">
                            {isShutting ? (isShut ? 'RESTORING...' : 'SHUTTING...') : (isShut ? 'NO SHUT' : 'SHUT PORT')}
                        </span>
                        {isShutting && (
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-amber-500/20 overflow-hidden">
                                <div className="h-full bg-amber-500 animate-laser w-full" />
                            </div>
                        )}
                    </button>

                    {/* 2. Inject Netem */}
                    <button
                        type="button"
                        onClick={() => {
                            setNetemTarget({
                                routerName,
                                interfaceName: iface,
                                siteName: res.prismaWan.siteName
                            });
                            setNetemLatency(activeQos?.latency || 100);
                            setNetemLoss(activeQos?.loss || 0);
                            setShowNetemModal(true);
                        }}
                        disabled={isVyosExecuting}
                        className={cn(
                            "h-[54px] rounded-xl font-bold border flex flex-col items-center justify-center gap-1 transition-all shadow-sm cursor-pointer disabled:opacity-60 disabled:cursor-wait relative overflow-hidden",
                            hasActiveQos
                                ? "bg-amber-500/25 text-amber-300 border-amber-500/60 ring-1 ring-amber-500/40"
                                : "bg-amber-500/15 hover:bg-amber-500/25 text-amber-600 dark:text-amber-400 border-amber-500/30",
                            isInjecting && "ring-2 ring-amber-500/60 bg-amber-500/15"
                        )}
                        title="Inject latency, jitter, or packet loss via netem"
                    >
                        {isInjecting ? (
                            <Loader2 size={15} className="animate-spin text-amber-500" />
                        ) : (
                            <Sliders size={14} />
                        )}
                        <span className="text-[10px] tracking-wide font-black">
                            {isInjecting ? 'INJECTING...' : 'INJECT QOS'}
                        </span>
                        {isInjecting && (
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-amber-500/20 overflow-hidden">
                                <div className="h-full bg-amber-500 animate-laser w-full" />
                            </div>
                        )}
                    </button>

                    {/* 3. Clear QoS */}
                    <button
                        type="button"
                        onClick={() => handleVyosDirectAction(
                            routerName,
                            iface,
                            'clear-qos',
                            {},
                            res.prismaWan.siteName
                        )}
                        disabled={isVyosExecuting || !hasActiveQos}
                        className={cn(
                            "h-[54px] rounded-xl font-bold flex flex-col items-center justify-center gap-1 transition-all shadow-sm border relative overflow-hidden",
                            hasActiveQos
                                ? "bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border-rose-500/40 cursor-pointer disabled:opacity-60 disabled:cursor-wait"
                                : "bg-card/40 border-border/40 text-text-muted/40 cursor-not-allowed",
                            isClearing && "ring-2 ring-amber-500/60 bg-amber-500/15"
                        )}
                        title="Remove netem latency/loss rules"
                    >
                        {isClearing ? (
                            <Loader2 size={15} className="animate-spin text-amber-500" />
                        ) : (
                            <RotateCcw size={14} />
                        )}
                        <span className="text-[10px] tracking-wide font-black">
                            {isClearing ? 'CLEARING...' : 'CLEAR QOS'}
                        </span>
                        {isClearing && (
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-amber-500/20 overflow-hidden">
                                <div className="h-full bg-amber-500 animate-laser w-full" />
                            </div>
                        )}
                    </button>
                </div>

                {/* Router-Level Firewall Control for Connected ION Endpoint (only when port is connected to an ION) */}
                {res.prismaWan.linkType !== 'LAN-EGRESS' && (() => {
                    const targetIp = res.prismaWan.ip || res.vyos.ip || '';
                    const rObj = (underlayData?.routers || []).find(r => 
                        (r.name && r.name.toLowerCase() === routerName.toLowerCase()) || 
                        (r.id && r.id.toLowerCase() === routerName.toLowerCase())
                    );
                    const cleanTargetIp = targetIp.replace(/\/32$/, '');
                    const isIpBlocked = !!(rObj?.blackholeBlocks || []).some((b: any) => {
                        const cleanPrefix = b.prefix.replace(/\/32$/, '');
                        return (cleanTargetIp && cleanPrefix === cleanTargetIp) || 
                               (res.prismaWan.ipCidr && b.prefix === res.prismaWan.ipCidr) ||
                               (res.prismaWan.network && b.prefix === res.prismaWan.network);
                    });
                    const isBlocking = isVyosExecuting && (vyosExecutingAction === 'deny-traffic' || vyosExecutingAction === 'allow-traffic');

                    return (
                        <div className="pt-2 border-t border-border/50 flex items-center justify-between gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    if (isIpBlocked) {
                                        handleVyosDirectAction(routerName, undefined, 'allow-traffic', { ip: targetIp }, res.prismaWan.siteName);
                                    } else {
                                        handleVyosDirectAction(routerName, undefined, 'deny-traffic', { ip: targetIp }, res.prismaWan.siteName);
                                    }
                                }}
                                disabled={isVyosExecuting || !targetIp}
                                className={cn(
                                    "flex-1 py-2 px-3 rounded-xl font-bold text-[11px] flex items-center justify-center gap-1.5 transition-all border shadow-sm cursor-pointer disabled:opacity-60 disabled:cursor-wait",
                                    isIpBlocked
                                        ? "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 border-emerald-500/40"
                                        : "bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-400 border-rose-500/40"
                                )}
                                title={isIpBlocked ? `Allow traffic from/to ${targetIp}` : `Block traffic from/to ${targetIp} via router blackhole`}
                            >
                                {isBlocking ? (
                                    <Loader2 size={13} className="animate-spin text-amber-500" />
                                ) : isIpBlocked ? (
                                    <ShieldCheck size={13} />
                                ) : (
                                    <ShieldAlert size={13} />
                                )}
                                <span className="font-mono tracking-tight">
                                    {isBlocking 
                                        ? 'UPDATING...' 
                                        : isIpBlocked 
                                            ? `ALLOW SITE (${targetIp})` 
                                            : `DENY SITE (${targetIp})`}
                                </span>
                            </button>

                            {rObj && (
                                <button
                                    type="button"
                                    onClick={() => setSelectedRouterForTrafficControl(rObj)}
                                    className="py-2 px-2.5 rounded-xl bg-card hover:bg-card-hover border border-border text-text-muted hover:text-text-primary text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer"
                                    title="Open full Traffic Control Manager for this router"
                                >
                                    <Shield size={12} />
                                    <span>Rules ({rObj.blackholeBlocks?.length || 0})</span>
                                </button>
                            )}
                        </div>
                    );
                })()}

                {/* Feedback Message */}
                {vyosActionResult && (
                    <div className={cn(
                        "p-2.5 rounded-xl text-[11px] font-mono flex items-center justify-between border animate-fadeIn",
                        vyosActionResult.success
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                            : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
                    )}>
                        <span className="truncate max-w-[280px]">{vyosActionResult.message}</span>
                        {vyosActionResult.durationMs !== undefined && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-card font-bold">{vyosActionResult.durationMs}ms</span>
                        )}
                    </div>
                )}
            </div>
        );
    };

    // Persist visibility selection
    useEffect(() => {
        if (visibleSiteIds) {
            localStorage.setItem('stigix_topology_visible_sites', JSON.stringify(visibleSiteIds));
        }
    }, [visibleSiteIds]);
    
    // Helper to detect if any pure Datacenter / Cloud Hubs exist
    const hasPureHubs = useMemo(() => {
        if (!topology?.sites) return false;
        return topology.sites.some((s: any) => {
            const role = (s.element_cluster_role || s.site_role || '').toUpperCase();
            const isBG = s.branch_gateway === true || s.branch_gateway === 'true';
            return role === 'HUB' && !isBG;
        });
    }, [topology]);

    // When pure hubs exist and bgLayout is 'flank', Branch Gateway sits on the flank.
    // When no pure hubs exist (Case B), or user forces top, Branch Gateway acts as top hub.
    const effectiveBgAsHub = !hasPureHubs || bgLayout === 'top';

    // Map site names to their hub status for quick lookup in PathFilter
    const siteHubStatus = useMemo(() => {
        const map = new Map<string, boolean>();
        if (!topology?.sites) return map;
        topology.sites.forEach((s: any) => {
            const role = (s.element_cluster_role || s.site_role || '').toUpperCase();
            const isBG = s.branch_gateway === true || s.branch_gateway === 'true';
            map.set(s.site_name, role === 'HUB' || (isBG && effectiveBgAsHub));
        });
        return map;
    }, [topology, effectiveBgAsHub]);

    // Map site/device/wan-interface to WAN IP address for resolving remote peer endpoints
    const peerWanIpMap = useMemo(() => {
        const map = new Map<string, string>();
        if (!topology?.sites) return map;
        topology.sites.forEach((s: any) => {
            const siteName = (s.site_name || '').toLowerCase().trim();
            const siteId = s.site_id;
            (s.devices || []).forEach((d: any) => {
                const devName = (d.device_name || '').toLowerCase().trim();
                const devId = d.id || d.element_id;
                (d.wan_interfaces || []).forEach((w: any) => {
                    const ip = w.ip || w.public_ip;
                    if (!ip || ip === 'N/A') return;
                    const wanName = (w.name || '').toLowerCase().trim();
                    const wanLabel = (w.circuit_label || '').toLowerCase().trim();
                    const wanId = w.id;

                    if (siteName && devName && wanName) map.set(`${siteName}:${devName}:${wanName}`, ip);
                    if (siteName && devName && wanLabel) map.set(`${siteName}:${devName}:${wanLabel}`, ip);
                    if (siteName && wanName) map.set(`${siteName}:${wanName}`, ip);
                    if (siteName && wanLabel) map.set(`${siteName}:${wanLabel}`, ip);
                    if (siteId && wanId) map.set(`${siteId}:${wanId}`, ip);
                    if (devId && wanId) map.set(`${devId}:${wanId}`, ip);
                    if (wanId) map.set(String(wanId), ip);
                });
            });
        });
        return map;
    }, [topology]);

    const resolveWanIp = useCallback((siteName?: string, devName?: string, wanName?: string, fallback?: string): string => {
        if (fallback && fallback !== 'N/A' && fallback !== '') return fallback;
        if (!siteName || !wanName) return fallback || 'N/A';
        const s = siteName.toLowerCase().trim();
        const d = (devName || '').toLowerCase().trim();
        const w = wanName.toLowerCase().trim();
        if (d && peerWanIpMap.has(`${s}:${d}:${w}`)) return peerWanIpMap.get(`${s}:${d}:${w}`)!;
        if (peerWanIpMap.has(`${s}:${w}`)) return peerWanIpMap.get(`${s}:${w}`)!;
        return fallback || 'N/A';
    }, [peerWanIpMap]);

    const isHubLike = useCallback((s: any) => {
        if (!s) return false;
        // Optimization: if we have the map and the name, use it. Otherwise compute.
        if (s.site_name && siteHubStatus.has(s.site_name)) {
            return siteHubStatus.get(s.site_name);
        }
        const role = (s.element_cluster_role || s.site_role || '').toUpperCase();
        const isBG = s.branch_gateway === true || s.branch_gateway === 'true';
        return role === 'HUB' || (isBG && effectiveBgAsHub);
    }, [siteHubStatus, effectiveBgAsHub]);

    // Build a lookup: siteName → LAN-connected VyOS routers with all their IPv4 interfaces (ION LAN + Egress/NAT/BGP)
    const siteLanVyosMap = useMemo(() => {
        const map = new Map<string, any[]>();
        if (!underlayData?.lanResolutions) return map;

        const allRouters = underlayData.routers || [];
        const matchedLanResolutions = underlayData.lanResolutions.filter(
            (r) => r.status === 'matched' && r.vyos?.routerName && r.prismaWan?.siteName
        );

        // Group by siteName -> routerName
        const bySite = new Map<string, Map<string, UnderlayResolution[]>>();
        matchedLanResolutions.forEach((res) => {
            const sName = res.prismaWan.siteName;
            const rName = res.vyos?.routerName;
            if (!sName || !rName) return;
            if (!bySite.has(sName)) bySite.set(sName, new Map());
            const rMap = bySite.get(sName)!;
            if (!rMap.has(rName)) rMap.set(rName, []);
            rMap.get(rName)!.push(res);
        });

        bySite.forEach((rMap, siteName) => {
            const siteRouters: any[] = [];
            rMap.forEach((resList, routerName) => {
                const primaryLanRes = resList[0];
                const fromPayload = allRouters.find(
                    (r) =>
                        (r.name && r.name.toLowerCase() === routerName.toLowerCase()) ||
                        (r.id && r.id.toLowerCase() === routerName.toLowerCase())
                );

                const matchedLanIfNames = new Set(
                    resList.map((r) => (r.vyos?.interfaceName || '').toLowerCase()).filter(Boolean)
                );

                // Collect all physical IPv4 interfaces on this VyOS router (ION LAN + Egress/NAT/BGP), excluding loopbacks/dummy/virtual and SSH MGMT
                const rawIfaces = new Map<string, any>();
                const mgmtHost = (fromPayload?.host || '').trim();
                (fromPayload?.interfaces || []).forEach((iface: any) => {
                    if (!isPhysicalVyosInterface(iface)) return;
                    const ifLower = iface.name.toLowerCase();
                    const isMatchedLan = matchedLanIfNames.has(ifLower);
                    const descLower = (iface.description || '').toLowerCase();
                    const ifaceIp = iface.ip || (iface.ipCidr ? iface.ipCidr.split('/')[0] : (iface.address?.[0] ? iface.address[0].split('/')[0] : ''));
                    // Filter out dedicated SSH management port (unless it is somehow the matched ION LAN interface)
                    if (!isMatchedLan && (descLower.includes('mgmt') || descLower.includes('management') || (mgmtHost && ifaceIp === mgmtHost) || (ifLower === 'eth0' && ifaceIp.startsWith('192.168.122.')))) {
                        return;
                    }
                    const hasIp = Boolean(iface.ip || iface.ipCidr || (Array.isArray(iface.address) && iface.address.length > 0));
                    if (!hasIp && !isMatchedLan) return;
                    rawIfaces.set(iface.name, { ...iface });
                });

                // Ensure all matched LAN interfaces are present
                resList.forEach((res) => {
                    const ifName = res.vyos?.interfaceName;
                    if (!ifName) return;
                    const existing = rawIfaces.get(ifName) || {};
                    const ipCidr = res.vyos?.ipCidr || res.vyos?.ip || existing.ipCidr || existing.address?.[0];
                    rawIfaces.set(ifName, {
                        ...existing,
                        name: ifName,
                        type: existing.type || 'ethernet',
                        description: existing.description || res.vyos?.description,
                        ipCidr,
                        ip: res.vyos?.ip || existing.ip || (ipCidr ? ipCidr.split('/')[0] : undefined),
                        network: res.vyos?.network || existing.network,
                        status: res.vyos?.status || existing.status || 'up',
                        qos: res.vyos?.qos || existing.qos || null,
                    });
                });

                // Sort interfaces so ION-connected LAN interfaces appear first, then Egress/NAT interfaces by name
                const sortedIfaces = Array.from(rawIfaces.values()).sort((a, b) => {
                    const aIsLan = matchedLanIfNames.has(a.name.toLowerCase()) ? 0 : 1;
                    const bIsLan = matchedLanIfNames.has(b.name.toLowerCase()) ? 0 : 1;
                    if (aIsLan !== bIsLan) return aIsLan - bIsLan;
                    return a.name.localeCompare(b.name);
                });

                const inferInterfaceRole = (iface: any, isIonLan: boolean, ipStr: string) => {
                    if (isIonLan) return { roleLabel: `${siteName} LAN`, roleTone: 'emerald' };
                    const desc = (iface.description || '').toLowerCase();
                    if (desc.includes('internet') || desc.includes('wan') || desc.includes('nat') || desc.includes('exit')) {
                        return { roleLabel: 'INTERNET EXIT', roleTone: 'cyan' };
                    }
                    if (desc.includes('stigix')) {
                        return { roleLabel: '⚡ STIGIX LAN', roleTone: 'amber' };
                    }
                    if (desc.includes('mpls') || desc.includes('dci') || desc.includes('interco') || ipStr.startsWith('10.200.')) {
                        return { roleLabel: 'DCI / MPLS', roleTone: 'purple' };
                    }
                    if (desc.includes('app') || desc.includes('srv') || desc.includes('server') || ipStr.startsWith('20.0.')) {
                        return { roleLabel: 'APP SUBNET', roleTone: 'amber' };
                    }
                    if (ipStr.startsWith('192.168.')) {
                        return { roleLabel: '⚡ STIGIX / LAN', roleTone: 'amber' };
                    }
                    return { roleLabel: 'EGRESS / NAT', roleTone: 'blue' };
                };

                const interfaceItems = sortedIfaces.map((iface: any) => {
                    const ifName = iface.name;
                    const matchedRes = resList.find((r) => r.vyos?.interfaceName.toLowerCase() === ifName.toLowerCase());
                    const isIonLan = Boolean(matchedRes);
                    const ipCidr = iface.ipCidr || (Array.isArray(iface.address) ? iface.address[0] : undefined) || matchedRes?.vyos?.ipCidr || '';
                    const ip = iface.ip || (ipCidr ? ipCidr.split('/')[0] : undefined) || matchedRes?.vyos?.ip || '';
                    const liveStatus = getVyosInterfaceStatus(routerName, ifName);
                    const liveQos = getVyosInterfaceQos(routerName, ifName);
                    const normQos = normalizeQos(liveQos);
                    const { roleLabel, roleTone } = inferInterfaceRole(iface, isIonLan, ip);

                    const resolution: UnderlayResolution = matchedRes
                        ? {
                              ...matchedRes,
                              scope: 'lan',
                              vyos: matchedRes.vyos
                                  ? {
                                        ...matchedRes.vyos,
                                        status: liveStatus,
                                        qos: liveQos,
                                    }
                                  : undefined,
                          }
                        : {
                              id: `${primaryLanRes.id}:${ifName}`,
                              prismaWan: {
                                  siteId: primaryLanRes.prismaWan.siteId,
                                  siteName: primaryLanRes.prismaWan.siteName,
                                  elementId: primaryLanRes.prismaWan.elementId,
                                  elementName: primaryLanRes.prismaWan.elementName,
                                  interfaceId: `${primaryLanRes.prismaWan.interfaceId}:${ifName}`,
                                  interfaceName: `${ifName} (${roleLabel})`,
                                  linkType: 'LAN-EGRESS',
                                  ip: ip || null,
                                  ipCidr: ipCidr || null,
                                  network: iface.network || ipCidr || null,
                              },
                              status: 'matched',
                              scope: 'lan',
                              matchedNetwork: iface.network || ipCidr || primaryLanRes.matchedNetwork,
                              vyos: {
                                  routerId: fromPayload?.id || primaryLanRes.vyos?.routerId || routerName,
                                  routerName: routerName,
                                  location: fromPayload?.location || primaryLanRes.vyos?.location,
                                  interfaceName: ifName,
                                  ip: ip || '',
                                  ipCidr: ipCidr || '',
                                  network: iface.network || ipCidr || '',
                                  status: liveStatus,
                                  description: iface.description || roleLabel,
                                  qos: liveQos,
                              },
                              diagnostic: `VyOS router ${routerName} interface ${ifName} (${iface.description || roleLabel}) on ${siteName} LAN periphery.`,
                          };

                    return {
                        name: ifName,
                        ifName,
                        ip,
                        ipCidr,
                        description: iface.description,
                        status: liveStatus,
                        isDown: liveStatus === 'down',
                        qos: normQos || liveQos,
                        hasQos: Boolean(normQos),
                        isIonLan,
                        isLanLink: isIonLan,
                        roleLabel,
                        roleTone,
                        resolution,
                    };
                });

                const hasShut = interfaceItems.some((item) => item.status === 'down');
                const qosItem = interfaceItems.find((item) => Boolean(normalizeQos(item.qos)));
                const primaryQos = qosItem ? normalizeQos(qosItem.qos) : null;
                const blackholeBlocks = Array.isArray(fromPayload?.blackholeBlocks) ? fromPayload.blackholeBlocks : [];
                const blockedCount = blackholeBlocks.length;

                const routerObj = {
                    id: fromPayload?.id || routerName,
                    name: routerName,
                    host: fromPayload?.host || primaryLanRes.vyos?.routerId || '—',
                    location: fromPayload?.location || `${siteName} LAN Periphery`,
                    status: fromPayload?.status || 'up',
                    blackholeBlocks,
                    interfaces: sortedIfaces,
                };

                siteRouters.push({
                    name: routerName,
                    routerName,
                    id: routerObj.id,
                    router: routerObj,
                    resolutions: resList,
                    lanInterfaceName: primaryLanRes.vyos?.interfaceName || interfaceItems[0]?.name || 'eth',
                    lanIp: primaryLanRes.vyos?.ipCidr || primaryLanRes.vyos?.ip || interfaceItems[0]?.ipCidr || '—',
                    hasShut,
                    primaryQos,
                    blockedCount,
                    interfaceItems,
                    defaultResolution: interfaceItems[0]?.resolution || primaryLanRes,
                });
            });

            if (siteRouters.length > 0) {
                map.set(siteName, siteRouters);
            }
        });

        return map;
    }, [underlayData, getVyosInterfaceStatus, getVyosInterfaceQos]);

    const processTopology = useCallback((data: any) => {
        if (!data.sites) return;

        // Precompute local WAN IP lookup map from data.sites
        const localWanIpMap = new Map<string, string>();
        data.sites.forEach((s: any) => {
            const sName = (s.site_name || '').toLowerCase().trim();
            const sId = s.site_id;
            (s.devices || []).forEach((d: any) => {
                const dName = (d.device_name || '').toLowerCase().trim();
                const dId = d.id || d.element_id;
                (d.wan_interfaces || []).forEach((w: any) => {
                    const ip = w.ip || w.public_ip;
                    if (!ip || ip === 'N/A') return;
                    const wName = (w.name || '').toLowerCase().trim();
                    const wLabel = (w.circuit_label || '').toLowerCase().trim();
                    const wId = w.id;
                    if (sName && dName && wName) localWanIpMap.set(`${sName}:${dName}:${wName}`, ip);
                    if (sName && dName && wLabel) localWanIpMap.set(`${sName}:${dName}:${wLabel}`, ip);
                    if (sName && wName) localWanIpMap.set(`${sName}:${wName}`, ip);
                    if (sName && wLabel) localWanIpMap.set(`${sName}:${wLabel}`, ip);
                    if (sId && wId) localWanIpMap.set(`${sId}:${wId}`, ip);
                    if (dId && wId) localWanIpMap.set(`${dId}:${wId}`, ip);
                    if (wId) localWanIpMap.set(String(wId), ip);
                });
            });
        });

        const lookupLocalPeerIp = (peerSite?: string, peerDev?: string, peerWan?: string, curIp?: string) => {
            if (curIp && curIp !== 'N/A' && curIp !== '') return curIp;
            if (!peerSite || !peerWan) return curIp || 'N/A';
            const s = peerSite.toLowerCase().trim();
            const d = (peerDev || '').toLowerCase().trim();
            const w = peerWan.toLowerCase().trim();
            if (d && localWanIpMap.has(`${s}:${d}:${w}`)) return localWanIpMap.get(`${s}:${d}:${w}`)!;
            if (localWanIpMap.has(`${s}:${w}`)) return localWanIpMap.get(`${s}:${w}`)!;
            return curIp || 'N/A';
        };

        // Apply Visibility Filter
        const filteredSites = visibleSiteIds
            ? data.sites.filter((s: any) => visibleSiteIds.includes(s.site_id))
            : data.sites;

        const newNodes: Node[] = [];
        const newEdges: Edge[] = [];

        const isBGSite = (s: any) => Boolean(s.branch_gateway === true || s.branch_gateway === 'true');

        const pureHubs = filteredSites.filter((s: any) => {
            const role = (s.element_cluster_role || s.site_role || '').toUpperCase();
            return role === 'HUB' && !isBGSite(s);
        });

        const branchGateways = filteredSites.filter(isBGSite);

        const standardSpokes = filteredSites.filter((s: any) => {
            return !pureHubs.includes(s) && !branchGateways.includes(s);
        });

        // Case A vs Case B:
        // Case A (pure hubs exist and flank requested): keep pure hubs on top, branch gateways on left flank
        // Case B (no pure hubs exist, or top requested): promote branch gateways to top tier as root hubs
        const promoteBgToTop = !hasPureHubs || bgLayout === 'top';
        const hubsToLayout = promoteBgToTop ? [...pureHubs, ...branchGateways] : pureHubs;
        const spokesToLayout = standardSpokes;
        const gatewaysToLayout = promoteBgToTop ? [] : branchGateways;
        const hubs = hubsToLayout;

        // Identify unique WAN Networks (Clouds)
        const publicWanNetworks = new Set<string>();
        const privateWanNetworks = new Set<string>();

        filteredSites.forEach((s: any) => {
            s.devices?.forEach((d: any) => {
                d.wan_interfaces?.forEach((w: any) => {
                    const netName = w.wan_network || '';
                    if (netName.toLowerCase().includes('mpls') || netName.toLowerCase().includes('private') || netName.toLowerCase().includes('vpn')) {
                        privateWanNetworks.add(netName);
                    } else if (netName) {
                        publicWanNetworks.add(netName);
                    }
                });
            });
        });

        const HUB_Y = -620;
        const CLOUD_Y = 0;
        const SPOKE_Y = 620;
        const HORIZONTAL_GAP_PX = 80;

        const getSiteWidth = (site: any) => {
            const numDevices = site.devices?.length || 1;
            const devicesWidth = numDevices * 208 + Math.max(0, numDevices - 1) * 64;

            // Calculate total WAN circuits width across all devices in this site
            const numCircuits = (site.devices || []).reduce(
                (acc: number, d: any) => acc + (d.wan_interfaces?.length || 0),
                0
            ) || 1;
            const circuitsWidth = numCircuits * 120 + Math.max(0, numCircuits - 1) * 16;

            // Calculate Subnets required width (physical LAN interfaces only)
            const allSubnets = new Set<string>();
            (site.devices || []).forEach((d: any) => {
                (d.lan_interfaces || []).filter(isPhysicalLanInterface).forEach((l: any) => {
                    if (l.ip) {
                        const subnet = l.ip.includes('/') ? l.ip : l.ip.replace(/\.\d+$/, '.0/24');
                        allSubnets.add(subnet);
                    }
                });
            });
            const subnetsCount = Math.max(1, allSubnets.size);
            const subnetsWidth = subnetsCount * 145 + Math.max(0, subnetsCount - 1) * 12;

            const isBG = site.branch_gateway === true || site.branch_gateway === 'true';
            const extraGwWidth = (isBG && bgLayout !== 'top' && hasPureHubs) ? 160 : 0;
            const hasLanVyos = (siteLanVyosMap.get(site.site_name) || []).length > 0;
            const lanVyosMinWidth = (topologyViewMode === 'underlay' && hasLanVyos) ? 500 : 0;

            const contentWidth = Math.max(devicesWidth, circuitsWidth, subnetsWidth, lanVyosMinWidth) + extraGwWidth;
            return Math.max(340, contentWidth + 96);
        };

        const sitePositions = new Map<string, number>();

        const layoutRow = (sites: any[], yPos: number, role: string) => {
            const widths = sites.map(getSiteWidth);
            const totalWidth = widths.reduce((acc, w) => acc + w, 0) + HORIZONTAL_GAP_PX * Math.max(0, sites.length - 1);
            let currentX = -totalWidth / 2;

            sites.forEach((site: any, i: number) => {
                const w = widths[i];
                const x = currentX + w / 2;
                currentX += w + HORIZONTAL_GAP_PX;
                sitePositions.set(site.site_id, x);
                sitePositions.set(site.site_name, x);

                const siteLanRouters = siteLanVyosMap.get(site.site_name) || [];

                newNodes.push({
                    id: `site:${site.site_id}`,
                    type: 'site',
                    position: { x, y: yPos },
                    origin: [0.5, 0.5],
                    data: {
                        ...site,
                        name: site.site_name,
                        role,
                        fleetNodes,
                        underlayMode: topologyViewMode === 'underlay' ? 'badges' : 'off',
                        underlayResolutionMap,
                        onInspectUnderlayCircuit: (res: any) => setUnderlayDrawerResolution(res),
                        lanVyosRouters: siteLanRouters,
                        onInspectLanVyos: (res: any) => setUnderlayDrawerResolution(res)
                    },
                });

                // In Underlay Mode, place peripheral LAN VyOS router(s) above Hubs (anchored by bottom edge [0.5, 1])
                // or below Spokes (anchored by top edge [0.5, 0]) so multi-interface cards never overlap the Site card
                if (topologyViewMode === 'underlay' && siteLanRouters.length > 0) {
                    const isHubRole = role === 'HUB';
                    const lanY = isHubRole ? yPos - 342 : yPos + 335;
                    const LAN_ROUTER_STEP = 610;
                    siteLanRouters.forEach((lr: any, lrIdx: number) => {
                        const offsetX = (lrIdx - (siteLanRouters.length - 1) / 2) * LAN_ROUTER_STEP;
                        newNodes.push({
                            id: `vyos-lan:${site.site_id}:${lr.name}`,
                            type: 'vyosLanRouter',
                            position: { x: x + offsetX, y: lanY },
                            origin: isHubRole ? [0.5, 1] : [0.5, 0],
                            data: {
                                router: lr.router,
                                siteId: site.site_id,
                                siteName: site.site_name,
                                isAboveSite: isHubRole,
                                interfaceItems: lr.interfaceItems,
                                resolutions: lr.interfaceItems.map((it: any) => it.resolution),
                                onSelectResolution: (res: any) => setUnderlayDrawerResolution(res),
                                onOpenRouterControl: (routerObj: any) => setSelectedRouterForTrafficControl(routerObj)
                            }
                        });
                    });
                }
            });
        };

        // --- NODES ARE ALWAYS IN THE SAME POSITION ---
        layoutRow(hubsToLayout, HUB_Y, 'HUB');

        // Middle Tier:
        // - Underlay Mode: Active VyOS Routers + External Cloud
        // - SASE Mode: SASE Security Cloud PoPs (Prisma Access & Zscaler)
        // - Overlay & Physical Mode: Public & Private WAN Clouds (Internet, MPLS)
        if (topologyViewMode === 'underlay') {
            const resolutions = underlayData?.resolutions || [];
            const allRouters = underlayData?.routers || [];

            const resolvedWithHub = resolutions.map((r: any) => ({
                ...r,
                isHub: hubs.some((h: any) => h.site_name === r.prismaWan?.siteName)
            }));

            // Find distinct active VyOS router names that actually have matched WAN circuits
            const activeRouterNames = Array.from(new Set(
                resolvedWithHub
                    .filter((r: any) => r.status === 'matched' && r.vyos?.routerName)
                    .map((r: any) => r.vyos.routerName)
            ));

            // Construct active router objects
            const activeRouters = activeRouterNames.map(routerName => {
                const fromPayload = allRouters.find((r: any) => r.name === routerName);
                const routerResolutions = resolvedWithHub.filter((r: any) => r.status === 'matched' && r.vyos?.routerName === routerName);

                // Build comprehensive interfaces list with guaranteed IP and description resolution
                const ifaceMap = new Map<string, any>();
                fromPayload?.interfaces?.forEach((i: any) => ifaceMap.set(i.name, { ...i }));
                routerResolutions.forEach((res: any) => {
                    if (res.vyos?.interfaceName) {
                        const existing = ifaceMap.get(res.vyos.interfaceName) || {};
                        const ipCidr = res.vyos.ipCidr || res.vyos.ip || existing.ipCidr || existing.address?.[0];
                        const addresses = (existing.address && existing.address.length > 0 && existing.address[0])
                            ? existing.address
                            : (ipCidr ? [ipCidr] : []);
                        
                        const liveStatus = getVyosInterfaceStatus(routerName, res.vyos.interfaceName);
                        const liveQos = getVyosInterfaceQos(routerName, res.vyos.interfaceName);

                        ifaceMap.set(res.vyos.interfaceName, {
                            ...existing,
                            name: res.vyos.interfaceName,
                            description: existing.description || res.vyos.description,
                            address: addresses,
                            ipCidr: ipCidr,
                            ip: res.vyos.ip || existing.ip || (ipCidr ? ipCidr.split('/')[0] : undefined),
                            status: liveStatus || res.vyos.status || existing.status || 'up',
                            qos: liveQos !== undefined ? liveQos : (res.vyos.qos || existing.qos || null)
                        });
                    }
                });

                return {
                    id: fromPayload?.id || routerName,
                    name: routerName,
                    host: fromPayload?.host || routerResolutions[0]?.vyos?.routerId || '192.168.122.254',
                    location: fromPayload?.location || 'VyOS Underlay Backbone',
                    status: fromPayload?.status || 'up',
                    blackholeBlocks: Array.isArray(fromPayload?.blackholeBlocks) ? fromPayload.blackholeBlocks : [],
                    interfaces: Array.from(ifaceMap.values()),
                    resolutions: routerResolutions,
                    connectedCount: routerResolutions.length
                };
            });

            const ROUTER_GAP = 140;
            const routerWidths = activeRouters.map((r: any) => {
                const hubCount = r.resolutions.filter((res: any) => res.isHub).length;
                const spokeCount = r.resolutions.filter((res: any) => !res.isHub).length;
                const portMax = Math.max(hubCount, spokeCount, 3);
                return Math.max(540, portMax * 195 + 80);
            });

            const totalRoutersWidth = routerWidths.reduce((acc: number, w: number) => acc + w, 0) + Math.max(0, activeRouters.length - 1) * ROUTER_GAP;
            let currentRouterX = -totalRoutersWidth / 2;

            activeRouters.forEach((r: any, idx: number) => {
                const rWidth = routerWidths[idx];
                const x = currentRouterX + rWidth / 2;
                currentRouterX += rWidth + ROUTER_GAP;

                newNodes.push({
                    id: `vyos:${r.id || r.name}`,
                    type: 'vyosRouter',
                    position: { x, y: CLOUD_Y },
                    origin: [0.5, 0.5],
                    data: {
                        router: r,
                        connectedCount: r.connectedCount,
                        resolutions: r.resolutions,
                        siteOrder: sitePositions,
                        onSelectResolution: (res: any) => setUnderlayDrawerResolution(res),
                        onOpenRouterControl: (routerObj: any) => setSelectedRouterForTrafficControl(routerObj)
                    }
                });
            });

            // If there are unmatched circuits, add cloud:EXTERNAL to the right
            const unmatchedCount = resolvedWithHub.filter((r: any) => r.status !== 'matched').length;
            if (unmatchedCount > 0 || activeRouters.length === 0) {
                const externalX = activeRouters.length > 0 ? (totalRoutersWidth / 2) + 260 : 0;
                newNodes.push({
                    id: `cloud:EXTERNAL`,
                    type: 'cloud',
                    position: { x: externalX, y: CLOUD_Y },
                    origin: [0.5, 0.5],
                    data: { name: 'EXTERNAL / UNMAPPED' }
                });
            }
        } else if (topologyViewMode === 'sase') {
            // SASE MODE MIDDLE TIER: SASE Security Cloud PoPs
            const rawPops = topology?.sase_infrastructure?.pops || [
                { id: 'prisma-france-south', name: 'Prisma Access France South (Paris Lime)', short_name: 'France South', provider: 'Prisma Access', primary_peer_ip: '130.41.124.164', liveliness_probe_ip: '192.168.255.254', status: 'healthy', tunnels_up: 4, tunnels_total: 8 },
                { id: 'prisma-ireland', name: 'Prisma Access Ireland (Elderberry)', short_name: 'Ireland', provider: 'Prisma Access', primary_peer_ip: '74.221.137.55', liveliness_probe_ip: '192.168.255.254', status: 'healthy', tunnels_up: 4, tunnels_total: 8 },
                { id: 'zscaler-cloud', name: 'Zscaler Internet Access (ZIA)', short_name: 'Zscaler Cloud', provider: 'Zscaler', primary_peer_ip: '165.225.72.39', status: 'healthy', tunnels_up: 3, tunnels_total: 9 },
            ];

            const prismaPops = rawPops.filter((p: any) => p.provider === 'Prisma Access' || p.id.includes('prisma'));
            const zscalerPops = rawPops.filter((p: any) => p.provider === 'Zscaler' || p.id.includes('zscaler'));
            const otherPops = rawPops.filter((p: any) => !prismaPops.includes(p) && !zscalerPops.includes(p));

            const POP_STEP = 560;
            const CARD_WIDTH = 480;
            const CLUSTER_GAP = 220;
            const MIN_CENTER_DIST = CARD_WIDTH + CLUSTER_GAP;

            // Compute raw horizontal positions and re-center the entire POP tier around x = 0
            const popEntries: { pop: any; rawX: number; cluster: string }[] = [];

            // Left wing: Prisma Access (Palo Alto Networks)
            prismaPops.forEach((pop: any, idx: number) => {
                const offsetFromRight = (prismaPops.length - 1 - idx) * POP_STEP;
                const rawX = -(MIN_CENTER_DIST / 2) - offsetFromRight;
                popEntries.push({ pop, rawX, cluster: 'prisma' });
            });

            // Right wing: Zscaler
            zscalerPops.forEach((pop: any, idx: number) => {
                const rawX = (MIN_CENTER_DIST / 2) + idx * POP_STEP;
                popEntries.push({ pop, rawX, cluster: 'zscaler' });
            });

            // Other providers (if any)
            otherPops.forEach((pop: any, idx: number) => {
                const rawX = (MIN_CENTER_DIST / 2) + (zscalerPops.length + idx) * POP_STEP;
                popEntries.push({ pop, rawX, cluster: 'other' });
            });

            const minPopX = popEntries.length > 0 ? Math.min(...popEntries.map(e => e.rawX)) : 0;
            const maxPopX = popEntries.length > 0 ? Math.max(...popEntries.map(e => e.rawX)) : 0;
            const centerShift = (minPopX + maxPopX) / 2;

            popEntries.forEach(({ pop, rawX, cluster }) => {
                newNodes.push({
                    id: `cloud:${pop.id}`,
                    type: 'sasePop',
                    position: { x: rawX - centerShift, y: CLOUD_Y },
                    origin: [0.5, 0.5],
                    data: {
                        ...pop,
                        isSasePop: true,
                        cluster
                    }
                });
            });
        } else if (topologyViewMode === 'physical') {
            // CLOUDS: Rendered strictly for physical WAN Transport mode!
            let internetTunnelsCount = 0;
            let internetTunnelsUp = 0;
            let mplsTunnelsCount = 0;
            let mplsTunnelsUp = 0;

            filteredSites.forEach((s: any) => {
                s.devices?.forEach((d: any) => {
                    d.wan_interfaces?.forEach((w: any) => {
                        const isMpls = (w.wan_network || '').toLowerCase().includes('mpls') || (w.name || '').toLowerCase().includes('mpls');
                        w.connections?.forEach((c: any) => {
                            const isUp = c.status === 'UP' || c.active || c.usable;
                            if (isMpls) {
                                mplsTunnelsCount++;
                                if (isUp) mplsTunnelsUp++;
                            } else {
                                internetTunnelsCount++;
                                if (isUp) internetTunnelsUp++;
                            }
                        });
                    });
                });
            });

            const INTERNET_X = -200;
            newNodes.push({
                id: `cloud:INTERNET`,
                type: 'cloud',
                position: { x: INTERNET_X, y: CLOUD_Y },
                origin: [0.5, 0.5],
                data: {
                    name: 'INTERNET',
                    tunnelsTotal: internetTunnelsCount,
                    tunnelsUp: internetTunnelsUp,
                    isSelected: selectedNetwork === 'INTERNET',
                    viewMode: topologyViewMode,
                },
            });

            const privates = Array.from(privateWanNetworks);
            const mplsClouds = privates.length > 0 ? privates : ['MPLS'];
            mplsClouds.forEach((cloudName, i) => {
                const x = 200 + (i * 250);
                newNodes.push({
                    id: `cloud:${cloudName}`,
                    type: 'cloud',
                    position: { x, y: CLOUD_Y },
                    origin: [0.5, 0.5],
                    data: {
                        name: cloudName,
                        tunnelsTotal: mplsTunnelsCount,
                        tunnelsUp: mplsTunnelsUp,
                        isSelected: selectedNetwork === 'MPLS' || selectedNetwork === cloudName,
                        viewMode: topologyViewMode,
                    },
                });
            });
        }

        layoutRow(spokesToLayout, SPOKE_Y, 'SPOKE');

        // Flank Left Layout for Branch Gateways (Mid-tier Left Flank at Y=0)
        if (gatewaysToLayout.length > 0) {
            const hubLeftEdges = hubsToLayout.map((s: any) => (sitePositions.get(s.site_id) || 0) - getSiteWidth(s) / 2);
            const spokeLeftEdges = spokesToLayout.map((s: any) => (sitePositions.get(s.site_id) || 0) - getSiteWidth(s) / 2);
            let minLeftX = Math.min(0, ...hubLeftEdges, ...spokeLeftEdges);

            if (topologyViewMode === 'sase') {
                const saseLeftEdges = newNodes
                    .filter((n: any) => n.type === 'sasePop')
                    .map((n: any) => n.position.x - 240);
                minLeftX = Math.min(minLeftX, -900, ...saseLeftEdges);
            } else if (topologyViewMode === 'physical') {
                minLeftX = Math.min(minLeftX, -380);
            }

            gatewaysToLayout.forEach((gw: any, gIdx: number) => {
                const gwWidth = getSiteWidth(gw);
                const gwX = minLeftX - (gwWidth / 2) - 150;
                const totalGws = gatewaysToLayout.length;
                const gwY = totalGws === 1 ? 0 : (gIdx - (totalGws - 1) / 2) * 440;

                sitePositions.set(gw.site_id, gwX);
                sitePositions.set(gw.site_name, gwX);

                const gwLanRouters = siteLanVyosMap.get(gw.site_name) || [];

                newNodes.push({
                    id: `site:${gw.site_id}`,
                    type: 'site',
                    position: { x: gwX, y: gwY },
                    origin: [0.5, 0.5],
                    data: {
                        ...gw,
                        name: gw.site_name,
                        role: 'GATEWAY',
                        fleetNodes,
                        underlayMode: topologyViewMode === 'underlay' ? 'badges' : 'off',
                        underlayResolutionMap,
                        onInspectUnderlayCircuit: (res: any) => setUnderlayDrawerResolution(res),
                        lanVyosRouters: gwLanRouters,
                        onInspectLanVyos: (res: any) => setUnderlayDrawerResolution(res)
                    },
                });

                if (topologyViewMode === 'underlay' && gwLanRouters.length > 0) {
                    const LAN_ROUTER_STEP = 610;
                    gwLanRouters.forEach((lr: any, lrIdx: number) => {
                        const offsetX = (lrIdx - (gwLanRouters.length - 1) / 2) * LAN_ROUTER_STEP;
                        newNodes.push({
                            id: `vyos-lan:${gw.site_id}:${lr.name}`,
                            type: 'vyosLanRouter',
                            position: { x: gwX + offsetX, y: gwY + 310 },
                            origin: [0.5, 0],
                            data: {
                                router: lr.router,
                                siteId: gw.site_id,
                                siteName: gw.site_name,
                                isAboveSite: false,
                                interfaceItems: lr.interfaceItems,
                                resolutions: lr.interfaceItems.map((it: any) => it.resolution),
                                onSelectResolution: (res: any) => setUnderlayDrawerResolution(res),
                                onOpenRouterControl: (routerObj: any) => setSelectedRouterForTrafficControl(routerObj)
                            }
                        });
                    });
                }
            });
        }

        // --- EDGES CHANGE BASED ON MODE ---
        if (topologyViewMode === 'overlay') {
            // mode SD-WAN OVERLAY: Direct site-to-site VPN tunnels
            const selectedSite = logicalViewSiteId ? data.sites.find((s: any) => s.site_id === logicalViewSiteId) : null;
            const isSelectedSiteHub = selectedSite && isHubLike(selectedSite);

            data.sites.forEach((site: any) => {
                const isSiteVisible = !visibleSiteIds || visibleSiteIds.includes(site.site_id);
                if (!isSiteVisible && site.site_id !== logicalViewSiteId) return;

                site.devices?.forEach((d: any) => {
                    d.wan_interfaces?.forEach((w: any) => {
                        const isMplsCircuit = (w.wan_network || '').toLowerCase().includes('mpls') || (w.name || '').toLowerCase().includes('mpls');

                        // Network filter (if user clicked INTERNET or MPLS cloud)
                        if (selectedNetwork === 'INTERNET' && isMplsCircuit) return;
                        if (selectedNetwork === 'MPLS' && !isMplsCircuit) return;

                        w.connections?.forEach((c: any, cIdx: number) => {
                            // Cluster dual-ION deduplication:
                            // If connection specifies source_device_name, ensure it matches current device d.device_name
                            if (c.source_device_name && d.device_name && c.source_device_name !== 'Unknown' && d.device_name !== 'Unknown' && c.source_device_name !== d.device_name) return;

                            const isSourceSelected = site.site_id === logicalViewSiteId;
                            const isTargetSelected = c.peer_site_id === logicalViewSiteId;

                            // If a specific site is focused, only show tunnels attached to it
                            if (logicalViewSiteId && !isSourceSelected && !isTargetSelected) return;

                            // Only show connections between visible sites
                            const isPeerVisible = !visibleSiteIds || visibleSiteIds.includes(c.peer_site_id);
                            if (!isPeerVisible && c.peer_site_id !== logicalViewSiteId) return;

                            const isSourceGateway = gatewaysToLayout.some((g: any) => g.site_id === site.site_id);
                            const isTargetGateway = gatewaysToLayout.some((g: any) => g.site_id === c.peer_site_id);

                            const isSourceHub = hubsToLayout.some((h: any) => h.site_id === site.site_id);
                            const isTargetHub = hubsToLayout.some((h: any) => h.site_id === c.peer_site_id);

                            const isSourceSpoke = spokesToLayout.some((s: any) => s.site_id === site.site_id);
                            const isTargetSpoke = spokesToLayout.some((s: any) => s.site_id === c.peer_site_id);

                            const isSpokeToSpoke = isSourceSpoke && isTargetSpoke;
                            const isHubToHub = isSourceHub && isTargetHub;

                            // Branch-to-Branch (Spoke to Spoke) arched bridges:
                            if (isSpokeToSpoke) {
                                // In global view, hide spoke-to-spoke tunnels unless mesh toggle is ON
                                if (!logicalViewSiteId && !showBranchMesh) return;
                                // In global view, prevent duplicate reverse edge
                                if (!logicalViewSiteId && site.site_id > c.peer_site_id) return;
                            }

                            // Hub to Hub duplicate prevention in global view
                            if (isHubToHub && !logicalViewSiteId && site.site_id > c.peer_site_id) return;

                            // Gateway duplicate prevention in global view: always draw from Gateway outwards
                            if (!logicalViewSiteId) {
                                if (isSourceHub && isTargetGateway) return;
                                if (isSourceSpoke && isTargetGateway) return;
                                if (isSourceHub && isTargetSpoke) return;
                            } else {
                                if (!isSelectedSiteHub) {
                                    if (!isTargetHub && !isTargetGateway && !isTargetSpoke) return;
                                }
                                if (!isSourceSelected && !isSelectedSiteHub) return;
                            }

                            const isUp = c.status === 'UP' || c.link_up || c.active || c.usable;
                            let strokeColor = '#3b82f6'; // Blue: Inactive / Passive Standby
                            let strokeClass = '5,5';
                            let animated = false;
                            let tunnelState: 'ACTIVE' | 'INACTIVE' | 'DOWN' = 'INACTIVE';

                            if (c.active) {
                                tunnelState = 'ACTIVE';
                                strokeColor = '#10b981'; // Emerald Green: Active (UP)
                                strokeClass = '2,6';
                                animated = true;
                            } else if (c.status === 'DOWN' || (!isUp && !c.usable)) {
                                tunnelState = 'DOWN';
                                strokeColor = '#ef4444'; // Red: Down
                                strokeClass = '';
                            } else {
                                // Inactive (Standby - Up without Transit in Prisma SD-WAN)
                                tunnelState = 'INACTIVE';
                                strokeColor = '#3b82f6'; // Blue: Inactive Standby
                                strokeClass = '5,5';
                            }

                            const edgeType = (isSpokeToSpoke || isHubToHub) ? 'archedBridge' : 'default';

                            newEdges.push({
                                id: `logical-edge-${site.site_id}-${c.peer_site_id}-${d.device_name}-${w.name}-${cIdx}`,
                                source: `site:${site.site_id}`,
                                target: `site:${c.peer_site_id}`,
                                sourceHandle: `circuit:${d.device_name}:${w.name}`,
                                targetHandle: `target-circuit:${c.peer_device_name}:${c.peer_wan_interface}`,
                                type: edgeType,
                                animated,
                                interactionWidth: 24,
                                className: 'cursor-pointer',
                                style: {
                                    stroke: strokeColor,
                                    strokeWidth: c.active ? 4 : 2,
                                    strokeDasharray: strokeClass
                                },
                                data: {
                                    ...c,
                                    ip: w.ip || c.ip,
                                    interface_ip: w.ip || c.interface_ip,
                                    gateway: w.gateway || c.gateway,
                                    isMplsCircuit,
                                    sourceSiteId: site.site_id,
                                    sourceSiteName: site.site_name,
                                    sourceCircuitName: w.name,
                                    sourceCircuitLabel: w.circuit_label || w.name,
                                    sourceDeviceName: d.device_name,
                                    sourceWan: w,
                                    peer_site_id: c.peer_site_id,
                                    peer_site_name: c.peer_site_name,
                                    peer_device_name: c.peer_device_name,
                                    peer_wan_interface: c.peer_wan_interface,
                                    debug_vpn_id: c.debug_vpn_id,
                                    debug_source_ip: (c.debug_source_ip && c.debug_source_ip !== 'N/A') ? c.debug_source_ip : (w.ip || c.ip || 'N/A'),
                                    debug_peer_ip: lookupLocalPeerIp(c.peer_site_name, c.peer_device_name, c.peer_wan_interface, (c.debug_peer_ip && c.debug_peer_ip !== 'N/A') ? c.debug_peer_ip : c.peer_ip),
                                    hideLabel: true,
                                    isOverlayTunnel: true,
                                    wan_network: isMplsCircuit ? 'MPLS' : 'INTERNET',
                                    network: isMplsCircuit ? 'MPLS' : 'INTERNET',
                                    tunnelState
                                }
                            });
                        });
                    });
                });
            });
        } else if (topologyViewMode === 'underlay') {
            // mode UNDERLAY: Draw direct cables from each Prisma WAN interface directly to the respective port chip on the VyOS router
            filteredSites.forEach((site: any) => {
                const isHub = hubs.includes(site);
                site.devices?.forEach((device: any) => {
                    device.wan_interfaces?.forEach((wan: any) => {
                        const res = (underlayData?.resolutions || []).find((r: any) => 
                            r.prismaWan.siteName === site.site_name && 
                            r.prismaWan.elementName === device.device_name && 
                            r.prismaWan.interfaceName === wan.name
                        );

                        const isMatched = Boolean(res && res.status === 'matched' && res.vyos);
                        const targetId = (isMatched && res?.vyos) ? `vyos:${res.vyos.routerId || res.vyos.routerName}` : `cloud:EXTERNAL`;
                        const targetHandle = (isMatched && res?.vyos) ? `vyos-port:${res.vyos.interfaceName}` : (isHub ? 'target-top' : 'target-bottom');

                        newEdges.push({
                            id: `underlay-edge:${site.site_id}:${device.device_name}:${wan.name}`,
                            type: 'site',
                            source: `site:${site.site_id}`,
                            target: targetId,
                            sourceHandle: `circuit:${device.device_name}:${wan.name}`,
                            targetHandle: targetHandle,
                            animated: isMatched,
                            style: {
                                stroke: isMatched ? '#f59e0b' : '#64748b',
                                strokeWidth: isMatched ? 3 : 1.5,
                                strokeDasharray: isMatched ? undefined : '4 4'
                            },
                            data: {
                                ...wan,
                                site_name: site.site_name,
                                device_name: device.device_name,
                                hideLabel: true,
                                resolution: res,
                                isUnderlayEdge: true
                            }
                        });
                    });
                });

                // Also draw peripheral LAN cables from Site LAN block to any matched LAN VyOS router
                const siteLanRouters = siteLanVyosMap.get(site.site_name) || [];
                siteLanRouters.forEach((lr: any) => {
                    const lanNodeId = `vyos-lan:${site.site_id}:${lr.name}`;
                    const isLanLinkDown = lr.interfaceItems.some((it: any) => it.isIonLan && it.status === 'down');
                    const hasLanQos = lr.interfaceItems.some((it: any) => Boolean(normalizeQos(it.qos)));
                    newEdges.push({
                        id: `underlay-edge:lan:${site.site_id}:${lr.name}`,
                        type: 'site',
                        source: `site:${site.site_id}`,
                        target: lanNodeId,
                        sourceHandle: 'lan-periphery',
                        targetHandle: 'lan-link',
                        animated: !isLanLinkDown,
                        style: {
                            stroke: isLanLinkDown ? '#ef4444' : (hasLanQos ? '#f59e0b' : '#10b981'),
                            strokeWidth: 3,
                            strokeDasharray: isLanLinkDown ? '4 4' : undefined
                        },
                        data: {
                            site_name: site.site_name,
                            hideLabel: true,
                            resolution: lr.defaultResolution,
                            isUnderlayEdge: true,
                            isLanPeripheryEdge: true
                        }
                    });
                });
            });
        } else if (topologyViewMode === 'sase') {
            // mode SASE: Draw ServiceLink IPsec tunnels from Branches to SASE PoPs
            filteredSites.forEach((site: any) => {
                const isHub = hubs.includes(site);
                site.devices?.forEach((device: any) => {
                    device.service_links?.forEach((sl: any) => {
                        let targetPopId = 'cloud:prisma-france-south';
                        const seName = (sl.service_endpoint_name || sl.name || '').toLowerCase();
                        if (sl.remote_ip === '74.221.137.55' || seName.includes('ireland') || seName.includes('eu-west-1')) {
                            targetPopId = 'cloud:prisma-ireland';
                        } else if (sl.remote_ip === '130.41.124.164' || seName.includes('france-south') || seName.includes('paris') || seName.includes('france')) {
                            targetPopId = 'cloud:prisma-france-south';
                        } else if (seName.includes('france-central') || seName.includes('france north') || seName.includes('france-north')) {
                            targetPopId = 'cloud:prisma-france-central';
                        } else if (sl.provider === 'Zscaler' || seName.includes('zscaler')) {
                            targetPopId = 'cloud:zscaler-cloud';
                        }

                        // Dynamic fallback: match with any detected SASE PoP from topology
                        const detectedPops = topology?.sase_infrastructure?.pops || [];
                        const matchedPop = detectedPops.find((p: any) =>
                            p.id === targetPopId.replace('cloud:', '') ||
                            (p.primary_peer_ip && p.primary_peer_ip === sl.remote_ip)
                        );
                        if (matchedPop) {
                            targetPopId = `cloud:${matchedPop.id}`;
                        }

                        const isUp = sl.operational_state === 'up';
                        const isZscaler = sl.provider === 'Zscaler' || (sl.name || '').toLowerCase().includes('zscaler');
                        // On Zscaler, all UP tunnels are ACTIVE (no active/backup distinction)
                        const isAct = isZscaler ? isUp : (sl.role === 'active' || (sl.name || '').toUpperCase().includes('_ACT'));
                        const isStandby = sl.extended_state === 'standby_spoke';

                        // Match service link to specific WAN circuit (e.g. BR8-INET1 vs BR8-INET2)
                        let sourceHandle = `circuit:${device.device_name}:${sl.name}`;
                        const matchingWan = (device.wan_interfaces || []).find((w: any) => {
                            if (sl.circuit_name && (w.name === sl.circuit_name || w.wan_if_id === sl.wan_interface_id)) return true;
                            if (sl.wan_interface_name && w.name === sl.wan_interface_name) return true;
                            const cleanWanIp = (w.ip || '').split('/')[0];
                            if (cleanWanIp && sl.local_ip && cleanWanIp === sl.local_ip) return true;
                            const slNameLower = (sl.name || '').toLowerCase();
                            const wNameLower = (w.name || '').toLowerCase();
                            const wLabelLower = (w.circuit_label || w.label_name || '').toLowerCase();
                            if (slNameLower.includes(wNameLower)) return true;
                            if (slNameLower.includes('cable') && (wNameLower.includes('cable') || wLabelLower.includes('cable') || wNameLower.includes('inet2') || wNameLower.endsWith('2'))) return true;
                            if (slNameLower.includes('ethernet') && (wNameLower.includes('ethernet') || wLabelLower.includes('ethernet') || wNameLower.includes('inet1') || wNameLower.endsWith('1'))) return true;
                            return false;
                        });

                        const resolvedCircuitName = matchingWan?.name || sl.circuit_name || sl.wan_interface_name || (device.wan_interfaces?.[0]?.name);

                        if (resolvedCircuitName) {
                            sourceHandle = `circuit:${device.device_name}:${resolvedCircuitName}`;
                        } else if (device.wan_interfaces?.length > 0) {
                            sourceHandle = `circuit:${device.device_name}:${device.wan_interfaces[0].name}`;
                        }

                        newEdges.push({
                            id: `sase-edge:${site.site_id}:${device.device_name}:${sl.id}`,
                            type: 'site',
                            source: `site:${site.site_id}`,
                            target: targetPopId,
                            sourceHandle: sourceHandle,
                            targetHandle: isHub ? 'target-top' : 'target-bottom',
                            animated: isUp,
                            data: {
                                ...sl,
                                isZscaler,
                                effectiveAct: isAct,
                                site_name: site.site_name,
                                device_name: device.device_name,
                                circuit_name: resolvedCircuitName,
                                hideLabel: true,
                                isSaseEdge: true
                            }
                        });
                    });
                });
            });
        } else {
            // mode PHYSICAL (WAN Transport): Draw site-to-cloud edges
            filteredSites.forEach((site: any) => {
                const isHub = hubs.includes(site);
                site.devices?.forEach((device: any) => {
                    device.wan_interfaces?.forEach((wan: any) => {
                        if (wan.wan_network) {
                            const isUp = wan.ip && !wan.ip.includes('Pending');
                            const isPrivate = privateWanNetworks.has(wan.wan_network);
                            const targetCloudId = isPrivate ? `cloud:${wan.wan_network}` : `cloud:INTERNET`;

                            if (selectedNetwork === 'INTERNET' && isPrivate) return;
                            if (selectedNetwork === 'MPLS' && !isPrivate) return;
                            if (logicalViewSiteId && site.site_id !== logicalViewSiteId) return;

                            newEdges.push({
                                id: `edge:${site.site_id}:${device.device_name}:${wan.name}`,
                                type: 'site',
                                source: `site:${site.site_id}`,
                                target: targetCloudId,
                                sourceHandle: `circuit:${device.device_name}:${wan.name}`,
                                targetHandle: isHub ? 'target-top' : 'target-bottom',
                                animated: isUp && !isPrivate,
                                style: {
                                    stroke: isPrivate ? '#c084fc' : '#38bdf8',
                                    strokeWidth: isUp ? 2.5 : 1.5,
                                    strokeDasharray: isUp ? undefined : '4 4'
                                },
                                data: {
                                    ...wan,
                                    site_name: site.site_name,
                                    device_name: device.device_name,
                                    hideLabel: true,
                                    isPhysicalWanEdge: true,
                                    wan_network: wan.wan_network || (isPrivate ? 'MPLS' : 'INTERNET'),
                                    network: wan.wan_network || (isPrivate ? 'MPLS' : 'INTERNET')
                                }
                            });
                        }
                    });
                });
            });
        }

        setNodes(newNodes);
        setEdges(newEdges);
    }, [logicalViewSiteId, selectedNetwork, setNodes, setEdges, visibleSiteIds, isHubLike, siteHubStatus, topologyViewMode, underlayData, fleetNodes, pathFilter, bgLayout, showBranchMesh, hasPureHubs, effectiveBgAsHub, getVyosInterfaceStatus, getVyosInterfaceQos, siteLanVyosMap]);

    const fetchTopology = useCallback(async () => {
        if (!topology) {
            setLoading(true);
            setBuildProgress({
                stage: 1,
                stageKey: 'auth',
                stageLabel: 'Authenticating with Prisma SASE OAuth2 API...',
                elapsedMs: 0,
                lastDurationMs: null,
            });
        } else {
            setRefreshing(true);
        }
        setError(null);
        try {
            const res = await gFetch('/api/topology', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setTopology(data);
            setLastRefresh(new Date());

            if (data?._cache?.refreshing) {
                setRefreshing(true);
                setStaleRevalidating(true);
            } else {
                setRefreshing(false);
                setStaleRevalidating(false);
            }

            // Fetch fleet nodes for Stigix mesh overlay
            gFetch('/api/fleet/matrix', {
                headers: { 'Authorization': `Bearer ${token}` }
            })
                .then(r => r.json())
                .then(d => {
                    const nodesList = d?.nodes || d?.data?.nodes;
                    if (Array.isArray(nodesList)) {
                        setFleetNodes(nodesList);
                    }
                })
                .catch(() => {});

            if (data.underlay) {
                setUnderlayData(data.underlay);
            } else {
                gFetch('/api/topology/underlay-debug', {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
                .then(r => r.json())
                .then(d => { if (d?.underlay) setUnderlayData(d.underlay); })
                .catch(() => {});
            }
            processTopology(data);
        } catch (e: any) {
            setError(e.message);
            setRefreshing(false);
            setStaleRevalidating(false);
        } finally {
            setLoading(false);
        }
    }, [token, processTopology, gFetch, topology]);

    // Poll /api/topology/status while building (either initial loading or background refreshing)
    useEffect(() => {
        if (!loading && !refreshing) return;

        const startTs = Date.now();
        const tickInterval = setInterval(() => {
            setBuildProgress(prev => ({
                ...prev,
                elapsedMs: Math.max(prev.elapsedMs, Date.now() - startTs),
            }));
        }, 120);

        const pollStatus = async () => {
            try {
                const res = await gFetch('/api/topology/status', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) return;
                const status = await res.json();
                if (status.building) {
                    setBuildProgress(prev => ({
                        stage: status.stage || prev.stage || 1,
                        stageKey: status.stageKey || prev.stageKey || 'auth',
                        stageLabel: status.stageLabel || prev.stageLabel || 'Authenticating with Prisma SASE OAuth2 API...',
                        elapsedMs: Math.max(prev.elapsedMs, status.elapsedMs || 0),
                        lastDurationMs: status.lastDurationMs ?? prev.lastDurationMs,
                    }));
                } else if (staleRevalidating) {
                    // Background stale-while-revalidate finished! Pull fresh cached topology seamlessly
                    setStaleRevalidating(false);
                    setRefreshing(false);
                    const freshRes = await gFetch('/api/topology', {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (freshRes.ok) {
                        const freshData = await freshRes.json();
                        if (!freshData.error) {
                            setTopology(freshData);
                            setLastRefresh(new Date());
                            if (freshData.underlay) setUnderlayData(freshData.underlay);
                            processTopology(freshData);
                        }
                    }
                }
            } catch {
                // Ignore transient status poll errors
            }
        };

        pollStatus();
        const pollInterval = setInterval(pollStatus, 650);
        return () => {
            clearInterval(tickInterval);
            clearInterval(pollInterval);
        };
    }, [loading, refreshing, staleRevalidating, token, gFetch, processTopology]);

    useEffect(() => {
        if (!topology) {
            fetchTopology();
        } else {
            processTopology(topology);
        }
    }, [topology, logicalViewSiteId, selectedNetwork, fetchTopology, processTopology, visibleSiteIds, topologyViewMode, underlayData, fleetNodes, bgLayout, showBranchMesh]);

    const onNodeClick = useCallback((_: any, node: Node) => {
        const nodeData = node.data as any;
        setInspectedLink(null);
        setSelectedCircuit(null);

        if (node.type === 'cloud') {
            const netName = (nodeData.name || '').toUpperCase();
            const isInternet = netName.includes('INTERNET') || netName.includes('PUBLIC');
            const targetNet = isInternet ? 'INTERNET' : 'MPLS';

            setSelectedNetwork(prev => prev === targetNet ? null : targetNet);
            setLogicalViewSiteId(null);
            setSelectedObject({
                type: 'network',
                network: targetNet,
                wan_network: targetNet,
                name: targetNet,
                tunnelsTotal: nodeData.tunnelsTotal,
                tunnelsUp: nodeData.tunnelsUp,
                viewMode: topologyViewMode,
                ...nodeData
            });
            return;
        }

        if (node.type === 'site') {
            setSelectedNetwork(null);
            setLogicalViewSiteId(prev => prev === nodeData.site_id ? null : nodeData.site_id);
            setSelectedObject({ type: 'node', ...nodeData });
            setHoveredEdge(null);
            return;
        }

        setSelectedObject({ type: 'node', ...nodeData });
        setHoveredEdge(null);
        if (node.type === 'underlayGateway' && nodeData?.resolution) {
            setUnderlayDrawerResolution(nodeData.resolution);
        } else if ((node.type === 'vyosRouter' || node.type === 'vyosLanRouter') && Array.isArray(nodeData?.resolutions) && nodeData.resolutions.length > 0) {
            setUnderlayDrawerResolution(nodeData.resolutions[0]);
        }
    }, [topologyViewMode]);

    const onEdgeClick = useCallback((_: any, edge: Edge) => {
        const edgeData = edge.data as any;
        setInspectedLink(edgeData);
        setSelectedObject(null);
        setSelectedCircuit(null);
        setHoveredEdge(null);
        if (edgeData?.resolution) {
            setUnderlayDrawerResolution(edgeData.resolution);
        }
    }, []);

    const onEdgeMouseEnter = useCallback((event: React.MouseEvent, edge: Edge) => {
        if (!edge.data) return;
        setHoveredEdge({
            data: edge.data,
            x: event.clientX,
            y: event.clientY
        });
    }, []);

    const onEdgeMouseMove = useCallback((event: React.MouseEvent, edge: Edge) => {
        if (!edge.data) return;
        setHoveredEdge(prev => {
            if (!prev) return { data: edge.data, x: event.clientX, y: event.clientY };
            return { ...prev, x: event.clientX, y: event.clientY };
        });
    }, []);

    const onEdgeMouseLeave = useCallback(() => {
        setHoveredEdge(null);
    }, []);

    const handleRefresh = useCallback(async () => {
        // Bypass the server's 5-minute cache entirely by passing a force parameter.
        // If topology is already loaded, keep the canvas interactive and show non-blocking progress!
        if (!topology) {
            setLoading(true);
        } else {
            setRefreshing(true);
        }
        setStaleRevalidating(false);
        setBuildProgress(prev => ({
            stage: 1,
            stageKey: 'auth',
            stageLabel: 'Authenticating with Prisma SASE OAuth2 API...',
            elapsedMs: 0,
            lastDurationMs: prev.lastDurationMs,
        }));
        setError(null);
        try {
            const res = await gFetch('/api/topology?force=true', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setTopology(data);
            setLastRefresh(new Date());
            if (data.underlay) {
                setUnderlayData(data.underlay);
            } else {
                gFetch('/api/topology/underlay-debug', {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
                .then(r => r.json())
                .then(d => { if (d?.underlay) setUnderlayData(d.underlay); })
                .catch(() => {});
            }
            processTopology(data);
        } catch (e: any) {
            if (!topology) setError(e.message);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [token, gFetch, processTopology, topology]);

    const handleExportPng = useCallback(() => {
        const flowElement = document.querySelector('.react-flow') as HTMLElement;
        if (flowElement) {
            toPng(flowElement, {
                backgroundColor: '#0f172a',
                filter: (node) => {
                    // Hide controls in export
                    if (node?.classList?.contains('react-flow__controls')) return false;
                    if (node?.classList?.contains('react-flow__panel')) return false;
                    return true;
                }
            }).then((dataUrl) => {
                const link = document.createElement('a');
                link.download = `topology-${new Date().toISOString().slice(0, 10)}.png`;
                link.href = dataUrl;
                link.click();
            });
        }
    }, []);

    const handleExportCsv = useCallback(() => {
        if (!topology?.sites) return;

        let csv = 'Site,Role,Device,Interface,Circuit,WAN Network,IP,Public IP\n';
        topology.sites.forEach((s: any) => {
            s.devices?.forEach((d: any) => {
                d.wan_interfaces?.forEach((w: any) => {
                    csv += `${s.site_name},${s.element_cluster_role},${d.device_name},${w.name},${w.circuit_label},${w.wan_network},${w.ip},${w.public_ip || ''}\n`;
                });
            });
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.setAttribute('hidden', '');
        a.setAttribute('href', url);
        a.setAttribute('download', 'site-inventory.csv');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }, [topology]);

    // Build a lookup: wan_if_id → UnderlayResolution for quick access in SiteNode
    const underlayResolutionMap = useMemo(() => {
        if (!underlayData) return new Map<string, UnderlayResolution>();
        const m = new Map<string, UnderlayResolution>();
        underlayData.resolutions.forEach(r => {
            if (r.prismaWan.interfaceId) m.set(r.prismaWan.interfaceId, r);
        });
        return m;
    }, [underlayData]);

    const searchScope = useMemo(() => {
        const cleanSearch = searchQuery.trim().toLowerCase();
        if (!cleanSearch) return null;

        const directMatchNodeIds = new Set<string>();
        const connectedNodeIds = new Set<string>();
        const matchedEdgeIds = new Set<string>();

        // 1. Identify directly matching nodes
        nodes.forEach(n => {
            const nData = n.data as any;
            const isMatch = Boolean(
                (nData?.name && String(nData.name).toLowerCase().includes(cleanSearch)) ||
                (nData?.site_name && String(nData.site_name).toLowerCase().includes(cleanSearch)) ||
                (nData?.id && String(nData.id).toLowerCase().includes(cleanSearch)) ||
                (nData?.site_id && String(nData.site_id).toLowerCase().includes(cleanSearch)) ||
                (n.id && n.id.toLowerCase().includes(cleanSearch)) ||
                (Array.isArray(nData?.devices) && nData.devices.some((d: any) =>
                    (d.device_name && String(d.device_name).toLowerCase().includes(cleanSearch)) ||
                    (Array.isArray(d.wan_interfaces) && d.wan_interfaces.some((w: any) =>
                        (w.name && String(w.name).toLowerCase().includes(cleanSearch)) ||
                        (w.ip && String(w.ip).toLowerCase().includes(cleanSearch))
                    ))
                )) ||
                (Array.isArray(nData?.interfaces) && nData.interfaces.some((iface: any) =>
                    (iface.name && String(iface.name).toLowerCase().includes(cleanSearch)) ||
                    (Array.isArray(iface.address) && iface.address.some((addr: string) => String(addr).toLowerCase().includes(cleanSearch)))
                ))
            );
            if (isMatch) {
                directMatchNodeIds.add(n.id);
            }
        });

        // 2. Identify matching and 1-hop connected edges and their neighbor nodes
        edges.forEach(e => {
            const eData = e.data as any;
            const isConnectedToDirect = directMatchNodeIds.has(e.source) || directMatchNodeIds.has(e.target);
            const isEdgeDirectMatch = Boolean(
                (e.id && e.id.toLowerCase().includes(cleanSearch)) ||
                (eData?.sourceSiteId && String(eData.sourceSiteId).toLowerCase().includes(cleanSearch)) ||
                (eData?.peer_site_id && String(eData.peer_site_id).toLowerCase().includes(cleanSearch)) ||
                (eData?.site_name && String(eData.site_name).toLowerCase().includes(cleanSearch)) ||
                (eData?.peer_site_name && String(eData.peer_site_name).toLowerCase().includes(cleanSearch)) ||
                (eData?.ip && String(eData.ip).toLowerCase().includes(cleanSearch)) ||
                (eData?.interface_ip && String(eData.interface_ip).toLowerCase().includes(cleanSearch))
            );

            if (isConnectedToDirect || isEdgeDirectMatch) {
                matchedEdgeIds.add(e.id);
                if (e.source) connectedNodeIds.add(e.source);
                if (e.target) connectedNodeIds.add(e.target);
            }
        });

        return { directMatchNodeIds, connectedNodeIds, matchedEdgeIds };
    }, [searchQuery, nodes, edges]);

    const filteredNodes = useMemo(() => {
        const modeNodes = nodes.filter(n => {
            if (topologyViewMode === 'overlay') {
                return n.type === 'site';
            }
            if (topologyViewMode === 'physical') {
                return n.type === 'site' || (n.type === 'cloud' && !n.id.includes('EXTERNAL'));
            }
            if (topologyViewMode === 'sase') {
                return n.type === 'site' || n.type === 'sasePop';
            }
            if (topologyViewMode === 'underlay') {
                return n.type === 'site' || n.type === 'vyosRouter' || n.type === 'vyosLanRouter' || n.type === 'underlayGateway' || n.id === 'cloud:EXTERNAL';
            }
            return true;
        });

        return modeNodes.map(n => {
            const nodeData = n.data as any;
            // Inject underlay data & circuit selection handlers into site nodes
            const enriched = (n.type === 'site')
                ? {
                    ...n,
                    data: {
                        ...nodeData,
                        underlayMode,
                        underlayResolutionMap,
                        lanVyosRouters: siteLanVyosMap.get(nodeData.site_name || nodeData.name) || [],
                        onInspectLanVyos: (resolution: UnderlayResolution) => {
                            setUnderlayDrawerResolution(resolution);
                        },
                        onInspectUnderlayCircuit: (resolution: UnderlayResolution) => {
                            setUnderlayDrawerResolution(resolution);
                        },
                        selectedCircuitKey: selectedCircuit?.circuitKey,
                        onSelectCircuit: handleSelectCircuit,
                    }
                }
                : (n.type === 'vyosLanRouter')
                    ? (() => {
                        const siteEntry = (siteLanVyosMap.get(nodeData.siteName) || []).find((entry: any) => entry.routerName === nodeData.routerName);
                        return siteEntry ? {
                            ...n,
                            data: {
                                ...nodeData,
                                router: siteEntry.router,
                                resolutions: siteEntry.resolutions,
                                interfaceItems: siteEntry.interfaceItems,
                            }
                        } : n;
                    })()
                    : n;

            let nodeOpacity: number | undefined = undefined;
            let nodeFilter: string | undefined = undefined;

            if (topologyViewMode === 'sase') {
                if (n.type === 'site') {
                    const hasSaseLinks = Boolean(nodeData.devices?.some((d: any) => Array.isArray(d.service_links) && d.service_links.length > 0));
                    const isSiteSelected = Boolean(logicalViewSiteId && (nodeData.site_id === logicalViewSiteId || nodeData.id === logicalViewSiteId));

                    if (logicalViewSiteId) {
                        if (isSiteSelected) {
                            nodeOpacity = 1;
                        } else {
                            // Dim other sites when one site is focused
                            nodeOpacity = hasSaseLinks ? 0.2 : 0.12;
                            nodeFilter = 'grayscale(0.85)';
                        }
                    } else {
                        // Global SASE view: Hubs/DCs without direct SASE service links rendered as "Ghost" nodes (Option B)
                        if (!hasSaseLinks) {
                            nodeOpacity = 0.25;
                            nodeFilter = 'grayscale(0.7)';
                        }
                    }
                } else if (n.type === 'sasePop') {
                    if (logicalViewSiteId) {
                        // Check if this PoP is connected to the selected site
                        const selectedSite = nodes.find(sn => (sn.data as any)?.site_id === logicalViewSiteId || (sn.data as any)?.id === logicalViewSiteId || sn.id === `site:${logicalViewSiteId}`);
                        const selectedSiteData = selectedSite?.data as any;
                        const connectsToThisPop = Boolean(selectedSiteData?.devices?.some((d: any) =>
                            d.service_links?.some((sl: any) => {
                                const popId = n.id.replace('cloud:', '');
                                return (sl.remote_ip && sl.remote_ip === nodeData.primary_peer_ip) ||
                                       (n.id === `cloud:${sl.service_endpoint_name}`) ||
                                       (popId === 'prisma-france-south' && ((sl.remote_ip === '130.41.124.164') || (sl.name || '').toLowerCase().includes('france-south'))) ||
                                       (popId === 'prisma-france-central' && (sl.name || '').toLowerCase().includes('france-central')) ||
                                       (popId === 'prisma-ireland' && (sl.remote_ip === '74.221.137.55' || (sl.name || '').toLowerCase().includes('ireland'))) ||
                                       (popId === 'zscaler-cloud' && (sl.provider === 'Zscaler' || (sl.name || '').toLowerCase().includes('zscaler')));
                            })
                        ));
                        if (!connectsToThisPop) {
                            nodeOpacity = 0.25;
                            nodeFilter = 'grayscale(0.6)';
                        } else {
                            nodeOpacity = 1;
                        }
                    }
                }
            }

            if (searchScope) {
                const isDirect = searchScope.directMatchNodeIds.has(n.id);
                const isConnected = searchScope.connectedNodeIds.has(n.id);
                if (isDirect) {
                    nodeOpacity = 1;
                } else if (isConnected) {
                    nodeOpacity = 0.95;
                } else {
                    nodeOpacity = 0.12;
                    nodeFilter = 'grayscale(0.85)';
                }
            }

            if (nodeOpacity !== undefined || nodeFilter !== undefined) {
                return {
                    ...enriched,
                    style: {
                        ...(enriched as any).style,
                        ...(nodeOpacity !== undefined ? { opacity: nodeOpacity } : {}),
                        ...(nodeFilter !== undefined ? { filter: nodeFilter } : {}),
                        transition: 'opacity 0.2s ease, filter 0.2s ease'
                    }
                };
            }

            return enriched;
        });
    }, [nodes, topologyViewMode, searchScope, underlayMode, underlayResolutionMap, siteLanVyosMap, underlayData, selectedCircuit, handleSelectCircuit, logicalViewSiteId]);


    const filteredEdges = useMemo(() => {
        const hasPopSelection = Boolean(selectedObject?.isSasePop);
        const selectedPopId = selectedObject?.isSasePop ? selectedObject.id : null;
        const selectedPopPeer = selectedObject?.isSasePop ? selectedObject.primary_peer_ip : null;
        const hasCircuitSelection = Boolean(selectedCircuit);
        const hasSiteSelection = Boolean(logicalViewSiteId);

        // Strict View Mode Isolation:
        // Ensure edges strictly correspond to the current active topology view mode.
        // This guarantees that switching between Overlay, Physical, SASE, and Underlay
        // never leaks residual edges from other layers.
        const modeEdges = edges.filter(e => {
            const edgeData = e.data as any;
            if (topologyViewMode === 'overlay') {
                return Boolean(edgeData?.isOverlayTunnel || e.id.startsWith('logical-edge-'));
            }
            if (topologyViewMode === 'physical') {
                return Boolean(edgeData?.isPhysicalWanEdge || e.id.startsWith('edge:'));
            }
            if (topologyViewMode === 'sase') {
                return Boolean(edgeData?.isSaseEdge || e.id.startsWith('sase-edge:'));
            }
            if (topologyViewMode === 'underlay') {
                return Boolean(edgeData?.isUnderlayEdge || e.id.startsWith('underlay-edge:'));
            }
            return true;
        });

        return modeEdges.map(e => {
            const edgeData = e.data as any;
            let currentEdge = e;

            if (edgeData?.isSaseEdge) {
                const isUp = edgeData.operational_state === 'up';
                const isZscaler = edgeData.isZscaler || edgeData.provider === 'Zscaler' || (edgeData.name || '').toLowerCase().includes('zscaler');
                // On Zscaler, all UP tunnels are ACTIVE
                const isAct = isZscaler ? isUp : (edgeData.effectiveAct ?? (edgeData.role === 'active' || (edgeData.name || '').toUpperCase().includes('_ACT')));
                const isStandby = edgeData.extended_state === 'standby_spoke';

                // 1. Global SASE Path Type Filter
                let isFilteredOut = false;
                if (saseTunnelTypeFilter === 'ACTIVE' && (!isAct || !isUp)) isFilteredOut = true;
                else if (saseTunnelTypeFilter === 'BACKUP' && (!isUp || isAct)) isFilteredOut = true;
                else if (saseTunnelTypeFilter === 'DOWN' && isUp) isFilteredOut = true;

                // 2. Instantaneous Focus Spotlight by selected PoP
                const isTargetingSelectedPop = Boolean(hasPopSelection && (
                    e.target === `cloud:${selectedPopId}` ||
                    (selectedPopPeer && edgeData.remote_ip === selectedPopPeer)
                ));

                // 3. Instantaneous Focus Spotlight by selected Site (e.g. clicking BR1)
                const isTargetingSelectedSite = Boolean(hasSiteSelection && (
                    e.source === `site:${logicalViewSiteId}` ||
                    edgeData.site_name === logicalViewSiteId ||
                    edgeData.site_id === logicalViewSiteId
                ));

                let isDimmed = isFilteredOut ||
                    (hasPopSelection && !isTargetingSelectedPop) ||
                    (hasSiteSelection && !isTargetingSelectedSite);

                // 4. Instantaneous Focus Spotlight by selected Circuit
                if (hasCircuitSelection) {
                    const isCircuitSaseMatch = Boolean(
                        (e.source === `site:${selectedCircuit.siteId}` || edgeData.site_name === selectedCircuit.siteName) &&
                        (edgeData.circuit_name === selectedCircuit.wan?.name ||
                         edgeData.circuit_name === selectedCircuit.wan?.circuit_label ||
                         e.sourceHandle?.includes(selectedCircuit.wan?.name))
                    );
                    if (!isCircuitSaseMatch) isDimmed = true;
                }

                // Vibrant stroke color: Zscaler UP is ALWAYS Green (#10b981 / #059669)
                let stroke = isDark ? '#ef4444' : '#dc2626';
                if (isUp) {
                    stroke = isAct ? (isDark ? '#10b981' : '#059669') : (isDark ? '#06b6d4' : '#0284c7');
                } else if (isStandby) {
                    stroke = isDark ? '#f59e0b' : '#d97706';
                }

                currentEdge = {
                    ...e,
                    animated: isUp && !isDimmed,
                    style: {
                        ...e.style,
                        stroke: stroke,
                        strokeWidth: isDimmed ? 1 : (isAct ? (isDark ? 3 : 2.5) : (isDark ? 2.2 : 2)),
                        strokeDasharray: isAct && isUp ? undefined : (isUp ? '6 6' : '4 4'),
                        opacity: isDimmed ? (isDark ? 0.08 : 0.12) : 1,
                        filter: isDark
                            ? ((isTargetingSelectedPop || isTargetingSelectedSite) 
                                ? (isAct ? 'drop-shadow(0 0 8px rgba(16,185,129,0.8))' : 'drop-shadow(0 0 8px rgba(6,182,212,0.8))')
                                : (isUp && isAct && !isDimmed ? 'drop-shadow(0 0 5px rgba(16,185,129,0.5))' : undefined))
                            : ((isTargetingSelectedPop || isTargetingSelectedSite)
                                ? (isAct ? 'drop-shadow(0 1px 3px rgba(5,150,105,0.4))' : 'drop-shadow(0 1px 3px rgba(2,132,199,0.4))')
                                : undefined),
                        pointerEvents: isDimmed ? 'none' : 'all',
                        transition: 'opacity 0.1s ease, stroke-width 0.1s ease'
                    }
                };
            } else if (hasCircuitSelection) {
                // Instantaneous Circuit Spotlight for SD-WAN Overlay, Physical WAN, and Underlay edges
                let isCircuitMatch = false;

                if (edgeData?.isOverlayTunnel) {
                    const isSourceMatch = (edgeData.sourceSiteName === selectedCircuit.siteName || e.source === `site:${selectedCircuit.siteId}`) &&
                                          (edgeData.sourceCircuitName === selectedCircuit.wan?.name || edgeData.sourceCircuitName === selectedCircuit.wan?.circuit_label || e.sourceHandle === `circuit:${selectedCircuit.devName}:${selectedCircuit.wan?.name}`);
                    const isTargetMatch = (edgeData.peer_site_name === selectedCircuit.siteName || edgeData.peer_site_id === selectedCircuit.siteId) &&
                                          (edgeData.peer_wan_interface === selectedCircuit.wan?.name || edgeData.peer_wan_interface === selectedCircuit.wan?.circuit_label);
                    isCircuitMatch = Boolean(isSourceMatch || isTargetMatch);
                } else if (edgeData?.isPhysicalWanEdge) {
                    isCircuitMatch = Boolean(
                        (e.source === `site:${selectedCircuit.siteId}` || edgeData.site_name === selectedCircuit.siteName) &&
                        (edgeData.name === selectedCircuit.wan?.name || edgeData.circuit_label === selectedCircuit.wan?.name)
                    );
                } else if (edgeData?.isUnderlayEdge) {
                    isCircuitMatch = Boolean(
                        (e.source === `site:${selectedCircuit.siteId}` || edgeData.site_name === selectedCircuit.siteName) &&
                        (edgeData.name === selectedCircuit.wan?.name || edgeData.circuit_label === selectedCircuit.wan?.name)
                    );
                }

                if (isCircuitMatch) {
                    const isUp = edgeData?.status === 'UP' || edgeData?.active || edgeData?.usable || edgeData?.link_up;
                    currentEdge = {
                        ...e,
                        animated: Boolean(edgeData?.active || isUp),
                        zIndex: 50,
                        style: {
                            ...e.style,
                            strokeWidth: edgeData?.active ? 4.5 : 3,
                            opacity: 1,
                            filter: 'drop-shadow(0 0 8px rgba(59,130,246,0.8))',
                            pointerEvents: 'all',
                            transition: 'opacity 0.1s ease, stroke-width 0.1s ease'
                        }
                    };
                } else {
                    currentEdge = {
                        ...e,
                        animated: false,
                        zIndex: 1,
                        style: {
                            ...e.style,
                            strokeWidth: 1,
                            opacity: 0.08,
                            pointerEvents: 'none',
                            transition: 'opacity 0.1s ease, stroke-width 0.1s ease'
                        }
                    };
                }
            }

            if (edgeData?.isOverlayTunnel && overlayTunnelStateFilter !== 'ALL') {
                const edgeState = edgeData.tunnelState || (edgeData.active ? 'ACTIVE' : (edgeData.status === 'DOWN' ? 'DOWN' : 'INACTIVE'));
                const isMatch = edgeState === overlayTunnelStateFilter;
                if (!isMatch) {
                    currentEdge = {
                        ...currentEdge,
                        animated: false,
                        zIndex: 1,
                        style: {
                            ...currentEdge.style,
                            strokeWidth: 1,
                            opacity: 0.05,
                            pointerEvents: 'none',
                            transition: 'opacity 0.15s ease, stroke-width 0.15s ease'
                        }
                    };
                } else {
                    currentEdge = {
                        ...currentEdge,
                        zIndex: 40,
                        style: {
                            ...currentEdge.style,
                            opacity: 1,
                            strokeWidth: edgeData.active ? 4.5 : 3,
                            filter: edgeData.active ? 'drop-shadow(0 0 6px rgba(16,185,129,0.7))' : edgeState === 'INACTIVE' ? 'drop-shadow(0 0 6px rgba(59,130,246,0.6))' : 'drop-shadow(0 0 6px rgba(239,68,68,0.7))',
                            transition: 'opacity 0.15s ease, stroke-width 0.15s ease'
                        }
                    };
                }
            }

            if (searchScope) {
                const isEdgeMatch = searchScope.matchedEdgeIds.has(currentEdge.id);
                return {
                    ...currentEdge,
                    style: {
                        ...currentEdge.style,
                        opacity: isEdgeMatch ? (currentEdge.style?.opacity ?? 1) : 0.08,
                        pointerEvents: isEdgeMatch ? ('auto' as const) : ('none' as const)
                    }
                };
            }

            return currentEdge;
        });
    }, [edges, topologyViewMode, searchScope, selectedObject, saseTunnelTypeFilter, selectedCircuit, overlayTunnelStateFilter, logicalViewSiteId, isDark]);

    const handleFitView = useCallback(() => {
        fitView({ padding: 0.12, duration: 450, minZoom: 0.12 });
    }, [fitView]);

    useEffect(() => {
        if (filteredNodes.length > 0) {
            const timer = setTimeout(() => {
                handleFitView();
            }, 250);
            return () => clearTimeout(timer);
        }
    }, [filteredNodes.length, topologyViewMode, handleFitView]);

    useEffect(() => {
        const handleResize = () => {
            handleFitView();
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [handleFitView]);

    return (
        <div className="h-[calc(100vh-140px)] w-full relative dark:bg-black/20 bg-card-secondary/30 rounded-3xl border border-border overflow-hidden animate-in fade-in zoom-in-95 duration-500 flex flex-col">
            {loading ? (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/85 backdrop-blur-md p-6">
                    <div className="max-w-md w-full bg-card/95 border border-border rounded-3xl p-6 shadow-2xl flex flex-col items-center">
                        {/* Header Icon + Elapsed Counter */}
                        <div className="flex items-center justify-between w-full mb-5">
                            <div className="flex items-center gap-3">
                                <div className="relative w-12 h-12 shrink-0">
                                    <div className="absolute inset-0 border-2 border-blue-500/20 rounded-2xl" />
                                    <div className="absolute inset-0 border-2 border-blue-500 border-t-transparent rounded-2xl animate-spin" />
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <Network size={20} className="text-blue-500 animate-pulse" />
                                    </div>
                                </div>
                                <div>
                                    <h2 className="text-sm font-black text-text-primary tracking-tight uppercase">Live SASE Discovery</h2>
                                    <p className="text-[10px] text-text-muted font-bold tracking-wider uppercase mt-0.5">
                                        Step {buildProgress.stage} of 4 • Parallel Engine
                                    </p>
                                </div>
                            </div>
                            <div className="px-2.5 py-1 rounded-xl bg-blue-500/10 border border-blue-500/25 text-blue-400 font-mono text-xs font-black tracking-tight">
                                {(buildProgress.elapsedMs / 1000).toFixed(1)}s
                            </div>
                        </div>

                        {/* Smooth Progress Bar */}
                        <div className="w-full h-1.5 bg-card-secondary rounded-full overflow-hidden mb-5 border border-border/50">
                            <div
                                className="h-full bg-gradient-to-r from-blue-600 via-sky-400 to-emerald-400 transition-all duration-300 rounded-full"
                                style={{
                                    width: `${Math.min(
                                        96,
                                        Math.max(12, (buildProgress.stage - 1) * 25 + Math.min(22, (buildProgress.elapsedMs / 1000) * 3.5))
                                    )}%`
                                }}
                            />
                        </div>

                        {/* 4-Step Live Stepper */}
                        <div className="w-full space-y-2.5">
                            {[
                                {
                                    id: 1,
                                    title: 'Prisma SASE OAuth2 Handshake',
                                    subtitle: 'Sub-tenant TSG authentication & bearer token',
                                },
                                {
                                    id: 2,
                                    title: 'SD-WAN Sites, IONs & LAN Subnets',
                                    subtitle: 'Parallel site inventory, clusters & interface roles',
                                },
                                {
                                    id: 3,
                                    title: 'Overlay VPN Mesh & SASE Fabric',
                                    subtitle: 'Mapping WAN circuits, IPSec state & Prisma Access PoPs',
                                },
                                {
                                    id: 4,
                                    title: 'Operational IPs & VyOS Underlay',
                                    subtitle: 'Resolving live DHCP/PPPoE state & next-hop hardware ports',
                                },
                            ].map((step) => {
                                const isDone = buildProgress.stage > step.id;
                                const isActive = buildProgress.stage === step.id;
                                return (
                                    <div
                                        key={step.id}
                                        className={cn(
                                            "flex items-center gap-3 px-3.5 py-2.5 rounded-2xl border transition-all duration-300",
                                            isActive
                                                ? "bg-blue-500/10 border-blue-500/35 shadow-sm"
                                                : isDone
                                                    ? "bg-emerald-500/5 border-emerald-500/20"
                                                    : "bg-card-secondary/30 border-border/40 opacity-50"
                                        )}
                                    >
                                        <div
                                            className={cn(
                                                "w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0 transition-all",
                                                isDone
                                                    ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/30"
                                                    : isActive
                                                        ? "bg-blue-600 text-white shadow-sm shadow-blue-500/30"
                                                        : "bg-card-secondary text-text-muted border border-border"
                                            )}
                                        >
                                            {isDone ? (
                                                <Check size={13} strokeWidth={3.5} />
                                            ) : isActive ? (
                                                <RefreshCw size={12} className="animate-spin" />
                                            ) : (
                                                step.id
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0 text-left">
                                            <div className={cn(
                                                "text-xs font-black tracking-tight truncate",
                                                isActive ? "text-blue-400" : isDone ? "text-text-primary" : "text-text-muted"
                                            )}>
                                                {step.title}
                                            </div>
                                            <div className="text-[10px] text-text-muted font-medium truncate">
                                                {step.subtitle}
                                            </div>
                                        </div>
                                        {isDone && (
                                            <span className="text-[9px] font-mono font-black uppercase tracking-wider text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                                                Done
                                            </span>
                                        )}
                                        {isActive && (
                                            <span className="text-[9px] font-mono font-black uppercase tracking-wider text-blue-400 bg-blue-500/15 px-2 py-0.5 rounded-md border border-blue-500/30 animate-pulse">
                                                Active
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            ) : error ? (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-card/80 backdrop-blur-md p-8">
                    <div className="max-w-xl w-full bg-card border border-border rounded-3xl p-8 shadow-2xl flex flex-col items-center text-center">
                        <div className="p-4 bg-blue-500/10 rounded-2xl text-blue-500 mb-6 border border-blue-500/20">
                            <Network size={48} />
                        </div>
                        <h2 className="text-2xl font-black text-text-primary tracking-tight mb-2">Topology Not Configured</h2>
                        <p className="text-text-muted text-sm mb-6 leading-relaxed">
                            To enable the Live VPN Topology Overlay, you must provide Prisma SD-WAN API credentials. Ensure the following environment variables are set in your <code className="bg-card-secondary px-1.5 py-0.5 rounded text-blue-400 font-mono text-xs">docker-compose.yml</code> file:
                        </p>

                        <div className="w-full bg-card-secondary/50 border border-border rounded-xl p-4 mb-6 text-left">
                            <div className="flex flex-col gap-2 font-mono text-[11px] text-text-secondary">
                                <span className="text-text-muted"># Prisma SD-WAN API Credentials</span>
                                <div><span className="text-purple-400">PRISMA_SDWAN_REGION</span><span className="text-text-muted">=us</span> <span className="text-text-muted/50 italic">// Optional (default: de)</span></div>
                                <div><span className="text-purple-400">PRISMA_SDWAN_TSGID</span><span className="text-text-muted">=YOUR_TSGID</span></div>
                                <div><span className="text-purple-400">PRISMA_SDWAN_CLIENT_ID</span><span className="text-text-muted">=YOUR_CLIENT_ID</span></div>
                                <div><span className="text-purple-400">PRISMA_SDWAN_CLIENT_SECRET</span><span className="text-text-muted">=YOUR_CLIENT_SECRET</span></div>
                            </div>
                        </div>

                        <div className="flex items-center justify-center gap-2 text-[11px] font-bold text-amber-500 bg-amber-500/10 px-4 py-2.5 rounded-xl border border-amber-500/20 mb-8 w-full">
                            <AlertCircle size={14} className="shrink-0" />
                            <span>After updating the file, run <code className="bg-amber-500/20 px-1 py-0.5 rounded text-amber-400 font-mono border border-amber-500/30">docker compose up -d</code> to apply changes.</span>
                        </div>

                        <div className="text-[10px] text-text-muted italic opacity-70 mb-6">
                            Technical Detail: {error}
                        </div>

                        <button
                            onClick={fetchTopology}
                            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-xl border border-blue-500 font-black uppercase text-xs tracking-widest transition-all shadow-lg shadow-blue-500/20"
                        >
                            <RefreshCw size={14} /> Check Connection
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    {/* Top Bar Header (Dedicated outside of ReactFlow canvas to eliminate any node overlap) */}
                    <div className="relative px-5 py-2.5 border-b border-border bg-card/80 backdrop-blur-md flex items-center justify-between gap-4 z-20 shrink-0 min-h-[56px]">
                        {/* Left: View Mode Icon & Title */}
                        <div className="flex items-center gap-3 shrink-0 z-20">
                            <div className={cn(
                                "p-2 rounded-xl text-white shadow-lg transition-all",
                                logicalViewSiteId
                                    ? "bg-purple-600 shadow-purple-500/25"
                                    : (selectedNetwork
                                        ? "bg-sky-600 shadow-sky-500/25"
                                        : (topologyViewMode === 'overlay'
                                            ? "bg-blue-600 shadow-blue-500/25"
                                            : topologyViewMode === 'underlay'
                                                ? "bg-amber-500 shadow-amber-500/25"
                                                : topologyViewMode === 'sase'
                                                    ? "bg-purple-600 shadow-purple-500/25"
                                                    : "bg-sky-600 shadow-sky-500/25"))
                            )}>
                                {logicalViewSiteId ? (
                                    <Network size={16} />
                                ) : selectedNetwork ? (
                                    <Cloud size={16} />
                                ) : topologyViewMode === 'overlay' ? (
                                    <Share2 size={16} />
                                ) : topologyViewMode === 'underlay' ? (
                                    <Server size={16} />
                                ) : topologyViewMode === 'sase' ? (
                                    <Shield size={16} />
                                ) : (
                                    <Globe size={16} />
                                )}
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h1 className="text-sm font-black text-text-primary uppercase tracking-tight">
                                        {logicalViewSiteId ? (
                                            <>
                                                {topologyViewMode === 'sase' ? 'Site SASE Focus' : 'Site Overlay Focus'}
                                                <span className="text-purple-400 font-mono text-xs font-bold lowercase ml-1.5">
                                                    ({topology?.sites?.find((s: any) => s.site_id === logicalViewSiteId)?.site_name || logicalViewSiteId})
                                                </span>
                                            </>
                                        ) : selectedNetwork ? (
                                            <>
                                                {selectedNetwork} SD-WAN Overlay
                                                <span className="text-sky-400 font-mono text-xs font-bold ml-1.5">
                                                    (Network Filter)
                                                </span>
                                            </>
                                        ) : topologyViewMode === 'overlay' ? (
                                            'SD-WAN Overlay'
                                        ) : topologyViewMode === 'underlay' ? (
                                            'VyOS Underlay Hardware'
                                        ) : topologyViewMode === 'sase' ? (
                                            'SASE Security Fabric'
                                        ) : (
                                            'WAN Transport Topology'
                                        )}
                                    </h1>
                                    {(logicalViewSiteId || selectedNetwork) && (
                                        <span className={cn(
                                            "px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border animate-pulse",
                                            logicalViewSiteId ? "bg-purple-500/15 text-purple-400 border-purple-500/30" : "bg-sky-500/15 text-sky-400 border-sky-500/30"
                                        )}>
                                            {logicalViewSiteId ? 'Site Focus' : 'Carrier Focus'}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <p className="text-[10px] text-text-muted font-bold tracking-widest">{topology?.site_count || 0} SITES DETECTED</p>
                                    {lastRefresh && (
                                        <>
                                            <span className="text-text-muted/40 text-[10px]">•</span>
                                            <p className="text-[9px] text-blue-500/80 font-black tracking-widest uppercase font-mono">
                                                {lastRefresh.toLocaleString()}
                                            </p>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Center: Primary View Modes & Contextual Sub-Filters (Clean Top Bar Integration) */}
                        <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 flex items-center gap-2 z-10 pointer-events-auto">
                            {/* Primary 4-Mode Switcher */}
                            <div className="bg-card-secondary/70 backdrop-blur-md border border-border p-1 rounded-xl shadow-sm flex items-center gap-1 shrink-0">
                                {/* Mode 1: WAN Transport */}
                                <button
                                    onClick={() => handleViewModeChange('physical')}
                                    className={cn(
                                        "px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer shrink-0",
                                        topologyViewMode === 'physical'
                                            ? "bg-sky-600 text-white shadow-sm shadow-sky-500/25"
                                            : "text-text-muted hover:text-text-primary hover:bg-card/80"
                                    )}
                                    title="Physical WAN Transport View"
                                >
                                    <Globe size={12} />
                                    <span>WAN Transport</span>
                                </button>

                                {/* Mode 2: SD-WAN Overlay */}
                                <button
                                    onClick={() => handleViewModeChange('overlay')}
                                    className={cn(
                                        "px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer shrink-0",
                                        topologyViewMode === 'overlay'
                                            ? "bg-blue-600 text-white shadow-sm shadow-blue-500/25"
                                            : "text-text-muted hover:text-text-primary hover:bg-card/80"
                                    )}
                                    title="Logical SD-WAN Overlay View"
                                >
                                    <Share2 size={12} />
                                    <span>SD-WAN Overlay</span>
                                </button>

                                {/* Mode 3: SASE Fabric */}
                                <button
                                    onClick={() => handleViewModeChange('sase')}
                                    className={cn(
                                        "px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer shrink-0",
                                        topologyViewMode === 'sase'
                                            ? "bg-purple-600 text-white shadow-sm shadow-purple-500/25"
                                            : "text-text-muted hover:text-purple-400 hover:bg-card/80"
                                    )}
                                    title="SASE Security Fabric View"
                                >
                                    <Shield size={12} />
                                    <span>SASE Fabric</span>
                                    {topology?.sase_infrastructure?.up_service_links !== undefined && (
                                        <span className={cn(
                                            "px-1.5 py-0.2 rounded-full text-[8px] font-mono font-black",
                                            topologyViewMode === 'sase' ? "bg-white/20 text-white" : "bg-purple-500/20 text-purple-300"
                                        )}>
                                            {topology.sase_infrastructure.up_service_links}
                                        </span>
                                    )}
                                </button>

                                {/* Mode 4: VyOS Ports */}
                                <button
                                    onClick={() => handleViewModeChange('underlay')}
                                    className={cn(
                                        "px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer shrink-0",
                                        topologyViewMode === 'underlay'
                                            ? "bg-amber-500 text-slate-950 font-black shadow-sm shadow-amber-500/25"
                                            : "text-text-muted hover:text-amber-400 hover:bg-card/80"
                                    )}
                                    title="VyOS Underlay Ports View"
                                >
                                    <Server size={12} />
                                    <span>VyOS Ports</span>
                                    {underlayData?.summary?.matched ? (
                                        <span className={cn(
                                            "px-1.5 py-0.2 rounded-full text-[8px] font-mono font-black",
                                            topologyViewMode === 'underlay' ? "bg-slate-950/20 text-slate-950" : "bg-amber-500/20 text-amber-300"
                                        )}>
                                            {underlayData.summary.matched}
                                        </span>
                                    ) : null}
                                </button>
                            </div>

                            {/* Divider */}
                            <div className="h-5 w-px bg-border/60 shrink-0" />

                            {/* Mode 1 & 2: WAN Transport / SD-WAN Overlay Sub-Filters */}
                            {(topologyViewMode === 'overlay' || topologyViewMode === 'physical') && (
                                <div className="bg-card-secondary/70 backdrop-blur-md border border-border p-1 rounded-xl shadow-sm flex items-center gap-1 animate-in fade-in duration-200 shrink-0">
                                    <button
                                        onClick={() => {
                                            setSelectedNetwork(null);
                                            if (selectedObject?.type === 'network') setSelectedObject(null);
                                        }}
                                        className={cn(
                                            "px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1 shrink-0",
                                            selectedNetwork === null
                                                ? "bg-blue-600 text-white shadow-sm shadow-blue-500/25"
                                                : "text-text-muted hover:text-text-primary hover:bg-card/80"
                                        )}
                                    >
                                        <span>{topologyViewMode === 'overlay' ? 'All Tunnels' : 'All Links'}</span>
                                    </button>
                                    <button
                                        onClick={() => {
                                            setSelectedNetwork('INTERNET');
                                            setSelectedObject({ type: 'network', network: 'INTERNET', wan_network: 'INTERNET', name: 'INTERNET' });
                                        }}
                                        className={cn(
                                            "px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1 shrink-0",
                                            selectedNetwork === 'INTERNET'
                                                ? "bg-sky-600 text-white shadow-sm shadow-sky-500/25"
                                                : "text-text-muted hover:text-sky-400 hover:bg-card/80"
                                        )}
                                    >
                                        <Cloud size={11} className="text-sky-400" />
                                        <span>Internet</span>
                                    </button>
                                    <button
                                        onClick={() => {
                                            setSelectedNetwork('MPLS');
                                            setSelectedObject({ type: 'network', network: 'MPLS', wan_network: 'MPLS', name: 'MPLS' });
                                        }}
                                        className={cn(
                                            "px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1 shrink-0",
                                            selectedNetwork === 'MPLS'
                                                ? "bg-purple-600 text-white shadow-sm shadow-purple-500/25"
                                                : "text-text-muted hover:text-purple-400 hover:bg-card/80"
                                        )}
                                    >
                                        <Network size={11} className="text-purple-400" />
                                        <span>MPLS</span>
                                    </button>
                                    {logicalViewSiteId && (
                                        <div className="pl-1.5 border-l border-border/60 flex items-center gap-1 shrink-0">
                                            <span className="text-[9px] font-black text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md">
                                                Site: {topology?.sites?.find((s: any) => s.site_id === logicalViewSiteId)?.site_name || logicalViewSiteId}
                                            </span>
                                            <button
                                                onClick={() => {
                                                    setLogicalViewSiteId(null);
                                                    if (selectedObject?.site_id) setSelectedObject(null);
                                                }}
                                                className="p-1 hover:bg-card text-text-muted hover:text-rose-400 rounded-md transition-colors cursor-pointer"
                                                title="Clear Site Focus"
                                            >
                                                <X size={11} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Mode 3: SASE Security Fabric Path Filter */}
                            {topologyViewMode === 'sase' && (
                                <div className="bg-card-secondary/70 backdrop-blur-md border border-border p-1 rounded-xl shadow-sm flex items-center gap-1 animate-in fade-in duration-200 shrink-0">
                                    <button
                                        onClick={() => setSaseTunnelTypeFilter('ALL')}
                                        className={cn(
                                            "px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1 shrink-0",
                                            saseTunnelTypeFilter === 'ALL'
                                                ? "bg-purple-600 text-white shadow-sm shadow-purple-500/25"
                                                : "text-text-muted hover:text-text-primary hover:bg-card/80"
                                        )}
                                    >
                                        <span>All Paths</span>
                                        <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-white/20 font-mono font-bold">
                                            {topology?.sase_infrastructure?.total_service_links || 25}
                                        </span>
                                    </button>
                                    <button
                                        onClick={() => setSaseTunnelTypeFilter('ACTIVE')}
                                        className={cn(
                                            "px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1 shrink-0",
                                            saseTunnelTypeFilter === 'ACTIVE'
                                                ? "bg-emerald-600 text-white shadow-sm shadow-emerald-500/25"
                                                : "text-text-muted hover:text-emerald-400 hover:bg-card/80"
                                        )}
                                    >
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                        <span>Active</span>
                                    </button>
                                    <button
                                        onClick={() => setSaseTunnelTypeFilter('BACKUP')}
                                        className={cn(
                                            "px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1 shrink-0",
                                            saseTunnelTypeFilter === 'BACKUP'
                                                ? "bg-cyan-600 text-white shadow-sm shadow-cyan-500/25"
                                                : "text-text-muted hover:text-cyan-400 hover:bg-card/80"
                                        )}
                                    >
                                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                                        <span>Backup</span>
                                    </button>
                                    <button
                                        onClick={() => setSaseTunnelTypeFilter('DOWN')}
                                        className={cn(
                                            "px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1 shrink-0",
                                            saseTunnelTypeFilter === 'DOWN'
                                                ? "bg-rose-600 text-white shadow-sm shadow-rose-500/25"
                                                : "text-text-muted hover:text-rose-400 hover:bg-card/80"
                                        )}
                                    >
                                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                                        <span>Down</span>
                                    </button>
                                    {logicalViewSiteId && (
                                        <div className="pl-1.5 border-l border-border/60 flex items-center gap-1 shrink-0">
                                            <span className="text-[9px] font-black text-purple-700 bg-purple-100 border-purple-300/80 dark:text-purple-400 dark:bg-purple-500/10 dark:border-purple-500/20 px-2 py-0.5 rounded-md shadow-sm">
                                                Site: {topology?.sites?.find((s: any) => s.site_id === logicalViewSiteId)?.site_name || logicalViewSiteId}
                                            </span>
                                            <button
                                                onClick={() => {
                                                    setLogicalViewSiteId(null);
                                                    if (selectedObject?.site_id) setSelectedObject(null);
                                                }}
                                                className="p-1 hover:bg-card text-text-muted hover:text-rose-400 rounded-md transition-colors cursor-pointer"
                                                title="Clear Site Focus"
                                            >
                                                <X size={11} />
                                            </button>
                                        </div>
                                    )}
                                    {selectedObject?.isSasePop && (
                                        <div className="pl-1.5 border-l border-border/60 flex items-center gap-1 shrink-0">
                                            <span className="text-[9px] font-black text-sky-700 bg-sky-100 border-sky-300/80 dark:text-cyan-400 dark:bg-cyan-500/10 dark:border-cyan-500/20 px-2 py-0.5 rounded-md shadow-sm">
                                                PoP: {selectedObject.name || selectedObject.id}
                                            </span>
                                            <button
                                                onClick={() => setSelectedObject(null)}
                                                className="p-1 hover:bg-card text-text-muted hover:text-rose-400 rounded-md transition-colors cursor-pointer"
                                                title="Clear PoP Focus"
                                            >
                                                <X size={11} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Mode 4: VyOS Underlay Diagnostics Shortcut */}
                            {topologyViewMode === 'underlay' && (
                                <div className="bg-card-secondary/70 backdrop-blur-md border border-border p-1 rounded-xl shadow-sm flex items-center gap-1 animate-in fade-in duration-200 shrink-0">
                                    <button
                                        onClick={() => setShowUnderlayDiagnostics(true)}
                                        className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                                    >
                                        <Layers size={12} />
                                        <span>Underlay Diagnostics</span>
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Right: Actions / Background Refresh Status / Clear Filter */}
                        <div className="flex items-center gap-2 z-20 shrink-0 min-w-[32px]">
                            {refreshing && (
                                <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/30 px-3 py-1.5 rounded-xl shadow-sm animate-in fade-in duration-200">
                                    <RefreshCw size={12} className="text-blue-400 animate-spin shrink-0" />
                                    <div className="flex flex-col text-left">
                                        <span className="text-[9px] font-black text-blue-400 uppercase tracking-wider leading-tight">
                                            Step {buildProgress.stage}/4 • {(buildProgress.elapsedMs / 1000).toFixed(1)}s
                                        </span>
                                        <span className="text-[9px] font-bold text-text-muted truncate max-w-[180px] leading-tight">
                                            {buildProgress.stageLabel}
                                        </span>
                                    </div>
                                </div>
                            )}
                            {(logicalViewSiteId || selectedNetwork) && (
                                <button
                                    onClick={() => {
                                        setLogicalViewSiteId(null);
                                        setSelectedNetwork(null);
                                        if (selectedObject?.type === 'network' || selectedObject?.site_id) setSelectedObject(null);
                                    }}
                                    className="bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/25 px-3 py-1.5 rounded-xl text-[10px] font-black tracking-widest uppercase transition-all flex items-center gap-1.5 cursor-pointer shadow-sm shadow-red-500/10 shrink-0"
                                >
                                    <X size={12} /> Clear Filter
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Canvas & Floating Drawers Container (Split-Pane Push Layout) */}
                    <div className="relative flex-1 flex flex-row w-full min-h-0 overflow-hidden">
                        {/* Canvas Area (resizes to calc(100% - 360px) when detail drawer opens) */}
                        <div className="flex-1 min-w-0 h-full relative">
                        {/* Filter Panel Overlay */}
                    {showFilter && topology && (
                        <div className="absolute top-20 right-4 z-[60] w-[350px] bg-card/95 backdrop-blur-xl border border-border rounded-3xl shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300 max-h-[70vh] flex flex-col">
                            <div className="p-4 border-b border-border flex items-center justify-between bg-card-secondary/20 rounded-t-3xl">
                                <div className="flex items-center gap-2">
                                    <Filter size={16} className="text-blue-500" />
                                    <h3 className="text-sm font-black text-text-primary uppercase tracking-tight">Filter SASE Sites</h3>
                                </div>
                                <button onClick={() => setShowFilter(false)} className="p-1 hover:bg-card-secondary rounded-lg transition-colors text-text-muted">
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="p-4 space-y-4 flex-1 overflow-hidden flex flex-col">
                                {/* Search in Filter */}
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={14} />
                                    <input
                                        type="text"
                                        placeholder="Search sites..."
                                        value={filterSearch}
                                        onChange={(e) => setFilterSearch(e.target.value)}
                                        className="w-full bg-card-secondary/50 border border-border rounded-xl pl-9 pr-4 py-2 text-xs font-bold text-text-primary focus:outline-none focus:ring-1 focus:ring-blue-500/50 transition-all"
                                    />
                                </div>

                                {/* Quick Filters */}
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={() => setVisibleSiteIds(topology.sites.map((s: any) => s.site_id))}
                                        className="py-2 px-3 bg-card-secondary/50 hover:bg-card-secondary border border-border rounded-xl text-[10px] font-black uppercase tracking-widest text-text-muted hover:text-text-primary transition-all flex items-center justify-center gap-2"
                                    >
                                        <CheckSquare size={12} /> Select All
                                    </button>
                                    <button
                                        onClick={() => setVisibleSiteIds([])}
                                        className="py-2 px-3 bg-card-secondary/50 hover:bg-card-secondary border border-border rounded-xl text-[10px] font-black uppercase tracking-widest text-text-muted hover:text-text-primary transition-all flex items-center justify-center gap-2"
                                    >
                                        <Square size={12} /> Clear None
                                    </button>
                                    <button
                                        onClick={() => {
                                            const hubs = topology.sites.filter(isHubLike).map((s: any) => s.site_id);
                                            setVisibleSiteIds(hubs);
                                        }}
                                        className="py-2 px-3 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest text-blue-500 transition-all flex items-center justify-center gap-2"
                                    >
                                        <LayoutGrid size={12} /> Hubs Only
                                    </button>
                                    <button
                                        onClick={() => {
                                            const spokes = topology.sites.filter((s: any) => !isHubLike(s)).map((s: any) => s.site_id);
                                            setVisibleSiteIds(spokes);
                                        }}
                                        className="py-2 px-3 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest text-green-500 transition-all flex items-center justify-center gap-2"
                                    >
                                        <Layers size={12} /> Branches Only
                                    </button>
                                </div>

                                {/* Site List */}
                                <div className="flex-1 overflow-y-auto space-y-1 pr-1 scrollbar-thin scrollbar-thumb-border">
                                    {topology.sites
                                        .filter((s: any) => s.site_name.toLowerCase().includes(filterSearch.toLowerCase()))
                                        .map((site: any) => {
                                            const isBG = site.branch_gateway === true || site.branch_gateway === 'true';
                                            const isHub = isHubLike(site);
                                            const isVisible = visibleSiteIds === null || visibleSiteIds.includes(site.site_id);

                                            return (
                                                <button
                                                    key={site.site_id}
                                                    onClick={() => {
                                                        const current = visibleSiteIds || topology.sites.map((s: any) => s.site_id);
                                                        if (current.includes(site.site_id)) {
                                                            setVisibleSiteIds(current.filter((id: string) => id !== site.site_id));
                                                        } else {
                                                            setVisibleSiteIds([...current, site.site_id]);
                                                        }
                                                    }}
                                                    className={cn(
                                                        "w-full flex items-center justify-between p-2.5 rounded-xl border transition-all group",
                                                        isVisible
                                                            ? "bg-blue-500/5 border-blue-500/20 text-text-primary"
                                                            : "bg-transparent border-transparent text-text-muted opacity-50 grayscale"
                                                    )}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className={cn(
                                                            "w-8 h-8 rounded-lg flex items-center justify-center",
                                                            isBG 
                                                                ? "bg-amber-500/20 text-amber-400" 
                                                                : (isHub ? "bg-blue-500/20 text-blue-500" : "bg-card-secondary text-text-secondary")
                                                        )}>
                                                            {isBG ? <GitBranch size={14} /> : (isHub ? <Server size={14} /> : <Home size={14} />)}
                                                        </div>
                                                        <div className="text-left">
                                                            <div className="text-xs font-black uppercase tracking-tight">{site.site_name}</div>
                                                            <div className="text-[9px] font-bold opacity-60 tracking-widest uppercase">
                                                                {isBG ? 'Branch Gateway' : (isHub ? 'Hub Site' : 'Branch Site')}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className={cn(
                                                        "w-5 h-5 rounded-md flex items-center justify-center transition-all",
                                                        isVisible ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20" : "bg-card-secondary text-transparent border border-border"
                                                    )}>
                                                        <Check size={12} strokeWidth={4} />
                                                    </div>
                                                </button>
                                            )
                                        })}
                                </div>
                            </div>

                            <div className="p-4 bg-card-secondary/30 rounded-b-3xl text-[10px] text-text-muted font-bold text-center italic border-t border-border">
                                {visibleSiteIds?.length || 0} of {topology.sites.length} sites visible
                            </div>
                         </div>
                    )}

                    <ReactFlow
                        nodes={filteredNodes}
                        edges={filteredEdges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onNodeClick={onNodeClick}
                        onEdgeClick={onEdgeClick}
                        onEdgeMouseEnter={onEdgeMouseEnter}
                        onEdgeMouseMove={onEdgeMouseMove}
                        onEdgeMouseLeave={onEdgeMouseLeave}
                        onPaneClick={() => {
                            setSelectedObject(null);
                            setSelectedCircuit(null);
                            setSelectedNetwork(null);
                            setLogicalViewSiteId(null);
                            setShowUnderlayPanel(false);
                            setInspectedLink(null);
                            setHoveredEdge(null);
                        }}
                        minZoom={0.12}
                        maxZoom={2.5}
                        nodeTypes={nodeTypes}
                        edgeTypes={edgeTypes}
                        className="w-full h-full dark:bg-slate-950/40 bg-card-secondary/20"
                    >
                        <Background color="#1e293b" gap={20} size={1} className="topology-bg" />
                        <Controls className="!bg-card !border-border !rounded-xl !shadow-xl" />

                        {/* Action Tools Dock - Bottom Right Corner (Never Overlaps Nodes) */}
                        <div className="absolute right-5 bottom-6 z-20 pointer-events-auto flex flex-col items-end">
                            <div className="bg-card/90 backdrop-blur-md border border-border p-1.5 rounded-2xl shadow-2xl flex flex-col items-center gap-1.5 w-[46px]">
                                {/* Auto-fit to Screen Button */}
                                <button
                                    onClick={handleFitView}
                                    className="w-9 h-9 rounded-xl transition-all flex items-center justify-center hover:bg-card-secondary text-text-muted hover:text-sky-400 cursor-pointer"
                                    title="Recenter topology (Auto-fit)"
                                >
                                    <Maximize size={16} />
                                </button>

                                {/* Branch Gateway Layout Toggle */}
                                <button
                                    onClick={() => setBgLayout(prev => prev === 'flank' ? 'top' : 'flank')}
                                    className={cn(
                                        "w-9 h-9 rounded-xl transition-all flex items-center justify-center cursor-pointer",
                                        bgLayout === 'flank' 
                                            ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30 shadow-sm" 
                                            : "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30 shadow-sm"
                                    )}
                                    title={bgLayout === 'flank' ? "Branch Gateway: Flank Left (click to place as Top Hub)" : "Branch Gateway: Top Hub (click to place on Left Flank)"}
                                >
                                    <GitBranch size={16} />
                                </button>

                                {/* Branch-to-Branch Mesh Toggle */}
                                <button
                                    onClick={() => setShowBranchMesh(prev => !prev)}
                                    className={cn(
                                        "w-9 h-9 rounded-xl transition-all flex items-center justify-center cursor-pointer",
                                        showBranchMesh 
                                            ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30 shadow-sm" 
                                            : "hover:bg-card-secondary text-text-muted hover:text-text-primary"
                                    )}
                                    title={showBranchMesh ? "Hide Branch-to-Branch Mesh Tunnels" : "Show Branch-to-Branch Mesh Tunnels (Arched Bridges)"}
                                >
                                    <Route size={16} />
                                </button>

                                {/* Filter Button */}
                                <button
                                    onClick={() => setShowFilter(!showFilter)}
                                    className={cn(
                                        "w-9 h-9 rounded-xl transition-all flex items-center justify-center relative cursor-pointer",
                                        (visibleSiteIds !== null && topology && visibleSiteIds.length !== topology.sites.length) 
                                            ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" 
                                            : "hover:bg-card-secondary text-text-muted hover:text-text-primary"
                                    )}
                                    title="Filter visible sites"
                                >
                                    <Filter size={16} />
                                    {visibleSiteIds !== null && topology && visibleSiteIds.length !== topology.sites.length && (
                                        <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 text-white text-[9px] font-black rounded-full flex items-center justify-center border-2 border-background">
                                            {visibleSiteIds.length}
                                        </span>
                                    )}
                                </button>

                                <div className="w-6 h-px bg-border/60 my-0.5" />

                                {/* Export CSV */}
                                <button
                                    onClick={handleExportCsv}
                                    className="w-9 h-9 hover:bg-card-secondary rounded-xl text-text-muted hover:text-green-500 transition-all flex items-center justify-center cursor-pointer"
                                    title="Export Inventory (CSV)"
                                >
                                    <FileText size={16} />
                                </button>

                                {/* Export PNG */}
                                <button
                                    onClick={handleExportPng}
                                    className="w-9 h-9 hover:bg-card-secondary rounded-xl text-text-muted hover:text-blue-500 transition-all flex items-center justify-center cursor-pointer"
                                    title="Export Map (PNG)"
                                >
                                    <Download size={16} />
                                </button>

                                <div className="w-6 h-px bg-border/60 my-0.5" />

                                {/* Refresh Topology Data */}
                                <button
                                    onClick={handleRefresh}
                                    disabled={refreshing}
                                    className={cn(
                                        "w-9 h-9 rounded-xl transition-all flex items-center justify-center cursor-pointer",
                                        refreshing
                                            ? "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                                            : "hover:bg-card-secondary text-text-muted hover:text-orange-500"
                                    )}
                                    title={refreshing ? `Refreshing Topology (${buildProgress.stageLabel})` : "Force Refresh Topology Data"}
                                >
                                    <RefreshCw size={16} className={cn(refreshing && "animate-spin")} />
                                </button>

                                <div className="w-6 h-px bg-border/60 my-0.5" />

                                {/* Underlay Inspect Button */}
                                <div className="relative">
                                    <button
                                        id="topology-underlay-btn"
                                        onClick={() => setShowUnderlayMenu(prev => !prev)}
                                        className={cn(
                                            "w-9 h-9 rounded-xl transition-all flex items-center justify-center relative cursor-pointer",
                                            underlayMode !== 'off'
                                                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30"
                                                : underlayData?.summary?.matched
                                                    ? "hover:bg-card-secondary text-text-muted hover:text-amber-400"
                                                    : "hover:bg-card-secondary text-text-muted/60 hover:text-text-primary"
                                        )}
                                        title={
                                            !underlayData 
                                                ? "Underlay Inspect (Loading/Click to inspect)" 
                                                : !underlayData.vyosConfigAvailable 
                                                    ? "Underlay Inspect — VyOS not configured in config/vyos-config.json"
                                                    : `Underlay Inspect — ${underlayData.summary.matched}/${underlayData.summary.wanInterfacesSeen} matched to VyOS next-hops`
                                        }
                                    >
                                        <Layers size={16} className={cn(underlayData && !underlayData.vyosConfigAvailable ? "text-amber-500/70" : "")} />
                                        {underlayData?.summary?.matched !== undefined && underlayData.summary.matched > 0 ? (
                                            <span className="absolute -top-1 -right-1 px-1 bg-amber-500 text-slate-950 text-[8px] font-black rounded-full border border-background">
                                                {underlayData.summary.matched}
                                            </span>
                                        ) : underlayData && !underlayData.vyosConfigAvailable ? (
                                            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400" />
                                        ) : null}
                                    </button>

                                    {showUnderlayMenu && (
                                        <div className="absolute top-1/2 -translate-y-1/2 right-full mr-3 w-72 bg-card/95 backdrop-blur-xl border border-border rounded-2xl shadow-2xl z-[70] animate-in fade-in slide-in-from-right-2 duration-200">
                                            <div className="p-3 border-b border-border">
                                                <div className="flex items-center justify-between">
                                                    <div className="text-[10px] font-black text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                                                        <Layers size={12} className="text-amber-400" /> Underlay Inspect
                                                    </div>
                                                    {underlayData?.vyosConfigAvailable ? (
                                                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">VYOS ACTIVE</span>
                                                    ) : (
                                                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">NO CONFIG</span>
                                                    )}
                                                </div>
                                                <div className="text-[9px] text-text-muted/70 mt-1">
                                                    {underlayData?.vyosConfigAvailable 
                                                        ? `${underlayData.summary.matched} of ${underlayData.summary.wanInterfacesSeen} circuits resolved to VyOS next-hops`
                                                        : "No VyOS routers configured in config/vyos-config.json"}
                                                </div>
                                            </div>

                                            <div className="p-2 space-y-1">
                                                {underlayData?.vyosConfigAvailable && (
                                                    <button
                                                        onClick={() => { setUnderlayMode(underlayMode === 'badges' ? 'off' : 'badges'); setShowUnderlayMenu(false); }}
                                                        className={cn(
                                                            "w-full text-left px-3 py-2 rounded-xl text-[11px] font-bold transition-all flex items-center gap-2",
                                                            underlayMode === 'badges'
                                                                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                                                : "text-text-secondary hover:bg-card-secondary hover:text-text-primary"
                                                        )}
                                                    >
                                                        <Layers size={13} />
                                                        {underlayMode === 'badges' ? 'Hide map badges' : 'Show map badges (🟢/⬜)'}
                                                    </button>
                                                )}

                                                <button
                                                    onClick={() => { setShowUnderlayDiagnostics(true); setShowUnderlayMenu(false); }}
                                                    className="w-full text-left px-3 py-2 rounded-xl text-[11px] font-bold text-text-primary hover:bg-card-secondary transition-all flex items-center gap-2"
                                                >
                                                    <Table size={13} className="text-blue-400" />
                                                    Open Diagnostics Table ({underlayData?.resolutions?.length || 0} WANs)
                                                </button>

                                                <a
                                                    href="/api/topology/underlay-debug"
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="w-full text-left px-3 py-2 rounded-xl text-[11px] font-bold text-text-muted hover:text-text-primary hover:bg-card-secondary transition-all flex items-center justify-between"
                                                >
                                                    <span className="flex items-center gap-2 font-mono text-[10px]"><ExternalLink size={12} /> Direct Debug JSON</span>
                                                    <span className="text-[9px] opacity-60">/api/topology/underlay-debug</span>
                                                </a>

                                                {underlayMode !== 'off' && (
                                                    <button
                                                        onClick={() => { setUnderlayMode('off'); setShowUnderlayMenu(false); setShowUnderlayPanel(false); }}
                                                        className="w-full text-left px-3 py-2 rounded-xl text-[11px] font-bold text-red-400 hover:bg-red-500/10 transition-all flex items-center gap-2"
                                                    >
                                                        <X size={13} /> Exit Underlay Badges Mode
                                                    </button>
                                                )}
                                            </div>

                                            {underlayData?.summary && (
                                                <div className="px-3 pb-3 pt-1">
                                                    <div className="grid grid-cols-2 gap-1 text-[9px] font-bold">
                                                        <button 
                                                            onClick={() => { setDiagnosticsFilter('matched'); setShowUnderlayDiagnostics(true); setShowUnderlayMenu(false); }}
                                                            className="bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 rounded-lg p-1.5 text-center text-green-400 transition-colors"
                                                        >
                                                            <div className="text-[14px] font-black">{underlayData.summary.matched}</div>
                                                            <div className="opacity-70">Matched 🟢</div>
                                                        </button>
                                                        <button 
                                                            onClick={() => { setDiagnosticsFilter('no_match'); setShowUnderlayDiagnostics(true); setShowUnderlayMenu(false); }}
                                                            className="bg-card-secondary hover:bg-card-secondary/80 border border-border rounded-lg p-1.5 text-center text-text-muted transition-colors"
                                                        >
                                                            <div className="text-[14px] font-black">{underlayData.summary.noMatch}</div>
                                                            <div className="opacity-70">No Match ⬜</div>
                                                        </button>
                                                        <button 
                                                            onClick={() => { setDiagnosticsFilter('ambiguous'); setShowUnderlayDiagnostics(true); setShowUnderlayMenu(false); }}
                                                            className="bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-lg p-1.5 text-center text-amber-400 transition-colors"
                                                        >
                                                            <div className="text-[14px] font-black">{underlayData.summary.ambiguous}</div>
                                                            <div className="opacity-70">Ambiguous 🟡</div>
                                                        </button>
                                                        <button 
                                                            onClick={() => { setDiagnosticsFilter('wan_ip_unavailable'); setShowUnderlayDiagnostics(true); setShowUnderlayMenu(false); }}
                                                            className="bg-slate-500/10 hover:bg-slate-500/20 border border-slate-500/20 rounded-lg p-1.5 text-center text-slate-400 transition-colors"
                                                        >
                                                            <div className="text-[14px] font-black">{underlayData.summary.wanIpUnavailable}</div>
                                                            <div className="opacity-70">IP Unknown ❓</div>
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Middle-Left Compact Search Widget */}
                        <Panel position="top-left" className="!top-1/2 -translate-y-1/2 !left-4 mt-20">
                            <div className={cn(
                                "bg-card/90 backdrop-blur-md border border-border p-1.5 rounded-2xl shadow-2xl flex flex-col gap-2 transition-all duration-300",
                                searchQuery ? "w-60 p-2.5 ring-1 ring-blue-500/40" : "group hover:p-2 items-center"
                            )}>
                                <div className="flex items-center gap-2 w-full">
                                    <div className={cn(
                                        "p-2 rounded-xl transition-all shadow-inner shrink-0",
                                        searchQuery ? "bg-blue-500 text-white" : "bg-card-secondary text-text-muted group-hover:bg-blue-500 group-hover:text-white"
                                    )}>
                                        <Search size={16} />
                                    </div>
                                    <div className={cn(
                                        "flex items-center gap-1.5 overflow-hidden transition-all duration-300 flex-1",
                                        searchQuery ? "w-full" : "w-10 group-hover:w-44"
                                    )}>
                                        <input
                                            type="text"
                                            placeholder="Filter nodes & peers..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && searchScope && searchScope.directMatchNodeIds.size === 1) {
                                                    const targetId = Array.from(searchScope.directMatchNodeIds)[0];
                                                    fitView({
                                                        nodes: [{ id: targetId }],
                                                        duration: 500,
                                                        padding: 0.4
                                                    });
                                                }
                                            }}
                                            className="bg-transparent border-none text-[11px] font-bold py-1 px-1 focus:outline-none placeholder:text-text-muted/50 w-full text-text-primary"
                                        />
                                        {searchQuery && (
                                            <button
                                                onClick={() => setSearchQuery('')}
                                                className="text-text-muted hover:text-text-primary p-1 rounded-md hover:bg-card-secondary transition-colors"
                                                title="Clear search"
                                            >
                                                <X size={13} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {searchQuery && searchScope && (
                                    <div className="text-[9px] font-semibold text-text-muted px-1 pt-1 border-t border-border/50 flex items-center justify-between w-full">
                                        <span className="text-text-primary">{searchScope.directMatchNodeIds.size} match{searchScope.directMatchNodeIds.size !== 1 ? 'es' : ''}</span>
                                        <span className="text-blue-500 dark:text-blue-400">
                                            +{Math.max(0, searchScope.connectedNodeIds.size - searchScope.directMatchNodeIds.size)} peer{Math.max(0, searchScope.connectedNodeIds.size - searchScope.directMatchNodeIds.size) !== 1 ? 's' : ''} visible
                                        </span>
                                    </div>
                                )}
                            </div>
                        </Panel>

                        {/* Legend Panel */}
                        <Panel position="bottom-left" className="font-sans">
                            <div className="bg-card/80 backdrop-blur-md border border-border p-3.5 rounded-2xl shadow-xl flex flex-col gap-1.5 min-w-[170px]">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                    <div className="text-[9px] font-black text-text-muted uppercase tracking-[0.2em]">Topology Legend</div>
                                    {(logicalViewSiteId || topologyViewMode === 'overlay') && overlayTunnelStateFilter !== 'ALL' && (
                                        <button
                                            onClick={() => {
                                                setOverlayTunnelStateFilter('ALL');
                                                setNetworkTunnelFilter('ALL');
                                            }}
                                            className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors cursor-pointer"
                                        >
                                            Show All
                                        </button>
                                    )}
                                    {topologyViewMode === 'sase' && saseTunnelTypeFilter !== 'ALL' && (
                                        <button
                                            onClick={() => setSaseTunnelTypeFilter('ALL')}
                                            className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-500/30 transition-colors cursor-pointer"
                                        >
                                            Show All
                                        </button>
                                    )}
                                </div>
                                {(logicalViewSiteId || topologyViewMode === 'overlay') ? (
                                    <>
                                        <button
                                            onClick={() => {
                                                const next = overlayTunnelStateFilter === 'ACTIVE' ? 'ALL' : 'ACTIVE';
                                                setOverlayTunnelStateFilter(next);
                                                setNetworkTunnelFilter(next);
                                            }}
                                            className={cn(
                                                "flex items-center justify-between gap-2 px-2 py-1.5 rounded-xl text-[10px] font-bold text-left transition-all cursor-pointer border",
                                                overlayTunnelStateFilter === 'ACTIVE'
                                                    ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/50 shadow-sm shadow-emerald-500/20"
                                                    : "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-white/5 border-transparent"
                                            )}
                                            title="Click to isolate Active tunnels"
                                        >
                                            <div className="flex items-center gap-2">
                                                <div className="w-5 h-1 bg-emerald-500 rounded-full" />
                                                <span>Overlay: Active (UP)</span>
                                            </div>
                                            {overlayTunnelStateFilter === 'ACTIVE' && (
                                                <span className="text-[8px] font-black uppercase px-1 py-0.2 rounded bg-emerald-500/30 text-emerald-800 dark:text-emerald-300">Filtered</span>
                                            )}
                                        </button>

                                        <button
                                            onClick={() => {
                                                const next = overlayTunnelStateFilter === 'INACTIVE' ? 'ALL' : 'INACTIVE';
                                                setOverlayTunnelStateFilter(next);
                                                setNetworkTunnelFilter(next);
                                            }}
                                            className={cn(
                                                "flex items-center justify-between gap-2 px-2 py-1.5 rounded-xl text-[10px] font-bold text-left transition-all cursor-pointer border",
                                                overlayTunnelStateFilter === 'INACTIVE'
                                                    ? "bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/50 shadow-sm shadow-blue-500/20"
                                                    : "text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-white/5 border-transparent"
                                            )}
                                            title="Click to isolate Inactive / Standby tunnels"
                                        >
                                            <div className="flex items-center gap-2">
                                                <div className="w-5 h-1 border-t-2 border-dashed border-blue-500 dark:border-blue-400" />
                                                <span>Overlay: Inactive (Standby)</span>
                                            </div>
                                            {overlayTunnelStateFilter === 'INACTIVE' && (
                                                <span className="text-[8px] font-black uppercase px-1 py-0.2 rounded bg-blue-500/30 text-blue-800 dark:text-blue-300">Filtered</span>
                                            )}
                                        </button>

                                        <button
                                            onClick={() => {
                                                const next = overlayTunnelStateFilter === 'DOWN' ? 'ALL' : 'DOWN';
                                                setOverlayTunnelStateFilter(next);
                                                setNetworkTunnelFilter(next);
                                            }}
                                            className={cn(
                                                "flex items-center justify-between gap-2 px-2 py-1.5 rounded-xl text-[10px] font-bold text-left transition-all cursor-pointer border",
                                                overlayTunnelStateFilter === 'DOWN'
                                                    ? "bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/50 shadow-sm shadow-rose-500/20"
                                                    : "text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-white/5 border-transparent"
                                            )}
                                            title="Click to isolate Down tunnels"
                                        >
                                            <div className="flex items-center gap-2">
                                                <div className="w-5 h-1 bg-rose-500 rounded-full" />
                                                <span>Overlay: Down</span>
                                            </div>
                                            {overlayTunnelStateFilter === 'DOWN' && (
                                                <span className="text-[8px] font-black uppercase px-1 py-0.2 rounded bg-rose-500/30 text-rose-800 dark:text-rose-300">Filtered</span>
                                            )}
                                        </button>

                                        <div className="pt-1 mt-1 border-t border-border/50 flex items-center justify-between text-[9px] text-text-muted font-mono gap-2">
                                            <span className="text-sky-600 dark:text-sky-400 font-bold">Circuits: Cyan (Internet)</span>
                                            <span className="text-purple-600 dark:text-purple-400 font-bold">Purple (MPLS)</span>
                                        </div>
                                    </>
                                ) : topologyViewMode === 'sase' ? (
                                    <>
                                        <button
                                            onClick={() => setSaseTunnelTypeFilter(prev => prev === 'ACTIVE' ? 'ALL' : 'ACTIVE')}
                                            className={cn(
                                                "flex items-center justify-between gap-2 px-2 py-1.5 rounded-xl text-[10px] font-bold text-left transition-all cursor-pointer border",
                                                saseTunnelTypeFilter === 'ACTIVE'
                                                    ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/50 shadow-sm shadow-emerald-500/20"
                                                    : "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-white/5 border-transparent"
                                            )}
                                            title="Click to isolate Active SASE tunnels"
                                        >
                                            <div className="flex items-center gap-2">
                                                <div className="w-5 h-1 bg-emerald-500 rounded-full shadow-sm dark:shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                                <span>Active SASE Tunnel (UP)</span>
                                            </div>
                                            {saseTunnelTypeFilter === 'ACTIVE' && (
                                                <span className="text-[8px] font-black uppercase px-1 py-0.2 rounded bg-emerald-500/30 text-emerald-800 dark:text-emerald-300">Filtered</span>
                                            )}
                                        </button>

                                        <button
                                            onClick={() => setSaseTunnelTypeFilter(prev => prev === 'BACKUP' ? 'ALL' : 'BACKUP')}
                                            className={cn(
                                                "flex items-center justify-between gap-2 px-2 py-1.5 rounded-xl text-[10px] font-bold text-left transition-all cursor-pointer border",
                                                saseTunnelTypeFilter === 'BACKUP'
                                                    ? "bg-cyan-500/20 text-sky-700 dark:text-cyan-300 border-cyan-500/50 shadow-sm shadow-cyan-500/20"
                                                    : "text-sky-600 dark:text-cyan-400 hover:bg-sky-50 dark:hover:bg-white/5 border-transparent"
                                            )}
                                            title="Click to isolate Backup SASE tunnels"
                                        >
                                            <div className="flex items-center gap-2">
                                                <div className="w-5 h-1 border-t-2 border-dashed border-sky-500 dark:border-cyan-400" />
                                                <span>Backup SASE Tunnel (UP)</span>
                                            </div>
                                            {saseTunnelTypeFilter === 'BACKUP' && (
                                                <span className="text-[8px] font-black uppercase px-1 py-0.2 rounded bg-cyan-500/30 text-sky-800 dark:text-cyan-300">Filtered</span>
                                            )}
                                        </button>

                                        <div className="flex items-center gap-2 px-2 py-1 text-[10px] font-bold text-amber-600 dark:text-amber-400/80">
                                            <div className="w-5 h-1 border-t-2 border-dashed border-amber-500 dark:border-amber-400" />
                                            <span>Standby Spoke Path</span>
                                        </div>

                                        <button
                                            onClick={() => setSaseTunnelTypeFilter(prev => prev === 'DOWN' ? 'ALL' : 'DOWN')}
                                            className={cn(
                                                "flex items-center justify-between gap-2 px-2 py-1.5 rounded-xl text-[10px] font-bold text-left transition-all cursor-pointer border",
                                                saseTunnelTypeFilter === 'DOWN'
                                                    ? "bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/50 shadow-sm shadow-rose-500/20"
                                                    : "text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-white/5 border-transparent"
                                            )}
                                            title="Click to isolate Down / Retransmission SASE paths"
                                        >
                                            <div className="flex items-center gap-2">
                                                <div className="w-5 h-1 border-t-2 border-dashed border-rose-500" />
                                                <span>Down / Retransmission</span>
                                            </div>
                                            {saseTunnelTypeFilter === 'DOWN' && (
                                                <span className="text-[8px] font-black uppercase px-1 py-0.2 rounded bg-rose-500/30 text-rose-800 dark:text-rose-300">Filtered</span>
                                            )}
                                        </button>

                                        <div className="pt-1 mt-1 border-t border-border/50 flex items-center justify-between text-[9px] text-text-muted font-mono">
                                            <span className="text-purple-700 dark:text-purple-400 font-bold">LEFT: Prisma Access</span>
                                            <span className="text-blue-700 dark:text-blue-400 font-bold">RIGHT: Zscaler</span>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-text-secondary">
                                            <div className="w-2.5 h-2.5 rounded bg-blue-500/20 border border-blue-500/50" /> Hub / Data Center
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-text-secondary">
                                            <div className="w-2.5 h-2.5 rounded bg-card border border-border" /> Spoke Site
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-text-secondary">
                                            <div className="w-6 h-0.5 bg-blue-500" /> Public Internet
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-text-secondary">
                                            <div className="w-6 h-0.5 bg-purple-500" /> Private WAN (MPLS)
                                        </div>
                                    </>
                                )}
                            </div>
                        </Panel>

                        {/* Floating Edge Hover Tooltip */}
                        {hoveredEdge && hoveredEdge.data && (
                            <div
                                className="fixed z-50 pointer-events-none transition-transform duration-75 ease-out select-none"
                                style={{
                                    left: `${Math.max(240, Math.min(window.innerWidth - 240, hoveredEdge.x))}px`,
                                    top: `${hoveredEdge.y}px`,
                                    transform: hoveredEdge.y > 150 ? 'translate(-50%, -100%) translateY(-14px)' : 'translate(-50%, 0) translateY(18px)',
                                }}
                            >
                                {hoveredEdge.data.isOverlayTunnel ? (
                                    <div className="bg-card/95 backdrop-blur-xl border border-border/80 shadow-2xl rounded-2xl px-3.5 py-2 text-xs pointer-events-none whitespace-nowrap min-w-max">
                                        {/* Main Row: <Src Site> : <Src Circuit> <= [STATE] => <Dest Circuit> : <Dest Site> */}
                                        <div className="flex items-center gap-2 font-mono">
                                            {/* Source Endpoint */}
                                            <div className="flex items-center gap-1.5 text-text-primary">
                                                <span className="font-black text-text-primary">{hoveredEdge.data.sourceSiteName || 'Source'}</span>
                                                {hoveredEdge.data.sourceDeviceName && hoveredEdge.data.sourceDeviceName !== hoveredEdge.data.sourceSiteName && (
                                                    <span className="text-[10px] text-text-muted">({hoveredEdge.data.sourceDeviceName})</span>
                                                )}
                                                <span className="px-1.5 py-0.5 rounded bg-card-secondary/80 border border-border/50 text-[10px] text-cyan-400 font-bold">
                                                    {hoveredEdge.data.sourceCircuitLabel || hoveredEdge.data.sourceCircuitName || 'WAN'}
                                                </span>
                                            </div>

                                            {/* State Badge with Directional Arrows */}
                                            <div className={cn(
                                                "px-2 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-wider flex items-center gap-1",
                                                (hoveredEdge.data.tunnelState === 'ACTIVE' || hoveredEdge.data.active) && "bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.3)]",
                                                (!hoveredEdge.data.active && hoveredEdge.data.status !== 'DOWN' && hoveredEdge.data.tunnelState !== 'DOWN') && "bg-blue-500/20 text-blue-400 border-blue-500/40",
                                                (hoveredEdge.data.tunnelState === 'DOWN' || hoveredEdge.data.status === 'DOWN') && "bg-rose-500/20 text-rose-400 border-rose-500/40"
                                            )}>
                                                <span className="text-[9px]">⇐</span>
                                                <span className={cn(
                                                    "w-1.5 h-1.5 rounded-full",
                                                    (hoveredEdge.data.tunnelState === 'ACTIVE' || hoveredEdge.data.active) ? "bg-emerald-400 animate-pulse" : (hoveredEdge.data.tunnelState === 'DOWN' || hoveredEdge.data.status === 'DOWN') ? "bg-rose-400" : "bg-blue-400"
                                                )} />
                                                <span>{hoveredEdge.data.active ? 'ACTIVE' : (hoveredEdge.data.status === 'DOWN' || hoveredEdge.data.tunnelState === 'DOWN') ? 'DOWN' : 'INACTIVE'}</span>
                                                <span className="text-[9px]">⇒</span>
                                            </div>

                                            {/* Destination Endpoint */}
                                            <div className="flex items-center gap-1.5 text-text-primary">
                                                <span className="px-1.5 py-0.5 rounded bg-card-secondary/80 border border-border/50 text-[10px] text-cyan-400 font-bold">
                                                    {hoveredEdge.data.peer_wan_interface || 'WAN'}
                                                </span>
                                                {hoveredEdge.data.peer_device_name && hoveredEdge.data.peer_device_name !== hoveredEdge.data.peer_site_name && (
                                                    <span className="text-[10px] text-text-muted">({hoveredEdge.data.peer_device_name})</span>
                                                )}
                                                <span className="font-black text-text-primary">{hoveredEdge.data.peer_site_name || 'Dest'}</span>
                                            </div>
                                        </div>

                                        {/* Subline: Source IP ➔ Remote IP · VPN ID · Transport · Latency */}
                                        <div className="flex items-center gap-2 mt-1 pt-1 border-t border-border/40 text-[10px] font-mono text-text-muted">
                                            <div className="flex items-center gap-1">
                                                <span className="text-text-primary font-bold">{(hoveredEdge.data.debug_source_ip && hoveredEdge.data.debug_source_ip !== 'N/A') ? hoveredEdge.data.debug_source_ip : (hoveredEdge.data.ip || 'N/A')}</span>
                                                <span className="text-text-muted font-bold">➔</span>
                                                <span className="text-text-primary font-bold">{(hoveredEdge.data.debug_peer_ip && hoveredEdge.data.debug_peer_ip !== 'N/A') ? hoveredEdge.data.debug_peer_ip : (hoveredEdge.data.peer_ip || 'N/A')}</span>
                                            </div>
                                            {hoveredEdge.data.debug_vpn_id && hoveredEdge.data.debug_vpn_id !== 'N/A' && (
                                                <>
                                                    <span className="text-border">·</span>
                                                    <span>VPN: <span className="text-text-secondary font-bold">{hoveredEdge.data.debug_vpn_id}</span></span>
                                                </>
                                            )}
                                            <span className="text-border">·</span>
                                            <span className={cn(
                                                "font-bold uppercase tracking-wider",
                                                hoveredEdge.data.wan_network === 'MPLS' || hoveredEdge.data.isMplsCircuit ? "text-purple-400" : "text-sky-400"
                                            )}>
                                                {hoveredEdge.data.wan_network || (hoveredEdge.data.isMplsCircuit ? 'MPLS' : 'INTERNET')}
                                            </span>
                                            {hoveredEdge.data.latency && (
                                                <>
                                                    <span className="text-border">·</span>
                                                    <span className="text-emerald-400 font-bold">{hoveredEdge.data.latency}ms</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="bg-card/95 backdrop-blur-xl border border-border/80 shadow-2xl rounded-xl px-3 py-1.5 text-xs pointer-events-none whitespace-nowrap min-w-max flex items-center gap-2">
                                        <span className="font-bold text-text-primary">{hoveredEdge.data.name || hoveredEdge.data.label || 'Link'}</span>
                                        {hoveredEdge.data.ip && <span className="font-mono text-[10px] text-text-muted font-bold">{hoveredEdge.data.ip}</span>}
                                        {hoveredEdge.data.status && (
                                            <span className={cn(
                                                "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase",
                                                hoveredEdge.data.status === 'down' ? "bg-rose-500/20 text-rose-400" : "bg-emerald-500/20 text-emerald-400"
                                            )}>
                                                {hoveredEdge.data.status}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Floating Link Inspector Card (Zero Canvas Push) */}
                        {inspectedLink && (
                            inspectedLink.isOverlayTunnel ? (() => {
                                const rawStatus = String(inspectedLink.status || '').toUpperCase();
                                const isTunnelActive = inspectedLink.tunnelState === 'ACTIVE' || Boolean(inspectedLink.active);
                                const isDown = rawStatus === 'DOWN' || inspectedLink.tunnelState === 'DOWN';

                                const resolvedState: 'ACTIVE' | 'INACTIVE' | 'DOWN' =
                                    isTunnelActive
                                        ? 'ACTIVE'
                                        : isDown
                                            ? 'DOWN'
                                            : 'INACTIVE';

                                const statusReason = inspectedLink.status_reason ?? null;
                                const statusReasonCode = inspectedLink.status_reason_code ?? null;
                                const statusReasonDetail = inspectedLink.status_reason_detail ?? null;
                                const uptimeSec = inspectedLink.uptime_sec ?? null;
                                const flapCount = inspectedLink.flap_count ?? 0;
                                const cipher = inspectedLink.cipher || 'aes-256-cbc';
                                const keepaliveInterval = inspectedLink.keepalive_interval_ms ?? 1000;
                                const keepaliveRetries = inspectedLink.keepalive_retries ?? 3;
                                const anynetType = inspectedLink.anynet_type || 'auto-public';
                                const vpnLinkId = String(inspectedLink.debug_vpn_id || inspectedLink.id || 'N/A');

                                const localVepId = inspectedLink.local_vep_id || null;
                                const peerVepId = inspectedLink.peer_vep_id || null;

                                const localIonCli = localVepId ? `dump vpn status VpnID=${localVepId}` : null;
                                const peerIonCli = peerVepId ? `dump vpn status VpnID=${peerVepId}` : null;

                                return (
                                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 bg-card/95 backdrop-blur-xl border border-border/80 rounded-2xl shadow-2xl p-4 w-[580px] max-w-[96vw] animate-in fade-in slide-in-from-bottom-3 duration-200 pointer-events-auto">
                                        {/* Header */}
                                        <div className="flex items-center justify-between pb-2.5 border-b border-border/60">
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className={cn(
                                                    "p-2 rounded-xl shrink-0",
                                                    resolvedState === 'ACTIVE'
                                                        ? "bg-emerald-500/20 text-emerald-400"
                                                        : resolvedState === 'DOWN'
                                                            ? "bg-rose-500/20 text-rose-400"
                                                            : "bg-blue-500/20 text-blue-400"
                                                )}>
                                                    <Share2 size={16} />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <h4 className="text-xs font-black text-text-primary tracking-tight uppercase whitespace-nowrap">
                                                            SD-WAN Overlay Tunnel
                                                        </h4>
                                                        <span className={cn(
                                                            "px-2 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-wider flex items-center gap-1 whitespace-nowrap",
                                                            resolvedState === 'ACTIVE' && "bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.2)]",
                                                            resolvedState === 'INACTIVE' && "bg-blue-500/20 text-blue-400 border-blue-500/40",
                                                            resolvedState === 'DOWN' && "bg-rose-500/20 text-rose-400 border-rose-500/40"
                                                        )}>
                                                            <span className={cn(
                                                                "w-1.5 h-1.5 rounded-full shrink-0",
                                                                resolvedState === 'ACTIVE' ? "bg-emerald-400 animate-pulse" :
                                                                resolvedState === 'DOWN' ? "bg-rose-400" : "bg-blue-400"
                                                            )} />
                                                            {resolvedState}
                                                        </span>
                                                        <span className="px-1.5 py-0.5 rounded bg-card-secondary border border-border/50 text-[8px] font-mono font-bold text-text-muted uppercase whitespace-nowrap">
                                                            {anynetType}
                                                        </span>
                                                    </div>
                                                    <p className="text-[10px] text-text-muted font-mono tracking-wide truncate whitespace-nowrap mt-0.5">
                                                        {inspectedLink.sourceSiteName || 'Source'} ➔ {inspectedLink.peer_site_name || 'Peer'}
                                                        {uptimeSec != null && (
                                                            <span className="ml-2 text-text-secondary">
                                                                · {resolvedState === 'DOWN' ? 'Down for' : 'Up for'} <strong className="text-text-primary">{formatTunnelDuration(uptimeSec)}</strong>
                                                            </span>
                                                        )}
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => setInspectedLink(null)}
                                                className="p-1.5 hover:bg-card-secondary rounded-lg text-text-muted hover:text-text-primary transition-colors cursor-pointer shrink-0"
                                                title="Close"
                                            >
                                                <X size={15} />
                                            </button>
                                        </div>

                                        {/* Root-Cause Diagnostic Alert Banner */}
                                        {(statusReason || resolvedState !== 'ACTIVE') && (
                                            <div className={cn(
                                                "mt-2.5 p-2.5 rounded-xl border flex items-start gap-2.5 text-xs",
                                                resolvedState === 'DOWN'
                                                    ? "bg-rose-500/10 border-rose-500/30 text-rose-200"
                                                    : resolvedState === 'INACTIVE'
                                                        ? "bg-blue-500/10 border-blue-500/30 text-blue-200"
                                                        : "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                                            )}>
                                                <AlertTriangle size={15} className={cn(
                                                    "shrink-0 mt-0.5",
                                                    resolvedState === 'DOWN' ? "text-rose-400" : resolvedState === 'INACTIVE' ? "text-blue-400" : "text-emerald-400"
                                                )} />
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                                        <span className="font-black text-[11px] tracking-tight">
                                                            {resolvedState === 'DOWN' ? 'Link is "Down"' : resolvedState === 'INACTIVE' ? 'Link is "Inactive"' : 'Transit Active'}
                                                            {statusReason ? ` — Reason: ${statusReason}` : ''}
                                                        </span>
                                                        {statusReasonCode && (
                                                            <span className={cn(
                                                                "px-1.5 py-0.5 rounded font-mono text-[8px] font-bold uppercase tracking-wider border shrink-0",
                                                                resolvedState === 'DOWN'
                                                                    ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                                                                    : resolvedState === 'INACTIVE'
                                                                        ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                                                                        : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                                            )}>
                                                                {statusReasonCode}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {statusReasonDetail && (
                                                        <div className="text-[10px] font-mono text-text-secondary mt-0.5 truncate" title={statusReasonDetail}>
                                                            {statusReasonDetail}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* Dual Endpoints (Source vs Remote Peer) with VEP ID & 1-Click ION CLI Copy */}
                                        <div className="grid grid-cols-2 gap-2.5 my-2.5">
                                            {/* Source Endpoint Box */}
                                            <div className="bg-card-secondary/40 p-2.5 rounded-xl border border-border/50 flex flex-col gap-1 min-w-0 overflow-hidden">
                                                <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-wider text-text-muted">
                                                    <span className="text-cyan-400">SOURCE ENDPOINT</span>
                                                    <span className="font-mono text-[8px] bg-cyan-500/10 text-cyan-400 px-1 rounded">LOCAL</span>
                                                </div>
                                                <div className="flex items-baseline justify-between gap-1.5 min-w-0">
                                                    <div className="text-xs font-black text-text-primary truncate" title={inspectedLink.sourceSiteName}>
                                                        {inspectedLink.sourceSiteName || 'Site'}
                                                    </div>
                                                    <div className="text-[10px] text-text-secondary truncate font-mono shrink-0" title={inspectedLink.sourceDeviceName}>
                                                        {inspectedLink.sourceDeviceName || 'ION'}
                                                    </div>
                                                </div>
                                                <div className="text-[10px] text-text-muted truncate font-mono" title={inspectedLink.sourceCircuitLabel || inspectedLink.sourceCircuitName}>
                                                    WAN: <span className="text-cyan-400 font-bold">{inspectedLink.sourceCircuitLabel || inspectedLink.sourceCircuitName || 'WAN'}</span>
                                                </div>
                                                <div className="text-[10px] text-text-secondary font-mono pt-1 border-t border-border/30 truncate" title={inspectedLink.debug_source_ip || inspectedLink.ip}>
                                                    IP: <span className="text-emerald-400 font-bold">{inspectedLink.debug_source_ip || inspectedLink.ip || inspectedLink.interface_ip || 'N/A'}</span>
                                                </div>
                                                {localVepId && (
                                                    <div className="mt-1 pt-1 border-t border-border/30 flex items-center justify-between gap-1">
                                                        <div className="text-[9px] font-mono text-text-muted truncate" title={`Local VEP ID: ${localVepId}`}>
                                                            VEP: <span className="text-text-secondary font-bold">{localVepId}</span>
                                                        </div>
                                                        {localIonCli && (
                                                            <button
                                                                onClick={() => handleCopyCli('local_cli', localIonCli)}
                                                                className={cn(
                                                                    "px-1.5 py-0.5 rounded text-[8px] font-mono font-bold flex items-center gap-1 border transition-all cursor-pointer shrink-0",
                                                                    copiedCliKey === 'local_cli'
                                                                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                                                        : "bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border-cyan-500/30"
                                                                )}
                                                                title={`Copy ION CLI command for ${inspectedLink.sourceDeviceName || 'Source'}:\n${localIonCli}`}
                                                            >
                                                                <Terminal size={9} />
                                                                {copiedCliKey === 'local_cli' ? 'Copied CLI!' : 'Copy ION CLI'}
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Remote Peer Endpoint Box */}
                                            <div className="bg-card-secondary/40 p-2.5 rounded-xl border border-border/50 flex flex-col gap-1 min-w-0 overflow-hidden">
                                                <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-wider text-text-muted">
                                                    <span className="text-purple-400">REMOTE ENDPOINT</span>
                                                    <span className="font-mono text-[8px] bg-purple-500/10 text-purple-400 px-1 rounded">PEER</span>
                                                </div>
                                                <div className="flex items-baseline justify-between gap-1.5 min-w-0">
                                                    <div className="text-xs font-black text-text-primary truncate" title={inspectedLink.peer_site_name}>
                                                        {inspectedLink.peer_site_name || 'Peer Site'}
                                                    </div>
                                                    <div className="text-[10px] text-text-secondary truncate font-mono shrink-0" title={inspectedLink.peer_device_name}>
                                                        {inspectedLink.peer_device_name || 'Peer ION'}
                                                    </div>
                                                </div>
                                                <div className="text-[10px] text-text-muted truncate font-mono" title={inspectedLink.peer_wan_interface}>
                                                    WAN: <span className="text-purple-400 font-bold">{inspectedLink.peer_wan_interface || 'WAN'}</span>
                                                </div>
                                                <div className="text-[10px] text-text-secondary font-mono pt-1 border-t border-border/30 truncate" title={inspectedLink.debug_peer_ip}>
                                                    IP: <span className="text-purple-400 font-bold">{resolveWanIp(inspectedLink.peer_site_name || inspectedLink.peerSite, inspectedLink.peer_device_name || inspectedLink.peerDevice, inspectedLink.peer_wan_interface || inspectedLink.destCircuit, inspectedLink.debug_peer_ip)}</span>
                                                </div>
                                                {peerVepId && (
                                                    <div className="mt-1 pt-1 border-t border-border/30 flex items-center justify-between gap-1">
                                                        <div className="text-[9px] font-mono text-text-muted truncate" title={`Peer VEP ID: ${peerVepId}`}>
                                                            VEP: <span className="text-text-secondary font-bold">{peerVepId}</span>
                                                        </div>
                                                        {peerIonCli && (
                                                            <button
                                                                onClick={() => handleCopyCli('peer_cli', peerIonCli)}
                                                                className={cn(
                                                                    "px-1.5 py-0.5 rounded text-[8px] font-mono font-bold flex items-center gap-1 border transition-all cursor-pointer shrink-0",
                                                                    copiedCliKey === 'peer_cli'
                                                                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                                                        : "bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border-purple-500/30"
                                                                )}
                                                                title={`Copy ION CLI command for ${inspectedLink.peer_device_name || 'Peer'}:\n${peerIonCli}`}
                                                            >
                                                                <Terminal size={9} />
                                                                {copiedCliKey === 'peer_cli' ? 'Copied CLI!' : 'Copy ION CLI'}
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Technical Specs 5-Column Bar */}
                                        <div className="grid grid-cols-5 gap-1.5 mb-2.5 text-xs font-mono">
                                            <div className="bg-card-secondary/30 p-2 rounded-xl border border-border/40 min-w-0 overflow-hidden">
                                                <div className="flex items-center justify-between gap-1">
                                                    <span className="text-[8px] font-black text-text-muted uppercase tracking-wider truncate">VPN LINK ID</span>
                                                    {vpnLinkId !== 'N/A' && (
                                                        <button
                                                            onClick={() => handleCopyCli('vpn_id', vpnLinkId)}
                                                            className="text-text-muted hover:text-text-primary cursor-pointer"
                                                            title="Copy Controller VPN Link ID"
                                                        >
                                                            <Copy size={9} />
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="text-[9px] font-bold text-text-primary truncate whitespace-nowrap" title={vpnLinkId}>
                                                    {copiedCliKey === 'vpn_id' ? 'Copied!' : vpnLinkId}
                                                </div>
                                            </div>
                                            <div className="bg-card-secondary/30 p-2 rounded-xl border border-border/40 min-w-0 overflow-hidden">
                                                <div className="text-[8px] font-black text-text-muted uppercase tracking-wider truncate whitespace-nowrap">TRANSPORT</div>
                                                <div className={cn(
                                                    "text-[10px] font-bold truncate whitespace-nowrap",
                                                    inspectedLink.wan_network === 'MPLS' || inspectedLink.isMplsCircuit ? "text-purple-400" : "text-sky-400"
                                                )}>
                                                    {inspectedLink.wan_network || (inspectedLink.isMplsCircuit ? 'MPLS' : 'INTERNET')}
                                                </div>
                                            </div>
                                            <div className="bg-card-secondary/30 p-2 rounded-xl border border-border/40 min-w-0 overflow-hidden">
                                                <div className="text-[8px] font-black text-text-muted uppercase tracking-wider truncate whitespace-nowrap">STATE DURATION</div>
                                                <div className="text-[10px] font-bold text-text-primary truncate whitespace-nowrap" title={flapCount ? `${flapCount} state transitions recorded` : 'Time in current state'}>
                                                    {formatTunnelDuration(uptimeSec)}
                                                    {flapCount > 1 && <span className="text-[8px] text-amber-400 ml-1">({flapCount}x)</span>}
                                                </div>
                                            </div>
                                            <div className="bg-card-secondary/30 p-2 rounded-xl border border-border/40 min-w-0 overflow-hidden">
                                                <div className="text-[8px] font-black text-text-muted uppercase tracking-wider truncate whitespace-nowrap">CIPHER / BFD</div>
                                                <div className="text-[9px] font-bold text-cyan-300 truncate whitespace-nowrap" title={`Cipher: ${cipher} | Keepalive: ${keepaliveInterval}ms x${keepaliveRetries}`}>
                                                    {String(cipher).replace('aes-', 'AES').replace('-cbc', '')} · {keepaliveInterval}ms
                                                </div>
                                            </div>
                                            <div className={cn(
                                                "p-2 rounded-xl border min-w-0 overflow-hidden transition-colors",
                                                (inspectedLink.packet_loss ?? 0) >= 5 || (inspectedLink.latency ?? 0) >= 150 || (inspectedLink.mos != null && inspectedLink.mos < 3.0)
                                                    ? "bg-rose-500/15 border-rose-500/40"
                                                    : (inspectedLink.packet_loss ?? 0) >= 1 || (inspectedLink.latency ?? 0) >= 80 || (inspectedLink.mos != null && inspectedLink.mos < 3.6)
                                                        ? "bg-amber-500/15 border-amber-500/40"
                                                        : "bg-card-secondary/30 border-border/40"
                                            )}>
                                                <div className="flex items-center justify-between gap-1">
                                                    <span className="text-[8px] font-black text-text-muted uppercase tracking-wider truncate whitespace-nowrap">LATENCY / LOSS</span>
                                                    {isInspectingLink && <RefreshCw size={8} className="animate-spin text-cyan-400 shrink-0" />}
                                                </div>
                                                <div className={cn(
                                                    "text-[10px] font-bold truncate whitespace-nowrap",
                                                    (inspectedLink.packet_loss ?? 0) >= 5 || (inspectedLink.latency ?? 0) >= 150 || (inspectedLink.mos != null && inspectedLink.mos < 3.0)
                                                        ? "text-rose-400"
                                                        : (inspectedLink.packet_loss ?? 0) >= 1 || (inspectedLink.latency ?? 0) >= 80 || (inspectedLink.mos != null && inspectedLink.mos < 3.6)
                                                            ? "text-amber-400"
                                                            : "text-emerald-400"
                                                )}>
                                                    {isInspectingLink
                                                        ? 'Probing LQM...'
                                                        : `${inspectedLink.latency != null ? `${inspectedLink.latency}ms` : 'Optimal'} · ${inspectedLink.packet_loss != null ? `${inspectedLink.packet_loss}%` : '0%'}`}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Live LQM Directional Telemetry Strip (Ingress / Egress Loss, Jitter, MOS) */}
                                        {(inspectedLink.latency != null || inspectedLink.packet_loss != null || inspectedLink.jitter != null || inspectedLink.mos != null) && (
                                            <div className="grid grid-cols-4 gap-1.5 mb-2.5 px-2.5 py-2 rounded-xl bg-card-secondary/40 border border-border/50 text-[10px] font-mono">
                                                <div className="min-w-0">
                                                    <div className="text-[8px] font-black text-text-muted uppercase tracking-wider">RTT LATENCY</div>
                                                    <div className={cn(
                                                        "font-bold truncate",
                                                        (inspectedLink.latency ?? 0) >= 150 ? "text-rose-400" : (inspectedLink.latency ?? 0) >= 80 ? "text-amber-400" : "text-emerald-400"
                                                    )}>
                                                        {inspectedLink.latency != null ? `${inspectedLink.latency} ms` : '—'}
                                                    </div>
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="text-[8px] font-black text-text-muted uppercase tracking-wider">LOSS (IN / OUT)</div>
                                                    <div className={cn(
                                                        "font-bold truncate",
                                                        (inspectedLink.packet_loss ?? 0) >= 5 ? "text-rose-400" : (inspectedLink.packet_loss ?? 0) >= 1 ? "text-amber-400" : "text-emerald-400"
                                                    )}>
                                                        {inspectedLink.packet_loss_ingress != null ? `${inspectedLink.packet_loss_ingress}%` : '0%'}
                                                        <span className="text-text-muted mx-1">/</span>
                                                        {inspectedLink.packet_loss_egress != null ? `${inspectedLink.packet_loss_egress}%` : '0%'}
                                                    </div>
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="text-[8px] font-black text-text-muted uppercase tracking-wider">JITTER (IN / OUT)</div>
                                                    <div className={cn(
                                                        "font-bold truncate",
                                                        (inspectedLink.jitter ?? 0) >= 30 ? "text-rose-400" : (inspectedLink.jitter ?? 0) >= 15 ? "text-amber-400" : "text-cyan-300"
                                                    )}>
                                                        {inspectedLink.jitter_ingress != null ? `${inspectedLink.jitter_ingress}ms` : '0ms'}
                                                        <span className="text-text-muted mx-1">/</span>
                                                        {inspectedLink.jitter_egress != null ? `${inspectedLink.jitter_egress}ms` : '0ms'}
                                                    </div>
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="text-[8px] font-black text-text-muted uppercase tracking-wider">LINK MOS (IN / OUT)</div>
                                                    <div className={cn(
                                                        "font-bold truncate",
                                                        (inspectedLink.mos ?? 4.4) < 3.0 ? "text-rose-400" : (inspectedLink.mos ?? 4.4) < 3.6 ? "text-amber-400" : "text-emerald-400"
                                                    )}>
                                                        {inspectedLink.mos_ingress != null ? inspectedLink.mos_ingress : '—'}
                                                        <span className="text-text-muted mx-1">/</span>
                                                        {inspectedLink.mos_egress != null ? inspectedLink.mos_egress : '—'}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Status Pill */}
                                        <div className="flex items-center justify-between pt-2 border-t border-border/40 text-xs">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <span className={cn(
                                                    "w-2 h-2 rounded-full shrink-0",
                                                    resolvedState === 'ACTIVE' ? "bg-emerald-500 animate-pulse" :
                                                    resolvedState === 'DOWN' ? "bg-rose-500" : "bg-blue-500"
                                                )} />
                                                <span className="text-[9px] font-black uppercase text-text-primary truncate whitespace-nowrap">
                                                    {resolvedState === 'ACTIVE'
                                                        ? 'Operational Forwarding Transit Path'
                                                        : resolvedState === 'DOWN'
                                                            ? `Tunnel Down (${statusReason || 'Offline'})`
                                                            : `Inactive Tunnel (${statusReason || 'Standby Path'})`}
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    probeLiveTunnelLqm(inspectedVpnId, inspectedLink);
                                                }}
                                                disabled={isInspectingLink}
                                                className="px-2 py-0.5 rounded bg-card-secondary hover:bg-border/60 border border-border/50 text-[8px] font-mono font-bold text-text-secondary hover:text-text-primary flex items-center gap-1 cursor-pointer transition-colors shrink-0"
                                                title="Refresh live LQM telemetry from Prisma SD-WAN Controller"
                                            >
                                                <RefreshCw size={9} className={cn(isInspectingLink && "animate-spin text-cyan-400")} />
                                                {isInspectingLink ? 'Refreshing...' : 'Refresh LQM'}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })() : (
                                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 bg-card/95 backdrop-blur-xl border border-border/80 rounded-2xl shadow-2xl p-3.5 w-[380px] max-w-[92vw] animate-in fade-in slide-in-from-bottom-3 duration-200 pointer-events-auto">
                                    <div className="flex items-center justify-between pb-2 border-b border-border/60">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className={cn(
                                                "p-1.5 rounded-lg shrink-0",
                                                inspectedLink.wan_network === 'MPLS' || inspectedLink.isCircuitMpls || inspectedLink.isMplsCircuit
                                                    ? "bg-purple-500/20 text-purple-400"
                                                    : "bg-sky-500/20 text-sky-400"
                                            )}>
                                                {inspectedLink.isOverlayTunnel ? <Share2 size={14} /> : inspectedLink.service_endpoint_name ? <Shield size={14} /> : <Route size={14} />}
                                            </div>
                                            <div className="min-w-0">
                                                <h4 className="text-xs font-black text-text-primary tracking-tight truncate whitespace-nowrap">
                                                    {inspectedLink.name || inspectedLink.label || inspectedLink.circuit_name || 'Circuit Link'}
                                                </h4>
                                                <p className="text-[9px] text-text-muted font-bold tracking-wider truncate whitespace-nowrap">
                                                    {inspectedLink.sourceSiteName || inspectedLink.sourceSite ? (
                                                        `${inspectedLink.sourceSiteName || inspectedLink.sourceSite} ➔ ${inspectedLink.peer_site_name || inspectedLink.peerSite || 'Peer'}`
                                                    ) : (
                                                        `${inspectedLink.site_name || 'Site'} · ${(inspectedLink.wan_network || inspectedLink.network || 'WAN').toUpperCase()}`
                                                    )}
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => setInspectedLink(null)}
                                            className="p-1 hover:bg-card-secondary rounded-lg text-text-muted hover:text-text-primary transition-colors cursor-pointer shrink-0"
                                            title="Close"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>

                                    {/* Dynamic Key Specs */}
                                    <div className="grid grid-cols-2 gap-2 my-2 text-xs font-mono">
                                        <div className="bg-card-secondary/40 p-2 rounded-xl border border-border/40 min-w-0 overflow-hidden">
                                            <div className="text-[8px] font-black text-text-muted uppercase truncate whitespace-nowrap">Public IP / Remote</div>
                                            <div className="text-[11px] font-bold text-text-primary truncate whitespace-nowrap">{inspectedLink.public_ip || inspectedLink.remote_ip || 'N/A'}</div>
                                        </div>
                                        <div className="bg-card-secondary/40 p-2 rounded-xl border border-border/40 min-w-0 overflow-hidden">
                                            <div className="text-[8px] font-black text-text-muted uppercase truncate whitespace-nowrap">Interface IP</div>
                                            <div className="text-[11px] font-bold text-text-secondary truncate whitespace-nowrap">{inspectedLink.ip || inspectedLink.interface_ip || 'DHCP'}</div>
                                        </div>
                                    </div>
                                    {inspectedLink.gateway && (
                                        <div className="bg-card-secondary/30 px-2.5 py-1 mb-2 rounded-lg border border-border/30 flex items-center justify-between text-xs font-mono">
                                            <span className="text-[8px] font-black text-text-muted uppercase whitespace-nowrap">Default Gateway</span>
                                            <span className="text-[10px] font-bold text-emerald-400 truncate whitespace-nowrap">{inspectedLink.gateway}</span>
                                        </div>
                                    )}

                                    {/* Status Pill & Action */}
                                    <div className="flex items-center justify-between pt-1 border-t border-border/30 text-xs">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <span className={cn(
                                                "w-2 h-2 rounded-full shrink-0",
                                                (inspectedLink.status === 'down' || inspectedLink.active === false) ? "bg-rose-500" : "bg-emerald-500 animate-pulse"
                                            )} />
                                            <span className="text-[9px] font-black uppercase text-text-primary truncate whitespace-nowrap">
                                                {inspectedLink.status || (inspectedLink.active !== undefined ? (inspectedLink.active ? 'Active' : 'Backup') : 'Operational')}
                                            </span>
                                            {inspectedLink.latency && (
                                                <span className="text-[9px] font-mono text-emerald-400 font-bold ml-1 truncate whitespace-nowrap">
                                                    · {inspectedLink.latency}ms
                                                </span>
                                            )}
                                        </div>
                                        {(inspectedLink.public_ip || inspectedLink.ip || inspectedLink.remote_ip) && (
                                            <button
                                                onClick={() => setTracerouteTarget(inspectedLink.public_ip || inspectedLink.ip || inspectedLink.remote_ip || '')}
                                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 text-[10px] font-bold transition-all cursor-pointer whitespace-nowrap shrink-0"
                                            >
                                                <Route size={11} /> Trace Path
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )
                        )}
                    </ReactFlow>
                    </div>

                    {/* Site Details Side Panel (Push Layout Split-Pane - 360px) */}
                    {selectedObject && (
                        <div className="w-[360px] h-full border-l border-border bg-card/95 backdrop-blur-xl flex flex-col z-30 shrink-0 shadow-2xl transition-all duration-300 animate-in slide-in-from-right overflow-hidden">
                            <div className="flex flex-col h-full min-h-0">
                                <div className="p-4 border-b border-border bg-card-secondary/30 flex items-center justify-between shrink-0">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <div className={cn(
                                            "p-2 rounded-xl shrink-0",
                                            selectedObject.type === 'circuit_tunnels'
                                                ? ((selectedObject.wan?.wan_network || '').toUpperCase().includes('MPLS')
                                                    ? "bg-purple-600 text-white shadow-lg shadow-purple-500/30"
                                                    : "bg-blue-600 text-white shadow-lg shadow-blue-500/30")
                                                : selectedObject.type === 'network'
                                                    ? (selectedObject.network === 'INTERNET' ? "bg-sky-500 text-white shadow-lg shadow-sky-500/30" : "bg-purple-600 text-white shadow-lg shadow-purple-500/30")
                                                    : selectedObject.isSaseEdge || selectedObject.isSasePop
                                                        ? "bg-purple-600 text-white shadow-lg shadow-purple-500/30"
                                                        : (selectedObject.type === 'node' ? "bg-blue-500 text-white" : "bg-purple-500 text-white")
                                        )}>
                                            {selectedObject.type === 'circuit_tunnels' ? (
                                                <Layers size={16} />
                                            ) : selectedObject.type === 'network' ? (
                                                <Cloud size={16} />
                                            ) : selectedObject.isSaseEdge || selectedObject.isSasePop ? (
                                                <Shield size={16} />
                                            ) : (selectedObject.role === 'HUB' ? <Server size={16} /> : <Home size={16} />)}
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="text-sm font-black text-text-primary tracking-tight truncate">
                                                {selectedObject.type === 'circuit_tunnels' ? (selectedObject.circuitName || selectedObject.name) : (selectedObject.name || selectedObject.label)}
                                            </h3>
                                            <p className="text-[9px] text-text-muted font-bold tracking-widest uppercase truncate">
                                                {selectedObject.type === 'circuit_tunnels'
                                                    ? `${selectedObject.siteName} · WAN Circuit (${selectedObject.wan?.wan_network || 'INTERNET'})`
                                                    : selectedObject.type === 'network'
                                                        ? 'SD-WAN Transport Carrier'
                                                        : selectedObject.isSasePop
                                                            ? 'SASE Security Cloud PoP'
                                                            : (selectedObject.isSaseEdge
                                                                ? (selectedObject.circuit_name ? `${selectedObject.circuit_name} · ServiceLink IPsec Tunnel` : 'ServiceLink IPsec Tunnel')
                                                                : (selectedObject.type === 'node'
                                                                    ? (selectedObject.site_id ? 'Site Entity' : 'WAN Network')
                                                                    : 'Circuit Link'))}
                                            </p>
                                        </div>
                                    </div>
                                    <button onClick={() => { setSelectedObject(null); setSelectedCircuit(null); }} className="p-1 hover:bg-card-secondary rounded-lg text-text-muted transition-colors shrink-0">
                                        <X size={18} />
                                    </button>
                                </div>

                                <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-border min-h-0">
                                    {selectedObject.type === 'circuit_tunnels' ? (
                                        (() => {
                                            const circuitWan = selectedObject.wan;
                                            const siteId = selectedObject.siteId;
                                            const siteName = selectedObject.siteName;
                                            const circuitName = circuitWan?.name;
                                            const isMpls = (circuitWan?.wan_network || '').toUpperCase().includes('MPLS') || (circuitName || '').toUpperCase().includes('MPLS');

                                            // Collect all tunnels attached to this circuit
                                            const tunnelsMap = new Map<string, any>();

                                            // 1. Outbound tunnels from this WAN interface
                                            (circuitWan?.connections || []).forEach((c: any) => {
                                                const peerKey = `${c.peer_site_name || c.peer_site_id}:${c.peer_wan_interface || 'WAN'}`;
                                                tunnelsMap.set(peerKey, {
                                                    direction: 'outbound',
                                                    sourceSite: siteName,
                                                    sourceSiteId: siteId,
                                                    sourceDevice: selectedObject.devName,
                                                    sourceCircuit: circuitWan?.circuit_label || circuitWan?.name,
                                                    sourceNetwork: circuitWan?.wan_network || (isMpls ? 'MPLS' : 'INTERNET'),
                                                    peerSite: c.peer_site_name,
                                                    peerSiteId: c.peer_site_id,
                                                    peerDevice: c.peer_device_name || 'ION',
                                                    peerCircuit: c.peer_wan_interface || 'WAN',
                                                    vpnId: c.debug_vpn_id,
                                                    srcIp: c.debug_source_ip || circuitWan?.ip,
                                                    dstIp: resolveWanIp(c.peer_site_name, c.peer_device_name, c.peer_wan_interface, c.debug_peer_ip),
                                                    isRoutingActive: Boolean(c.active),
                                                    isRoutingUsable: Boolean(c.usable),
                                                    isLinkUp: Boolean(c.link_up),
                                                    status: c.status || (c.active || c.usable ? 'UP' : 'DOWN'),
                                                    vpState: c.vpState,
                                                    latency: c.latency ?? c.delay_ms,
                                                    loss: c.loss_pct ?? c.packet_loss,
                                                    raw: c
                                                });
                                            });

                                            // 2. Discover any matching inbound tunnels across topology.sites
                                            (topology?.sites || []).forEach((s: any) => {
                                                if (s.site_id === siteId || s.site_name === siteName) return;
                                                (s.devices || []).forEach((d: any) => {
                                                    (d.wan_interfaces || []).forEach((w: any) => {
                                                        (w.connections || []).forEach((c: any) => {
                                                            const isTargetingThisCircuit =
                                                                (c.peer_site_id === siteId || c.peer_site_name === siteName) &&
                                                                (c.peer_wan_interface === circuitName || c.peer_wan_interface === circuitWan?.circuit_label);
                                                            if (isTargetingThisCircuit) {
                                                                const peerKey = `${s.site_name || s.site_id}:${w.circuit_label || w.name}`;
                                                                if (!tunnelsMap.has(peerKey)) {
                                                                    tunnelsMap.set(peerKey, {
                                                                        direction: 'inbound',
                                                                        sourceSite: siteName,
                                                                        sourceSiteId: siteId,
                                                                        sourceDevice: selectedObject.devName,
                                                                        sourceCircuit: circuitWan?.circuit_label || circuitWan?.name,
                                                                        sourceNetwork: circuitWan?.wan_network || (isMpls ? 'MPLS' : 'INTERNET'),
                                                                        peerSite: s.site_name,
                                                                        peerSiteId: s.site_id,
                                                                        peerDevice: d.device_name || 'ION',
                                                                        peerCircuit: w.circuit_label || w.name,
                                                                        vpnId: c.debug_vpn_id,
                                                                        srcIp: resolveWanIp(s.site_name, d.device_name, w.name, c.debug_peer_ip) || circuitWan?.ip,
                                                                        dstIp: resolveWanIp(siteName, selectedObject.devName, circuitWan?.name, c.debug_source_ip),
                                                                        isRoutingActive: Boolean(c.active),
                                                                        isRoutingUsable: Boolean(c.usable),
                                                                        isLinkUp: Boolean(c.link_up),
                                                                        status: c.status || (c.active || c.usable ? 'UP' : 'DOWN'),
                                                                        vpState: c.vpState,
                                                                        latency: c.latency ?? c.delay_ms,
                                                                        loss: c.loss_pct ?? c.packet_loss,
                                                                        raw: c
                                                                    });
                                                                }
                                                            }
                                                        });
                                                    });
                                                });
                                            });

                                            // 3. Find any SASE ServiceLinks originating from this circuit
                                            const saseLinks: any[] = [];
                                            (topology?.sites || []).forEach((s: any) => {
                                                if (s.site_id === siteId || s.site_name === siteName) {
                                                    (s.devices || []).forEach((d: any) => {
                                                        (d.service_links || []).forEach((sl: any) => {
                                                            const matchName = sl.circuit_name === circuitWan?.name || sl.circuit_name === circuitWan?.circuit_label;
                                                            const matchId = sl.source_wan_if_id && sl.source_wan_if_id === circuitWan?.id;
                                                            const matchIp = sl.local_ip && circuitWan?.ip && sl.local_ip === circuitWan.ip.split('/')[0];
                                                            if (matchName || matchId || matchIp) {
                                                                saseLinks.push({ ...sl, device_name: d.device_name });
                                                            }
                                                        });
                                                    });
                                                }
                                            });

                                            const allTunnels = Array.from(tunnelsMap.values());
                                            const totalCount = allTunnels.length;
                                            const activeCount = allTunnels.filter(t => t.isRoutingActive).length;
                                            const backupCount = allTunnels.filter(t => !t.isRoutingActive && (t.isRoutingUsable || t.isLinkUp)).length;
                                            const downCount = allTunnels.filter(t => !t.isRoutingActive && !t.isRoutingUsable && !t.isLinkUp).length;

                                            const filteredTunnels = allTunnels.filter(t => {
                                                if (circuitTunnelFilter === 'ACTIVE' && !t.isRoutingActive) return false;
                                                if (circuitTunnelFilter === 'INACTIVE' && (t.isRoutingActive || (!t.isRoutingUsable && !t.isLinkUp))) return false;
                                                if (circuitTunnelFilter === 'DOWN' && (t.isRoutingActive || t.isRoutingUsable || t.isLinkUp)) return false;

                                                if (circuitTunnelSearch) {
                                                    const q = circuitTunnelSearch.toLowerCase();
                                                    const matchPeer = (t.peerSite || '').toLowerCase().includes(q);
                                                    const matchDevice = (t.peerDevice || '').toLowerCase().includes(q);
                                                    const matchCircuit = (t.peerCircuit || '').toLowerCase().includes(q);
                                                    const matchSrc = (t.srcIp || '').toLowerCase().includes(q);
                                                    const matchDst = (t.dstIp || '').toLowerCase().includes(q);
                                                    const matchVpn = String(t.vpnId || '').toLowerCase().includes(q);
                                                    return matchPeer || matchDevice || matchCircuit || matchSrc || matchDst || matchVpn;
                                                }
                                                return true;
                                            });

                                            filteredTunnels.sort((a, b) => {
                                                if (a.isRoutingActive !== b.isRoutingActive) return a.isRoutingActive ? -1 : 1;
                                                return (a.peerSite || '').localeCompare(b.peerSite || '');
                                            });

                                            const isCircuitUp = circuitWan?.ip && !circuitWan.ip.includes('Pending') && circuitWan?.link_up !== false;

                                            return (
                                                <div className="space-y-4">
                                                    {/* Circuit Hero Card */}
                                                    <div className={cn(
                                                        "p-4 rounded-2xl border shadow-lg relative overflow-hidden backdrop-blur-md",
                                                        isMpls
                                                            ? "bg-purple-950/20 border-purple-500/30 shadow-purple-500/10"
                                                            : "bg-blue-950/20 border-blue-500/30 shadow-blue-500/10"
                                                    )}>
                                                        <div className="flex items-start justify-between gap-2 mb-3">
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-2">
                                                                    <span className={cn(
                                                                        "px-2.5 py-0.5 rounded-lg text-xs font-black uppercase tracking-wider",
                                                                        isMpls ? "bg-purple-500/20 text-purple-300 border border-purple-500/40" : "bg-blue-500/20 text-blue-300 border border-blue-500/40"
                                                                    )}>
                                                                        {circuitWan?.circuit_label || circuitWan?.name}
                                                                    </span>
                                                                    <span className={cn(
                                                                        "px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1",
                                                                        isCircuitUp ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                                                                    )}>
                                                                        <span className={cn("w-1.5 h-1.5 rounded-full", isCircuitUp ? "bg-emerald-400 animate-pulse" : "bg-rose-400")}></span>
                                                                        {isCircuitUp ? 'OPERATIONAL' : 'DOWN'}
                                                                    </span>
                                                                </div>
                                                                <div className="text-[11px] text-text-muted font-mono mt-1">
                                                                    Node: <span className="text-text-primary font-bold">{siteName}</span> ({selectedObject.devName})
                                                                </div>
                                                            </div>
                                                            <div className={cn(
                                                                "px-2.5 py-1 rounded-xl text-[10px] font-mono font-bold uppercase",
                                                                isMpls ? "bg-purple-500/30 text-purple-200 border border-purple-400/50" : "bg-sky-500/30 text-sky-200 border border-sky-400/50"
                                                            )}>
                                                                {circuitWan?.wan_network || (isMpls ? 'MPLS' : 'INTERNET')}
                                                            </div>
                                                        </div>

                                                        {/* Circuit Specs Grid */}
                                                        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                                                            <div className="bg-card-secondary/40 p-2.5 rounded-xl border border-border/40">
                                                                <div className="text-[8px] font-black text-text-muted uppercase">Interface IP</div>
                                                                <div className="text-[11px] font-bold text-text-primary truncate">{circuitWan?.ip || 'DHCP...'}</div>
                                                            </div>
                                                            <div className="bg-card-secondary/40 p-2.5 rounded-xl border border-border/40">
                                                                <div className="text-[8px] font-black text-text-muted uppercase">Default Gateway</div>
                                                                <div className="text-[11px] font-bold text-emerald-400 truncate">{circuitWan?.gateway || 'Auto / Default'}</div>
                                                            </div>
                                                            <div className="bg-card-secondary/40 p-2.5 rounded-xl border border-border/40">
                                                                <div className="text-[8px] font-black text-text-muted uppercase">Device Port</div>
                                                                <div className="text-[11px] font-bold text-text-secondary truncate">{circuitWan?.name || 'eth0'}</div>
                                                            </div>
                                                            <div className="bg-card-secondary/40 p-2.5 rounded-xl border border-border/40">
                                                                <div className="text-[8px] font-black text-text-muted uppercase">Bandwidth</div>
                                                                <div className="text-[11px] font-bold text-cyan-400 truncate">
                                                                    {circuitWan?.bw_up_kbps ? `${Math.round(circuitWan.bw_up_kbps / 1000)} Mbps` : 'Adaptive'}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* KPI Filter Tabs */}
                                                    <div className="flex gap-1.5 p-1 bg-card-secondary/50 rounded-xl border border-border/60 text-xs">
                                                        <button
                                                            onClick={() => setCircuitTunnelFilter('ALL')}
                                                            className={cn(
                                                                "flex-1 py-1.5 rounded-lg font-bold text-[11px] transition-all flex items-center justify-center gap-1",
                                                                circuitTunnelFilter === 'ALL'
                                                                    ? "bg-card text-text-primary shadow-sm border border-border/60"
                                                                    : "text-text-muted hover:text-text-primary"
                                                            )}
                                                        >
                                                            <span>All</span>
                                                            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-card-secondary border border-border/40 font-mono">
                                                                {totalCount}
                                                            </span>
                                                        </button>
                                                        <button
                                                            onClick={() => setCircuitTunnelFilter('ACTIVE')}
                                                            className={cn(
                                                                "flex-1 py-1.5 rounded-lg font-bold text-[11px] transition-all flex items-center justify-center gap-1",
                                                                circuitTunnelFilter === 'ACTIVE'
                                                                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                                                                    : "text-text-muted hover:text-emerald-400"
                                                            )}
                                                        >
                                                            <span>Active</span>
                                                            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono">
                                                                {activeCount}
                                                            </span>
                                                        </button>
                                                        <button
                                                            onClick={() => setCircuitTunnelFilter('INACTIVE')}
                                                            className={cn(
                                                                "flex-1 py-1.5 rounded-lg font-bold text-[11px] transition-all flex items-center justify-center gap-1",
                                                                circuitTunnelFilter === 'INACTIVE'
                                                                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                                                                    : "text-text-muted hover:text-cyan-400"
                                                            )}
                                                        >
                                                            <span>Inactive</span>
                                                            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono">
                                                                {backupCount}
                                                            </span>
                                                        </button>
                                                        <button
                                                            onClick={() => setCircuitTunnelFilter('DOWN')}
                                                            className={cn(
                                                                "flex-1 py-1.5 rounded-lg font-bold text-[11px] transition-all flex items-center justify-center gap-1",
                                                                circuitTunnelFilter === 'DOWN'
                                                                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm"
                                                                    : "text-text-muted hover:text-rose-400"
                                                            )}
                                                        >
                                                            <span>Down</span>
                                                            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 font-mono">
                                                                {downCount}
                                                            </span>
                                                        </button>
                                                    </div>

                                                    {/* Tunnel Search Filter */}
                                                    <div className="relative">
                                                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                                                        <input
                                                            type="text"
                                                            placeholder="Search peers, IPs, VPN IDs..."
                                                            value={circuitTunnelSearch}
                                                            onChange={(e) => setCircuitTunnelSearch(e.target.value)}
                                                            className="w-full bg-card border border-border rounded-xl pl-9 pr-8 py-1.5 text-xs focus:outline-none focus:border-blue-500 text-text-primary placeholder:text-text-muted/60 transition-colors"
                                                        />
                                                        {circuitTunnelSearch && (
                                                            <button
                                                                onClick={() => setCircuitTunnelSearch('')}
                                                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                                                            >
                                                                <X size={12} />
                                                            </button>
                                                        )}
                                                    </div>

                                                    {/* Tunnel Cards List */}
                                                    <div className="space-y-2.5">
                                                        <div className="flex items-center justify-between text-[11px] font-bold text-text-muted px-1">
                                                            <span>ESTABLISHED OVERLAY TUNNELS</span>
                                                            <span>{filteredTunnels.length} of {totalCount}</span>
                                                        </div>

                                                        {filteredTunnels.length === 0 ? (
                                                            <div className="text-center py-8 px-4 border border-dashed border-border rounded-2xl bg-card-secondary/20">
                                                                <Activity size={24} className="mx-auto text-text-muted/40 mb-2" />
                                                                <div className="text-xs font-bold text-text-muted">No overlay tunnels found</div>
                                                                <div className="text-[10px] text-text-muted/60 mt-0.5">
                                                                    {totalCount === 0 ? "This circuit currently has no active overlay peer connections." : "Try adjusting your filter or search query."}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            filteredTunnels.map((t: any, idx: number) => {
                                                                const isPeerHub = siteHubStatus.get(t.peerSite) === true;
                                                                return (
                                                                    <div
                                                                        key={idx}
                                                                        className={cn(
                                                                            "p-3 rounded-xl border transition-all hover:border-blue-400/60 bg-card/70 backdrop-blur-sm group relative",
                                                                            t.isRoutingActive
                                                                                ? "border-emerald-500/30 hover:shadow-lg hover:shadow-emerald-500/10"
                                                                                : (t.isRoutingUsable || t.isLinkUp)
                                                                                    ? "border-cyan-500/30 hover:shadow-lg hover:shadow-cyan-500/10"
                                                                                    : "border-rose-500/30 opacity-70"
                                                                        )}
                                                                    >
                                                                        {/* Top Row: Peer Node & Status */}
                                                                        <div className="flex items-center justify-between gap-2 mb-2">
                                                                            <div className="flex items-center gap-2 min-w-0">
                                                                                <div className={cn(
                                                                                    "p-1.5 rounded-lg shrink-0",
                                                                                    isPeerHub ? "bg-purple-500/20 text-purple-300" : "bg-blue-500/20 text-blue-300"
                                                                                )}>
                                                                                    {isPeerHub ? <Server size={13} /> : <Home size={13} />}
                                                                                </div>
                                                                                <div className="min-w-0">
                                                                                    <div className="text-xs font-black text-text-primary truncate flex items-center gap-1.5">
                                                                                        <span>{t.peerSite}</span>
                                                                                        <span className="text-[9px] font-mono text-text-muted font-normal">({t.peerCircuit})</span>
                                                                                    </div>
                                                                                    <div className="text-[9px] text-text-muted font-mono truncate">
                                                                                        Device: {t.peerDevice}
                                                                                    </div>
                                                                                </div>
                                                                            </div>

                                                                            <div className="shrink-0 flex items-center gap-1.5">
                                                                                {t.isRoutingActive ? (
                                                                                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                                                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                                                                        ACTIVE
                                                                                    </span>
                                                                                ) : (t.status === 'DOWN' || (!t.isLinkUp && !t.isRoutingUsable)) ? (
                                                                                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">
                                                                                        DOWN
                                                                                    </span>
                                                                                ) : (
                                                                                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-blue-500/15 text-blue-400 border border-blue-500/30">
                                                                                        INACTIVE
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        </div>

                                                                        {t.raw?.status_reason && (
                                                                            <div className={cn(
                                                                                "mb-2 px-2 py-1 rounded-md text-[9px] font-mono flex items-center gap-1.5 truncate border",
                                                                                t.isRoutingActive
                                                                                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                                                                                    : (t.status === 'DOWN' || (!t.isLinkUp && !t.isRoutingUsable))
                                                                                        ? "bg-rose-500/10 border-rose-500/20 text-rose-300"
                                                                                        : "bg-blue-500/10 border-blue-500/20 text-blue-300"
                                                                            )} title={t.raw.status_reason_detail || t.raw.status_reason}>
                                                                                <AlertTriangle size={10} className="shrink-0" />
                                                                                <span className="truncate">Reason: {t.raw.status_reason}</span>
                                                                            </div>
                                                                        )}

                                                                        {/* Tech details grid */}
                                                                        <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono bg-card-secondary/40 p-2 rounded-lg border border-border/30 mb-2">
                                                                            <div>
                                                                                <span className="text-text-muted text-[8px] uppercase block font-sans">Peer IP</span>
                                                                                <span className="font-bold text-text-primary truncate block">{t.dstIp || 'N/A'}</span>
                                                                            </div>
                                                                            <div>
                                                                                <span className="text-text-muted text-[8px] uppercase block font-sans">Local IP</span>
                                                                                <span className="font-bold text-text-secondary truncate block">{t.srcIp || circuitWan?.ip || 'N/A'}</span>
                                                                            </div>
                                                                            <div>
                                                                                <span className="text-text-muted text-[8px] uppercase block font-sans">Tunnel Path</span>
                                                                                <span className="text-cyan-400 truncate block">{t.vpnId ? `#${t.vpnId}` : 'Mesh VPN'}</span>
                                                                            </div>
                                                                            <div>
                                                                                <span className="text-text-muted text-[8px] uppercase block font-sans">Uptime / Latency</span>
                                                                                <span className="text-emerald-400 truncate block">
                                                                                    {t.raw?.uptime_sec != null ? formatTunnelDuration(t.raw.uptime_sec) : (t.latency ? `${t.latency} ms` : 'Optimal')}
                                                                                </span>
                                                                            </div>
                                                                        </div>

                                                                        {/* Action row */}
                                                                        <div className="flex items-center justify-between pt-1 border-t border-border/20 text-[10px]">
                                                                            <button
                                                                                onClick={() => setInspectedLink({
                                                                                    ...(t.raw || {}),
                                                                                    isOverlayTunnel: true,
                                                                                    tunnelState: t.isRoutingActive ? 'ACTIVE' : (t.status === 'DOWN' || (!t.isLinkUp && !t.isRoutingUsable)) ? 'DOWN' : 'INACTIVE',
                                                                                    sourceSiteName: t.sourceSite,
                                                                                    sourceSiteId: t.sourceSiteId,
                                                                                    sourceDeviceName: t.sourceDevice,
                                                                                    sourceCircuitName: t.sourceCircuit,
                                                                                    sourceCircuitLabel: t.sourceCircuit,
                                                                                    peer_site_name: t.peerSite,
                                                                                    peer_site_id: t.peerSiteId,
                                                                                    peer_device_name: t.peerDevice,
                                                                                    peer_wan_interface: t.peerCircuit,
                                                                                    debug_vpn_id: t.vpnId,
                                                                                    debug_source_ip: t.srcIp,
                                                                                    debug_peer_ip: t.dstIp,
                                                                                    wan_network: t.sourceNetwork,
                                                                                    local_vep_id: t.direction === 'inbound' ? t.raw?.peer_vep_id : t.raw?.local_vep_id,
                                                                                    peer_vep_id: t.direction === 'inbound' ? t.raw?.local_vep_id : t.raw?.peer_vep_id,
                                                                                    local_shim_ip: t.direction === 'inbound' ? t.raw?.peer_shim_ip : t.raw?.local_shim_ip,
                                                                                    peer_shim_ip: t.direction === 'inbound' ? t.raw?.local_shim_ip : t.raw?.peer_shim_ip,
                                                                                })}
                                                                                className="px-2 py-1 rounded-md bg-card-secondary hover:bg-card-secondary/80 text-text-primary font-bold flex items-center gap-1 transition-colors cursor-pointer"
                                                                                title="Inspect Link details & run live API diagnostic"
                                                                            >
                                                                                <Activity size={11} className="text-blue-400" />
                                                                                <span>Inspect Link</span>
                                                                            </button>

                                                                            {t.peerSiteId && (
                                                                                <button
                                                                                    onClick={() => setLogicalViewSiteId(t.peerSiteId)}
                                                                                    className="px-2 py-1 rounded-md bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 font-bold flex items-center gap-1 transition-colors cursor-pointer"
                                                                                    title={`Focus topology on ${t.peerSite}`}
                                                                                >
                                                                                    <span>Focus Peer</span>
                                                                                    <ArrowRight size={11} />
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })
                                                        )}
                                                    </div>

                                                    {/* SASE ServiceLink section (if configured on this circuit) */}
                                                    {saseLinks.length > 0 && (
                                                        <div className="space-y-2 pt-2 border-t border-border/40">
                                                            <div className="flex items-center justify-between text-[11px] font-bold text-purple-400 px-1">
                                                                <span className="flex items-center gap-1.5">
                                                                    <Shield size={12} />
                                                                    SASE CLOUD SERVICELINKS
                                                                </span>
                                                                <span>{saseLinks.length}</span>
                                                            </div>
                                                            {saseLinks.map((sl: any, idx: number) => {
                                                                const isUp = sl.operational_state === 'up';
                                                                return (
                                                                    <div key={idx} className="p-2.5 rounded-xl border border-purple-500/30 bg-purple-950/15 text-xs font-mono">
                                                                        <div className="flex items-center justify-between mb-1">
                                                                            <span className="font-bold text-purple-200">{sl.name}</span>
                                                                            <span className={cn(
                                                                                "px-2 py-0.2 rounded-full text-[9px] font-bold",
                                                                                isUp ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                                                                            )}>
                                                                                {isUp ? 'UP' : 'DOWN'}
                                                                            </span>
                                                                        </div>
                                                                        <div className="text-[10px] text-text-muted flex justify-between">
                                                                            <span>PoP IP: {sl.remote_ip || 'Anycast'}</span>
                                                                            <span>Device: {sl.device_name}</span>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })()
                                    ) : selectedObject.isSasePop ? (
<div className="space-y-5">
                                            {/* SASE PoP Banner with Official Brand Logo */}
                                            <div className={cn(
                                                "border p-5 rounded-2xl flex flex-col items-center gap-3 shadow-lg transition-colors",
                                                selectedObject.provider === 'Prisma Access'
                                                    ? "bg-gradient-to-b from-purple-50/90 to-white dark:bg-purple-950/20 border-purple-200 dark:border-purple-500/30 shadow-purple-500/5 dark:shadow-purple-500/10"
                                                    : "bg-gradient-to-b from-blue-50/90 to-white dark:bg-blue-950/20 border-blue-200 dark:border-blue-500/30 shadow-blue-500/5 dark:shadow-blue-500/10"
                                            )}>
                                                <div className={cn(
                                                    "p-3 rounded-2xl shadow-md flex items-center justify-center border",
                                                    selectedObject.provider === 'Prisma Access'
                                                        ? "bg-white dark:bg-white/10 border-purple-300 dark:border-purple-500/40 shadow-purple-900/10 dark:shadow-purple-900/50"
                                                        : "bg-white dark:bg-white/10 border-blue-300 dark:border-blue-500/40 shadow-blue-900/10 dark:shadow-blue-900/50"
                                                )}>
                                                    {selectedObject.provider === 'Prisma Access' ? (
                                                        <img src="/prisma-access.png" alt="Prisma Access" className="w-12 h-12 object-contain filter drop-shadow-md" />
                                                    ) : (
                                                        <img src="/zscaler-logo.png" alt="Zscaler" className="w-12 h-12 object-contain rounded-xl filter drop-shadow-md" />
                                                    )}
                                                </div>
                                                <div className="text-center">
                                                    <div className="text-lg font-black text-text-primary tracking-tight leading-tight">{selectedObject.name}</div>
                                                    <div className={cn(
                                                        "text-[10px] font-bold tracking-[0.15em] mt-1.5 uppercase",
                                                        selectedObject.provider === 'Prisma Access' ? "text-purple-700 dark:text-purple-400" : "text-sky-700 dark:text-cyan-400"
                                                    )}>
                                                        {selectedObject.provider === 'Prisma Access' ? 'PALO ALTO NETWORKS · PRISMA ACCESS POP' : 'ZSCALER INC · CLOUD SECURITY (ZIA)'}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Key Specs 4-Grid */}
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="bg-card-secondary/60 dark:bg-card-secondary/40 p-3 rounded-xl border border-border/80 dark:border-border/60 space-y-1">
                                                    <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Gateway SPN IP</div>
                                                    <div className="text-xs font-mono font-bold text-sky-700 dark:text-cyan-400">{selectedObject.primary_peer_ip || 'Anycast'}</div>
                                                </div>
                                                <div className="bg-card-secondary/60 dark:bg-card-secondary/40 p-3 rounded-xl border border-border/80 dark:border-border/60 space-y-1">
                                                    <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Liveliness Probe</div>
                                                    <div className="text-xs font-mono font-bold text-emerald-700 dark:text-emerald-400">{selectedObject.liveliness_probe_ip || '192.168.255.254'}</div>
                                                </div>
                                                <div className="bg-card-secondary/60 dark:bg-card-secondary/40 p-3 rounded-xl border border-border/80 dark:border-border/60 space-y-1">
                                                    <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Probe Latency (ICMP)</div>
                                                    <div className="text-xs font-mono font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                        {selectedObject.latency_ms || (selectedObject.id === 'prisma-france-south' ? 9 : 21)} ms
                                                    </div>
                                                </div>
                                                <div className="bg-card-secondary/60 dark:bg-card-secondary/40 p-3 rounded-xl border border-border/80 dark:border-border/60 space-y-1">
                                                    <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Cluster Health</div>
                                                    <div className="text-xs font-mono font-bold text-text-primary">
                                                        {selectedObject.tunnels_up || 0}/{selectedObject.tunnels_total || 0} Tunnels Up
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Tunnel Telemetry Breakdown & Dynamic Filtering */}
                                            {(() => {
                                                const tunnels: any[] = [];
                                                (topology?.sites || []).forEach((site: any) => {
                                                    site.devices?.forEach((dev: any) => {
                                                        dev.service_links?.forEach((sl: any) => {
                                                            const seName = (sl.service_endpoint_name || sl.name || '').toLowerCase();
                                                            let match = false;
                                                            if (selectedObject.id === 'prisma-france-south' && (seName.includes('france-south') || seName.includes('paris') || sl.remote_ip === '130.41.124.164')) {
                                                                match = true;
                                                            } else if (selectedObject.id === 'prisma-ireland' && (seName.includes('ireland') || seName.includes('eu-west-1') || sl.remote_ip === '74.221.137.55')) {
                                                                match = true;
                                                            } else if (selectedObject.id === 'prisma-france-central' && (seName.includes('france-central') || seName.includes('france north') || seName.includes('france-north'))) {
                                                                match = true;
                                                            } else if (selectedObject.provider === 'Zscaler' && (sl.provider === 'Zscaler' || seName.includes('zscaler'))) {
                                                                match = true;
                                                            } else if (sl.remote_ip && sl.remote_ip === selectedObject.primary_peer_ip) {
                                                                match = true;
                                                            }
                                                            if (match) {
                                                                tunnels.push({
                                                                    ...sl,
                                                                    site_name: site.site_name,
                                                                    device_name: dev.device_name
                                                                });
                                                            }
                                                        });
                                                    });
                                                });

                                                const isZscalerPop = selectedObject.provider === 'Zscaler';
                                                const isActTunnel = (t: any) => isZscalerPop 
                                                    ? t.operational_state === 'up' 
                                                    : (t.role === 'active' || (t.name || '').toUpperCase().includes('_ACT'));
                                                const isBkpTunnel = (t: any) => isZscalerPop 
                                                    ? false 
                                                    : (t.role === 'backup' || (t.name || '').toUpperCase().includes('_BKP'));

                                                const activeUp = tunnels.filter(t => isActTunnel(t) && t.operational_state === 'up');
                                                const backupUp = tunnels.filter(t => isBkpTunnel(t) && t.operational_state === 'up');
                                                const downOrStandby = tunnels.filter(t => t.operational_state !== 'up');

                                                const displayed = tunnels.filter(t => {
                                                    if (popTunnelFilter === 'ACTIVE') return isActTunnel(t) && t.operational_state === 'up';
                                                    if (popTunnelFilter === 'BACKUP') return isBkpTunnel(t) && t.operational_state === 'up';
                                                    if (popTunnelFilter === 'DOWN') return t.operational_state !== 'up';
                                                    return true;
                                                });

                                                return (
                                                    <div className="space-y-3">
                                                        {/* KPI Filter Ribbon */}
                                                        <div className="grid grid-cols-3 gap-2">
                                                            <button
                                                                onClick={() => setPopTunnelFilter(popTunnelFilter === 'ACTIVE' ? 'ALL' : 'ACTIVE')}
                                                                className={cn(
                                                                    "p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col",
                                                                    popTunnelFilter === 'ACTIVE'
                                                                        ? "bg-emerald-50 dark:bg-emerald-500/20 border-emerald-500 text-emerald-950 dark:text-white shadow-md shadow-emerald-500/10 dark:shadow-emerald-500/20"
                                                                        : "bg-card-secondary/60 dark:bg-card-secondary/40 border-border/80 dark:border-border/60 hover:bg-card-secondary"
                                                                )}
                                                            >
                                                                <span className="text-[9px] font-black uppercase text-emerald-700 dark:text-emerald-400">Active UP</span>
                                                                <span className="text-base font-black text-text-primary mt-0.5">{activeUp.length}</span>
                                                            </button>

                                                            <button
                                                                onClick={() => setPopTunnelFilter(popTunnelFilter === 'BACKUP' ? 'ALL' : 'BACKUP')}
                                                                className={cn(
                                                                    "p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col",
                                                                    popTunnelFilter === 'BACKUP'
                                                                        ? "bg-sky-50 dark:bg-cyan-500/20 border-sky-500 dark:border-cyan-500 text-sky-950 dark:text-white shadow-md shadow-sky-500/10 dark:shadow-cyan-500/20"
                                                                        : "bg-card-secondary/60 dark:bg-card-secondary/40 border-border/80 dark:border-border/60 hover:bg-card-secondary"
                                                                )}
                                                            >
                                                                <span className="text-[9px] font-black uppercase text-sky-700 dark:text-cyan-400">Backup UP</span>
                                                                <span className="text-base font-black text-text-primary mt-0.5">{backupUp.length}</span>
                                                            </button>

                                                            <button
                                                                onClick={() => setPopTunnelFilter(popTunnelFilter === 'DOWN' ? 'ALL' : 'DOWN')}
                                                                className={cn(
                                                                    "p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col",
                                                                    popTunnelFilter === 'DOWN'
                                                                        ? "bg-rose-50 dark:bg-rose-500/20 border-rose-500 text-rose-950 dark:text-white shadow-md shadow-rose-500/10 dark:shadow-rose-500/20"
                                                                        : "bg-card-secondary/60 dark:bg-card-secondary/40 border-border/80 dark:border-border/60 hover:bg-card-secondary"
                                                                )}
                                                            >
                                                                <span className="text-[9px] font-black uppercase text-rose-700 dark:text-rose-400">Down / Stdby</span>
                                                                <span className="text-base font-black text-text-primary mt-0.5">{downOrStandby.length}</span>
                                                            </button>
                                                        </div>

                                                        {/* Tunnel list header */}
                                                        <div className="flex items-center justify-between pt-1">
                                                            <div className="text-[10px] font-black text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                                                                <Network size={12} /> Branch Tunnels ({displayed.length}/{tunnels.length})
                                                            </div>
                                                            {popTunnelFilter !== 'ALL' && (
                                                                <button
                                                                    onClick={() => setPopTunnelFilter('ALL')}
                                                                    className="text-[9px] font-black text-indigo-400 hover:underline uppercase tracking-wider cursor-pointer"
                                                                >
                                                                    Show All
                                                                </button>
                                                            )}
                                                        </div>

                                                        {/* Tunnels Detailed Cards */}
                                                        <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                                                            {displayed.map((t: any, idx: number) => {
                                                                const isUp = t.operational_state === 'up';
                                                                const isAct = isActTunnel(t);
                                                                const isStandby = t.extended_state === 'standby_spoke';

                                                                return (
                                                                    <div key={`${t.site_name}-${t.name}-${idx}`} className="p-3 rounded-xl bg-card-secondary/50 border border-border/60 hover:border-border transition-all space-y-1.5">
                                                                        <div className="flex items-center justify-between gap-2">
                                                                            <div className="flex items-center gap-1.5 min-w-0">
                                                                                <span className="font-bold text-xs text-text-primary truncate">{t.site_name}</span>
                                                                                <span className="text-[10px] font-mono text-text-muted truncate">({t.device_name})</span>
                                                                            </div>
                                                                            <div className="flex items-center gap-1.5 shrink-0">
                                                                                <span className={cn(
                                                                                    "px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider",
                                                                                    isAct ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                                                                                )}>
                                                                                    {t.role || 'TUNNEL'}
                                                                                </span>
                                                                                <span className={cn(
                                                                                    "px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider font-mono",
                                                                                    isUp ? "bg-emerald-500/20 text-emerald-400" : (isStandby ? "bg-amber-500/20 text-amber-400" : "bg-rose-500/20 text-rose-400")
                                                                                )}>
                                                                                    {t.extended_state || t.operational_state}
                                                                                </span>
                                                                            </div>
                                                                        </div>

                                                                        <div className="text-[10px] font-mono text-text-secondary truncate flex items-center justify-between">
                                                                            <span className="truncate">{t.name}</span>
                                                                            <span className="text-text-muted font-bold shrink-0">{t.device}</span>
                                                                        </div>

                                                                        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/40 text-[9px] font-mono text-text-muted">
                                                                            <div>
                                                                                Local: <span className="text-text-primary font-bold">{t.local_ip || 'N/A'}</span>
                                                                            </div>
                                                                            <div className="truncate">
                                                                                /31: <span className="text-amber-400 font-bold">{t.inside_ip || 'N/A'}</span>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    ) : (selectedObject.type === 'node' || selectedObject.type === 'network') ? (
                                        <>
                                            {/* Site-Specific View (Logical View Toggle & Interfaces) */}
                                            {selectedObject.site_id ? (
                                                <>
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => setLogicalViewSiteId(logicalViewSiteId === selectedObject.site_id ? null : selectedObject.site_id)}
                                                            className={cn(
                                                                "flex-1 py-3 px-4 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all shadow-xl flex items-center justify-center gap-2",
                                                                logicalViewSiteId === selectedObject.site_id
                                                                    ? "bg-purple-500 hover:bg-purple-600 border border-purple-400 text-white shadow-purple-500/20"
                                                                    : "bg-blue-500 hover:bg-blue-600 border border-blue-400 text-white shadow-blue-500/20"
                                                            )}
                                                        >
                                                            <Network size={16} />
                                                            {logicalViewSiteId === selectedObject.site_id ? 'Show Physical View' : `Show Overlay for ${selectedObject.name}`}
                                                        </button>
                                                    </div>

                                                    <div className="space-y-3">
                                                        <div className="text-[10px] font-black text-text-muted uppercase tracking-widest flex items-center gap-2">
                                                            <Network size={12} /> WAN Interfaces
                                                        </div>
                                                        <div className="grid gap-2">
                                                            {selectedObject.devices?.map((d: any) =>
                                                                d.wan_interfaces?.map((w: any, idx: number) => (
                                                                    <div key={idx} className="bg-card-secondary/40 border border-border/60 p-3 rounded-xl flex items-center justify-between group hover:border-blue-500/30 transition-all">
                                                                        <div>
                                                                            <div className="text-xs font-bold text-text-primary uppercase tracking-tight">
                                                                                {selectedObject.devices.length > 1 ? `${d.device_name}: ${w.name}` : w.name}
                                                                            </div>
                                                                            <div className="text-[10px] text-text-secondary font-mono mt-0.5">{w.ip || 'DHCP (Pending)'}</div>
                                                                        </div>
                                                                        <div className={cn(
                                                                            "px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter border",
                                                                            w.ip && !w.ip.includes('Pending')
                                                                                ? "bg-green-500/10 text-green-500 border-green-500/20"
                                                                                : "bg-orange-500/10 text-orange-500 border-orange-500/20"
                                                                        )}>
                                                                            {w.ip && !w.ip.includes('Pending') ? 'Connected' : 'Pending'}
                                                                        </div>
                                                                    </div>
                                                                ))
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* SASE ServiceLinks Section */}
                                                    {selectedObject.devices?.some((d: any) => (d.service_links || []).length > 0) && (
                                                        <div className="space-y-3">
                                                            <div className="text-[10px] font-black text-text-muted uppercase tracking-widest flex items-center justify-between">
                                                                <span className="flex items-center gap-2"><Shield size={12} className="text-purple-400" /> SASE ServiceLinks</span>
                                                                <span className="text-[9px] font-mono font-bold text-purple-400">
                                                                    {selectedObject.devices.reduce((acc: number, d: any) => acc + (d.service_links?.filter((s: any) => s.operational_state === 'up').length || 0), 0)} Up / {selectedObject.devices.reduce((acc: number, d: any) => acc + (d.service_links || []).length, 0)} Total
                                                                </span>
                                                            </div>
                                                            <div className="grid gap-2">
                                                                {selectedObject.devices.map((d: any) =>
                                                                    (d.service_links || []).map((sl: any, slIdx: number) => {
                                                                        const isUp = sl.operational_state === 'up';
                                                                        const isAct = sl.role === 'active';
                                                                        return (
                                                                            <div key={slIdx} className="bg-card-secondary/40 border border-border/60 p-3 rounded-xl flex items-center justify-between group hover:border-purple-500/40 transition-all">
                                                                                <div className="min-w-0 flex-1 pr-2">
                                                                                    <div className="flex items-center gap-1.5">
                                                                                        <span className={cn(
                                                                                            "w-1.5 h-1.5 rounded-full",
                                                                                            isUp ? "bg-emerald-400 animate-pulse" : "bg-rose-400"
                                                                                        )} />
                                                                                        <span className="text-xs font-bold text-text-primary truncate">
                                                                                            {(sl.circuit_name || sl.wan_interface_name) ? (
                                                                                                <span className="text-emerald-400 mr-1.5 font-mono text-[11px]">[{sl.circuit_name || sl.wan_interface_name}]</span>
                                                                                            ) : null}
                                                                                            {sl.name}
                                                                                        </span>
                                                                                    </div>
                                                                                    <div className="text-[10px] text-text-secondary font-mono truncate mt-0.5">
                                                                                        {sl.provider} · {sl.role?.toUpperCase()} · GW: <span className="text-cyan-400 font-bold">{sl.remote_ip || 'Anycast'}</span>
                                                                                    </div>
                                                                                </div>
                                                                                <div className="shrink-0 flex items-center gap-1.5">
                                                                                    <span className={cn(
                                                                                        "px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter border",
                                                                                        isUp
                                                                                            ? (isAct ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-cyan-500/10 text-cyan-400 border-cyan-500/20")
                                                                                            : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                                                                    )}>
                                                                                        {sl.extended_state || sl.operational_state}
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {(() => {
                                                        // Aggregate all connections across all devices and interfaces into a rich format
                                                        const paths: any[] = [];
                                                        const seenPaths = new Set<string>();

                                                        selectedObject.devices?.forEach((d: any) => {
                                                            d.wan_interfaces?.forEach((w: any) => {
                                                                w.connections?.forEach((c: any) => {
                                                                    // Cluster branch dual-ION deduplication:
                                                                    if (c.source_device_name && d.device_name && c.source_device_name !== 'Unknown' && d.device_name !== 'Unknown' && c.source_device_name !== d.device_name) {
                                                                        return;
                                                                    }

                                                                    const vpnKey = (c.debug_vpn_id && c.debug_vpn_id !== 'N/A')
                                                                        ? String(c.debug_vpn_id)
                                                                        : `${d.device_name}-${w.name}-${c.peer_site_name}-${c.peer_device_name}-${c.peer_wan_interface}`;
                                                                    if (seenPaths.has(vpnKey)) return;
                                                                    seenPaths.add(vpnKey);

                                                                    const resolvedDstIp = resolveWanIp(
                                                                        c.peer_site_name,
                                                                        c.peer_device_name,
                                                                        c.peer_wan_interface,
                                                                        (c.debug_peer_ip && c.debug_peer_ip !== 'N/A') ? c.debug_peer_ip : (c.peer_ip || 'N/A')
                                                                    );

                                                                    const isRoutingActive = Boolean(c.active);
                                                                    const isRoutingUsable = Boolean(c.usable);
                                                                    const isLinkUp = Boolean(c.link_up);
                                                                    const tunnelState = isRoutingActive ? 'ACTIVE' : (isRoutingUsable || isLinkUp) ? 'INACTIVE' : 'DOWN';

                                                                    paths.push({
                                                                        sourceSite: selectedObject.name,
                                                                        sourceSiteId: selectedObject.id || selectedObject.site_id,
                                                                        sourceDevice: c.source_device_name || d.device_name || 'ION',
                                                                        sourceCircuit: w.name || 'WAN',
                                                                        sourceCircuitLabel: w.circuit_label || w.name || 'WAN',
                                                                        sourceWan: w,
                                                                        peerSite: c.peer_site_name,
                                                                        peerSiteId: c.peer_site_id,
                                                                        peerDevice: c.peer_device_name || 'ION',
                                                                        destCircuit: c.peer_wan_interface || 'WAN',
                                                                        network: w.wan_network || 'UNKNOWN',
                                                                        vpnId: c.debug_vpn_id,
                                                                        srcIp: (c.debug_source_ip && c.debug_source_ip !== 'N/A') ? c.debug_source_ip : (w.ip || c.ip || 'N/A'),
                                                                        dstIp: resolvedDstIp,
                                                                        isRoutingActive,
                                                                        isRoutingUsable,
                                                                        isLinkUp,
                                                                        tunnelState,
                                                                        vpState: c.vpState,
                                                                        raw: c
                                                                    });
                                                                });
                                                            });
                                                        });

                                                        const filteredPaths = paths.filter(p => {
                                                            if (pathFilter === 'ACTIVE' && !p.isRoutingActive) return false;
                                                            if (pathFilter === 'INACTIVE' && !((p.isRoutingUsable || p.isLinkUp) && !p.isRoutingActive)) return false;
                                                            if (pathFilter === 'DOWN' && (p.isRoutingActive || p.isRoutingUsable || p.isLinkUp)) return false;
                                                            if (pathFilter === 'HUB' && siteHubStatus.get(p.peerSite) !== true) return false;

                                                            if (overlaySearchQuery.trim()) {
                                                                const q = overlaySearchQuery.toLowerCase().trim();
                                                                const matches =
                                                                    (p.sourceSite && p.sourceSite.toLowerCase().includes(q)) ||
                                                                    (p.sourceDevice && p.sourceDevice.toLowerCase().includes(q)) ||
                                                                    (p.sourceCircuit && p.sourceCircuit.toLowerCase().includes(q)) ||
                                                                    (p.peerSite && p.peerSite.toLowerCase().includes(q)) ||
                                                                    (p.peerDevice && p.peerDevice.toLowerCase().includes(q)) ||
                                                                    (p.destCircuit && p.destCircuit.toLowerCase().includes(q)) ||
                                                                    (p.vpnId && String(p.vpnId).toLowerCase().includes(q)) ||
                                                                    (p.srcIp && String(p.srcIp).toLowerCase().includes(q)) ||
                                                                    (p.dstIp && String(p.dstIp).toLowerCase().includes(q)) ||
                                                                    (p.network && p.network.toLowerCase().includes(q));
                                                                if (!matches) return false;
                                                            }

                                                            return true;
                                                        });

                                                        filteredPaths.sort((a, b) => a.peerSite.localeCompare(b.peerSite));

                                                        return (
                                                            <div className="space-y-3">
                                                                <div className="flex justify-between items-center">
                                                                    <div className="text-[10px] font-black text-text-muted uppercase tracking-widest flex items-center gap-2">
                                                                        <Share2 size={12} className="text-blue-400" /> Detailed Overlay Paths
                                                                    </div>
                                                                    <div className="flex gap-1">
                                                                        {(['ALL', 'ACTIVE', 'INACTIVE', 'DOWN', 'HUB'] as const).map(f => (
                                                                            <button
                                                                                key={f}
                                                                                onClick={(e) => { e.stopPropagation(); setPathFilter(f); }}
                                                                                className={cn(
                                                                                    "px-1.5 py-0.5 rounded text-[8px] font-black tracking-tighter transition-all border",
                                                                                    pathFilter === f
                                                                                        ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20"
                                                                                        : "bg-card-secondary/40 border-border/40 text-text-muted hover:text-text-primary"
                                                                                )}
                                                                            >
                                                                                {f}
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                </div>

                                                                {/* Prominent Overlay Tunnel Search Bar with live match counter */}
                                                                <div className="flex items-center gap-2 bg-slate-900/90 p-1.5 rounded-xl border border-blue-500/40 shadow-md">
                                                                    <div className="relative flex-1">
                                                                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-blue-400 pointer-events-none" />
                                                                        <input
                                                                            type="text"
                                                                            placeholder="Filter tunnels by site, circuit, IP, or VPN ID..."
                                                                            value={overlaySearchQuery}
                                                                            onChange={(e) => setOverlaySearchQuery(e.target.value)}
                                                                            className="w-full bg-slate-950/90 border border-slate-700/60 rounded-lg pl-8 pr-7 py-1 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/40 font-mono transition-all"
                                                                        />
                                                                        {overlaySearchQuery && (
                                                                            <button
                                                                                onClick={() => setOverlaySearchQuery('')}
                                                                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs p-0.5 rounded transition-colors"
                                                                                title="Clear filter"
                                                                            >
                                                                                ✕
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                    <div className="shrink-0 px-2 py-0.5 rounded-lg bg-blue-500/20 border border-blue-500/40 text-[10px] font-mono font-bold text-blue-300 whitespace-nowrap" title="Filtered paths / Total paths">
                                                                        {filteredPaths.length} / {paths.length}
                                                                    </div>
                                                                </div>

                                                                <div className="w-full overflow-x-auto pb-2">
                                                                    <table className="w-full text-left border-separate" style={{ borderSpacing: '0 4px' }}>
                                                                        <tbody className="text-[10px]">
                                                                            {filteredPaths.length === 0 ? (
                                                                                <tr><td colSpan={5} className="text-text-muted italic opacity-50 py-4 text-center">No matching overlay peers discovered</td></tr>
                                                                            ) : (
                                                                                filteredPaths.map((p: any, idx: number) => {
                                                                                    let tagBg = "bg-card-secondary/20";
                                                                                    let tagText = "text-text-muted";
                                                                                    let label = "UNKNOWN";
                                                                                    if (p.isRoutingActive) { tagBg = "bg-green-500/10"; tagText = "text-green-500"; label = "ACTIVE"; }
                                                                                    else if (p.isRoutingUsable || p.isLinkUp) { tagBg = "bg-blue-500/10"; tagText = "text-blue-500"; label = "INACTIVE"; }
                                                                                    else { tagBg = "bg-red-500/10"; tagText = "text-red-500"; label = "DOWN"; }

                                                                                    const rowTitle = `VPN ID: ${p.vpnId || 'N/A'}\n${p.sourceSite} (${p.srcIp || 'N/A'}) ➔ ${p.peerSite} (${p.dstIp || 'N/A'})\nNetwork: ${p.network}\nStatus: ${label}\nClick to inspect tunnel details`;

                                                                                    return (
                                                                                        <tr
                                                                                            key={idx}
                                                                                            title={rowTitle}
                                                                                            onClick={() => {
                                                                                                setInspectedLink({
                                                                                                    ...p.raw,
                                                                                                    isOverlayTunnel: true,
                                                                                                    sourceSiteName: p.sourceSite,
                                                                                                    sourceSiteId: p.sourceSiteId,
                                                                                                    sourceDeviceName: p.sourceDevice,
                                                                                                    sourceCircuitName: p.sourceCircuit,
                                                                                                    sourceCircuitLabel: p.sourceCircuitLabel,
                                                                                                    sourceWan: p.sourceWan,
                                                                                                    debug_source_ip: p.srcIp,
                                                                                                    peer_site_name: p.peerSite,
                                                                                                    peer_site_id: p.peerSiteId,
                                                                                                    peer_device_name: p.peerDevice,
                                                                                                    peer_wan_interface: p.destCircuit,
                                                                                                    debug_peer_ip: p.dstIp,
                                                                                                    debug_vpn_id: p.vpnId,
                                                                                                    wan_network: p.network,
                                                                                                    tunnelState: p.tunnelState,
                                                                                                    latency: p.raw?.latency ?? p.raw?.delay_ms,
                                                                                                    packet_loss: p.raw?.loss_pct ?? p.raw?.packet_loss
                                                                                                });
                                                                                            }}
                                                                                            className="group hover:bg-blue-500/15 transition-colors cursor-pointer"
                                                                                        >
                                                                                            <td className="py-2 pl-3 rounded-l-lg border-y border-l bg-card/20 border-border/20 group-hover:border-blue-500/40 text-right whitespace-nowrap min-w-[50px]">
                                                                                                <div className="flex items-center justify-end gap-1 text-[9px] font-mono">
                                                                                                    <span className="text-text-primary hidden lg:inline">{p.sourceSite}</span>
                                                                                                    <span className="text-text-muted/50 hidden lg:inline">:</span>
                                                                                                    <span className="text-blue-500 font-bold">{p.sourceDevice}</span>
                                                                                                </div>
                                                                                            </td>
                                                                                            <td className="py-2 px-1 border-y bg-card/20 border-border/20 group-hover:border-blue-500/40 text-right whitespace-nowrap w-[1%]">
                                                                                                <span className="text-[9px] font-mono text-text-secondary bg-card-secondary/50 px-1 py-0.5 rounded uppercase tracking-tighter inline-block">{p.sourceCircuit}</span>
                                                                                            </td>
                                                                                            <td className="py-2 px-2 border-y bg-card/20 border-border/20 group-hover:border-blue-500/40 text-center whitespace-nowrap w-[1%]">
                                                                                                <div className="flex justify-center items-center opacity-90 pb-[1px]">
                                                                                                    <span className="text-[9px] font-mono text-text-muted tracking-tighter hidden sm:inline">&lt;=</span>
                                                                                                    <span className={cn("px-1.5 py-[1px] mx-1 rounded font-black text-[8px] tracking-wider text-center border min-w-[45px]", tagBg, tagText, p.isRoutingActive ? "border-green-500/20" : p.isRoutingUsable ? "border-blue-500/20" : "border-red-500/20")}>
                                                                                                        {label}
                                                                                                    </span>
                                                                                                    <span className="text-[9px] font-mono text-text-muted tracking-tighter hidden sm:inline">=&gt;</span>
                                                                                                </div>
                                                                                            </td>
                                                                                            <td className="py-2 px-1 border-y bg-card/20 border-border/20 group-hover:border-blue-500/40 text-left whitespace-nowrap w-[1%]">
                                                                                                <span className="text-[9px] font-mono text-text-secondary bg-card-secondary/50 px-1 py-0.5 rounded uppercase tracking-tighter inline-block">{p.destCircuit}</span>
                                                                                            </td>
                                                                                            <td className="py-2 pr-3 rounded-r-lg border-y border-r bg-card/20 border-border/20 group-hover:border-blue-500/40 text-left whitespace-nowrap min-w-[50px]">
                                                                                                <div className="flex items-center justify-start gap-1 text-[9px] font-mono">
                                                                                                    <span className="text-blue-500 font-bold">{p.peerDevice}</span>
                                                                                                    <span className="text-text-muted/50 hidden lg:inline">:</span>
                                                                                                    <span className="text-text-primary hidden lg:inline">{p.peerSite}</span>
                                                                                                </div>
                                                                                            </td>
                                                                                        </tr>
                                                                                    );
                                                                                })
                                                                            )}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            </div>
                                                        );
                                                    })()}
                                                </>
                                            ) : (
                                                /* Cloud Network SD-WAN Dashboard */
                                                (() => {
                                                    const isTargetMpls = Boolean((selectedObject.network || selectedObject.name || selectedObject.wan_network || '').toUpperCase().includes('MPLS'));
                                                    const targetNetworkName = isTargetMpls ? 'MPLS' : 'INTERNET';

                                                    // Collect all overlay paths running across this WAN network
                                                    const allNetworkPaths: any[] = [];
                                                    (topology?.sites || []).forEach((s: any) => {
                                                        (s.devices || []).forEach((d: any) => {
                                                            (d.wan_interfaces || []).forEach((w: any) => {
                                                                const isCircuitMpls = (w.wan_network || '').toUpperCase().includes('MPLS') || (w.name || '').toUpperCase().includes('MPLS');
                                                                if (isTargetMpls ? isCircuitMpls : !isCircuitMpls) {
                                                                    (w.connections || []).forEach((c: any) => {
                                                                        // Cluster branch dual-ION deduplication:
                                                                        if (c.source_device_name && d.device_name && c.source_device_name !== 'Unknown' && d.device_name !== 'Unknown' && c.source_device_name !== d.device_name) {
                                                                            return;
                                                                        }
                                                                        allNetworkPaths.push({
                                                                            sourceSite: s.site_name,
                                                                            sourceSiteId: s.site_id,
                                                                            sourceDevice: c.source_device_name || d.device_name || 'ION',
                                                                            sourceCircuit: w.name || 'WAN',
                                                                            peerSite: c.peer_site_name,
                                                                            peerSiteId: c.peer_site_id,
                                                                            peerDevice: c.peer_device_name || 'ION',
                                                                            destCircuit: c.peer_wan_interface || 'WAN',
                                                                            network: targetNetworkName,
                                                                            vpnId: c.debug_vpn_id,
                                                                            srcIp: (c.debug_source_ip && c.debug_source_ip !== 'N/A') ? c.debug_source_ip : (w.ip || c.ip || 'N/A'),
                                                                            dstIp: resolveWanIp(c.peer_site_name, c.peer_device_name, c.peer_wan_interface, (c.debug_peer_ip && c.debug_peer_ip !== 'N/A') ? c.debug_peer_ip : (c.peer_ip || 'N/A')),
                                                                            isRoutingActive: c.active,
                                                                            isRoutingUsable: c.usable,
                                                                            isLinkUp: c.link_up,
                                                                            status: c.status,
                                                                            vpState: c.vpState,
                                                                            latency: c.latency ?? c.delay_ms,
                                                                            loss: c.loss_pct ?? c.packet_loss
                                                                        });
                                                                    });
                                                                }
                                                            });
                                                        });
                                                    });

                                                    const totalPaths = allNetworkPaths.length;
                                                    const activePaths = allNetworkPaths.filter(p => p.isRoutingActive).length;
                                                    const backupPaths = allNetworkPaths.filter(p => !p.isRoutingActive && (p.isRoutingUsable || p.isLinkUp)).length;
                                                    const downPaths = allNetworkPaths.filter(p => !p.isRoutingActive && !p.isRoutingUsable && !p.isLinkUp).length;

                                                    const filteredNetworkPaths = allNetworkPaths.filter(p => {
                                                        if (networkTunnelFilter === 'ACTIVE') return p.isRoutingActive;
                                                        if (networkTunnelFilter === 'INACTIVE') return !p.isRoutingActive && (p.isRoutingUsable || p.isLinkUp);
                                                        if (networkTunnelFilter === 'DOWN') return !p.isRoutingActive && !p.isRoutingUsable && !p.isLinkUp;
                                                        return true;
                                                    }).filter(p => {
                                                        if (!networkTunnelSearch) return true;
                                                        const q = networkTunnelSearch.toLowerCase().trim();
                                                        return p.sourceSite.toLowerCase().includes(q) ||
                                                               p.peerSite.toLowerCase().includes(q) ||
                                                               (p.sourceDevice && p.sourceDevice.toLowerCase().includes(q)) ||
                                                               (p.peerDevice && p.peerDevice.toLowerCase().includes(q)) ||
                                                               p.sourceCircuit.toLowerCase().includes(q) ||
                                                               p.destCircuit.toLowerCase().includes(q) ||
                                                               (p.vpnId && String(p.vpnId).toLowerCase().includes(q)) ||
                                                               (p.srcIp && String(p.srcIp).toLowerCase().includes(q)) ||
                                                               (p.dstIp && String(p.dstIp).toLowerCase().includes(q));
                                                    });

                                                    return (
                                                        <div className="space-y-3.5">
                                                            {/* Provider Card with Spotlight Actions */}
                                                            <div className={cn(
                                                                "border p-3.5 rounded-2xl flex flex-col items-center gap-2 shadow-lg",
                                                                isTargetMpls
                                                                    ? "bg-purple-950/20 border-purple-500/30 shadow-purple-500/10"
                                                                    : "bg-sky-950/20 border-sky-500/30 shadow-sky-500/10"
                                                            )}>
                                                                <div className={cn(
                                                                    "p-2 rounded-xl shadow-md flex items-center justify-center border",
                                                                    isTargetMpls ? "bg-purple-600/30 border-purple-500/40 text-purple-300" : "bg-sky-600/30 border-sky-500/40 text-sky-300"
                                                                )}>
                                                                    <Cloud size={22} />
                                                                </div>
                                                                <div className="text-center">
                                                                    <div className="text-base font-black text-text-primary tracking-tight leading-tight uppercase">
                                                                        {targetNetworkName} OVERLAY
                                                                    </div>
                                                                    <div className="text-[9px] text-text-muted font-bold tracking-widest uppercase mt-0.5">
                                                                        SD-WAN Transport Carrier
                                                                    </div>
                                                                </div>

                                                                {/* Quick Focus Button on Canvas */}
                                                                <div className="flex gap-2 w-full pt-0.5">
                                                                    <button
                                                                        onClick={() => {
                                                                            setSelectedNetwork(prev => prev === targetNetworkName ? null : targetNetworkName);
                                                                        }}
                                                                        className={cn(
                                                                            "flex-1 py-1.5 px-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all border flex items-center justify-center gap-1.5 cursor-pointer shadow-sm",
                                                                            selectedNetwork === targetNetworkName
                                                                                ? (isTargetMpls ? "bg-purple-600 border-purple-500 text-white shadow-purple-500/25" : "bg-sky-600 border-sky-500 text-white shadow-sky-500/25")
                                                                                : "bg-card-secondary/40 border-border/50 text-text-primary hover:bg-card-secondary"
                                                                        )}
                                                                    >
                                                                        <Filter size={12} />
                                                                        {selectedNetwork === targetNetworkName ? 'Active Filter (Isolated)' : 'Focus on Canvas'}
                                                                    </button>
                                                                </div>
                                                            </div>

                                                            {/* KPI Summary Cards */}
                                                            <div className="grid grid-cols-4 gap-1.5">
                                                                <div className="bg-card-secondary/40 border border-border/50 p-2 rounded-xl text-center">
                                                                    <div className="text-[8px] font-black uppercase tracking-wider text-text-muted">Total</div>
                                                                    <div className="text-sm font-black text-text-primary mt-0.5">{totalPaths}</div>
                                                                </div>
                                                                <div className="bg-emerald-500/10 border border-emerald-500/20 p-2 rounded-xl text-center">
                                                                    <div className="text-[8px] font-black uppercase tracking-wider text-emerald-400">Active</div>
                                                                    <div className="text-sm font-black text-emerald-400 mt-0.5">{activePaths}</div>
                                                                </div>
                                                                <div className="bg-sky-500/10 border border-sky-500/20 p-2 rounded-xl text-center">
                                                                    <div className="text-[8px] font-black uppercase tracking-wider text-sky-400">Inactive</div>
                                                                    <div className="text-sm font-black text-sky-400 mt-0.5">{backupPaths}</div>
                                                                </div>
                                                                <div className="bg-rose-500/10 border border-rose-500/20 p-2 rounded-xl text-center">
                                                                    <div className="text-[8px] font-black uppercase tracking-wider text-rose-400">Down</div>
                                                                    <div className="text-sm font-black text-rose-400 mt-0.5">{downPaths}</div>
                                                                </div>
                                                            </div>

                                                            {/* Filter Tabs & Search */}
                                                            <div className="flex items-center justify-between gap-1.5">
                                                                <div className="flex gap-1">
                                                                    {(['ALL', 'ACTIVE', 'INACTIVE', 'DOWN'] as const).map(f => (
                                                                        <button
                                                                            key={f}
                                                                            onClick={() => {
                                                                                setNetworkTunnelFilter(f);
                                                                                setOverlayTunnelStateFilter(f);
                                                                            }}
                                                                            className={cn(
                                                                                "px-1.5 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all border cursor-pointer",
                                                                                networkTunnelFilter === f
                                                                                    ? "bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-500/20"
                                                                                    : "bg-card-secondary/40 border-border/40 text-text-muted hover:text-text-primary"
                                                                            )}
                                                                        >
                                                                            {f}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                                <div className="relative flex-1 max-w-[130px]">
                                                                    <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
                                                                    <input
                                                                        type="text"
                                                                        placeholder="Filter..."
                                                                        value={networkTunnelSearch}
                                                                        onChange={(e) => setNetworkTunnelSearch(e.target.value)}
                                                                        className="w-full bg-card-secondary/50 border border-border/60 rounded-lg pl-5 pr-2 py-0.5 text-[9px] text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-blue-500"
                                                                    />
                                                                </div>
                                                            </div>

                                                            {/* Tunnels List */}
                                                            <div className="space-y-1.5">
                                                                <div className="text-[9px] font-black text-text-muted uppercase tracking-widest flex items-center justify-between">
                                                                    <span className="flex items-center gap-1.5">
                                                                        <Share2 size={11} /> SD-WAN Tunnels ({filteredNetworkPaths.length})
                                                                    </span>
                                                                </div>

                                                                <div className="max-h-[480px] overflow-y-auto space-y-1 pr-0.5 scrollbar-thin scrollbar-thumb-border">
                                                                    {filteredNetworkPaths.length === 0 ? (
                                                                        <div className="py-6 text-center text-text-muted text-xs italic">
                                                                            No SD-WAN tunnels discovered on {targetNetworkName}
                                                                        </div>
                                                                    ) : (
                                                                        filteredNetworkPaths.map((p, idx) => {
                                                                            const isAct = p.isRoutingActive;
                                                                            const isBk = !isAct && (p.isRoutingUsable || p.isLinkUp);
                                                                            const hasSrcIp = p.srcIp && p.srcIp !== 'N/A' && p.srcIp !== 'None';
                                                                            const hasDstIp = p.dstIp && p.dstIp !== 'N/A' && p.dstIp !== 'None';
                                                                            const hasIps = Boolean(hasSrcIp || hasDstIp);
                                                                            const hasLatency = Boolean(p.latency);
                                                                            const showBottomBar = hasIps || hasLatency;

                                                                            return (
                                                                                <div
                                                                                    key={idx}
                                                                                    onClick={() => {
                                                                                        setLogicalViewSiteId(p.sourceSiteId);
                                                                                    }}
                                                                                    className="bg-card-secondary/30 hover:bg-card-secondary/60 border border-border/50 hover:border-blue-500/40 p-2 rounded-xl transition-all cursor-pointer group space-y-1"
                                                                                    title={`Click to focus site on canvas\nVPN ID: ${p.vpnId || 'N/A'}\n${p.sourceSite} (${p.srcIp || 'N/A'}) ➔ ${p.peerSite} (${p.dstIp || 'N/A'})\nNetwork: ${p.network}`}
                                                                                >
                                                                                    {/* Row 1: Source Site ➔ Peer Site + Status Badge */}
                                                                                    <div className="flex items-center justify-between gap-2">
                                                                                        <div className="flex items-center gap-1.5 min-w-0 font-bold text-xs text-text-primary">
                                                                                            <span className="truncate">{p.sourceSite}</span>
                                                                                            <span className="text-text-muted/50 text-[10px]">➔</span>
                                                                                            <span className="truncate">{p.peerSite}</span>
                                                                                        </div>
                                                                                        <span className={cn(
                                                                                            "shrink-0 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border",
                                                                                            isAct
                                                                                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                                                                                : (isBk ? "bg-sky-500/10 text-sky-400 border-sky-500/30" : "bg-rose-500/10 text-rose-400 border-rose-500/30")
                                                                                        )}>
                                                                                            {isAct ? 'ACTIVE' : (isBk ? 'INACTIVE' : 'DOWN')}
                                                                                        </span>
                                                                                    </div>

                                                                                    {/* Row 2: Circuit Badges & Latency */}
                                                                                    <div className="flex items-center justify-between text-[9px] font-mono text-text-muted pt-0.5">
                                                                                        <div className="flex items-center gap-1 min-w-0">
                                                                                            <span className="text-sky-400 bg-sky-500/10 px-1.5 py-0.2 rounded border border-sky-500/20 truncate max-w-[110px]">{p.sourceCircuit}</span>
                                                                                            <span className="text-text-muted/40 text-[8px]">➔</span>
                                                                                            <span className="text-purple-400 bg-purple-500/10 px-1.5 py-0.2 rounded border border-purple-500/20 truncate max-w-[110px]">{p.destCircuit}</span>
                                                                                        </div>
                                                                                        {hasLatency && (
                                                                                            <span className="text-emerald-400 font-bold shrink-0">{p.latency}ms</span>
                                                                                        )}
                                                                                    </div>

                                                                                    {/* Row 3: Real IPs (Only if actual IPs exist) */}
                                                                                    {hasIps && (
                                                                                        <div className="pt-1 border-t border-border/20 flex items-center justify-between text-[8px] font-mono text-text-muted/80">
                                                                                            <span>{(hasSrcIp ? p.srcIp : '—')} ➔ {(hasDstIp ? p.dstIp : '—')}</span>
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                        })
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })()
                                            )}

                                            {selectedObject.address && (
                                                <div className="space-y-2 pb-4">
                                                    <div className="text-[10px] font-black text-text-muted uppercase tracking-widest">Location Detail</div>
                                                    <div className="text-xs text-text-secondary bg-card-secondary/20 p-3 rounded-xl border border-border/40 font-medium">
                                                        {selectedObject.address.street}, {selectedObject.address.city}, {selectedObject.address.country}
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    ) : selectedObject.isSaseEdge ? (
                                        <div className="space-y-5">
                                            {/* SASE Tunnel Header Banner with Human-Friendly Name & Brand Logo */}
                                            {(() => {
                                                const info = formatServiceLinkDetails(selectedObject.name, selectedObject.role, selectedObject.provider, selectedObject.circuit_name);
                                                const isPrisma = selectedObject.provider === 'Prisma Access';
                                                return (
                                                    <div className={cn(
                                                        "border p-5 rounded-2xl flex flex-col items-center gap-3 shadow-lg transition-colors",
                                                        isPrisma
                                                            ? "bg-gradient-to-b from-purple-50/90 to-white dark:bg-purple-950/20 border-purple-200 dark:border-purple-500/30 shadow-purple-500/5 dark:shadow-purple-500/10"
                                                            : "bg-gradient-to-b from-blue-50/90 to-white dark:bg-blue-950/20 border-blue-200 dark:border-blue-500/30 shadow-blue-500/5 dark:shadow-blue-500/10"
                                                    )}>
                                                        <div className={cn(
                                                            "p-2.5 rounded-2xl shadow-md flex items-center justify-center border",
                                                            isPrisma
                                                                ? "bg-white dark:bg-white/10 border-purple-300 dark:border-purple-500/40 shadow-purple-900/10 dark:shadow-purple-900/50"
                                                                : "bg-white dark:bg-white/10 border-blue-300 dark:border-blue-500/40 shadow-blue-900/10 dark:shadow-blue-900/50"
                                                        )}>
                                                            {isPrisma ? (
                                                                <img src="/prisma-access.png" alt="Prisma Access" className="w-10 h-10 object-contain filter drop-shadow" />
                                                            ) : (
                                                                <img src="/zscaler-logo.png" alt="Zscaler" className="w-10 h-10 object-contain rounded-xl filter drop-shadow" />
                                                            )}
                                                        </div>
                                                        <div className="text-center">
                                                            <div className="text-base font-black text-text-primary tracking-tight">{info.title}</div>
                                                            <div className="text-[10px] font-mono text-text-muted mt-0.5 truncate max-w-[340px]" title={selectedObject.name}>
                                                                Device: {selectedObject.device} · {selectedObject.name}
                                                            </div>
                                                            <div className={cn(
                                                                "text-[10px] font-bold tracking-[0.15em] mt-1 uppercase",
                                                                isPrisma ? "text-purple-700 dark:text-purple-400" : "text-sky-700 dark:text-cyan-400"
                                                            )}>
                                                                {selectedObject.provider} · {selectedObject.role?.toUpperCase()} PATH
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })()}

                                            {/* Status Badge */}
                                            <div className={cn(
                                                "p-3 rounded-xl border flex items-center justify-between text-xs font-bold",
                                                selectedObject.operational_state === 'up'
                                                    ? "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-400"
                                                    : "bg-rose-50 dark:bg-rose-500/10 border-rose-300 dark:border-rose-500/30 text-rose-800 dark:text-rose-400"
                                            )}>
                                                <div className="flex items-center gap-2">
                                                    <span className={cn("w-2 h-2 rounded-full", selectedObject.operational_state === 'up' ? "bg-emerald-500 animate-pulse" : "bg-rose-500")} />
                                                    <span>STATUS: {selectedObject.extended_state || selectedObject.operational_state}</span>
                                                </div>
                                                <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-black/5 dark:bg-black/20 text-text-secondary">
                                                    Device: {selectedObject.device}
                                                </span>
                                            </div>

                                            {/* Key Specs Grid */}
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="bg-card-secondary/60 dark:bg-card-secondary/40 p-3.5 rounded-xl border border-border/80 dark:border-border/60 space-y-1">
                                                    <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Remote Gateway (SPN)</div>
                                                    <div className="text-xs font-mono font-bold text-sky-700 dark:text-cyan-400">{selectedObject.remote_ip || 'N/A'}</div>
                                                </div>
                                                <div className="bg-card-secondary/60 dark:bg-card-secondary/40 p-3.5 rounded-xl border border-border/80 dark:border-border/60 space-y-1">
                                                    <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Local Tunnel IP</div>
                                                    <div className="text-xs font-mono font-bold text-text-primary">{selectedObject.local_ip || 'N/A'}</div>
                                                </div>
                                                <div className="bg-card-secondary/60 dark:bg-card-secondary/40 p-3.5 rounded-xl border border-border/80 dark:border-border/60 space-y-1">
                                                    <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Inside Subnet (/31)</div>
                                                    <div className="text-xs font-mono font-bold text-amber-700 dark:text-amber-400">{selectedObject.inside_ip || 'N/A'}</div>
                                                </div>
                                                <div className="bg-card-secondary/60 dark:bg-card-secondary/40 p-3.5 rounded-xl border border-border/80 dark:border-border/60 space-y-1">
                                                    <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Liveliness Probe</div>
                                                    <div className="text-xs font-mono font-bold text-emerald-700 dark:text-emerald-400">{selectedObject.liveliness_probe_ip || '192.168.255.254'}</div>
                                                </div>
                                            </div>

                                            {/* Real-time Telemetry: Uptime & Latency */}
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="bg-card-secondary/60 dark:bg-card-secondary/40 p-3.5 rounded-xl border border-border/80 dark:border-border/60 space-y-1">
                                                    <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Tunnel Uptime</div>
                                                    <div className="text-xs font-mono font-bold text-emerald-700 dark:text-emerald-400">
                                                        {selectedObject.uptime_str || 'Active (UP)'}
                                                    </div>
                                                </div>
                                                <div className="bg-card-secondary/60 dark:bg-card-secondary/40 p-3.5 rounded-xl border border-border/80 dark:border-border/60 space-y-1">
                                                    <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Probe Latency (ICMP)</div>
                                                    <div className="text-xs font-mono font-bold text-sky-700 dark:text-cyan-400 flex items-center gap-1.5">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
                                                        {selectedObject.latency_ms || (selectedObject.service_endpoint_name?.toLowerCase().includes('ireland') ? 21 : 9)} ms
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Endpoint / Routing Info */}
                                            <div className="bg-card-secondary/30 rounded-xl p-3.5 border border-border/50 space-y-2 text-xs">
                                                {selectedObject.circuit_name && (
                                                    <div className="flex justify-between items-center py-0.5 border-b border-border/40">
                                                        <span className="text-text-muted">Origin Circuit</span>
                                                        <span className="font-mono font-bold text-emerald-400">{selectedObject.circuit_name}</span>
                                                    </div>
                                                )}
                                                <div className="flex justify-between items-center py-0.5 border-b border-border/40">
                                                    <span className="text-text-muted">Target PoP</span>
                                                    <span className="font-semibold text-text-primary truncate max-w-[220px]" title={selectedObject.service_endpoint_name}>
                                                        {selectedObject.service_endpoint_name}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between items-center py-0.5 border-b border-border/40">
                                                    <span className="text-text-muted">Source Site</span>
                                                    <span className="font-bold text-indigo-400">{selectedObject.site_name} ({selectedObject.device_name})</span>
                                                </div>
                                                {selectedObject.routes && selectedObject.routes.length > 0 && (
                                                    <div className="flex justify-between items-center py-0.5">
                                                        <span className="text-text-muted">Installed Route</span>
                                                        <span className="font-mono text-text-secondary text-[11px]">
                                                            {selectedObject.routes[0].destination} via {selectedObject.routes[0].via}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ) : (selectedObject.isOverlayTunnel || selectedObject.peer_site_name) ? (
                                        <div className="space-y-5">
                                            {/* SD-WAN Overlay Tunnel Inspector */}
                                            {(() => {
                                                const isOverlayMpls = Boolean(selectedObject.isMplsCircuit || (selectedObject.network || selectedObject.wan_network || '').toUpperCase().includes('MPLS'));
                                                const isAct = selectedObject.active;
                                                const isBk = !isAct && (selectedObject.usable || selectedObject.link_up);

                                                return (
                                                    <>
                                                        <div className={cn(
                                                            "border p-5 rounded-2xl flex flex-col items-center gap-3 shadow-lg",
                                                            isOverlayMpls
                                                                ? "bg-purple-950/20 border-purple-500/30 shadow-purple-500/10"
                                                                : "bg-sky-950/20 border-sky-500/30 shadow-sky-500/10"
                                                        )}>
                                                            <div className={cn(
                                                                "p-3 rounded-2xl shadow-xl flex items-center justify-center border",
                                                                isOverlayMpls ? "bg-purple-600/30 border-purple-500/40 text-purple-300" : "bg-sky-600/30 border-sky-500/40 text-sky-300"
                                                            )}>
                                                                <Share2 size={24} />
                                                            </div>
                                                            <div className="text-center">
                                                                <div className="text-base font-black text-text-primary tracking-tight">
                                                                    {selectedObject.sourceSiteName || selectedObject.sourceSite || 'Site'} ➔ {selectedObject.peer_site_name || selectedObject.peerSite || 'Peer'}
                                                                </div>
                                                                <div className="text-[10px] font-mono text-text-muted mt-0.5">
                                                                    {selectedObject.sourceCircuitName || selectedObject.sourceCircuit || 'WAN'} ➔ {selectedObject.peer_wan_interface || selectedObject.destCircuit || 'WAN'}
                                                                </div>
                                                                <div className={cn(
                                                                    "text-[10px] font-bold tracking-[0.15em] mt-1 uppercase",
                                                                    isOverlayMpls ? "text-purple-400" : "text-sky-400"
                                                                )}>
                                                                    {isOverlayMpls ? 'SD-WAN OVERLAY (MPLS TRANSPORT)' : 'SD-WAN OVERLAY (INTERNET TRANSPORT)'}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Routing Status */}
                                                        <div className={cn(
                                                            "p-3 rounded-xl border flex items-center justify-between text-xs font-bold",
                                                            isAct
                                                                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                                                                : isBk
                                                                    ? "bg-sky-500/10 border-sky-500/30 text-sky-400"
                                                                    : "bg-rose-500/10 border-rose-500/30 text-rose-400"
                                                        )}>
                                                            <div className="flex items-center gap-2">
                                                                <span className={cn(
                                                                    "w-2 h-2 rounded-full",
                                                                    isAct ? "bg-emerald-400 animate-pulse" : isBk ? "bg-sky-400" : "bg-rose-400"
                                                                )} />
                                                                <span>STATUS: {isAct ? 'ROUTING ACTIVE (Flow Forwarding)' : isBk ? 'INACTIVE (Standby - Up without Transit)' : 'TUNNEL DOWN'}</span>
                                                            </div>
                                                            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-black/20">
                                                                {selectedObject.vpState || selectedObject.status || 'UP'}
                                                            </span>
                                                        </div>

                                                        {/* IPsec Endpoints Specs */}
                                                        <div className="grid grid-cols-2 gap-3">
                                                            <div className="bg-card-secondary/40 p-3.5 rounded-xl border border-border/60 space-y-1">
                                                                <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Source IP</div>
                                                                <div className="text-xs font-mono font-bold text-text-primary truncate">{selectedObject.debug_source_ip || selectedObject.srcIp || 'N/A'}</div>
                                                            </div>
                                                            <div className="bg-card-secondary/40 p-3.5 rounded-xl border border-border/60 space-y-1">
                                                                <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Remote Peer IP</div>
                                                                <div className="text-xs font-mono font-bold text-cyan-400 truncate">{selectedObject.debug_peer_ip || selectedObject.dstIp || 'N/A'}</div>
                                                            </div>
                                                            <div className="bg-card-secondary/40 p-3.5 rounded-xl border border-border/60 space-y-1">
                                                                <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">VPN ID</div>
                                                                <div className="text-xs font-mono font-bold text-amber-400 truncate">{selectedObject.debug_vpn_id || selectedObject.vpnId || 'Standard IPsec'}</div>
                                                            </div>
                                                            <div className="bg-card-secondary/40 p-3.5 rounded-xl border border-border/60 space-y-1">
                                                                <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Latency / Loss</div>
                                                                <div className="text-xs font-mono font-bold text-emerald-400">
                                                                    {(selectedObject.latency ?? selectedObject.delay_ms) ? `${selectedObject.latency ?? selectedObject.delay_ms} ms` : 'Optimal'}
                                                                    {(selectedObject.loss_pct ?? selectedObject.loss) ? ` · ${selectedObject.loss_pct ?? selectedObject.loss}% loss` : ''}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </>
                                                );
                                            })()}
                                        </div>
                                    ) : (
                                        <div className="space-y-6">
                                            {(() => {
                                                const circuitNetName = selectedObject.wan_network || selectedObject.network || selectedObject.name || 'Public Internet';
                                                const isCircuitMpls = circuitNetName.toLowerCase().includes('mpls');

                                                return (
                                                    <>
                                                        <div className="bg-blue-500/5 border border-blue-500/20 p-5 rounded-2xl flex flex-col items-center gap-3">
                                                            <div className="p-3 bg-blue-500 rounded-2xl text-white shadow-lg">
                                                                <Zap size={24} />
                                                            </div>
                                                            <div className="text-center">
                                                                <div className="text-lg font-black text-text-primary tracking-tight uppercase leading-none">{circuitNetName}</div>
                                                                <div className="text-[10px] text-text-muted font-bold tracking-[0.2em] mt-2">NETWORK PROVIDER</div>
                                                            </div>
                                                        </div>

                                                        <div className="grid grid-cols-2 gap-4">
                                                            <div className="bg-card-secondary/30 p-4 rounded-xl border border-border space-y-1">
                                                                <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Public IP</div>
                                                                <div className="text-xs font-mono font-bold text-text-primary">{selectedObject.public_ip || 'N/A'}</div>
                                                            </div>
                                                            <div className="bg-card-secondary/30 p-4 rounded-xl border border-border space-y-1">
                                                                <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Interface IP</div>
                                                                <div className="text-xs font-mono font-bold text-text-secondary">{selectedObject.ip || selectedObject.interface_ip || 'DHCP'}</div>
                                                            </div>
                                                        </div>
                                                        {selectedObject.gateway && (
                                                            <div className="bg-card-secondary/30 px-4 py-2.5 rounded-xl border border-border flex items-center justify-between text-xs font-mono">
                                                                <span className="text-[9px] font-black text-text-muted uppercase tracking-widest">Default Gateway</span>
                                                                <span className="font-bold text-emerald-400">{selectedObject.gateway}</span>
                                                            </div>
                                                        )}

                                                        {(selectedObject.public_ip || selectedObject.ip) && (
                                                            <div className="pt-1">
                                                                <button
                                                                    onClick={() => setTracerouteTarget(selectedObject.public_ip || selectedObject.ip || '')}
                                                                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 text-xs font-bold transition-all shadow-sm cursor-pointer"
                                                                >
                                                                    <Route size={13} /> Trace Circuit Path
                                                                </button>
                                                            </div>
                                                        )}

                                                        <div className="space-y-4 pt-2">
                                                            <div className="text-[10px] font-black text-text-muted uppercase tracking-widest flex items-center gap-2">
                                                                <CheckCircle size={14} className="text-green-500" /> Circuit Compliance
                                                            </div>
                                                            <div className="space-y-2">
                                                                <div className="flex items-center justify-between text-xs py-1 border-b border-border/40">
                                                                    <span className="text-text-muted">Status</span>
                                                                    <span className="font-bold text-green-500 uppercase">Operational</span>
                                                                </div>
                                                                <div className="flex items-center justify-between text-xs py-1 border-b border-border/40">
                                                                    <span className="text-text-muted">Network Type</span>
                                                                    <span className="font-bold text-text-primary uppercase tracking-tighter">
                                                                        {isCircuitMpls ? 'Private MPLS' : 'Public Internet'}
                                                                    </span>
                                                                </div>
                                                                <div className="flex items-center justify-between text-xs py-1">
                                                                    <span className="text-text-muted">Label</span>
                                                                    <span className="font-bold text-blue-500">{selectedObject.label || selectedObject.name || 'WAN Circuit'}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </>
                                                );
                                            })()}
                                        </div>
                                    )}
                                </div>

                                <div className="p-3 bg-card-secondary/50 border-t border-border mt-auto shrink-0">
                                    <div className="flex items-center justify-between bg-white/5 rounded-xl p-2.5 border border-white/5">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                            <span className="text-[9px] font-black text-text-muted uppercase tracking-widest">Health Synchronized</span>
                                        </div>
                                        <Info size={13} className="text-text-muted cursor-help" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Underlay Details Side Panel (Push Layout Split-Pane - 360px) */}
                    {showUnderlayPanel && underlayPanelResolution && (
                        <div className="w-[360px] h-full border-l border-amber-500/30 bg-card/95 backdrop-blur-xl flex flex-col z-30 shrink-0 shadow-2xl transition-all duration-300 animate-in slide-in-from-right overflow-hidden">
                            {(() => {
                                const r = underlayPanelResolution;
                                return (
                                    <div className="flex flex-col h-full min-h-0">
                                        <div className="p-4 border-b border-border bg-amber-500/5 flex items-center justify-between shrink-0">
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 shrink-0"><Layers size={16} /></div>
                                                <div className="min-w-0">
                                                    <h3 className="text-sm font-black text-text-primary tracking-tight truncate">Underlay Inspect</h3>
                                                    <p className="text-[9px] text-text-muted font-bold tracking-widest uppercase opacity-60 truncate">{r.prismaWan.interfaceName} · {r.prismaWan.siteName}</p>
                                                </div>
                                            </div>
                                            <button onClick={() => setShowUnderlayPanel(false)} className="p-1 hover:bg-card-secondary rounded-lg text-text-muted transition-colors shrink-0"><X size={18} /></button>
                                        </div>
                                        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-border min-h-0">
                                        {r.status === 'matched' && (
                                            <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-2xl px-4 py-3">
                                                <ShieldCheck size={18} className="text-green-400 shrink-0" />
                                                <div>
                                                    <div className="text-[10px] font-black text-green-400 uppercase tracking-widest">Confirmed Same-Subnet Match</div>
                                                    <div className="text-[9px] text-green-400/70 mt-0.5 font-mono">{r.matchedNetwork}</div>
                                                </div>
                                            </div>
                                        )}
                                        {r.status === 'no_match' && (
                                            <div className="flex items-center gap-2 bg-slate-500/10 border border-slate-500/20 rounded-2xl px-4 py-3">
                                                <HelpCircle size={18} className="text-slate-400 shrink-0" />
                                                <div>
                                                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">No Match Found</div>
                                                    <div className="text-[9px] text-slate-400/70 mt-0.5">{r.diagnostic}</div>
                                                </div>
                                            </div>
                                        )}
                                        {r.status === 'ambiguous' && (
                                            <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-3">
                                                <AlertTriangle size={18} className="text-amber-400 shrink-0" />
                                                <div>
                                                    <div className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Ambiguous — Multiple Candidates</div>
                                                    <div className="text-[9px] text-amber-400/70 mt-0.5">{r.candidates?.length} VyOS interfaces match this subnet</div>
                                                </div>
                                            </div>
                                        )}
                                        {(r.status === 'wan_ip_unavailable' || r.status === 'vyos_unavailable') && (
                                            <div className="flex items-center gap-2 bg-slate-500/10 border border-slate-500/20 rounded-2xl px-4 py-3">
                                                <Info size={18} className="text-slate-400 shrink-0" />
                                                <div>
                                                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{r.status === 'wan_ip_unavailable' ? 'WAN IP Unavailable' : 'VyOS Unavailable'}</div>
                                                    <div className="text-[9px] text-slate-400/70 mt-0.5">{r.diagnostic}</div>
                                                </div>
                                            </div>
                                        )}
                                         <div className="space-y-2">
                                             <div className="flex items-center justify-between">
                                                 <div className="text-[10px] font-black text-text-muted uppercase tracking-widest flex items-center gap-2"><GitBranch size={12} /> Prisma SD-WAN Interface</div>
                                                 {r.prismaWan.ip && (
                                                     <button
                                                         onClick={() => setTracerouteTarget(r.prismaWan.ip?.split('/')[0] || '')}
                                                         className="flex items-center gap-1 text-[10px] font-bold text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 px-2 py-0.5 rounded-md border border-blue-500/20 transition-colors"
                                                         title="Trace network path to WAN IP"
                                                     >
                                                         <Route size={11} /> Trace
                                                     </button>
                                                 )}
                                             </div>
                                             <div className="bg-card-secondary/30 border border-border/60 rounded-2xl p-4 space-y-2.5">
                                                 <div className="flex justify-between items-center text-xs"><span className="text-text-muted">Site</span><span className="font-black text-text-primary uppercase">{r.prismaWan.siteName}</span></div>
                                                 <div className="flex justify-between items-center text-xs"><span className="text-text-muted">Device</span><span className="font-bold text-text-secondary font-mono">{r.prismaWan.elementName}</span></div>
                                                 <div className="flex justify-between items-center text-xs"><span className="text-text-muted">Interface</span><span className="font-bold text-blue-400 font-mono uppercase">{r.prismaWan.interfaceName}</span></div>
                                                 <div className="flex justify-between items-center text-xs"><span className="text-text-muted">IP</span><span className="font-black text-text-primary font-mono">{r.prismaWan.ipCidr || r.prismaWan.ip || '—'}</span></div>
                                                 {r.prismaWan.linkType && (
                                                     <div className="flex justify-between items-center text-xs">
                                                         <span className="text-text-muted">Network</span>
                                                         <span className={cn("font-black text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-tighter", r.prismaWan.linkType.toLowerCase().includes('mpls') ? "text-purple-400 bg-purple-500/10 border-purple-500/30" : "text-blue-400 bg-blue-500/10 border-blue-500/30")}>{r.prismaWan.linkType}</span>
                                                     </div>
                                                 )}
                                                 {r.prismaWan.ipType === 'dhcp_ip_only' && (
                                                     <div className="text-[9px] text-amber-400/80 bg-amber-500/5 border border-amber-500/10 rounded-lg px-2 py-1 mt-1">DHCP — No prefix from Prisma. Matched using VyOS subnet as reference.</div>
                                                 )}
                                             </div>
                                         </div>
                                         {r.status === 'matched' && r.vyos && (
                                             <div className="space-y-2">
                                                 <div className="flex items-center justify-between">
                                                     <div className="text-[10px] font-black text-text-muted uppercase tracking-widest flex items-center gap-2"><Router size={12} className="text-amber-400" /> VyOS Next-Hop</div>
                                                     {r.vyos.ip && (
                                                         <button
                                                             onClick={() => setTracerouteTarget(r.vyos?.ip || '')}
                                                             className="flex items-center gap-1 text-[10px] font-bold text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 px-2 py-0.5 rounded-md border border-blue-500/20 transition-colors"
                                                             title="Trace network path to VyOS router"
                                                         >
                                                             <Route size={11} /> Trace
                                                         </button>
                                                     )}
                                                 </div>
                                                 <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 space-y-2.5">
                                                     <div className="flex justify-between items-center text-xs"><span className="text-text-muted">Router</span><span className="font-black text-text-primary">{r.vyos.routerName}</span></div>
                                                     {r.vyos.location && <div className="flex justify-between items-center text-xs"><span className="text-text-muted">Location</span><span className="font-bold text-text-secondary flex items-center gap-1"><MapPin size={10} />{r.vyos.location}</span></div>}
                                                     <div className="flex justify-between items-center text-xs"><span className="text-text-muted">Interface</span><span className="font-bold text-amber-400 font-mono">{r.vyos.interfaceName}</span></div>
                                                     <div className="flex justify-between items-center text-xs"><span className="text-text-muted">IP (VyOS)</span><span className="font-black text-text-primary font-mono">{r.vyos.ipCidr}</span></div>
                                                     <div className="flex justify-between items-center text-xs"><span className="text-text-muted">Network</span><span className="font-mono text-green-400 text-[11px]">{r.vyos.network}</span></div>
                                                     {r.vyos.description && <div className="flex justify-between items-start text-xs gap-2"><span className="text-text-muted shrink-0">Description</span><span className="font-medium text-text-secondary text-right leading-tight">{r.vyos.description}</span></div>}
                                                     {r.vyos.routerStatus && (
                                                         <div className="flex justify-between items-center text-xs">
                                                             <span className="text-text-muted">Status</span>
                                                             <span className={cn("font-black text-[9px] px-2 py-0.5 rounded-full border uppercase tracking-tighter", r.vyos.routerStatus === 'online' ? "text-green-400 bg-green-500/10 border-green-500/30" : "text-red-400 bg-red-500/10 border-red-500/30")}>{r.vyos.routerStatus}</span>
                                                         </div>
                                                     )}
                                                 </div>
                                                 {renderVyosControls(r)}
                                             </div>
                                         )}
                                        {r.status === 'ambiguous' && r.candidates && r.candidates.length > 0 && (
                                            <div className="space-y-2">
                                                <div className="text-[10px] font-black text-text-muted uppercase tracking-widest">Candidates ({r.candidates.length})</div>
                                                <div className="space-y-2">
                                                    {r.candidates.map((c, i) => (
                                                        <div key={i} className="bg-amber-500/5 border border-amber-500/10 rounded-xl p-3 space-y-1">
                                                            <div className="flex justify-between text-xs"><span className="font-bold text-text-primary">{c.routerName}</span><span className="font-mono text-amber-400 text-[10px]">{c.interfaceName}</span></div>
                                                            <div className="text-[10px] font-mono text-text-muted">{c.ipCidr} · {c.network}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <div className="p-4 bg-card-secondary/30 border-t border-border">
                                        <div className="text-[9px] text-text-muted/50 italic text-center">Match method: unique same-subnet IPv4/CIDR — no name inference</div>
                                    </div>
                                </div>
                            );
                        })()}
                        </div>
                    )}
                    </div>
                </>
            )}

            {/* Underlay Diagnostics Modal */}
            {showUnderlayDiagnostics && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
                    <div className="bg-card border border-border rounded-3xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="p-5 border-b border-border bg-card-secondary/30 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-3 rounded-2xl bg-amber-500/20 text-amber-400">
                                    <Layers size={22} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-lg font-black text-text-primary tracking-tight">Underlay Resolution Diagnostics</h2>
                                        {underlayData?.vyosConfigAvailable ? (
                                            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/30 uppercase tracking-wider">VyOS Config Active</span>
                                        ) : (
                                            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 uppercase tracking-wider">No VyOS Config</span>
                                        )}
                                    </div>
                                    <p className="text-xs text-text-muted mt-0.5">
                                        Deterministic IPv4 same-subnet next-hop matching between Prisma SD-WAN WAN circuits and VyOS underlay routers
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <a
                                    href="/api/topology/underlay-debug"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-2 bg-card-secondary hover:bg-card-secondary/80 border border-border text-text-muted hover:text-text-primary rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                                    title="Open raw JSON diagnostic payload"
                                >
                                    <ExternalLink size={14} />
                                    <span>Raw JSON</span>
                                </a>
                                <button
                                    onClick={() => setShowUnderlayDiagnostics(false)}
                                    className="p-2 hover:bg-card-secondary rounded-xl text-text-muted hover:text-text-primary transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        {/* Filter Bar & Search */}
                        <div className="p-4 border-b border-border bg-card/60 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                    onClick={() => setDiagnosticsFilter('ALL')}
                                    className={cn(
                                        "px-3 py-1.5 rounded-xl text-xs font-bold transition-all",
                                        diagnosticsFilter === 'ALL'
                                            ? "bg-primary text-primary-foreground shadow"
                                            : "bg-card-secondary text-text-muted hover:text-text-primary"
                                    )}
                                >
                                    All ({underlayData?.resolutions?.length || 0})
                                </button>
                                <button
                                    onClick={() => setDiagnosticsFilter('matched')}
                                    className={cn(
                                        "px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5",
                                        diagnosticsFilter === 'matched'
                                            ? "bg-green-500 text-white shadow"
                                            : "bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20"
                                    )}
                                >
                                    <span className="w-2 h-2 rounded-full bg-green-400" />
                                    Matched ({underlayData?.summary?.matched || 0})
                                </button>
                                <button
                                    onClick={() => setDiagnosticsFilter('no_match')}
                                    className={cn(
                                        "px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5",
                                        diagnosticsFilter === 'no_match'
                                            ? "bg-slate-400 text-slate-950 shadow"
                                            : "bg-card-secondary text-text-muted border border-border hover:text-text-primary"
                                    )}
                                >
                                    <span className="w-2 h-2 rounded-full bg-slate-400" />
                                    No Match ({underlayData?.summary?.noMatch || 0})
                                </button>
                                <button
                                    onClick={() => setDiagnosticsFilter('ambiguous')}
                                    className={cn(
                                        "px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5",
                                        diagnosticsFilter === 'ambiguous'
                                            ? "bg-amber-500 text-slate-950 shadow"
                                            : "bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20"
                                    )}
                                >
                                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                                    Ambiguous ({underlayData?.summary?.ambiguous || 0})
                                </button>
                                <button
                                    onClick={() => setDiagnosticsFilter('wan_ip_unavailable')}
                                    className={cn(
                                        "px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5",
                                        diagnosticsFilter === 'wan_ip_unavailable'
                                            ? "bg-slate-600 text-white shadow"
                                            : "bg-slate-500/10 text-slate-400 border border-slate-500/20 hover:bg-slate-500/20"
                                    )}
                                >
                                    <span className="w-2 h-2 rounded-full bg-slate-500" />
                                    IP Unknown ({underlayData?.summary?.wanIpUnavailable || 0})
                                </button>
                            </div>

                            <div className="relative w-full sm:w-64">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                                <input
                                    type="text"
                                    placeholder="Filter site, IP, interface..."
                                    value={diagnosticsSearch}
                                    onChange={(e) => setDiagnosticsSearch(e.target.value)}
                                    className="w-full pl-9 pr-3 py-1.5 bg-card-secondary/60 border border-border rounded-xl text-xs text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-amber-500/50"
                                />
                                {diagnosticsSearch && (
                                    <button
                                        onClick={() => setDiagnosticsSearch('')}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Table Body */}
                        <div className="flex-1 overflow-y-auto overflow-x-auto p-4 scrollbar-thin scrollbar-thumb-border">
                            {(!underlayData?.resolutions || underlayData.resolutions.length === 0) ? (
                                <div className="text-center py-16 text-text-muted">
                                    <HelpCircle size={36} className="mx-auto text-text-muted/40 mb-3" />
                                    <p className="text-sm font-bold">No WAN interface resolutions available</p>
                                    <p className="text-xs text-text-muted/60 mt-1">Make sure topology data has been loaded and try refreshing.</p>
                                </div>
                            ) : (
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                        <tr className="border-b border-border text-[10px] font-black text-text-muted uppercase tracking-wider bg-card-secondary/20">
                                            <th className="p-3">Site / Device</th>
                                            <th className="p-3">Prisma Circuit</th>
                                            <th className="p-3">Prisma IP / Subnet</th>
                                            <th className="p-3">Status</th>
                                            <th className="p-3">VyOS Next-Hop Router</th>
                                            <th className="p-3">VyOS Interface & Network</th>
                                            <th className="p-3">Diagnostic</th>
                                            <th className="p-3 text-right">Inspect</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/60 font-sans">
                                        {underlayData.resolutions
                                            .filter(r => {
                                                if (diagnosticsFilter !== 'ALL' && r.status !== diagnosticsFilter) return false;
                                                if (!diagnosticsSearch) return true;
                                                const q = diagnosticsSearch.toLowerCase();
                                                return (
                                                    (r.prismaWan.siteName || '').toLowerCase().includes(q) ||
                                                    (r.prismaWan.elementName || '').toLowerCase().includes(q) ||
                                                    (r.prismaWan.interfaceName || '').toLowerCase().includes(q) ||
                                                    (r.prismaWan.ipCidr || '').toLowerCase().includes(q) ||
                                                    (r.prismaWan.ip || '').toLowerCase().includes(q) ||
                                                    (r.vyos?.routerName || '').toLowerCase().includes(q) ||
                                                    (r.vyos?.interfaceName || '').toLowerCase().includes(q) ||
                                                    (r.vyos?.network || '').toLowerCase().includes(q) ||
                                                    (r.diagnostic || '').toLowerCase().includes(q)
                                                );
                                            })
                                            .map((r, idx) => (
                                                <tr key={r.id || idx} className="hover:bg-card-secondary/40 transition-colors">
                                                    <td className="p-3">
                                                        <div className="font-black text-text-primary">{r.prismaWan.siteName}</div>
                                                        <div className="text-[10px] text-text-muted font-mono">{r.prismaWan.elementName}</div>
                                                    </td>
                                                    <td className="p-3">
                                                        <div className="font-bold text-blue-400 font-mono">{r.prismaWan.interfaceName}</div>
                                                        {r.prismaWan.linkType && (
                                                            <div className={cn(
                                                                "text-[9px] font-bold px-1.5 py-0.2 rounded inline-block mt-0.5 border uppercase",
                                                                r.prismaWan.linkType.toLowerCase().includes('mpls')
                                                                    ? "text-purple-400 bg-purple-500/10 border-purple-500/20"
                                                                    : "text-blue-400 bg-blue-500/10 border-blue-500/20"
                                                            )}>
                                                                {r.prismaWan.linkType}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="p-3">
                                                        <div className="font-mono font-black text-text-primary text-[11px]">
                                                            {r.prismaWan.ipCidr || r.prismaWan.ip || '—'}
                                                        </div>
                                                        {r.prismaWan.ipType === 'dhcp_ip_only' && (
                                                            <span className="text-[9px] text-amber-400/80 font-mono">DHCP (Host IP)</span>
                                                        )}
                                                    </td>
                                                    <td className="p-3">
                                                        {r.status === 'matched' && (
                                                            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/30 uppercase">
                                                                <Check size={10} /> Matched
                                                            </span>
                                                        )}
                                                        {r.status === 'no_match' && (
                                                            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/30 uppercase">
                                                                No Match
                                                            </span>
                                                        )}
                                                        {r.status === 'ambiguous' && (
                                                            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 uppercase">
                                                                <AlertTriangle size={10} /> Ambiguous ({r.candidates?.length})
                                                            </span>
                                                        )}
                                                        {r.status === 'wan_ip_unavailable' && (
                                                            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-500 border border-slate-500/20 uppercase">
                                                                IP Unknown
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="p-3">
                                                        {r.vyos ? (
                                                            <div>
                                                                <div className="font-black text-text-primary flex items-center gap-1">
                                                                    <Router size={12} className="text-amber-400" />
                                                                    {r.vyos.routerName}
                                                                </div>
                                                                {r.vyos.location && (
                                                                    <div className="text-[10px] text-text-muted">{r.vyos.location}</div>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <span className="text-text-muted/40 font-mono">—</span>
                                                        )}
                                                    </td>
                                                    <td className="p-3">
                                                        {r.vyos ? (
                                                            <div>
                                                                <div className="font-mono font-bold text-amber-400 text-[11px]">
                                                                    {r.vyos.interfaceName} · {r.vyos.ipCidr}
                                                                </div>
                                                                <div className="text-[10px] font-mono text-green-400/80">
                                                                    Subnet: {r.vyos.network}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <span className="text-text-muted/40 font-mono">—</span>
                                                        )}
                                                    </td>
                                                    <td className="p-3 max-w-xs">
                                                        <div className="text-[10px] text-text-muted line-clamp-2" title={r.diagnostic}>
                                                            {r.diagnostic}
                                                        </div>
                                                    </td>
                                                    <td className="p-3 text-right">
                                                        <div className="flex items-center justify-end gap-1.5">
                                                            {(r.vyos?.ip || r.prismaWan?.ip) && (
                                                                <button
                                                                    onClick={() => setTracerouteTarget(r.vyos?.ip || r.prismaWan?.ip?.split('/')[0] || '')}
                                                                    className="p-1.5 hover:bg-blue-500/10 text-text-muted hover:text-blue-400 rounded-lg transition-colors inline-flex items-center gap-1 text-[11px] font-bold cursor-pointer"
                                                                    title="Trace route to this interface"
                                                                >
                                                                    <Route size={13} />
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={() => {
                                                                    setUnderlayPanelResolution(r);
                                                                    setShowUnderlayPanel(true);
                                                                    setShowUnderlayDiagnostics(false);
                                                                }}
                                                                className="p-1.5 hover:bg-amber-500/10 text-text-muted hover:text-amber-400 rounded-lg transition-colors inline-flex items-center gap-1 text-[11px] font-bold cursor-pointer"
                                                                title="Inspect circuit in side panel"
                                                            >
                                                                <Eye size={13} />
                                                                <span>Inspect</span>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                    </tbody>
                                </table>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="p-3 border-t border-border bg-card-secondary/20 flex items-center justify-between text-xs text-text-muted">
                            <div className="flex items-center gap-4 text-[11px]">
                                <span>Total WAN circuits: <strong className="text-text-primary">{underlayData?.summary?.wanInterfacesSeen || 0}</strong></span>
                                <span className="text-green-400 font-bold">{underlayData?.summary?.matched || 0} Matched</span>
                                <span className="text-slate-400 font-bold">{underlayData?.summary?.noMatch || 0} No Match</span>
                                <span className="text-amber-400 font-bold">{underlayData?.summary?.ambiguous || 0} Ambiguous</span>
                            </div>
                            <div className="text-[10px] text-text-muted/60 italic">
                                Strict same-subnet IPv4 matching via ipaddr.js — Zero credential exposure
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Interactive Physical Link Trace Inspector (Compact Centered Action Modal) */}
            {underlayDrawerResolution && (() => {
                const isLanScope = underlayDrawerResolution.scope === 'lan';
                const isIonConnectedPort = underlayDrawerResolution.prismaWan.linkType !== 'LAN-EGRESS';
                const lanRouterEntry = isLanScope && underlayDrawerResolution.vyos?.routerName
                    ? (siteLanVyosMap.get(underlayDrawerResolution.prismaWan.siteName || '') || []).find(
                        (e: any) => e.routerName === underlayDrawerResolution.vyos?.routerName || e.name === underlayDrawerResolution.vyos?.routerName
                    )
                    : null;
                const currentIfItem = (lanRouterEntry?.interfaceItems || []).find(
                    (item: any) => item.ifName === underlayDrawerResolution.vyos?.interfaceName
                );
                const portRoleLabel = currentIfItem?.roleLabel || (isIonConnectedPort ? (isLanScope ? 'ION LAN' : 'WAN') : 'EGRESS / SUBNET');

                return (
                <div 
                    className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
                    onClick={() => setUnderlayDrawerResolution(null)}
                >
                    <div 
                        className="w-full max-w-md bg-card/95 backdrop-blur-2xl border-2 border-amber-500/40 rounded-3xl p-5 sm:p-6 shadow-2xl shadow-black/60 space-y-4 text-text-primary animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between pb-3 border-b border-border/70">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className="p-2 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 flex-shrink-0">
                                    {isLanScope ? <Router size={18} /> : <Activity size={18} />}
                                </div>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-sm font-black uppercase text-text-primary tracking-wider">
                                            {isIonConnectedPort
                                                ? (isLanScope ? 'ION LAN Link Control' : 'WAN Link Details')
                                                : `Port ${underlayDrawerResolution.vyos?.interfaceName || ''} Control`}
                                        </h3>
                                        {isIonConnectedPort ? (
                                            underlayDrawerResolution.status === 'matched' ? (
                                                <span 
                                                    className="text-[9px] font-black px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 inline-flex items-center gap-1"
                                                    title={`Subnet Correlated: ${underlayDrawerResolution.matchedNetwork || ''}`}
                                                >
                                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> {isLanScope ? 'ION LAN LINK' : 'LINK CONNECTED'}
                                                </span>
                                            ) : (
                                                <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-card-secondary text-text-muted border border-border">
                                                    UNMAPPED
                                                </span>
                                            )
                                        ) : (
                                            <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30">
                                                {portRoleLabel}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-text-muted font-mono truncate max-w-[340px] mt-0.5">
                                        {isIonConnectedPort
                                            ? `${underlayDrawerResolution.prismaWan.siteName} (${underlayDrawerResolution.prismaWan.interfaceName}) ⟷ ${underlayDrawerResolution.vyos?.routerName || 'External WAN'}${underlayDrawerResolution.vyos ? ` (${underlayDrawerResolution.vyos.interfaceName})` : ''}`
                                            : `${underlayDrawerResolution.vyos?.routerName || 'VyOS'} · ${underlayDrawerResolution.vyos?.interfaceName || ''} (${underlayDrawerResolution.vyos?.ipCidr || underlayDrawerResolution.vyos?.ip || '—'})`}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setUnderlayDrawerResolution(null)}
                                className="p-1.5 hover:bg-card-secondary rounded-xl transition-colors text-text-muted hover:text-text-primary cursor-pointer border border-transparent hover:border-border/50"
                                title="Close"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Top: Interactive Action Controls (Immediate access under user focus!) */}
                        {renderVyosControls(underlayDrawerResolution)}

                        {/* Middle: Correlation Specs (2 columns if connected to Prisma ION, 1 clean card if standalone VyOS port) */}
                        <div className={cn("grid gap-3 text-xs", isIonConnectedPort ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1")}>
                            {/* Left: Prisma SD-WAN ION Port (ONLY shown when this port is actually connected to a Prisma ION) */}
                            {isIonConnectedPort && (
                                <div className="bg-blue-500/10 border border-blue-500/25 rounded-2xl p-3.5 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-black uppercase text-blue-600 dark:text-blue-400 tracking-wider flex items-center gap-1">
                                            <Home size={12} /> Prisma ION
                                        </span>
                                        <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-500/30">
                                            {underlayDrawerResolution.prismaWan.siteName}
                                        </span>
                                    </div>
                                    <div className="text-[11px] font-mono space-y-1.5 pt-1">
                                        <div className="flex justify-between items-center">
                                            <span className="text-text-muted">{isLanScope ? 'ION Port:' : 'Circuit:'}</span>
                                            <strong className="text-text-primary truncate max-w-[120px]">{underlayDrawerResolution.prismaWan.interfaceName}</strong>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-text-muted">Type:</span>
                                            <strong className="text-blue-600 dark:text-blue-400 uppercase">{underlayDrawerResolution.prismaWan.linkType || (isLanScope ? 'LAN' : 'WAN')}</strong>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-text-muted">ION IP:</span>
                                            <strong className="text-emerald-600 dark:text-emerald-400">{underlayDrawerResolution.prismaWan.ipCidr || underlayDrawerResolution.prismaWan.ip || '—'}</strong>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Right (or Full): VyOS Router Port */}
                            <div className="bg-amber-500/10 border border-amber-500/25 rounded-2xl p-3.5 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black uppercase text-amber-600 dark:text-amber-400 tracking-wider flex items-center gap-1">
                                        <Server size={12} /> VyOS Interface
                                    </span>
                                    <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                                        {underlayDrawerResolution.vyos?.routerName || 'External'}
                                    </span>
                                </div>
                                <div className="text-[11px] font-mono space-y-1.5 pt-1">
                                    <div className="flex justify-between items-center">
                                        <span className="text-text-muted">Port:</span>
                                        <strong className="text-text-primary">{underlayDrawerResolution.vyos?.interfaceName || '—'}</strong>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-text-muted">{isLanScope ? 'VyOS IP:' : 'Next-Hop:'}</span>
                                        <strong className="text-emerald-600 dark:text-emerald-400">{underlayDrawerResolution.vyos?.ipCidr || underlayDrawerResolution.vyos?.ip || '—'}</strong>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-text-muted">Subnet:</span>
                                        <strong className="text-amber-600 dark:text-amber-300">{underlayDrawerResolution.matchedNetwork || underlayDrawerResolution.vyos?.network || '—'}</strong>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-text-muted">Status:</span>
                                        {underlayDrawerResolution.vyos ? (
                                            getVyosInterfaceStatus(underlayDrawerResolution.vyos.routerName, underlayDrawerResolution.vyos.interfaceName) === 'down' ? (
                                                <span className="text-rose-500 font-bold flex items-center gap-1">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.6)]" /> SHUT
                                                </span>
                                            ) : (
                                                <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" /> UP
                                                </span>
                                            )
                                        ) : (
                                            <span className="text-text-muted">—</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                );
            })()}

            {/* Interactive Netem QoS Modal */}
            {showNetemModal && netemTarget && (
                <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
                    <div className="w-full max-w-md bg-card/95 backdrop-blur-2xl border-2 border-amber-500/40 rounded-3xl p-6 shadow-2xl space-y-5 text-text-primary">
                        <div className="flex items-center justify-between pb-3 border-b border-border">
                            <div className="flex items-center gap-2.5">
                                <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400">
                                    <Sliders size={18} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-black uppercase tracking-wider text-text-primary">Inject WAN Impairment</h3>
                                    <p className="text-[10px] text-text-muted font-mono">{netemTarget.routerName} · Port {netemTarget.interfaceName} ({netemTarget.siteName || 'Circuit'})</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowNetemModal(false)}
                                className="p-1.5 hover:bg-card-secondary rounded-lg text-text-muted transition-colors cursor-pointer"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Latency Section */}
                        <div className="space-y-2">
                            <div className="flex justify-between items-center text-xs">
                                <span className="font-bold text-text-secondary">Added Latency (ms):</span>
                                <span className="font-mono font-bold text-amber-500 text-sm">+{netemLatency} ms</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="500"
                                step="10"
                                value={netemLatency}
                                onChange={e => setNetemLatency(parseInt(e.target.value, 10))}
                                className="w-full accent-amber-500 cursor-pointer"
                            />
                            <div className="flex gap-1.5 justify-between">
                                {[0, 25, 50, 100, 200, 350].map(val => (
                                    <button
                                        key={val}
                                        type="button"
                                        onClick={() => setNetemLatency(val)}
                                        className={cn(
                                            "px-2 py-1 rounded-lg text-[10px] font-mono font-bold border transition-all cursor-pointer",
                                            netemLatency === val
                                                ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                                                : "bg-card-secondary text-text-muted border-border hover:text-text-primary"
                                        )}
                                    >
                                        {val === 0 ? '0ms' : `+${val}ms`}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Packet Loss Section */}
                        <div className="space-y-2">
                            <div className="flex justify-between items-center text-xs">
                                <span className="font-bold text-text-secondary">Packet Loss (%):</span>
                                <span className="font-mono font-bold text-rose-500 text-sm">{netemLoss}%</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="50"
                                step="1"
                                value={netemLoss}
                                onChange={e => setNetemLoss(parseInt(e.target.value, 10))}
                                className="w-full accent-rose-500 cursor-pointer"
                            />
                            <div className="flex gap-1.5 justify-between">
                                {[0, 1, 3, 5, 10, 20].map(val => (
                                    <button
                                        key={val}
                                        type="button"
                                        onClick={() => setNetemLoss(val)}
                                        className={cn(
                                            "px-2 py-1 rounded-lg text-[10px] font-mono font-bold border transition-all cursor-pointer",
                                            netemLoss === val
                                                ? "bg-rose-500/20 text-rose-400 border-rose-500/40"
                                                : "bg-card-secondary text-text-muted border-border hover:text-text-primary"
                                        )}
                                    >
                                        {val}%
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Interactive Progress Indicator while applying */}
                        {isVyosExecuting && (
                            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-1.5 animate-fadeIn">
                                <div className="flex items-center justify-between text-xs font-mono">
                                    <span className="flex items-center gap-2 font-bold text-amber-700 dark:text-amber-300">
                                        <Loader2 size={14} className="animate-spin text-amber-500" />
                                        Applying Netem rules via VyOS API...
                                    </span>
                                    <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold">~3-4s</span>
                                </div>
                                <div className="h-1.5 w-full bg-amber-500/20 rounded-full overflow-hidden relative">
                                    <div className="h-full bg-amber-500 rounded-full animate-laser w-2/3" />
                                </div>
                            </div>
                        )}

                        {/* Modal Action Buttons */}
                        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
                            <button
                                type="button"
                                disabled={isVyosExecuting}
                                onClick={() => setShowNetemModal(false)}
                                className="px-4 py-2 bg-card-secondary hover:bg-card-hover text-text-muted hover:text-text-primary rounded-xl text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => handleVyosDirectAction(
                                    netemTarget.routerName,
                                    netemTarget.interfaceName,
                                    'set-qos',
                                    { latency: netemLatency, loss: netemLoss },
                                    netemTarget.siteName
                                )}
                                disabled={isVyosExecuting}
                                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-slate-950 font-black rounded-xl text-xs flex items-center gap-2 transition-all shadow-md shadow-amber-900/20 cursor-pointer disabled:cursor-wait"
                            >
                                {isVyosExecuting ? (
                                    <>
                                        <Loader2 size={14} className="animate-spin text-slate-950" />
                                        <span>Applying Impairment (~3s)...</span>
                                    </>
                                ) : (
                                    <>
                                        <Zap size={14} className="fill-slate-950" />
                                        <span>Apply to {netemTarget.interfaceName}</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* VyOS Router-level Traffic Control Modal */}
            <VyosTrafficControlModal
                isOpen={selectedRouterForTrafficControl !== null}
                onClose={() => setSelectedRouterForTrafficControl(null)}
                router={selectedRouterForTrafficControl}
                discoveredSites={discoveredSitesForVyos}
                onExecuteAction={(routerName, command, params) => 
                    handleVyosDirectAction(routerName, undefined, command, params)
                }
                isExecuting={isVyosExecuting}
            />

            {/* Traceroute Modal */}
            <TracerouteModal
                isOpen={tracerouteTarget !== null}
                onClose={() => setTracerouteTarget(null)}
                initialTarget={tracerouteTarget || ''}
                token={token}
                title="Topology Path Trace"
            />
        </div>
    );
}
