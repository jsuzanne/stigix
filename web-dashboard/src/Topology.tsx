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
    Maximize
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { TracerouteModal } from './components/TracerouteModal';

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
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
    };
    resolutions: UnderlayResolution[];
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
            <BaseEdge path={edgePath} markerEnd={markerEnd} style={{ ...style, stroke: strokeColor }} />
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

    // Status color coding for port badges
    if (status === 'up') bgClass = "bg-green-500/20 border-green-500/50 text-green-400";
    if (status === 'down') bgClass = "bg-red-500/20 border-red-500/50 text-red-500";

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

// --- Custom Site Node Component (The "Physical" Schematic) ---
const SiteNode = ({ data }: any) => {
    const isHub = data.role === 'HUB';
    const devices = data.devices || [];

    // Map circuit data for the "Circuit Blocks" (intermediaries to clouds)
    const wanCircuits = devices.flatMap((d: any) =>
        (d.wan_interfaces || []).map((w: any) => ({ ...w, devName: d.device_name }))
    );

    const lanInterfaces = devices.flatMap((d: any) =>
        (d.lan_interfaces || []).map((l: any) => ({ ...l, devName: d.device_name }))
    );

    // Aggregate ALL LAN subnets across ALL devices in this site
    const allLanSubnets = new Set<string>();
    devices.forEach((d: any) => {
        d.lan_interfaces?.forEach((l: any) => {
            if (l.ip) {
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

    // Subnet Pill Renderer: highlights the subnet hosting a Stigix node in high-tech Blue with Stigix symbol
    const renderSubnetPill = (subnet: string, sIdx: number) => {
        const stigixNode = fleetNodes.find((n: any) => {
            if (isIpInSubnet(n.ip, subnet) || isIpInSubnet(n.ip_private, subnet)) return true;
            if (isExactSiteMatch(data.name, n.name || n.id || n.site)) {
                const hasDirectIpMatch = uniqueSubeNets.some(s => isIpInSubnet(n.ip, s) || isIpInSubnet(n.ip_private, s));
                if (!hasDirectIpMatch && sIdx === 0) return true;
            }
            return false;
        });

        if (stigixNode) {
            const isLeader = Boolean(stigixNode.is_leader || stigixNode.role === 'LEADER' || (stigixNode.id && stigixNode.id.toLowerCase().includes('dc1') && !stigixNode.id.toLowerCase().includes('dc2')));
            return (
                <div
                    key={sIdx}
                    className="bg-blue-600/20 px-3.5 py-1 rounded-xl border-2 border-blue-400 text-[11px] font-mono font-bold text-blue-200 shadow-lg shadow-blue-500/25 relative z-10 group transition-all hover:scale-105 hover:bg-blue-500/30 hover:border-blue-300 flex items-center gap-2 cursor-pointer h-[32px]"
                    title={`⚡ Stigix SASE Agent: ${stigixNode.name || stigixNode.id} (${stigixNode.ip || stigixNode.ip_private}) • ${isLeader ? 'LEADER' : 'PEER'}`}
                >
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                    </span>
                    <Zap size={13} className="text-blue-300" />
                    <span>{subnet}</span>
                    <span className="text-[8px] px-1.5 py-0.5 rounded bg-blue-400/25 border border-blue-300/40 text-blue-100 uppercase font-black tracking-wider ml-0.5">
                        {isLeader ? 'LEADER' : 'PEER'}
                    </span>
                </div>
            );
        }

        return (
            <div
                key={sIdx}
                className="bg-green-500/10 px-3 py-1 rounded-xl border border-green-500/30 text-[11px] font-mono font-bold text-green-400 shadow-md shadow-green-500/10 relative z-10 group transition-all hover:scale-105 hover:bg-green-500/20 hover:border-green-500 h-[30px] flex items-center cursor-default"
            >
                {subnet}
            </div>
        );
    };

    return (
        <div className={cn(
            "flex flex-col items-center w-full gap-5",
            isHub ? "flex-col-reverse" : "flex-col"
        )}>

            {/* Circuit Blocks Section */}
            <div className="flex gap-4 z-10 relative">
                {wanCircuits.map((w: any, idx: number) => {
                    const badge = getUnderlayBadge(w);
                    return (
                        <div key={idx} className="relative flex flex-col items-center">
                            <div
                                className={cn(
                                    "px-3.5 py-1.5 rounded-xl border shadow-2xl backdrop-blur-md flex flex-col items-center justify-center gap-0.5 min-w-[120px] h-[48px] transition-all hover:scale-105 hover:border-white/40 group",
                                    w.wan_network?.toLowerCase().includes('mpls')
                                        ? "bg-purple-500/10 border-purple-500/30 text-purple-400"
                                        : "bg-blue-500/10 border-blue-500/30 text-blue-400",
                                    badge && onInspectUnderlayCircuit ? "cursor-pointer" : ""
                                )}
                                onClick={badge && onInspectUnderlayCircuit ? (e) => { e.stopPropagation(); onInspectUnderlayCircuit(badge.r); } : undefined}
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
                                    <div className={cn(
                                        "absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full border flex items-center justify-center text-[9px] font-black shadow-md z-30 transition-transform group-hover:scale-110",
                                        badge.c.cls
                                    )}>
                                        {badge.c.label}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>


            {/* Site Rectangle (Physical Box) */}
            <div className={cn(
                "px-8 py-7 rounded-[36px] border-2 transition-all shadow-2xl backdrop-blur-3xl bg-card/40 flex flex-col relative w-full",
                isHub ? "border-blue-500/30 shadow-blue-500/5 shadow-[0_0_50px_-12px_rgba(59,130,246,0.15)]" : "border-border shadow-black/40 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.5)]"
            )}>

                {/* SVG Layer for ALL internal wiring (1:1 Exact Math Coordinates) */}
                <svg className="absolute top-0 left-1/2 overflow-visible z-0" width="1" height="1">
                    {devices.map((dev: any, dIdx: number) => {
                        const deviceCount = devices.length;
                        const devX = (dIdx - (deviceCount - 1) / 2) * 272; // 208 (w-52) + 64 (gap-16)

                        return (
                            <React.Fragment key={dIdx}>
                                {/* WAN Wiring (Port -> Circuit Block) */}
                                {dev.wan_interfaces?.map((wan: any, wIdx: number) => {
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
                                                ? `M ${portX} 350 L ${blockX} 420` // Hub: Bottom Port down to Circuit Block
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

                                {/* LAN Wiring */}
                                {isHub ? (
                                    // Hub: Shared LAN Block (top Y=95) down to LAN Port 3 (Y=110)
                                    <path
                                        d={deviceCount === 1
                                            ? `M 0 95 L 0 110`
                                            : `M 0 95 L 0 102 M 0 102 L ${devX} 102 L ${devX} 110`
                                        }
                                        stroke="rgba(34, 197, 94, 0.45)"
                                        strokeWidth="2"
                                        fill="none"
                                        strokeLinejoin="round"
                                        strokeLinecap="round"
                                        strokeDasharray="4 4"
                                    />
                                ) : (
                                    // Spoke: LAN Port 3 (Y=248) down to Shared LAN Box (Y=274)
                                    <path
                                        d={deviceCount === 1
                                            ? `M 0 248 L 0 274`
                                            : `M ${devX} 248 L ${devX} 262 L 0 262 M 0 262 L 0 274`
                                        }
                                        stroke="rgba(34, 197, 94, 0.45)"
                                        strokeWidth="2"
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

                {/* Hub-Specific: Shared LAN Block at the Top */}
                {isHub && (
                    <div className="flex flex-col items-center justify-end mb-6 relative z-10">
                        <div className="absolute inset-x-0 -top-6 flex justify-center w-full z-0 overflow-hidden pointer-events-none">
                            <div className="text-[72px] font-black text-white/[0.02] select-none uppercase tracking-[0.2em] whitespace-nowrap px-6">{data.name}</div>
                        </div>
                        <div className="text-[20px] font-black text-text-primary uppercase tracking-[0.4em] opacity-85 mb-3 drop-shadow-lg relative z-10">{data.name}</div>
                        <div className="flex gap-2.5 items-center justify-center flex-wrap max-w-full">
                            {uniqueSubeNets.map((subnet, sIdx) => renderSubnetPill(subnet, sIdx))}
                        </div>
                    </div>
                )}

                {/* Horizontal Device Clusters */}
                <div className="flex items-center justify-center gap-16 relative z-10 w-full mb-8">
                    {devices.map((dev: any, dIdx: number) => (
                        <div key={dIdx} className="flex flex-col items-center group relative">

                            {/* Router Block (Fixed Height h-[220px]) */}
                            <div className={cn(
                                "w-52 h-[220px] rounded-[40px] border-2 flex flex-col items-center justify-center gap-4 transition-all group-hover:scale-105 group-hover:border-blue-500/50 group-hover:shadow-[0_20px_50px_-10px_rgba(59,130,246,0.3)] relative z-10",
                                isHub ? "bg-blue-600/10 border-blue-500/30 shadow-blue-500/10" : "bg-card-secondary/40 border-border/80"
                            )}>

                                {/* HUB: LAN Port Top */}
                                {isHub && (
                                    <div className="absolute -top-[10px] w-full flex justify-center z-20">
                                        <Port num="3" label={shortIp(dev.lan_interfaces?.[0]?.ip)} status={getStatus(dev.lan_interfaces?.[0])} labelPosition="bottom" />
                                    </div>
                                )}

                                {/* SPOKE: WAN Ports Top */}
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
                                    isHub ? "bg-blue-500 text-white shadow-blue-500/40" : "bg-card text-blue-500 shadow-black/20"
                                    )}>
                                    {isHub ? <Server size={28} /> : <Home size={28} />}
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

                                {/* SPOKE: LAN Port Bottom */}
                                {!isHub && (
                                    <div className="absolute -bottom-[10px] w-full flex justify-center z-20">
                                        <Port num="3" label={shortIp(dev.lan_interfaces?.[0]?.ip)} status={getStatus(dev.lan_interfaces?.[0])} labelPosition="top" />
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Spoke-Specific: Shared LAN Block at the Bottom */}
                {!isHub && (
                    <div className="flex flex-col items-center relative z-20 w-full mb-2">
                        <div className="flex gap-2.5 items-center justify-center flex-wrap max-w-full">
                            {uniqueSubeNets.map((subnet, sIdx) => renderSubnetPill(subnet, sIdx))}
                        </div>
                        <div className="absolute inset-x-0 -bottom-6 flex justify-center w-full z-0 overflow-hidden pointer-events-none">
                            <div className="text-[72px] font-black text-white/[0.02] select-none uppercase tracking-[0.2em] whitespace-nowrap px-6">{data.name}</div>
                        </div>
                        <div className="text-[20px] font-black text-text-primary uppercase tracking-[0.4em] opacity-85 mt-4 drop-shadow-lg relative z-10">{data.name}</div>
                    </div>
                )}
            </div>
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
                        ? (isSelected ? "bg-sky-500/30 border-sky-400 text-sky-200" : "bg-sky-500/15 border-sky-500/30 text-sky-300")
                        : (isSelected ? "bg-purple-500/30 border-purple-400 text-purple-200" : "bg-purple-500/15 border-purple-500/30 text-purple-300")
                )}>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>{tunnelsUp || 0} / {tunnelsTotal} Tunnels</span>
                </div>
            )}
        </div>
    );
};

const VyOSRouterNode = ({ data }: any) => {
    const { router, connectedCount = 0, resolutions = [], siteOrder = new Map(), onSelectResolution } = data;
    const isOnline = router.status !== 'down';

    // Group resolutions into Hub-connected and Spoke-connected
    const hubResolutions = resolutions.filter((r: any) => r.isHub);
    const spokeResolutions = resolutions.filter((r: any) => !r.isHub);

    // Identify interfaces for this router
    const allIfaces = router.interfaces || [];

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
                    "relative px-4 py-3 rounded-2xl border text-[11px] transition-all flex flex-col justify-between group/port min-w-[195px] max-w-[230px] min-h-[76px] gap-1.5 shadow-sm",
                    isConnected 
                        ? (isIfaceUp
                            ? "bg-card border-amber-500/50 hover:border-amber-400 hover:bg-card-secondary/70 shadow-md shadow-amber-500/10 cursor-pointer"
                            : "bg-rose-950/20 border-rose-500/50 hover:border-rose-400 hover:bg-rose-950/30 shadow-md shadow-rose-500/10 cursor-pointer") 
                        : "bg-card-secondary/40 border-border text-text-muted opacity-40 cursor-default"
                )}
                title={matchedRes ? `Connected to ${matchedRes.prismaWan.siteName} (${matchedRes.prismaWan.interfaceName}) · Click to inspect` : (iface.description || iface.name)}
            >
                {/* Dedicated ReactFlow Handle for direct 1:1 cable termination */}
                <Handle
                    type="target"
                    position={isTop ? Position.Top : Position.Bottom}
                    id={`vyos-port:${iface.name}`}
                    className="!w-3.5 !h-1.5 !bg-amber-500 dark:!bg-amber-400 !border !border-card !rounded-sm"
                />

                <div className="flex items-center justify-between pb-1 border-b border-border/50">
                    <span className="font-mono font-black text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                        <span className={cn("w-2.5 h-2.5 rounded-full", isConnected ? (isIfaceUp ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.8)]" : "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]") : "bg-slate-400 dark:bg-slate-600")} />
                        {iface.name}
                    </span>
                    <div className="flex items-center gap-1">
                        {hasQos && (
                            <span className="text-[8px] font-black px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40">
                                ⏱️ +{portQos.latency || 0}ms
                            </span>
                        )}
                        {isConnected && (
                            <span className="text-[9px] font-black px-1.5 py-0.2 rounded bg-green-500/15 text-green-700 dark:text-green-300 border border-green-500/30 truncate max-w-[85px]">
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
                    <div className="flex items-center justify-between text-[10px] font-black text-amber-600 dark:text-amber-400/90 uppercase tracking-wider px-1">
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
                            <span className="text-[9px] font-bold text-green-600 dark:text-green-400 uppercase tracking-widest">
                                {isOnline ? 'ONLINE' : 'OFFLINE'}
                            </span>
                        </div>
                        <div className="text-xs text-amber-600 dark:text-amber-400 font-mono font-bold mt-0.5">
                            Mgmt IP: {router.host}
                        </div>
                    </div>
                </div>

                <div className="text-right">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-700 dark:text-amber-300 text-[10px] font-black uppercase tracking-wider">
                        <span>{connectedCount} Circuits</span>
                    </div>
                    {router.location && (
                        <div className="text-[10px] text-text-muted mt-1 font-mono">
                            {router.location}
                        </div>
                    )}
                </div>
            </div>

            {/* BOTTOM ROW: Spoke-facing Physical Ports (Facing Branches at bottom) */}
            {displayBottomIfaces.length > 0 && (
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-[10px] font-black text-amber-600 dark:text-amber-400/90 uppercase tracking-wider px-1">
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
            "px-5 py-4 rounded-3xl border-2 transition-all shadow-2xl backdrop-blur-2xl flex flex-col items-center gap-2.5 w-[330px] max-w-[330px] cursor-pointer hover:scale-105 duration-200 select-none",
            isPrisma
                ? (isHealthy ? "bg-purple-950/40 border-purple-500/50 shadow-purple-500/20 hover:border-purple-400" : "bg-purple-950/20 border-purple-500/30")
                : (isHealthy ? "bg-blue-950/40 border-blue-500/50 shadow-blue-500/20 hover:border-blue-400" : "bg-rose-950/30 border-rose-500/40 shadow-rose-500/10"),
            selected && (isPrisma ? "ring-4 ring-purple-400 shadow-purple-500/50" : "ring-4 ring-blue-400 shadow-blue-500/50")
        )}>
            <Handle type="target" position={Position.Top} id="target-top" className="!opacity-0" />
            <Handle type="target" position={Position.Bottom} id="target-bottom" className="!opacity-0" />

            {/* Provider & Health Header */}
            <div className="flex items-center justify-between w-full gap-2">
                <div className="flex items-center gap-1.5">
                    {isPrisma ? (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border bg-purple-500/20 text-purple-300 border-purple-500/30 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 inline-block" />
                            Palo Alto · Prisma
                        </span>
                    ) : (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border bg-blue-500/20 text-blue-300 border-blue-500/30 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block" />
                            Zscaler · ZIA
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1.5">
                    <span className={cn("w-2 h-2 rounded-full", isHealthy ? "bg-emerald-400 animate-pulse" : "bg-rose-400")} />
                    <span className="text-[10px] font-mono font-bold text-text-muted">
                        {data.tunnels_up || 0}/{data.tunnels_total || 0} Up
                    </span>
                </div>
            </div>

            {/* Center Icon & Title with Official Logos */}
            <div className="flex items-center gap-3 w-full my-0.5">
                <div className={cn(
                    "p-2 rounded-2xl shadow-inner shrink-0 flex items-center justify-center border",
                    isPrisma ? "bg-white/10 border-purple-500/30 shadow-purple-900/50" : "bg-white/10 border-blue-500/30 shadow-blue-900/50"
                )}>
                    {isPrisma ? (
                        <img src="/prisma-access.png" alt="Prisma Access" className="w-8 h-8 object-contain filter drop-shadow" />
                    ) : (
                        <img src="/zscaler-logo.png" alt="Zscaler" className="w-8 h-8 object-contain rounded-lg filter drop-shadow" />
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-black text-text-primary tracking-tight truncate leading-tight">
                        {data.short_name || data.name}
                    </div>
                    {data.spn_name ? (
                        <div className="text-[10px] text-text-muted font-mono truncate">
                            SPN: {data.spn_name}
                        </div>
                    ) : (
                        <div className="text-[10px] text-text-muted font-mono truncate">
                            Region: {data.region || 'global'}
                        </div>
                    )}
                </div>
            </div>

            {/* IP & Telemetry Footer */}
            <div className="w-full pt-2 border-t border-border/60 flex items-center justify-between text-[10px] font-mono">
                <div className="flex items-center gap-1 text-cyan-400 font-bold truncate">
                    <span>GW:</span>
                    <span className="truncate">{data.primary_peer_ip || 'Anycast'}</span>
                </div>
                {data.liveliness_probe_ip ? (
                    <div className="text-text-muted text-[9px] shrink-0" title="Liveliness ICMP probe">
                        Probe: {data.liveliness_probe_ip}
                    </div>
                ) : (
                    <div className="text-text-muted text-[9px] shrink-0">
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
    underlayGateway: UnderlayGatewayNode,
    sasePop: SasePopNode,
};

const edgeTypes = {
    site: SiteEdge
};

// --- Main Topology Component ---

interface TopologyProps {
    token: string;
}

export default function Topology(props: TopologyProps) {
    return (
        <ReactFlowProvider>
            <TopologyContent {...props} />
        </ReactFlowProvider>
    );
}

function TopologyContent({ token }: TopologyProps) {
    const [topology, setTopology] = useState<any>(null);
    const { gFetch, activePeerId } = usePeerContext();
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedObject, setSelectedObject] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [pathFilter, setPathFilter] = useState<'ALL' | 'ACTIVE' | 'BACKUP' | 'DOWN' | 'HUB'>('ALL');
    const [logicalViewSiteId, setLogicalViewSiteId] = useState<string | null>(null);
    const [bgAsHub, setBgAsHub] = useState(true);

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
    const [topologyViewMode, setTopologyViewMode] = useState<'physical' | 'overlay' | 'sase' | 'underlay'>('overlay');
    const [selectedNetwork, setSelectedNetwork] = useState<'INTERNET' | 'MPLS' | null>(null);
    const [networkTunnelFilter, setNetworkTunnelFilter] = useState<'ALL' | 'ACTIVE' | 'BACKUP' | 'DOWN'>('ALL');
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
    const [popTunnelFilter, setPopTunnelFilter] = useState<'ALL' | 'ACTIVE' | 'BACKUP' | 'DOWN'>('ALL');
    const [saseTunnelTypeFilter, setSaseTunnelTypeFilter] = useState<'ALL' | 'ACTIVE' | 'BACKUP' | 'DOWN'>('ALL');

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
        // Check resolutions
        const resObj = (underlayData?.resolutions || []).find(r => 
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
        // Check resolutions
        const resObj = (underlayData?.resolutions || []).find(r => 
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

    const handleVyosDirectAction = async (
        routerName: string,
        iface: string,
        command: string,
        params: any = {},
        siteName?: string
    ) => {
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
                    interface: iface,
                    command,
                    params,
                    source: `Topology: ${siteName || 'Link'} (${iface})`
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to execute VyOS action');
            }

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

            // Immediately poll /api/topology/underlay-debug to refresh underlay routers and interface statuses
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

            setVyosActionResult({
                success: true,
                message: command === 'shut'
                    ? `Port ${iface} disabled (SHUT)`
                    : command === 'no-shut'
                    ? `Port ${iface} enabled (NO SHUT)`
                    : command === 'clear-qos'
                    ? `QoS cleared on ${iface}`
                    : `Applied QoS (+${params.latency || 0}ms, ${params.loss || 0}% loss) on ${iface}`,
                durationMs: data.durationMs
            });

            setTimeout(() => setVyosActionResult(null), 5000);
            setShowNetemModal(false);
        } catch (err: any) {
            setVyosActionResult({
                success: false,
                message: err.message
            });
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
                    <div className="flex items-center gap-1.5">
                        {hasActiveQos && (
                            <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/40 text-[9px] font-mono font-bold flex items-center gap-1">
                                <Sliders size={10} /> +{activeQos?.latency || 0}ms{activeQos?.loss ? ` ${activeQos.loss}%` : ''}
                            </span>
                        )}
                        {isShut && (
                            <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-500 border border-rose-500/30 text-[9px] font-mono font-bold flex items-center gap-1">
                                <Power size={10} /> SHUT
                            </span>
                        )}
                        <span className="text-[9px] font-mono px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300 font-bold border border-amber-500/20">
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
    
    // Helper to identify Hub-like sites (HUB role, Branch Gateway, or specific naming)
    // Map site names to their hub status for quick lookup in PathFilter
    const siteHubStatus = useMemo(() => {
        const map = new Map<string, boolean>();
        if (!topology?.sites) return map;
        topology.sites.forEach((s: any) => {
            const role = (s.element_cluster_role || s.site_role || '').toUpperCase();
            const isBG = s.branch_gateway === true || s.branch_gateway === 'true';
            map.set(s.site_name, role === 'HUB' || (isBG && bgAsHub));
        });
        return map;
    }, [topology, bgAsHub]);

    const isHubLike = useCallback((s: any) => {
        if (!s) return false;
        // Optimization: if we have the map and the name, use it. Otherwise compute.
        if (s.site_name && siteHubStatus.has(s.site_name)) {
            return siteHubStatus.get(s.site_name);
        }
        const role = (s.element_cluster_role || s.site_role || '').toUpperCase();
        const isBG = s.branch_gateway === true || s.branch_gateway === 'true';
        return role === 'HUB' || (isBG && bgAsHub);
    }, [siteHubStatus, bgAsHub]);

    const processTopology = useCallback((data: any) => {
        if (!data.sites) return;

        // Apply Visibility Filter
        const filteredSites = visibleSiteIds
            ? data.sites.filter((s: any) => visibleSiteIds.includes(s.site_id))
            : data.sites;

        const newNodes: Node[] = [];
        const newEdges: Edge[] = [];

        const hubs = filteredSites.filter(isHubLike);
        const spokes = filteredSites.filter((s: any) => !isHubLike(s));

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

            // Calculate Subnets required width (pills with integrated Stigix badge)
            const allSubnets = new Set<string>();
            (site.devices || []).forEach((d: any) => {
                d.lan_interfaces?.forEach((l: any) => {
                    if (l.ip) {
                        const subnet = l.ip.includes('/') ? l.ip : l.ip.replace(/\.\d+$/, '.0/24');
                        allSubnets.add(subnet);
                    }
                });
            });
            const subnetsCount = Math.max(1, allSubnets.size);
            const subnetsWidth = subnetsCount * 145 + Math.max(0, subnetsCount - 1) * 12;

            const contentWidth = Math.max(devicesWidth, circuitsWidth, subnetsWidth);
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

                newNodes.push({
                    id: `site:${site.site_id}`,
                    type: 'site',
                    position: { x, y: yPos },
                    origin: [0.5, 0.5],
                    data: { ...site, name: site.site_name, role, fleetNodes },
                });
            });
        };

        // --- NODES ARE ALWAYS IN THE SAME POSITION ---
        layoutRow(hubs, HUB_Y, 'HUB');

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
                        
                        ifaceMap.set(res.vyos.interfaceName, {
                            ...existing,
                            name: res.vyos.interfaceName,
                            description: existing.description || res.vyos.description,
                            address: addresses,
                            ipCidr: ipCidr,
                            ip: res.vyos.ip || existing.ip || (ipCidr ? ipCidr.split('/')[0] : undefined),
                            status: res.vyos.status || existing.status || 'up',
                            qos: res.vyos.qos || existing.qos || null
                        });
                    }
                });

                return {
                    id: fromPayload?.id || routerName,
                    name: routerName,
                    host: fromPayload?.host || routerResolutions[0]?.vyos?.routerId || '192.168.122.254',
                    location: fromPayload?.location || 'VyOS Underlay Backbone',
                    status: fromPayload?.status || 'up',
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
                        onSelectResolution: (res: any) => setUnderlayDrawerResolution(res)
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

            const POP_STEP = 420;
            const CARD_WIDTH = 330;
            const CLUSTER_GAP = 280;
            const MIN_CENTER_DIST = CARD_WIDTH + CLUSTER_GAP;

            // Left wing: Prisma Access (Palo Alto Networks)
            prismaPops.forEach((pop: any, idx: number) => {
                const offsetFromRight = (prismaPops.length - 1 - idx) * POP_STEP;
                const x = -(MIN_CENTER_DIST / 2) - offsetFromRight;
                newNodes.push({
                    id: `cloud:${pop.id}`,
                    type: 'sasePop',
                    position: { x, y: CLOUD_Y },
                    origin: [0.5, 0.5],
                    data: {
                        ...pop,
                        isSasePop: true,
                        cluster: 'prisma'
                    }
                });
            });

            // Right wing: Zscaler
            zscalerPops.forEach((pop: any, idx: number) => {
                const x = (MIN_CENTER_DIST / 2) + idx * POP_STEP;
                newNodes.push({
                    id: `cloud:${pop.id}`,
                    type: 'sasePop',
                    position: { x, y: CLOUD_Y },
                    origin: [0.5, 0.5],
                    data: {
                        ...pop,
                        isSasePop: true,
                        cluster: 'zscaler'
                    }
                });
            });

            // Other providers (if any)
            otherPops.forEach((pop: any, idx: number) => {
                const x = (MIN_CENTER_DIST / 2) + (zscalerPops.length + idx) * POP_STEP;
                newNodes.push({
                    id: `cloud:${pop.id}`,
                    type: 'sasePop',
                    position: { x, y: CLOUD_Y },
                    origin: [0.5, 0.5],
                    data: {
                        ...pop,
                        isSasePop: true,
                        cluster: 'other'
                    }
                });
            });
        } else {
            // CLOUDS: Rendered for physical and overlay modes!
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

        layoutRow(spokes, SPOKE_Y, 'SPOKE');

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
                            const isSourceSelected = site.site_id === logicalViewSiteId;
                            const isTargetSelected = c.peer_site_id === logicalViewSiteId;

                            // If a specific site is focused, only show tunnels attached to it
                            if (logicalViewSiteId && !isSourceSelected && !isTargetSelected) return;

                            // Only show connections between visible sites
                            const isPeerVisible = !visibleSiteIds || visibleSiteIds.includes(c.peer_site_id);
                            if (!isPeerVisible && c.peer_site_id !== logicalViewSiteId) return;

                            const isSiteHub = isHubLike(site);
                            const peerSite = data.sites.find((s: any) => s.site_id === c.peer_site_id);
                            const isPeerHub = peerSite && isHubLike(peerSite);

                            // Prevent duplicate reverse edges in global view:
                            if (!logicalViewSiteId) {
                                if (isSiteHub && !isPeerHub) return;
                                if (isSiteHub && isPeerHub && site.site_id > c.peer_site_id) return;
                            } else {
                                if (!isSelectedSiteHub) {
                                    if (!isPeerHub) return;
                                }
                                if (!isSourceSelected && !isSelectedSiteHub) return;
                            }

                            const isUp = c.status === 'UP' || c.active || c.usable;
                            let strokeColor = '#64748b';
                            let strokeClass = '';
                            let animated = false;

                            if (c.active) {
                                strokeColor = isMplsCircuit ? '#c084fc' : '#22c55e'; // Purple for MPLS, Green for Internet
                                strokeClass = '2,6';
                                animated = true;
                            } else if (c.usable) {
                                strokeColor = isMplsCircuit ? '#9333ea' : '#3b82f6';
                                strokeClass = '5,5';
                            } else if (c.status === 'DOWN') {
                                strokeColor = '#ef4444';
                            }

                            newEdges.push({
                                id: `logical-edge-${site.site_id}-${c.peer_site_id}-${d.device_name}-${w.name}-${cIdx}`,
                                source: `site:${site.site_id}`,
                                target: `site:${c.peer_site_id}`,
                                sourceHandle: `circuit:${d.device_name}:${w.name}`,
                                targetHandle: `target-circuit:${c.peer_device_name}:${c.peer_wan_interface}`,
                                type: 'default',
                                animated,
                                style: {
                                    stroke: strokeColor,
                                    strokeWidth: c.active ? 4 : 2,
                                    strokeDasharray: strokeClass
                                },
                                data: {
                                    ...c,
                                    isMplsCircuit,
                                    sourceSiteName: site.site_name,
                                    sourceCircuitName: w.name,
                                    hideLabel: true
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
                                    hideLabel: true
                                }
                            });
                        }
                    });
                });
            });
        }

        setNodes(newNodes);
        setEdges(newEdges);
    }, [logicalViewSiteId, selectedNetwork, setNodes, setEdges, visibleSiteIds, isHubLike, siteHubStatus, topologyViewMode, underlayData, fleetNodes, pathFilter, bgAsHub, getVyosInterfaceStatus]);

    const fetchTopology = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await gFetch('/api/topology', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setTopology(data);
            setLastRefresh(new Date());

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
        } finally {
            setLoading(false);
        }
    }, [token, processTopology, gFetch]);

    useEffect(() => {
        if (!topology) {
            fetchTopology();
        } else {
            processTopology(topology);
        }
    }, [topology, logicalViewSiteId, selectedNetwork, fetchTopology, processTopology, visibleSiteIds, topologyViewMode, underlayData, fleetNodes]);

    const onNodeClick = useCallback((_: any, node: Node) => {
        const nodeData = node.data as any;

        if (node.type === 'cloud') {
            const netName = (nodeData.name || '').toUpperCase();
            const isInternet = netName.includes('INTERNET') || netName.includes('PUBLIC');
            const targetNet = isInternet ? 'INTERNET' : 'MPLS';

            setSelectedNetwork(prev => prev === targetNet ? null : targetNet);
            setLogicalViewSiteId(null);
            setSelectedObject({
                type: 'network',
                network: targetNet,
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
            return;
        }

        setSelectedObject({ type: 'node', ...nodeData });
        if (node.type === 'underlayGateway' && nodeData?.resolution) {
            setUnderlayDrawerResolution(nodeData.resolution);
        } else if (node.type === 'vyosRouter' && Array.isArray(nodeData?.resolutions) && nodeData.resolutions.length > 0) {
            setUnderlayDrawerResolution(nodeData.resolutions[0]);
        }
    }, [topologyViewMode]);

    const onEdgeClick = useCallback((_: any, edge: Edge) => {
        setSelectedObject({ type: 'edge', ...edge.data });
        const edgeData = edge.data as any;
        if (edgeData?.resolution) {
            setUnderlayDrawerResolution(edgeData.resolution);
        }
    }, []);

    const handleRefresh = async () => {
        // Bypass the server's 5-minute cache entirely by passing a force parameter
        setLoading(true);
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
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

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

    const filteredNodes = useMemo(() => {
        return nodes.map(n => {
            const nodeData = n.data as any;
            // Inject underlay data into site nodes
            const enriched = (n.type === 'site' && underlayData)
                ? {
                    ...n,
                    data: {
                        ...nodeData,
                        underlayMode,
                        underlayResolutionMap,
                        onInspectUnderlayCircuit: (resolution: UnderlayResolution) => {
                            setUnderlayPanelResolution(resolution);
                            setShowUnderlayPanel(true);
                        }
                    }
                }
                : n;

            if (!searchQuery) return enriched;
            return {
                ...enriched,
                style: {
                    ...(enriched as any).style,
                    opacity: nodeData.name?.toLowerCase().includes(searchQuery.toLowerCase()) ? 1 : 0.2
                }
            };
        });
    }, [nodes, searchQuery, underlayMode, underlayResolutionMap, underlayData]);


    const filteredEdges = useMemo(() => {
        const hasPopSelection = Boolean(selectedObject?.isSasePop);
        const selectedPopId = selectedObject?.isSasePop ? selectedObject.id : null;
        const selectedPopPeer = selectedObject?.isSasePop ? selectedObject.primary_peer_ip : null;

        return edges.map(e => {
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
                const isDimmed = isFilteredOut || (hasPopSelection && !isTargetingSelectedPop);

                // Vibrant stroke color: Zscaler UP is ALWAYS Green (#10b981)
                let stroke = '#ef4444';
                if (isUp) {
                    stroke = isAct ? '#10b981' : '#06b6d4';
                } else if (isStandby) {
                    stroke = '#f59e0b';
                }

                currentEdge = {
                    ...e,
                    animated: isUp && !isDimmed,
                    style: {
                        ...e.style,
                        stroke: stroke,
                        strokeWidth: isDimmed ? 1 : (isAct ? 3 : 2.2),
                        strokeDasharray: isAct && isUp ? undefined : (isUp ? '6 6' : '4 4'),
                        opacity: isDimmed ? 0.08 : 1,
                        filter: isTargetingSelectedPop 
                            ? (isAct ? 'drop-shadow(0 0 8px rgba(16,185,129,0.8))' : 'drop-shadow(0 0 8px rgba(6,182,212,0.8))')
                            : (isUp && isAct && !isDimmed ? 'drop-shadow(0 0 5px rgba(16,185,129,0.5))' : undefined),
                        pointerEvents: isDimmed ? 'none' : 'all',
                        transition: 'opacity 0.1s ease, stroke-width 0.1s ease'
                    }
                };
            }

            if (searchQuery) {
                const nodeMatch = currentEdge.id.toLowerCase().includes(searchQuery.toLowerCase());
                return {
                    ...currentEdge,
                    style: { ...currentEdge.style, opacity: nodeMatch ? (currentEdge.style?.opacity ?? 1) : 0.1 }
                };
            }

            return currentEdge;
        });
    }, [edges, searchQuery, selectedObject, saseTunnelTypeFilter]);

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
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-md">
                    <div className="relative w-24 h-24 mb-6">
                        <div className="absolute inset-0 border-4 border-blue-500/20 rounded-full" />
                        <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Network size={32} className="text-blue-500 animate-pulse" />
                        </div>
                    </div>
                    <h2 className="text-xl font-black text-text-primary tracking-tight uppercase">Building Topology</h2>
                    <p className="text-text-muted text-xs font-bold mt-2 tracking-widest animate-pulse">Querying Prisma SASE Systems...</p>
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
                    <div className="px-5 py-3 border-b border-border bg-card/75 backdrop-blur-md flex items-center justify-between gap-4 z-20 shrink-0">
                        <div className="flex items-center gap-3">
                            <div className={cn(
                                "p-2.5 rounded-xl text-white shadow-lg transition-all",
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
                                    <Network size={18} />
                                ) : selectedNetwork ? (
                                    <Cloud size={18} />
                                ) : topologyViewMode === 'overlay' ? (
                                    <Share2 size={18} />
                                ) : topologyViewMode === 'underlay' ? (
                                    <Server size={18} />
                                ) : topologyViewMode === 'sase' ? (
                                    <Shield size={18} />
                                ) : (
                                    <Globe size={18} />
                                )}
                            </div>
                            <div>
                                <div className="flex items-center gap-2.5">
                                    <h1 className="text-sm font-black text-text-primary uppercase tracking-tight">
                                        {logicalViewSiteId ? (
                                            <>
                                                Site Overlay Focus
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
                                            'SD-WAN Overlay Mesh'
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

                        {(logicalViewSiteId || selectedNetwork) && (
                            <button
                                onClick={() => {
                                    setLogicalViewSiteId(null);
                                    setSelectedNetwork(null);
                                    if (selectedObject?.type === 'network' || selectedObject?.site_id) setSelectedObject(null);
                                }}
                                className="bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/25 px-3.5 py-1.5 rounded-xl text-[10px] font-black tracking-widest uppercase transition-all flex items-center gap-2 cursor-pointer shadow-sm shadow-red-500/10"
                            >
                                <X size={12} /> Clear Filter (All Sites)
                            </button>
                        )}
                    </div>

                    {/* Canvas & Floating Drawers Container */}
                    <div className="relative flex-1 w-full min-h-0">
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
                                                            isHub ? "bg-blue-500/20 text-blue-500" : "bg-card-secondary text-text-secondary"
                                                        )}>
                                                            {isHub ? <Server size={14} /> : <Home size={14} />}
                                                        </div>
                                                        <div className="text-left">
                                                            <div className="text-xs font-black uppercase tracking-tight">{site.site_name}</div>
                                                            <div className="text-[9px] font-bold opacity-60 tracking-widest uppercase">{isHub ? 'Hub Site' : 'Branch Site'}</div>
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

                    {/* Global SD-WAN Overlay Transport Filter Ribbon */}
                    {topologyViewMode === 'overlay' && (
                        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto bg-card/90 backdrop-blur-xl border border-border p-1.5 rounded-2xl shadow-2xl flex items-center gap-1.5 animate-in fade-in slide-in-from-top-4 duration-300">
                            <div className="px-2.5 py-1 text-[10px] font-black text-text-muted uppercase tracking-wider flex items-center gap-1.5 border-r border-border/60">
                                <Share2 size={12} className="text-blue-400" /> SD-WAN Transport:
                            </div>
                            <button
                                onClick={() => {
                                    setSelectedNetwork(null);
                                    if (selectedObject?.type === 'network') setSelectedObject(null);
                                }}
                                className={cn(
                                    "px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5",
                                    selectedNetwork === null
                                        ? "bg-blue-600 text-white shadow-md shadow-blue-500/25"
                                        : "text-text-muted hover:text-text-primary hover:bg-card-secondary"
                                )}
                            >
                                <span>Tous les Tunnels</span>
                            </button>
                            <button
                                onClick={() => {
                                    setSelectedNetwork('INTERNET');
                                    setSelectedObject({ type: 'network', network: 'INTERNET', name: 'INTERNET' });
                                }}
                                className={cn(
                                    "px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5",
                                    selectedNetwork === 'INTERNET'
                                        ? "bg-sky-600 text-white shadow-md shadow-sky-500/25"
                                        : "text-text-muted hover:text-sky-400 hover:bg-card-secondary"
                                )}
                            >
                                <Cloud size={12} className="text-sky-400" />
                                <span>Internet</span>
                            </button>
                            <button
                                onClick={() => {
                                    setSelectedNetwork('MPLS');
                                    setSelectedObject({ type: 'network', network: 'MPLS', name: 'MPLS' });
                                }}
                                className={cn(
                                    "px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5",
                                    selectedNetwork === 'MPLS'
                                        ? "bg-purple-600 text-white shadow-md shadow-purple-500/25"
                                        : "text-text-muted hover:text-purple-400 hover:bg-card-secondary"
                                )}
                            >
                                <Network size={12} className="text-purple-400" />
                                <span>MPLS</span>
                            </button>
                            {logicalViewSiteId && (
                                <div className="pl-1.5 border-l border-border/60 flex items-center gap-1">
                                    <span className="text-[10px] font-black text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-lg">
                                        Site: {topology?.sites?.find((s: any) => s.site_id === logicalViewSiteId)?.site_name || logicalViewSiteId}
                                    </span>
                                    <button
                                        onClick={() => {
                                            setLogicalViewSiteId(null);
                                            if (selectedObject?.site_id) setSelectedObject(null);
                                        }}
                                        className="p-1 hover:bg-card-secondary text-text-muted hover:text-rose-400 rounded-lg transition-colors cursor-pointer"
                                        title="Clear Site Focus"
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Global SASE Path Type Filter Ribbon */}
                    {topologyViewMode === 'sase' && (
                        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto bg-card/90 backdrop-blur-xl border border-border p-1.5 rounded-2xl shadow-2xl flex items-center gap-1.5 animate-in fade-in slide-in-from-top-4 duration-300">
                            <div className="px-2.5 py-1 text-[10px] font-black text-text-muted uppercase tracking-wider flex items-center gap-1.5 border-r border-border/60">
                                <Shield size={12} className="text-purple-400" /> SASE Filter:
                            </div>
                            <button
                                onClick={() => setSaseTunnelTypeFilter('ALL')}
                                className={cn(
                                    "px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5",
                                    saseTunnelTypeFilter === 'ALL'
                                        ? "bg-purple-600 text-white shadow-md shadow-purple-500/25"
                                        : "text-text-muted hover:text-text-primary hover:bg-card-secondary"
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
                                    "px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5",
                                    saseTunnelTypeFilter === 'ACTIVE'
                                        ? "bg-emerald-600 text-white shadow-md shadow-emerald-500/25"
                                        : "text-text-muted hover:text-emerald-400 hover:bg-card-secondary"
                                )}
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                <span>Active Only</span>
                            </button>
                            <button
                                onClick={() => setSaseTunnelTypeFilter('BACKUP')}
                                className={cn(
                                    "px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5",
                                    saseTunnelTypeFilter === 'BACKUP'
                                        ? "bg-cyan-600 text-white shadow-md shadow-cyan-500/25"
                                        : "text-text-muted hover:text-cyan-400 hover:bg-card-secondary"
                                )}
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                                <span>Backup Only</span>
                            </button>
                            <button
                                onClick={() => setSaseTunnelTypeFilter('DOWN')}
                                className={cn(
                                    "px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5",
                                    saseTunnelTypeFilter === 'DOWN'
                                        ? "bg-rose-600 text-white shadow-md shadow-rose-500/25"
                                        : "text-text-muted hover:text-rose-400 hover:bg-card-secondary"
                                )}
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                                <span>Down / Standby</span>
                            </button>
                        </div>
                    )}

                    <ReactFlow
                        nodes={filteredNodes}
                        edges={filteredEdges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onNodeClick={onNodeClick}
                        onEdgeClick={onEdgeClick}
                        onPaneClick={() => {
                            setSelectedObject(null);
                            setSelectedNetwork(null);
                            setLogicalViewSiteId(null);
                        }}
                        minZoom={0.12}
                        maxZoom={2.5}
                        nodeTypes={nodeTypes}
                        edgeTypes={edgeTypes}
                        className="w-full h-full dark:bg-slate-950/40 bg-card-secondary/20"
                    >
                        <Background color="#1e293b" gap={20} size={1} className="topology-bg" />
                        <Controls className="!bg-card !border-border !rounded-xl !shadow-xl" />

                        {/* Export & Toggles Panel - Vertical Dock Centered on Right */}
                        <div className="absolute right-5 top-1/2 -translate-y-1/2 z-20 pointer-events-auto flex flex-col gap-2.5 items-end">
                            {/* 1. View Switcher: 4 Modes (Vertical Segmented Control) */}
                            <div className="bg-card/90 backdrop-blur-md border border-border p-1.5 rounded-2xl shadow-2xl flex flex-col gap-1 w-[155px]">
                                {/* Mode 1: WAN Transport */}
                                <button
                                    onClick={() => {
                                        setTopologyViewMode('physical');
                                        setSelectedNetwork(null);
                                        setLogicalViewSiteId(null);
                                    }}
                                    className={cn(
                                        "w-full px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-between gap-2 cursor-pointer",
                                        topologyViewMode === 'physical'
                                            ? "bg-sky-600 text-white shadow-md shadow-sky-500/25"
                                            : "text-text-muted hover:text-text-primary hover:bg-card-secondary"
                                    )}
                                    title="Physical WAN Transport View (Circuits <-> Internet/MPLS Clouds)"
                                >
                                    <div className="flex items-center gap-2">
                                        <Globe size={14} />
                                        <span>WAN Transport</span>
                                    </div>
                                </button>

                                {/* Mode 2: SD-WAN Mesh */}
                                <button
                                    onClick={() => {
                                        setTopologyViewMode('overlay');
                                        setSelectedNetwork(null);
                                        setLogicalViewSiteId(null);
                                    }}
                                    className={cn(
                                        "w-full px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-between gap-2 cursor-pointer",
                                        topologyViewMode === 'overlay'
                                            ? "bg-blue-600 text-white shadow-md shadow-blue-500/25"
                                            : "text-text-muted hover:text-text-primary hover:bg-card-secondary"
                                    )}
                                    title="Logical SD-WAN Mesh View (Site-to-Site Tunnels)"
                                >
                                    <div className="flex items-center gap-2">
                                        <Share2 size={14} />
                                        <span>SD-WAN Mesh</span>
                                    </div>
                                </button>

                                {/* Mode 3: SASE Fabric */}
                                <button
                                    onClick={() => {
                                        setTopologyViewMode('sase');
                                        setSelectedNetwork(null);
                                        setLogicalViewSiteId(null);
                                    }}
                                    className={cn(
                                        "w-full px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-between gap-2 cursor-pointer",
                                        topologyViewMode === 'sase'
                                            ? "bg-purple-600 text-white shadow-md shadow-purple-500/25"
                                            : "text-text-muted hover:text-purple-400 hover:bg-card-secondary"
                                    )}
                                    title="Full SASE Security Fabric View (Branches <-> Prisma Access PoPs)"
                                >
                                    <div className="flex items-center gap-2">
                                        <Shield size={14} />
                                        <span>SASE Fabric</span>
                                    </div>
                                    {topology?.sase_infrastructure?.up_service_links !== undefined ? (
                                        <span className={cn(
                                            "px-1.5 py-0.5 rounded-full text-[8px] font-mono font-black",
                                            topologyViewMode === 'sase' ? "bg-white/20 text-white" : "bg-purple-500/20 text-purple-300"
                                        )}>
                                            {topology.sase_infrastructure.up_service_links}
                                        </span>
                                    ) : null}
                                </button>

                                {/* Mode 4: VyOS Underlay */}
                                <button
                                    onClick={() => {
                                        setTopologyViewMode('underlay');
                                        setSelectedNetwork(null);
                                        setLogicalViewSiteId(null);
                                    }}
                                    className={cn(
                                        "w-full px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-between gap-2 cursor-pointer",
                                        topologyViewMode === 'underlay'
                                            ? "bg-amber-500 text-slate-950 font-black shadow-md shadow-amber-500/25"
                                            : "text-text-muted hover:text-amber-400 hover:bg-card-secondary"
                                    )}
                                    title="Physical Underlay View (Prisma ION Ports <-> VyOS Router Interfaces)"
                                >
                                    <div className="flex items-center gap-2">
                                        <Server size={14} />
                                        <span>VyOS Ports</span>
                                    </div>
                                    {underlayData?.summary?.matched ? (
                                        <span className={cn(
                                            "px-1.5 py-0.5 rounded-full text-[8px] font-mono font-black",
                                            topologyViewMode === 'underlay' ? "bg-slate-950/20 text-slate-950" : "bg-amber-500/20 text-amber-300"
                                        )}>
                                            {underlayData.summary.matched}
                                        </span>
                                    ) : null}
                                </button>
                            </div>

                            {/* 2. Action Tools Vertical Dock */}
                            <div className="bg-card/90 backdrop-blur-md border border-border p-1.5 rounded-2xl shadow-2xl flex flex-col items-center gap-1.5 w-[50px]">
                                {/* Auto-fit to Screen Button */}
                                <button
                                    onClick={handleFitView}
                                    className="w-9 h-9 rounded-xl transition-all flex items-center justify-center hover:bg-card-secondary text-text-muted hover:text-sky-400 cursor-pointer"
                                    title="Recadrer la topologie (Auto-fit)"
                                >
                                    <Maximize size={16} />
                                </button>

                                {/* BG as Hub Toggle */}
                                <button
                                    onClick={() => setBgAsHub(prev => !prev)}
                                    className={cn(
                                        "w-9 h-9 rounded-xl transition-all flex items-center justify-center cursor-pointer",
                                        bgAsHub 
                                            ? "bg-blue-500/20 text-blue-500 hover:bg-blue-500/30 border border-blue-500/30 shadow-sm" 
                                            : "hover:bg-card-secondary text-text-muted hover:text-text-primary"
                                    )}
                                    title="Toggle whether Branch Gateways appear as Hubs (top) or regular Branches (bottom)"
                                >
                                    <Server size={16} />
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
                                    onClick={fetchTopology}
                                    className="w-9 h-9 hover:bg-card-secondary rounded-xl text-text-muted hover:text-orange-500 transition-all flex items-center justify-center cursor-pointer"
                                    title="Refresh Data"
                                >
                                    <RefreshCw size={16} />
                                </button>

                                {/* Trace Path Quick Tool */}
                                <button
                                    onClick={() => setTracerouteTarget('')}
                                    className="w-9 h-9 hover:bg-card-secondary rounded-xl text-text-muted hover:text-blue-500 transition-all flex items-center justify-center cursor-pointer"
                                    title="Trace Network Path (Traceroute)"
                                >
                                    <Route size={16} />
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
                            <div className="bg-card/90 backdrop-blur-md border border-border p-1.5 rounded-2xl shadow-2xl flex flex-col items-center gap-3 group transition-all duration-300 hover:p-2">
                                <div className="p-2.5 bg-card-secondary rounded-xl text-text-muted group-hover:bg-blue-500 group-hover:text-white transition-all shadow-inner">
                                    <Search size={18} />
                                </div>
                                <div className="flex flex-col gap-2 overflow-hidden w-10 group-hover:w-48 transition-all duration-500 ease-in-out">
                                    <input
                                        type="text"
                                        placeholder="Filter nodes..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="bg-transparent border-none text-[11px] font-bold py-1 px-1 focus:outline-none placeholder:text-text-muted/50 w-full"
                                    />
                                    <div className="h-px bg-gradient-to-r from-blue-500/50 to-transparent w-full scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-500" />
                                </div>
                            </div>
                        </Panel>

                        {/* Legend Panel */}
                        <Panel position="bottom-left" className="font-sans">
                            <div className="bg-card/80 backdrop-blur-md border border-border p-4 rounded-2xl shadow-xl flex flex-col gap-2 min-w-[150px]">
                                <div className="text-[9px] font-black text-text-muted uppercase tracking-[0.2em] mb-1">Topology Legend</div>
                                {(logicalViewSiteId || topologyViewMode === 'overlay') ? (
                                    <>
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-400">
                                            <div className="w-6 h-1 bg-emerald-500 rounded-full" /> Overlay: Active (UP)
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-blue-400">
                                            <div className="w-6 h-1 bg-blue-500 border-t border-dashed rounded-full" /> Overlay: Backup
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-rose-400">
                                            <div className="w-6 h-1 bg-rose-500 rounded-full" /> Overlay: Down
                                        </div>
                                        <div className="pt-1 mt-1 border-t border-border/50 flex items-center justify-between text-[9px] text-text-muted font-mono gap-2">
                                            <span className="text-sky-400 font-bold">Cyan: Internet</span>
                                            <span className="text-purple-400 font-bold">Purple: MPLS</span>
                                        </div>
                                    </>
                                ) : topologyViewMode === 'sase' ? (
                                    <>
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-400">
                                            <div className="w-5 h-1 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]" /> Active SASE Tunnel (UP)
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-cyan-400">
                                            <div className="w-5 h-1 border-t-2 border-dashed border-cyan-400" /> Backup SASE Tunnel (UP)
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-amber-400">
                                            <div className="w-5 h-1 border-t-2 border-dashed border-amber-400" /> Standby Spoke Path
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-rose-400">
                                            <div className="w-5 h-1 border-t-2 border-dashed border-rose-500" /> Down / Retransmission
                                        </div>
                                        <div className="pt-1 mt-1 border-t border-border/50 flex items-center justify-between text-[9px] text-text-muted font-mono">
                                            <span className="text-purple-400 font-bold">LEFT: Prisma Access</span>
                                            <span className="text-blue-400 font-bold">RIGHT: Zscaler</span>
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
                    </ReactFlow>

                    {/* Site Details Side Panel */}
                    <div className={cn(
                        "absolute top-4 bottom-4 right-4 w-[450px] bg-card/95 backdrop-blur-xl border border-border rounded-3xl shadow-2xl transition-all duration-500 z-50 overflow-hidden transform",
                        selectedObject ? "translate-x-0 opacity-100" : "translate-x-[calc(100%+20px)] opacity-0"
                    )}>
                        {selectedObject && (
                            <div className="flex flex-col h-full">
                                <div className="p-6 border-b border-border bg-card-secondary/30 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={cn(
                                            "p-2.5 rounded-xl",
                                            selectedObject.type === 'network'
                                                ? (selectedObject.network === 'INTERNET' ? "bg-sky-500 text-white shadow-lg shadow-sky-500/30" : "bg-purple-600 text-white shadow-lg shadow-purple-500/30")
                                                : selectedObject.isSaseEdge || selectedObject.isSasePop
                                                    ? "bg-purple-600 text-white shadow-lg shadow-purple-500/30"
                                                    : (selectedObject.type === 'node' ? "bg-blue-500 text-white" : "bg-purple-500 text-white")
                                        )}>
                                            {selectedObject.type === 'network' ? (
                                                <Cloud size={18} />
                                            ) : selectedObject.isSaseEdge || selectedObject.isSasePop ? (
                                                <Shield size={18} />
                                            ) : (selectedObject.role === 'HUB' ? <Server size={18} /> : <Home size={18} />)}
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-black text-text-primary tracking-tight">{selectedObject.name || selectedObject.label}</h3>
                                            <p className="text-[10px] text-text-muted font-bold tracking-widest uppercase">
                                                {selectedObject.type === 'network'
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
                                    <button onClick={() => setSelectedObject(null)} className="p-1.5 hover:bg-card-secondary rounded-lg text-text-muted transition-colors">
                                        <X size={20} />
                                    </button>
                                </div>

                                <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-border">
                                    {selectedObject.isSasePop ? (
<div className="space-y-5">
                                            {/* SASE PoP Banner with Official Brand Logo */}
                                            <div className={cn(
                                                "border p-5 rounded-2xl flex flex-col items-center gap-3 shadow-lg",
                                                selectedObject.provider === 'Prisma Access'
                                                    ? "bg-purple-950/20 border-purple-500/30 shadow-purple-500/10"
                                                    : "bg-blue-950/20 border-blue-500/30 shadow-blue-500/10"
                                            )}>
                                                <div className={cn(
                                                    "p-3 rounded-2xl shadow-xl flex items-center justify-center border",
                                                    selectedObject.provider === 'Prisma Access'
                                                        ? "bg-white/10 border-purple-500/40 shadow-purple-900/50"
                                                        : "bg-white/10 border-blue-500/40 shadow-blue-900/50"
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
                                                        selectedObject.provider === 'Prisma Access' ? "text-purple-400" : "text-cyan-400"
                                                    )}>
                                                        {selectedObject.provider === 'Prisma Access' ? 'PALO ALTO NETWORKS · PRISMA ACCESS POP' : 'ZSCALER INC · CLOUD SECURITY (ZIA)'}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Key Specs 4-Grid */}
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="bg-card-secondary/40 p-3 rounded-xl border border-border/60 space-y-1">
                                                    <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Gateway SPN IP</div>
                                                    <div className="text-xs font-mono font-bold text-cyan-400">{selectedObject.primary_peer_ip || 'Anycast'}</div>
                                                </div>
                                                <div className="bg-card-secondary/40 p-3 rounded-xl border border-border/60 space-y-1">
                                                    <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Liveliness Probe</div>
                                                    <div className="text-xs font-mono font-bold text-emerald-400">{selectedObject.liveliness_probe_ip || '192.168.255.254'}</div>
                                                </div>
                                                <div className="bg-card-secondary/40 p-3 rounded-xl border border-border/60 space-y-1">
                                                    <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Probe Latency (ICMP)</div>
                                                    <div className="text-xs font-mono font-bold text-emerald-400 flex items-center gap-1.5">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                                        {selectedObject.latency_ms || (selectedObject.id === 'prisma-france-south' ? 9 : 21)} ms
                                                    </div>
                                                </div>
                                                <div className="bg-card-secondary/40 p-3 rounded-xl border border-border/60 space-y-1">
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
                                                                        ? "bg-emerald-500/20 border-emerald-500 text-white shadow-md shadow-emerald-500/20"
                                                                        : "bg-card-secondary/40 border-border/60 hover:bg-card-secondary"
                                                                )}
                                                            >
                                                                <span className="text-[9px] font-black uppercase text-emerald-400">Active UP</span>
                                                                <span className="text-base font-black text-text-primary mt-0.5">{activeUp.length}</span>
                                                            </button>

                                                            <button
                                                                onClick={() => setPopTunnelFilter(popTunnelFilter === 'BACKUP' ? 'ALL' : 'BACKUP')}
                                                                className={cn(
                                                                    "p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col",
                                                                    popTunnelFilter === 'BACKUP'
                                                                        ? "bg-cyan-500/20 border-cyan-500 text-white shadow-md shadow-cyan-500/20"
                                                                        : "bg-card-secondary/40 border-border/60 hover:bg-card-secondary"
                                                                )}
                                                            >
                                                                <span className="text-[9px] font-black uppercase text-cyan-400">Backup UP</span>
                                                                <span className="text-base font-black text-text-primary mt-0.5">{backupUp.length}</span>
                                                            </button>

                                                            <button
                                                                onClick={() => setPopTunnelFilter(popTunnelFilter === 'DOWN' ? 'ALL' : 'DOWN')}
                                                                className={cn(
                                                                    "p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col",
                                                                    popTunnelFilter === 'DOWN'
                                                                        ? "bg-rose-500/20 border-rose-500 text-white shadow-md shadow-rose-500/20"
                                                                        : "bg-card-secondary/40 border-border/60 hover:bg-card-secondary"
                                                                )}
                                                            >
                                                                <span className="text-[9px] font-black uppercase text-rose-400">Down / Stdby</span>
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
                                    ) : selectedObject.type === 'node' ? (
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

                                                    <div className="space-y-3">
                                                        <div className="flex justify-between items-center">
                                                            <div className="text-[10px] font-black text-text-muted uppercase tracking-widest flex items-center gap-2">
                                                                <Share2 size={12} /> Detailed Overlay Paths
                                                            </div>
                                                            <div className="flex gap-1">
                                                                {(['ALL', 'ACTIVE', 'BACKUP', 'DOWN', 'HUB'] as const).map(f => (
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
                                                        <div className="w-full overflow-x-auto pb-2">
                                                            <table className="w-full text-left border-separate" style={{ borderSpacing: '0 4px' }}>
                                                                <tbody className="text-[10px]">
                                                                    {(() => {
                                                                        // Aggregate all connections across all devices and interfaces into a rich format
                                                                        const paths: any[] = [];
                                                                        selectedObject.devices?.forEach((d: any) => {
                                                                            d.wan_interfaces?.forEach((w: any) => {
                                                                                w.connections?.forEach((c: any) => {
                                                                                    paths.push({
                                                                                        sourceSite: selectedObject.name,
                                                                                        sourceDevice: c.source_device_name || 'ION',
                                                                                        sourceCircuit: w.name || 'WAN',
                                                                                        peerSite: c.peer_site_name,
                                                                                        peerDevice: c.peer_device_name || 'ION',
                                                                                        destCircuit: c.peer_wan_interface || 'WAN',
                                                                                        network: w.wan_network || 'UNKNOWN',
                                                                                        vpnId: c.debug_vpn_id,
                                                                                        srcIp: c.debug_source_ip,
                                                                                        dstIp: c.debug_peer_ip,
                                                                                        isRoutingActive: c.active,
                                                                                        isRoutingUsable: c.usable,
                                                                                        isLinkUp: c.link_up,
                                                                                        vpState: c.vpState
                                                                                    });
                                                                                });
                                                                            });
                                                                        });

                                                                        const filteredPaths = paths.filter(p => {
                                                                            if (pathFilter === 'ALL') return true;
                                                                            if (pathFilter === 'ACTIVE') return p.isRoutingActive;
                                                                            if (pathFilter === 'BACKUP') return (p.isRoutingUsable || p.isLinkUp) && !p.isRoutingActive;
                                                                            if (pathFilter === 'DOWN') return !p.isRoutingActive && !p.isRoutingUsable && !p.isLinkUp;
                                                                            if (pathFilter === 'HUB') {
                                                                                return siteHubStatus.get(p.peerSite) === true;
                                                                            }
                                                                            return true;
                                                                        });

                                                                        if (filteredPaths.length === 0) {
                                                                            return <tr><td colSpan={5} className="text-text-muted italic opacity-50 py-4 text-center">No matching overlay peers discovered</td></tr>;
                                                                        }
                                                                        filteredPaths.sort((a, b) => a.peerSite.localeCompare(b.peerSite));
                                                                        return filteredPaths.map((p: any, idx: number) => {
                                                                            let tagBg = "bg-card-secondary/20";
                                                                            let tagText = "text-text-muted";
                                                                            let label = "UNKNOWN";
                                                                            if (p.isRoutingActive) { tagBg = "bg-green-500/10"; tagText = "text-green-500"; label = "ACTIVE"; }
                                                                            else if (p.isRoutingUsable || p.isLinkUp) { tagBg = "bg-blue-500/10"; tagText = "text-blue-500"; label = "BACKUP"; }
                                                                            else { tagBg = "bg-red-500/10"; tagText = "text-red-500"; label = "DOWN"; }

                                                                            return (
                                                                                <tr key={idx} className="group hover:bg-card/40 transition-colors">
                                                                                    <td className="py-2 pl-3 rounded-l-lg border-y border-l bg-card/20 border-border/20 group-hover:border-border/60 text-right whitespace-nowrap min-w-[50px]">
                                                                                        <div className="flex items-center justify-end gap-1 text-[9px] font-mono">
                                                                                            <span className="text-text-primary hidden lg:inline">{p.sourceSite}</span>
                                                                                            <span className="text-text-muted/50 hidden lg:inline">:</span>
                                                                                            <span className="text-blue-500 font-bold">{p.sourceDevice}</span>
                                                                                        </div>
                                                                                    </td>
                                                                                    <td className="py-2 px-1 border-y bg-card/20 border-border/20 group-hover:border-border/60 text-right whitespace-nowrap w-[1%]">
                                                                                        <span className="text-[9px] font-mono text-text-secondary bg-card-secondary/50 px-1 py-0.5 rounded uppercase tracking-tighter inline-block">{p.sourceCircuit}</span>
                                                                                    </td>
                                                                                    <td className="py-2 px-2 border-y bg-card/20 border-border/20 group-hover:border-border/60 text-center whitespace-nowrap w-[1%]">
                                                                                        <div className="flex justify-center items-center opacity-90 pb-[1px]">
                                                                                            <span className="text-[9px] font-mono text-text-muted tracking-tighter hidden sm:inline">&lt;=</span>
                                                                                            <span className={cn("px-1.5 py-[1px] mx-1 rounded font-black text-[8px] tracking-wider text-center border min-w-[45px]", tagBg, tagText, p.isRoutingActive ? "border-green-500/20" : p.isRoutingUsable ? "border-blue-500/20" : "border-red-500/20")}>
                                                                                                {label}
                                                                                            </span>
                                                                                            <span className="text-[9px] font-mono text-text-muted tracking-tighter hidden sm:inline">=&gt;</span>
                                                                                        </div>
                                                                                    </td>
                                                                                    <td className="py-2 px-1 border-y bg-card/20 border-border/20 group-hover:border-border/60 text-left whitespace-nowrap w-[1%]">
                                                                                        <span className="text-[9px] font-mono text-text-secondary bg-card-secondary/50 px-1 py-0.5 rounded uppercase tracking-tighter inline-block">{p.destCircuit}</span>
                                                                                    </td>
                                                                                    <td className="py-2 pr-3 rounded-r-lg border-y border-r bg-card/20 border-border/20 group-hover:border-border/60 text-left whitespace-nowrap min-w-[50px]">
                                                                                        <div className="flex items-center justify-start gap-1 text-[9px] font-mono">
                                                                                            <span className="text-blue-500 font-bold">{p.peerDevice}</span>
                                                                                            <span className="text-text-muted/50 hidden lg:inline">:</span>
                                                                                            <span className="text-text-primary hidden lg:inline">{p.peerSite}</span>
                                                                                        </div>
                                                                                    </td>
                                                                                </tr>
                                                                            );
                                                                        });
                                                                    })()}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </div>
                                                </>
                                            ) : (
                                                /* Cloud Network SD-WAN Dashboard */
                                                (() => {
                                                    const isTargetMpls = (selectedObject.network || selectedObject.name || '').toUpperCase().includes('MPLS');
                                                    const targetNetworkName = isTargetMpls ? 'MPLS' : 'INTERNET';

                                                    // Collect all overlay paths running across this WAN network
                                                    const allNetworkPaths: any[] = [];
                                                    (topology?.sites || []).forEach((s: any) => {
                                                        (s.devices || []).forEach((d: any) => {
                                                            (d.wan_interfaces || []).forEach((w: any) => {
                                                                const isCircuitMpls = (w.wan_network || '').toUpperCase().includes('MPLS') || (w.name || '').toUpperCase().includes('MPLS');
                                                                if (isTargetMpls ? isCircuitMpls : !isCircuitMpls) {
                                                                    (w.connections || []).forEach((c: any) => {
                                                                        allNetworkPaths.push({
                                                                            sourceSite: s.site_name,
                                                                            sourceSiteId: s.site_id,
                                                                            sourceDevice: d.device_name,
                                                                            sourceCircuit: w.name || 'WAN',
                                                                            peerSite: c.peer_site_name,
                                                                            peerSiteId: c.peer_site_id,
                                                                            peerDevice: c.peer_device_name || 'ION',
                                                                            destCircuit: c.peer_wan_interface || 'WAN',
                                                                            network: targetNetworkName,
                                                                            vpnId: c.debug_vpn_id,
                                                                            srcIp: c.debug_source_ip || w.ip,
                                                                            dstIp: c.debug_peer_ip,
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
                                                        if (networkTunnelFilter === 'BACKUP') return !p.isRoutingActive && (p.isRoutingUsable || p.isLinkUp);
                                                        if (networkTunnelFilter === 'DOWN') return !p.isRoutingActive && !p.isRoutingUsable && !p.isLinkUp;
                                                        return true;
                                                    }).filter(p => {
                                                        if (!networkTunnelSearch) return true;
                                                        const q = networkTunnelSearch.toLowerCase();
                                                        return p.sourceSite.toLowerCase().includes(q) ||
                                                               p.peerSite.toLowerCase().includes(q) ||
                                                               p.sourceCircuit.toLowerCase().includes(q) ||
                                                               p.destCircuit.toLowerCase().includes(q);
                                                    });

                                                    return (
                                                        <div className="space-y-5">
                                                            {/* Provider Card with Spotlight Actions */}
                                                            <div className={cn(
                                                                "border p-5 rounded-3xl flex flex-col items-center gap-3 shadow-lg",
                                                                isTargetMpls
                                                                    ? "bg-purple-950/20 border-purple-500/30 shadow-purple-500/10"
                                                                    : "bg-sky-950/20 border-sky-500/30 shadow-sky-500/10"
                                                            )}>
                                                                <div className={cn(
                                                                    "p-3 rounded-2xl shadow-xl flex items-center justify-center border",
                                                                    isTargetMpls ? "bg-purple-600/30 border-purple-500/40 text-purple-300" : "bg-sky-600/30 border-sky-500/40 text-sky-300"
                                                                )}>
                                                                    <Cloud size={28} />
                                                                </div>
                                                                <div className="text-center">
                                                                    <div className="text-lg font-black text-text-primary tracking-tight leading-tight uppercase">
                                                                        {targetNetworkName} OVERLAY
                                                                    </div>
                                                                    <div className="text-[10px] text-text-muted font-bold tracking-widest uppercase mt-1">
                                                                        SD-WAN Transport Carrier
                                                                    </div>
                                                                </div>

                                                                {/* Quick Focus Button on Canvas */}
                                                                <div className="flex gap-2 w-full pt-1">
                                                                    <button
                                                                        onClick={() => {
                                                                            setSelectedNetwork(prev => prev === targetNetworkName ? null : targetNetworkName);
                                                                        }}
                                                                        className={cn(
                                                                            "flex-1 py-2 px-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all border flex items-center justify-center gap-2 cursor-pointer shadow-sm",
                                                                            selectedNetwork === targetNetworkName
                                                                                ? (isTargetMpls ? "bg-purple-600 border-purple-500 text-white shadow-purple-500/25" : "bg-sky-600 border-sky-500 text-white shadow-sky-500/25")
                                                                                : "bg-card-secondary/40 border-border/50 text-text-primary hover:bg-card-secondary"
                                                                        )}
                                                                    >
                                                                        <Filter size={13} />
                                                                        {selectedNetwork === targetNetworkName ? 'Filtre Actif (Isolé)' : 'Focaliser sur le Canvas'}
                                                                    </button>
                                                                </div>
                                                            </div>

                                                            {/* KPI Summary Cards */}
                                                            <div className="grid grid-cols-4 gap-2">
                                                                <div className="bg-card-secondary/40 border border-border/50 p-2.5 rounded-2xl text-center">
                                                                    <div className="text-[9px] font-black uppercase tracking-wider text-text-muted">Total</div>
                                                                    <div className="text-base font-black text-text-primary mt-0.5">{totalPaths}</div>
                                                                </div>
                                                                <div className="bg-emerald-500/10 border border-emerald-500/20 p-2.5 rounded-2xl text-center">
                                                                    <div className="text-[9px] font-black uppercase tracking-wider text-emerald-400">Active</div>
                                                                    <div className="text-base font-black text-emerald-400 mt-0.5">{activePaths}</div>
                                                                </div>
                                                                <div className="bg-sky-500/10 border border-sky-500/20 p-2.5 rounded-2xl text-center">
                                                                    <div className="text-[9px] font-black uppercase tracking-wider text-sky-400">Backup</div>
                                                                    <div className="text-base font-black text-sky-400 mt-0.5">{backupPaths}</div>
                                                                </div>
                                                                <div className="bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-2xl text-center">
                                                                    <div className="text-[9px] font-black uppercase tracking-wider text-rose-400">Down</div>
                                                                    <div className="text-base font-black text-rose-400 mt-0.5">{downPaths}</div>
                                                                </div>
                                                            </div>

                                                            {/* Filter Tabs & Search */}
                                                            <div className="flex items-center justify-between gap-1.5">
                                                                <div className="flex gap-1">
                                                                    {(['ALL', 'ACTIVE', 'BACKUP', 'DOWN'] as const).map(f => (
                                                                        <button
                                                                            key={f}
                                                                            onClick={() => setNetworkTunnelFilter(f)}
                                                                            className={cn(
                                                                                "px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all border cursor-pointer",
                                                                                networkTunnelFilter === f
                                                                                    ? "bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-500/20"
                                                                                    : "bg-card-secondary/40 border-border/40 text-text-muted hover:text-text-primary"
                                                                            )}
                                                                        >
                                                                            {f}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                                <div className="relative flex-1 max-w-[150px]">
                                                                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                                                                    <input
                                                                        type="text"
                                                                        placeholder="Filtrer site..."
                                                                        value={networkTunnelSearch}
                                                                        onChange={(e) => setNetworkTunnelSearch(e.target.value)}
                                                                        className="w-full bg-card-secondary/50 border border-border/60 rounded-lg pl-7 pr-2 py-1 text-[10px] text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-blue-500"
                                                                    />
                                                                </div>
                                                            </div>

                                                            {/* Tunnels List */}
                                                            <div className="space-y-2">
                                                                <div className="text-[10px] font-black text-text-muted uppercase tracking-widest flex items-center justify-between">
                                                                    <span className="flex items-center gap-1.5">
                                                                        <Share2 size={12} /> Tunnels SD-WAN ({filteredNetworkPaths.length})
                                                                    </span>
                                                                </div>

                                                                <div className="max-h-[420px] overflow-y-auto space-y-1.5 pr-1 scrollbar-thin scrollbar-thumb-border">
                                                                    {filteredNetworkPaths.length === 0 ? (
                                                                        <div className="py-8 text-center text-text-muted text-xs italic">
                                                                            Aucun tunnel SD-WAN trouvé sur {targetNetworkName}
                                                                        </div>
                                                                    ) : (
                                                                        filteredNetworkPaths.map((p, idx) => {
                                                                            const isAct = p.isRoutingActive;
                                                                            const isBk = !isAct && (p.isRoutingUsable || p.isLinkUp);
                                                                            return (
                                                                                <div
                                                                                    key={idx}
                                                                                    onClick={() => {
                                                                                        setLogicalViewSiteId(p.sourceSiteId);
                                                                                    }}
                                                                                    className="bg-card-secondary/30 hover:bg-card-secondary/60 border border-border/50 hover:border-blue-500/40 p-2.5 rounded-xl transition-all cursor-pointer group"
                                                                                    title="Cliquer pour focaliser ce site sur le canvas"
                                                                                >
                                                                                    <div className="flex items-center justify-between gap-1.5">
                                                                                        {/* Source */}
                                                                                        <div className="flex items-center gap-1 min-w-0">
                                                                                            <span className="text-xs font-black text-text-primary truncate">{p.sourceSite}</span>
                                                                                            <span className="text-[8px] font-mono text-sky-400 bg-sky-500/10 px-1 py-0.5 rounded border border-sky-500/20">{p.sourceCircuit}</span>
                                                                                        </div>

                                                                                        {/* Status Pill */}
                                                                                        <div className="shrink-0 flex items-center gap-1">
                                                                                            <span className={cn(
                                                                                                "px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border",
                                                                                                isAct
                                                                                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                                                                                    : (isBk ? "bg-sky-500/10 text-sky-400 border-sky-500/30" : "bg-rose-500/10 text-rose-400 border-rose-500/30")
                                                                                            )}>
                                                                                                {isAct ? 'ACTIVE' : (isBk ? 'BACKUP' : 'DOWN')}
                                                                                            </span>
                                                                                        </div>

                                                                                        {/* Peer */}
                                                                                        <div className="flex items-center gap-1 justify-end min-w-0">
                                                                                            <span className="text-[8px] font-mono text-purple-400 bg-purple-500/10 px-1 py-0.5 rounded border border-purple-500/20">{p.destCircuit}</span>
                                                                                            <span className="text-xs font-black text-text-primary truncate">{p.peerSite}</span>
                                                                                        </div>
                                                                                    </div>

                                                                                    {(p.srcIp || p.dstIp || p.latency) && (
                                                                                        <div className="mt-1.5 pt-1.5 border-t border-border/30 flex items-center justify-between text-[9px] font-mono text-text-muted">
                                                                                            <span>{p.srcIp} ➔ {p.dstIp}</span>
                                                                                            {p.latency && <span className="text-emerald-400 font-bold">{p.latency}ms</span>}
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
                                    ) : (
                                        selectedObject.isSaseEdge ? (
                                        <div className="space-y-5">
                                            {/* SASE Tunnel Header Banner with Human-Friendly Name & Brand Logo */}
                                            {(() => {
                                                const info = formatServiceLinkDetails(selectedObject.name, selectedObject.role, selectedObject.provider, selectedObject.circuit_name);
                                                const isPrisma = selectedObject.provider === 'Prisma Access';
                                                return (
                                                    <div className={cn(
                                                        "border p-5 rounded-2xl flex flex-col items-center gap-3 shadow-lg",
                                                        isPrisma
                                                            ? "bg-purple-950/20 border-purple-500/30 shadow-purple-500/10"
                                                            : "bg-blue-950/20 border-blue-500/30 shadow-blue-500/10"
                                                    )}>
                                                        <div className={cn(
                                                            "p-2.5 rounded-2xl shadow-xl flex items-center justify-center border",
                                                            isPrisma
                                                                ? "bg-white/10 border-purple-500/40 shadow-purple-900/50"
                                                                : "bg-white/10 border-blue-500/40 shadow-blue-900/50"
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
                                                            <div className="text-[10px] text-purple-400 font-bold tracking-[0.15em] mt-1 uppercase">
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
                                                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                                                    : "bg-rose-500/10 border-rose-500/30 text-rose-400"
                                            )}>
                                                <div className="flex items-center gap-2">
                                                    <span className={cn("w-2 h-2 rounded-full", selectedObject.operational_state === 'up' ? "bg-emerald-400 animate-pulse" : "bg-rose-400")} />
                                                    <span>STATUS: {selectedObject.extended_state || selectedObject.operational_state}</span>
                                                </div>
                                                <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-black/20">
                                                    Device: {selectedObject.device}
                                                </span>
                                            </div>

                                            {/* Key Specs Grid */}
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="bg-card-secondary/40 p-3.5 rounded-xl border border-border/60 space-y-1">
                                                    <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Remote Gateway (SPN)</div>
                                                    <div className="text-xs font-mono font-bold text-cyan-400">{selectedObject.remote_ip || 'N/A'}</div>
                                                </div>
                                                <div className="bg-card-secondary/40 p-3.5 rounded-xl border border-border/60 space-y-1">
                                                    <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Local Tunnel IP</div>
                                                    <div className="text-xs font-mono font-bold text-text-primary">{selectedObject.local_ip || 'N/A'}</div>
                                                </div>
                                                <div className="bg-card-secondary/40 p-3.5 rounded-xl border border-border/60 space-y-1">
                                                    <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Inside Subnet (/31)</div>
                                                    <div className="text-xs font-mono font-bold text-amber-400">{selectedObject.inside_ip || 'N/A'}</div>
                                                </div>
                                                <div className="bg-card-secondary/40 p-3.5 rounded-xl border border-border/60 space-y-1">
                                                    <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Liveliness Probe</div>
                                                    <div className="text-xs font-mono font-bold text-emerald-400">{selectedObject.liveliness_probe_ip || '192.168.255.254'}</div>
                                                </div>
                                            </div>

                                            {/* Real-time Telemetry: Uptime & Latency */}
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="bg-card-secondary/40 p-3.5 rounded-xl border border-border/60 space-y-1">
                                                    <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Tunnel Uptime</div>
                                                    <div className="text-xs font-mono font-bold text-emerald-400">
                                                        {selectedObject.uptime_str || 'Active (UP)'}
                                                    </div>
                                                </div>
                                                <div className="bg-card-secondary/40 p-3.5 rounded-xl border border-border/60 space-y-1">
                                                    <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Probe Latency (ICMP)</div>
                                                    <div className="text-xs font-mono font-bold text-cyan-400 flex items-center gap-1.5">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
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
                                    ) : (
                                        <div className="space-y-6">
                                            <div className="bg-blue-500/5 border border-blue-500/20 p-5 rounded-2xl flex flex-col items-center gap-3">
                                                <div className="p-3 bg-blue-500 rounded-2xl text-white shadow-lg">
                                                    <Zap size={24} />
                                                </div>
                                                <div className="text-center">
                                                    <div className="text-lg font-black text-text-primary tracking-tight uppercase leading-none">{selectedObject.wan_network}</div>
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
                                                    <div className="text-xs font-mono font-bold text-text-secondary">{selectedObject.ip || 'DHCP'}</div>
                                                </div>
                                            </div>

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
                                                            {selectedObject.wan_network.toLowerCase().includes('mpls') ? 'Private MPLS' : 'Public Internet'}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center justify-between text-xs py-1">
                                                        <span className="text-text-muted">Label</span>
                                                        <span className="font-bold text-blue-500">{selectedObject.label}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="p-6 bg-card-secondary/50 border-t border-border mt-auto">
                                    <div className="flex items-center justify-between bg-white/5 rounded-2xl p-4 border border-white/5">
                                        <div className="flex items-center gap-3">
                                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                            <span className="text-[10px] font-black text-text-muted uppercase tracking-widest">Health Synchronized</span>
                                        </div>
                                        <Info size={14} className="text-text-muted cursor-help" />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Underlay Details Side Panel */}
                    <div className={cn(
                        "absolute top-4 bottom-4 w-[400px] bg-card/95 backdrop-blur-xl border border-amber-500/20 rounded-3xl shadow-2xl transition-all duration-500 z-[55] overflow-hidden transform",
                        showUnderlayPanel && underlayPanelResolution
                            ? "translate-x-0 opacity-100"
                            : "translate-x-[calc(100%+20px)] opacity-0 pointer-events-none"
                    )} style={{ right: showUnderlayPanel && underlayPanelResolution && selectedObject ? '474px' : '16px' }}>
                        {showUnderlayPanel && underlayPanelResolution && (() => {
                            const r = underlayPanelResolution;
                            return (
                                <div className="flex flex-col h-full">
                                    <div className="p-5 border-b border-border bg-amber-500/5 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400"><Layers size={18} /></div>
                                            <div>
                                                <h3 className="text-sm font-black text-text-primary tracking-tight">Underlay Inspect</h3>
                                                <p className="text-[10px] text-text-muted font-bold tracking-widest uppercase opacity-60">{r.prismaWan.interfaceName} · {r.prismaWan.siteName}</p>
                                            </div>
                                        </div>
                                        <button onClick={() => setShowUnderlayPanel(false)} className="p-1.5 hover:bg-card-secondary rounded-lg text-text-muted transition-colors"><X size={18} /></button>
                                    </div>
                                    <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-thin scrollbar-thumb-border">
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
            {underlayDrawerResolution && (
                <div 
                    className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
                    onClick={() => setUnderlayDrawerResolution(null)}
                >
                    <div 
                        className="w-full max-w-lg bg-card/95 backdrop-blur-2xl border-2 border-amber-500/40 rounded-3xl p-5 sm:p-6 shadow-2xl shadow-black/60 space-y-4 text-text-primary animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between pb-3 border-b border-border/70">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className="p-2 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 flex-shrink-0">
                                    <Activity size={18} />
                                </div>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-sm font-black uppercase text-text-primary tracking-wider">
                                            WAN Link Details
                                        </h3>
                                        {underlayDrawerResolution.status === 'matched' ? (
                                            <span 
                                                className="text-[9px] font-black px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 inline-flex items-center gap-1"
                                                title={`Subnet Correlated: ${underlayDrawerResolution.matchedNetwork || ''} (Prisma WAN and VyOS share the same transit subnet)`}
                                            >
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> LINK CONNECTED
                                            </span>
                                        ) : (
                                            <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-card-secondary text-text-muted border border-border">
                                                UNMAPPED
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-text-muted font-mono truncate max-w-[320px] mt-0.5">
                                        {underlayDrawerResolution.prismaWan.siteName} ({underlayDrawerResolution.prismaWan.interfaceName}) ⟷ {underlayDrawerResolution.vyos?.routerName || 'External WAN'}{underlayDrawerResolution.vyos ? ` (${underlayDrawerResolution.vyos.interfaceName})` : ''}
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

                        {/* Middle: 2-Column Correlation Specs */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                            {/* Left: Prisma SD-WAN ION Port */}
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
                                        <span className="text-text-muted">Circuit:</span>
                                        <strong className="text-text-primary truncate max-w-[120px]">{underlayDrawerResolution.prismaWan.interfaceName}</strong>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-text-muted">Type:</span>
                                        <strong className="text-blue-600 dark:text-blue-400 uppercase">{underlayDrawerResolution.prismaWan.linkType || 'WAN'}</strong>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-text-muted">ION IP:</span>
                                        <strong className="text-emerald-600 dark:text-emerald-400">{underlayDrawerResolution.prismaWan.ipCidr || underlayDrawerResolution.prismaWan.ip || '—'}</strong>
                                    </div>
                                </div>
                            </div>

                            {/* Right: VyOS Underlay Router Port */}
                            <div className="bg-amber-500/10 border border-amber-500/25 rounded-2xl p-3.5 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black uppercase text-amber-600 dark:text-amber-400 tracking-wider flex items-center gap-1">
                                        <Server size={12} /> VyOS Router
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
                                        <span className="text-text-muted">Next-Hop:</span>
                                        <strong className="text-emerald-600 dark:text-emerald-400">{underlayDrawerResolution.vyos?.ipCidr || underlayDrawerResolution.vyos?.ip || '—'}</strong>
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

                        {/* Bottom: Transit Subnet Banner */}
                        <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-card-secondary/70 border border-amber-500/30 font-mono text-[11px] shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
                                Transit Subnet:
                            </span>
                            <span className="px-2.5 py-0.5 rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold border border-amber-500/30">
                                {underlayDrawerResolution.matchedNetwork || underlayDrawerResolution.vyos?.network || '—'}
                            </span>
                        </div>
                    </div>
                </div>
            )}

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
