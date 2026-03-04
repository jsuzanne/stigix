import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
    BaseEdge
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
    Search
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

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

    // Determine color based on network
    const isMpls = data?.wan_network?.toLowerCase().includes('mpls');
    const color = isMpls ? '#a855f7' : (data?.ip && !data?.ip.includes('Pending') ? '#3b82f6' : '#94a3b8');

    // Determine if we should show the label - ONLY if hideLabel is not set
    const showLabel = !data?.hideLabel;

    return (
        <>
            <BaseEdge path={edgePath} markerEnd={markerEnd} style={{ ...style, stroke: color }} />
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
const Port = ({ num, label, status = 'unknown' }: { num: string, label?: string, status?: 'up' | 'down' | 'unknown' }) => {
    let bgClass = "bg-card border-border text-text-muted";

    // Status color coding for port badges
    if (status === 'up') bgClass = "bg-green-500/20 border-green-500/50 text-green-400";
    if (status === 'down') bgClass = "bg-red-500/20 border-red-500/50 text-red-500";

    return (
        <div className="flex flex-col items-center gap-1 relative z-20 group">
            <div className={cn(
                "w-5 h-5 rounded-md border flex items-center justify-center text-[9px] font-black shadow-sm",
                bgClass
            )}>
                {num}
            </div>
            {label && (
                <div className="absolute top-[26px] whitespace-nowrap bg-card/80 backdrop-blur-sm px-1.5 py-0.5 rounded text-[8px] font-mono font-bold text-text-muted uppercase tracking-tighter shadow-sm border border-border/50 text-center">
                    {label}
                </div>
            )}
        </div>
    );
};

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

    return (
        <div className={cn(
            "flex flex-col items-center min-w-[400px] gap-6",
            isHub ? "flex-col-reverse" : "flex-col"
        )}>

            {/* Circuit Blocks Section */}
            <div className="flex gap-6 z-10 relative">
                {wanCircuits.map((w: any, idx: number) => (
                    <div key={idx} className="relative flex flex-col items-center">
                        <div className={cn(
                            "px-4 py-2 rounded-xl border shadow-2xl backdrop-blur-md flex flex-col items-center justify-center gap-1 min-w-[130px] h-[52px] transition-all hover:scale-105 hover:border-white/40 group",
                            w.wan_network?.toLowerCase().includes('mpls')
                                ? "bg-purple-500/10 border-purple-500/30 text-purple-400"
                                : "bg-blue-500/10 border-blue-500/30 text-blue-400"
                        )}>
                            <div className="text-[11px] font-black uppercase tracking-tight overflow-hidden text-ellipsis whitespace-nowrap max-w-[110px]">
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
                                position={Position.Bottom}
                                id={`target-circuit:${w.devName}:${w.name}`}
                                className="!w-full !h-1 !opacity-0"
                            />
                        </div>
                    </div>
                ))}
            </div>

            {/* Site Rectangle (Physical Box) */}
            <div className={cn(
                "p-12 rounded-[52px] border-2 transition-all shadow-2xl backdrop-blur-3xl bg-card/40 flex flex-col relative",
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
                                    const blockX = (globalIdx - (circuitCount - 1) / 2) * 154; // 130 (min-w) + 24 (gap-6)
                                    const portX = devX + (wIdx - (dev.wan_interfaces.length - 1) / 2) * 36; // 20 (w-5) + 16 (gap-4)

                                    return (
                                        <path
                                            key={wan.name}
                                            d={isHub
                                                ? `M ${portX} 444 L ${blockX} 548` // Hub: Bottom Port (444) down to Circuit (548)
                                                : `M ${portX} 48 L ${blockX} -24`  // Spoke: Top Port (48) up to Circuit (-24)
                                            }
                                            stroke={isMpls ? "rgba(168, 85, 247, 0.4)" : "rgba(59, 130, 246, 0.4)"}
                                            strokeWidth="3"
                                            fill="none"
                                            strokeDasharray="6 4"
                                            className="animate-in fade-in duration-1000"
                                        />
                                    );
                                })}

                                {/* LAN Wiring */}
                                {isHub ? (
                                    // Hub: Shared LAN Block (bottom Y=192) down to LAN Port (Y=224)
                                    <path
                                        d={`M 0 192 L ${devX} 224`}
                                        stroke="rgba(34, 197, 94, 0.5)"
                                        strokeWidth="3"
                                        fill="none"
                                        strokeLinejoin="round"
                                        strokeLinecap="round"
                                        strokeDasharray="4 4"
                                    />
                                ) : (
                                    // Spoke: LAN Port (Y=268) down to Shared LAN Box (Y=300)
                                    <path
                                        d={`M ${devX} 268 L 0 300`}
                                        stroke="rgba(34, 197, 94, 0.5)"
                                        strokeWidth="3"
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
                    <div className="flex flex-col items-center justify-end mb-8 relative z-10 h-[144px]">
                        <div className="absolute inset-x-0 -top-8 flex justify-center w-full z-0 overflow-visible">
                            <div className="text-[140px] font-black text-white/[0.015] select-none pointer-events-none uppercase tracking-[0.2em] whitespace-nowrap px-10">{data.name}</div>
                        </div>
                        <div className="text-[24px] font-black text-text-primary uppercase tracking-[0.5em] opacity-80 mb-4 drop-shadow-2xl relative z-10">{data.name}</div>
                        <div className="flex gap-4">
                            {uniqueSubeNets.map((subnet, sIdx) => (
                                <div key={sIdx} className="bg-green-500/10 px-6 py-3 rounded-[20px] border-2 border-green-500/40 text-[14px] font-black text-green-400 shadow-2xl shadow-green-500/20 relative z-10 group transition-all hover:scale-105 hover:bg-green-500/20 hover:border-green-500 h-[44px] flex items-center cursor-default">
                                    {subnet}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Horizontal Device Clusters */}
                <div className="flex items-center justify-center gap-16 relative z-10 w-full mb-8">
                    {devices.map((dev: any, dIdx: number) => (
                        <div key={dIdx} className="flex flex-col items-center group relative">

                            {/* Router Block (Fixed Height h-[220px]) */}
                            <div className={cn(
                                "w-52 h-[220px] rounded-[44px] border-2 flex flex-col items-center justify-center gap-5 transition-all group-hover:scale-105 group-hover:border-blue-500/50 group-hover:shadow-[0_20px_50px_-10px_rgba(59,130,246,0.3)] relative z-10",
                                isHub ? "bg-blue-600/10 border-blue-500/30 shadow-blue-500/10" : "bg-card-secondary/40 border-border/80"
                            )}>

                                {/* HUB: LAN Port Top */}
                                {isHub && (
                                    <div className="absolute -top-[10px] w-full flex justify-center z-20">
                                        <Port num="3" label={shortIp(dev.lan_interfaces?.[0]?.ip)} status={getStatus(dev.lan_interfaces?.[0])} />
                                    </div>
                                )}

                                {/* SPOKE: WAN Ports Top */}
                                {!isHub && (
                                    <div className="absolute -top-[10px] w-full flex justify-center gap-4 z-20">
                                        {dev.wan_interfaces?.map((wan: any, wIdx: number) => (
                                            <Port key={wIdx} num={(wIdx + 1).toString()} status={getStatus(wan)} />
                                        ))}
                                    </div>
                                )}

                                {/* Icon */}
                                <div className={cn(
                                    "p-5 rounded-3xl shadow-2xl transition-transform group-hover:rotate-12",
                                    isHub ? "bg-blue-500 text-white shadow-blue-500/40" : "bg-card text-blue-500 shadow-black/20"
                                )}>
                                    {isHub ? <Server size={32} /> : <Home size={32} />}
                                </div>

                                {/* Text */}
                                <div className="text-center px-6">
                                    <div className="text-[16px] font-black text-text-primary tracking-tight leading-none uppercase">{dev.device_name}</div>
                                    <div className="text-[11px] text-text-muted font-bold opacity-40 mt-2 uppercase tracking-widest">{dev.model}</div>
                                </div>

                                {/* HUB: WAN Ports Bottom */}
                                {isHub && (
                                    <div className="absolute -bottom-[10px] w-full flex justify-center gap-4 z-20">
                                        {dev.wan_interfaces?.map((wan: any, wIdx: number) => (
                                            <Port key={wIdx} num={(wIdx + 1).toString()} status={getStatus(wan)} />
                                        ))}
                                    </div>
                                )}

                                {/* SPOKE: LAN Port Bottom */}
                                {!isHub && (
                                    <div className="absolute -bottom-[10px] w-full flex justify-center z-20">
                                        <Port num="3" label={shortIp(dev.lan_interfaces?.[0]?.ip)} status={getStatus(dev.lan_interfaces?.[0])} />
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Spoke-Specific: Shared LAN Block at the Bottom */}
                {!isHub && (
                    <div className="flex flex-col items-center relative z-10 w-full mb-4">
                        <div className="flex gap-4">
                            {uniqueSubeNets.map((subnet, sIdx) => (
                                <div key={sIdx} className="bg-green-500/10 px-6 py-3 rounded-[20px] border-2 border-green-500/40 text-[14px] font-black text-green-400 shadow-2xl shadow-green-500/20 relative z-10 group transition-all hover:scale-105 hover:bg-green-500/20 hover:border-green-500 h-[44px] flex items-center cursor-default">
                                    {subnet}
                                </div>
                            ))}
                        </div>
                        <div className="absolute inset-x-0 -bottom-8 flex justify-center w-full z-0 overflow-visible">
                            <div className="text-[120px] font-black text-white/[0.015] select-none pointer-events-none uppercase tracking-[0.2em] whitespace-nowrap px-10">{data.name}</div>
                        </div>
                        <div className="text-[28px] font-black text-text-primary uppercase tracking-[0.5em] opacity-80 mt-6 drop-shadow-2xl relative z-10">{data.name}</div>
                    </div>
                )}
            </div>
        </div>
    );

};

const CloudNode = ({ data }: any) => {
    const isInternet = data.name === 'INTERNET';

    return (
        <div className={cn(
            "px-10 py-6 rounded-[50px] border-2 border-dashed transition-all shadow-2xl backdrop-blur-3xl flex flex-col items-center gap-3 min-w-[240px]",
            isInternet ? "bg-blue-500/10 border-blue-500/30 shadow-blue-500/10" : "bg-purple-500/10 border-purple-500/30 shadow-purple-500/10"
        )}>
            <Handle type="target" position={Position.Top} id="target-top" className="!opacity-0" />
            <Handle type="target" position={Position.Bottom} id="target-bottom" className="!opacity-0" />

            <div className={cn(
                "p-4 rounded-full shadow-inner",
                isInternet ? "bg-blue-500 text-white" : "bg-purple-500 text-white"
            )}>
                <Cloud size={28} />
            </div>
            <div className="text-center">
                <div className="text-lg font-black text-text-primary tracking-tight uppercase leading-none">{data.wan_network}</div>
                <div className="text-[10px] text-text-muted font-bold tracking-[0.2em] mt-2">UNDERLAY</div>
            </div>
        </div>
    );
};

const nodeTypes = {
    site: SiteNode,
    cloud: CloudNode,
};

const edgeTypes = {
    site: SiteEdge
};

// --- Main Topology Component ---

interface TopologyProps {
    token: string;
}

export default function Topology({ token }: TopologyProps) {
    const [topology, setTopology] = useState<any>(null);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedObject, setSelectedObject] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [pathFilter, setPathFilter] = useState<'ALL' | 'ACTIVE' | 'BACKUP' | 'DOWN' | 'HUB'>('ALL');
    const [logicalViewSiteId, setLogicalViewSiteId] = useState<string | null>(null);

    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

    const fetchTopology = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/topology', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setTopology(data);
            setLastRefresh(new Date());
            processTopology(data);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const processTopology = (data: any) => {
        if (!data.sites) return;

        const newNodes: Node[] = [];
        const newEdges: Edge[] = [];

        // Identify Hubs vs Spokes
        const hubs = data.sites.filter((s: any) =>
            s.element_cluster_role === 'HUB' ||
            s.site_name.includes('DC') ||
            s.site_name.includes('BRGW') ||
            s.site_name.toLowerCase().includes('azure') ||
            s.site_name.toLowerCase().includes('aws')
        );
        const spokes = data.sites.filter((s: any) => !hubs.includes(s));

        // Identify unique WAN Networks (Clouds)
        const publicWanNetworks = new Set<string>();
        const privateWanNetworks = new Set<string>();

        data.sites.forEach((s: any) => {
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

        const HUB_Y = -850;
        const CLOUD_Y = 0;
        const SPOKE_Y = 850;
        const HORIZONTAL_GAP_PX = 150;

        const getSiteWidth = (site: any) => {
            const numDevices = site.devices?.length || 1;
            const devicesWidth = numDevices * 208 + Math.max(0, numDevices - 1) * 64;
            return Math.max(400, devicesWidth + 96);
        };

        const layoutRow = (sites: any[], yPos: number, role: string) => {
            const widths = sites.map(getSiteWidth);
            const totalWidth = widths.reduce((acc, w) => acc + w, 0) + HORIZONTAL_GAP_PX * Math.max(0, sites.length - 1);
            let currentX = -totalWidth / 2;

            sites.forEach((site: any, i: number) => {
                const w = widths[i];
                const x = currentX + w / 2;
                currentX += w + HORIZONTAL_GAP_PX;

                newNodes.push({
                    id: `site:${site.site_id}`,
                    type: 'site',
                    position: { x, y: yPos },
                    data: { ...site, name: site.site_name, role },
                });
            });
        };

        // --- NODES ARE ALWAYS IN THE SAME POSITION ---
        layoutRow(hubs, HUB_Y, 'HUB');

        // Clouds only visible in PHYSICAL map
        if (!logicalViewSiteId) {
            const INTERNET_X = -200;
            if (publicWanNetworks.size > 0) {
                newNodes.push({
                    id: `cloud:INTERNET`,
                    type: 'cloud',
                    position: { x: INTERNET_X, y: CLOUD_Y },
                    data: { name: 'INTERNET' },
                });
            }

            const privates = Array.from(privateWanNetworks);
            privates.forEach((cloudName, i) => {
                const x = 200 + (i * 250);
                newNodes.push({
                    id: `cloud:${cloudName}`,
                    type: 'cloud',
                    position: { x, y: CLOUD_Y },
                    data: { name: cloudName },
                });
            });
        }

        layoutRow(spokes, SPOKE_Y, 'SPOKE');

        // --- EDGES CHANGE BASED ON MODE ---
        if (logicalViewSiteId) {
            // mode LOGICAL: Draw direct site-to-site tunnels for the selected site
            const centerSite = data.sites.find((s: any) => s.site_id === logicalViewSiteId);
            if (centerSite) {
                centerSite.devices?.forEach((d: any) => {
                    d.wan_interfaces?.forEach((w: any) => {
                        w.connections?.forEach((c: any, cIdx: number) => {
                            // Phase 1 Simplification: Only show tunnels to Hub sites
                            const peerSite = data.sites.find((s: any) => s.site_id === c.peer_site_id);
                            const peerIsHub = peerSite && (
                                peerSite.element_cluster_role === 'HUB' ||
                                peerSite.site_name.includes('DC') ||
                                peerSite.site_name.includes('BRGW') ||
                                peerSite.site_name.toLowerCase().includes('azure') ||
                                peerSite.site_name.toLowerCase().includes('aws')
                            );

                            if (!peerIsHub) return;

                            const isUp = c.status === 'UP' || c.active || c.usable;
                            let strokeColor = '#64748b';
                            let strokeClass = '';
                            let animated = false;

                            if (c.active) {
                                strokeColor = '#22c55e'; // Green
                                strokeClass = '2,6'; // Dotted
                                animated = true;
                            } else if (c.usable) {
                                strokeColor = '#3b82f6'; // Blue
                                strokeClass = '5,5'; // Dashed
                            } else if (c.status === 'DOWN') {
                                strokeColor = '#ef4444'; // Red
                            }

                            newEdges.push({
                                id: `logical-edge-${centerSite.site_id}-${c.peer_site_id}-${d.device_name}-${w.name}-${cIdx}`,
                                source: `site:${centerSite.site_id}`,
                                target: `site:${c.peer_site_id}`,
                                sourceHandle: `circuit:${d.device_name}:${w.name}`,
                                targetHandle: `target-circuit:${c.peer_device_name}:${c.peer_wan_interface}`,
                                type: 'default',
                                animated,
                                style: { stroke: strokeColor, strokeWidth: c.active ? 5 : 2, strokeDasharray: strokeClass },
                                data: { ...c, hideLabel: true }
                            });
                        });
                    });
                });
            }
        } else {
            // mode PHYSICAL: Draw site-to-cloud edges
            data.sites.forEach((site: any) => {
                const isHub = hubs.includes(site);
                site.devices?.forEach((device: any) => {
                    device.wan_interfaces?.forEach((wan: any) => {
                        if (wan.wan_network) {
                            const isUp = wan.ip && !wan.ip.includes('Pending');
                            const isPrivate = privateWanNetworks.has(wan.wan_network);
                            const targetCloudId = isPrivate ? `cloud:${wan.wan_network}` : `cloud:INTERNET`;

                            newEdges.push({
                                id: `edge:${site.site_id}:${device.device_name}:${wan.name}`,
                                type: 'site',
                                source: `site:${site.site_id}`,
                                target: targetCloudId,
                                sourceHandle: `circuit:${device.device_name}:${wan.name}`,
                                targetHandle: isHub ? 'target-top' : 'target-bottom',
                                animated: isUp && !isPrivate,
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
    };

    useEffect(() => {
        if (!topology) {
            fetchTopology();
        } else {
            processTopology(topology);
        }
    }, [topology, logicalViewSiteId]);

    const onNodeClick = useCallback((_: any, node: Node) => {
        setSelectedObject({ type: 'node', ...node.data });
    }, []);

    const onEdgeClick = useCallback((_: any, edge: Edge) => {
        setSelectedObject({ type: 'edge', ...edge.data });
    }, []);

    const handleRefresh = async () => {
        // Bypass the server's 5-minute cache entirely by passing a force parameter
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/topology?force=true', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setTopology(data);
            setLastRefresh(new Date());
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

    const filteredNodes = useMemo(() => {
        if (!searchQuery) return nodes;
        return nodes.map(n => ({
            ...n,
            style: {
                ...n.style,
                opacity: (n.data as any).name.toLowerCase().includes(searchQuery.toLowerCase()) ? 1 : 0.2
            }
        }));
    }, [nodes, searchQuery]);

    const filteredEdges = useMemo(() => {
        if (!searchQuery) return edges;
        return edges.map(e => {
            const nodeMatch = e.id.toLowerCase().includes(searchQuery.toLowerCase());
            return {
                ...e,
                style: { ...e.style, opacity: nodeMatch ? 1 : 0.1 }
            };
        });
    }, [edges, searchQuery]);

    return (
        <div className="h-[calc(100vh-140px)] w-full relative bg-black/20 rounded-3xl border border-border overflow-hidden animate-in fade-in zoom-in-95 duration-500">
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
                    {/* Top Bar Navigation Area Included Normally Above reactFlow */}
                    <div className="absolute top-4 left-4 right-4 z-50 flex justify-between items-start pointer-events-none">
                        <div className="bg-card/80 backdrop-blur-md border border-white/5 rounded-2xl px-6 py-4 shadow-2xl pointer-events-auto">
                            <h2 className="text-sm font-black text-text-primary tracking-widest uppercase">Site Topology</h2>
                            <p className="text-[10px] text-text-muted font-bold tracking-widest mt-1 uppercase opacity-60">
                                {topology?.sites?.length || 0} Sites Detected
                            </p>
                        </div>

                        <div className="flex gap-2 pointer-events-auto">
                            <button
                                onClick={handleRefresh}
                                className="bg-card/80 backdrop-blur-md border border-white/5 hover:bg-card hover:border-blue-500/50 text-text-muted hover:text-blue-400 p-3 rounded-xl transition-all shadow-xl group flex items-center justify-center"
                                title="Force Refresh Topology"
                            >
                                <RefreshCw size={18} className={cn("transition-transform duration-500", loading ? "animate-spin" : "group-hover:rotate-180")} />
                            </button>
                            <button
                                onClick={handleExportCsv}
                                className="bg-card/80 backdrop-blur-md border border-white/5 hover:bg-card hover:border-blue-500/50 text-text-muted hover:text-blue-400 p-3 rounded-xl transition-all shadow-xl group flex items-center justify-center"
                                title="Export details to CSV"
                            >
                                <FileText size={18} className="transition-transform group-hover:scale-110" />
                            </button>
                            <button
                                onClick={handleExportPng}
                                className="bg-card/80 backdrop-blur-md border border-white/5 hover:bg-card hover:border-blue-500/50 text-text-muted hover:text-blue-400 p-3 rounded-xl transition-all shadow-xl group flex items-center justify-center"
                                title="Export diagram to PNG"
                            >
                                <Download size={18} className="transition-transform group-hover:scale-110" />
                            </button>
                        </div>
                    </div>

                    <ReactFlow
                        nodes={filteredNodes}
                        edges={filteredEdges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onNodeClick={onNodeClick}
                        onEdgeClick={onEdgeClick}
                        nodeTypes={nodeTypes}
                        edgeTypes={edgeTypes}
                        fitView
                        className="bg-slate-950/40"
                    >
                        <Background color="#1e293b" gap={20} size={1} />
                        <Controls className="!bg-card !border-border !rounded-xl !shadow-xl" />

                        {/* Upper Toolbar */}
                        <Panel position="top-left" className="flex items-center gap-3">
                            <div className="bg-card/90 backdrop-blur-md border border-border p-2 rounded-2xl shadow-2xl flex items-center gap-3">
                                <div className="p-2.5 bg-blue-500 rounded-xl text-white shadow-lg shadow-blue-500/20">
                                    <Share2 size={18} />
                                </div>
                                <div className="pr-4">
                                    <h1 className="text-sm font-black text-text-primary uppercase tracking-tight flex items-center gap-2">
                                        {logicalViewSiteId ? 'Logical Overlay View' : 'Site Topology'}
                                    </h1>
                                    <p className="text-[10px] text-text-muted font-bold tracking-widest">{topology?.site_count || 0} SITES DETECTED</p>
                                    {lastRefresh && (
                                        <p className="text-[8px] text-blue-500/80 font-black tracking-widest uppercase mt-0.5 font-mono">
                                            {lastRefresh.toLocaleString()}
                                        </p>
                                    )}
                                </div>
                                {logicalViewSiteId && (
                                    <>
                                        <div className="h-8 w-px bg-border mx-2" />
                                        <button
                                            onClick={() => setLogicalViewSiteId(null)}
                                            className="bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 px-3 py-1.5 rounded-xl text-[10px] font-black tracking-widest uppercase transition-all flex items-center gap-2"
                                        >
                                            <X size={12} /> Exit Overlay View
                                        </button>
                                    </>
                                )}
                                <div className="h-8 w-px bg-border mx-2" />
                                <div className="relative">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                                    <input
                                        type="text"
                                        placeholder="Filter nodes..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="bg-card-secondary border border-border text-[11px] font-bold pl-9 pr-3 py-1.5 rounded-xl w-48 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                    />
                                </div>
                            </div>
                        </Panel>

                        {/* Export Panel */}
                        <Panel position="top-right" className="flex items-center gap-2">
                            <div className="bg-card/90 backdrop-blur-md border border-border p-1.5 rounded-2xl shadow-xl flex items-center gap-2">
                                <button
                                    onClick={handleExportCsv}
                                    className="p-2 hover:bg-card-secondary rounded-xl text-text-muted hover:text-green-500 transition-all group flex items-center gap-2"
                                    title="Export Inventory (CSV)"
                                >
                                    <FileText size={16} />
                                    <span className="text-[10px] font-black uppercase tracking-tighter hidden group-hover:block transition-all">CSV</span>
                                </button>
                                <button
                                    onClick={handleExportPng}
                                    className="p-2 hover:bg-card-secondary rounded-xl text-text-muted hover:text-blue-500 transition-all group flex items-center gap-2"
                                    title="Export Map (PNG)"
                                >
                                    <Download size={16} />
                                    <span className="text-[10px] font-black uppercase tracking-tighter hidden group-hover:block transition-all">PNG</span>
                                </button>
                                <div className="h-4 w-px bg-border" />
                                <button
                                    onClick={fetchTopology}
                                    className="p-2 hover:bg-card-secondary rounded-xl text-text-muted hover:text-orange-500 transition-all group"
                                    title="Refresh Data"
                                >
                                    <RefreshCw size={16} />
                                </button>
                            </div>
                        </Panel>

                        {/* Legend Panel */}
                        <Panel position="bottom-left" className="font-sans">
                            <div className="bg-card/80 backdrop-blur-md border border-border p-4 rounded-2xl shadow-xl flex flex-col gap-2 min-w-[150px]">
                                <div className="text-[9px] font-black text-text-muted uppercase tracking-[0.2em] mb-1">Topology Legend</div>
                                {logicalViewSiteId ? (
                                    <>
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-text-secondary">
                                            <div className="w-6 h-1 bg-green-500 rounded-full" /> Overlay: Active
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-text-secondary">
                                            <div className="w-6 h-1 bg-blue-500 border-t border-dashed rounded-full" /> Overlay: Backup
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-text-secondary">
                                            <div className="w-6 h-1 bg-red-500 rounded-full" /> Overlay: Down
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
                                            selectedObject.type === 'node' ? "bg-blue-500 text-white" : "bg-purple-500 text-white"
                                        )}>
                                            {selectedObject.role === 'HUB' ? <Server size={18} /> : <Home size={18} />}
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-black text-text-primary tracking-tight">{selectedObject.name || selectedObject.label}</h3>
                                            <p className="text-[10px] text-text-muted font-bold tracking-widest uppercase">
                                                {selectedObject.type === 'node' ? 'Site Entity' : 'Circuit Link'}
                                            </p>
                                        </div>
                                    </div>
                                    <button onClick={() => setSelectedObject(null)} className="p-1.5 hover:bg-card-secondary rounded-lg text-text-muted transition-colors">
                                        <X size={20} />
                                    </button>
                                </div>

                                <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-border">
                                    {selectedObject.type === 'node' ? (
                                        <>
                                            {/* Logical View Toggle */}
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
                                                                                // Debugging fields
                                                                                vpnId: c.debug_vpn_id,
                                                                                srcIp: c.debug_source_ip,
                                                                                dstIp: c.debug_peer_ip,

                                                                                // Core routing logic mapping from Prisma SD-WAN (now per-session)
                                                                                isRoutingActive: c.active,
                                                                                isRoutingUsable: c.usable,
                                                                                isLinkUp: c.link_up,
                                                                                vpState: c.vpState
                                                                            });
                                                                        });
                                                                    });
                                                                });

                                                                // Apply Filter
                                                                const filteredPaths = paths.filter(p => {
                                                                    if (pathFilter === 'ALL') return true;
                                                                    if (pathFilter === 'ACTIVE') return p.isRoutingActive;
                                                                    if (pathFilter === 'BACKUP') return (p.isRoutingUsable || p.isLinkUp) && !p.isRoutingActive;
                                                                    if (pathFilter === 'DOWN') return !p.isRoutingActive && !p.isRoutingUsable && !p.isLinkUp;
                                                                    if (pathFilter === 'HUB') return p.peerSite.startsWith('DC') || p.peerSite.startsWith('BRGW') || p.peerDevice.startsWith('DC') || p.peerDevice.startsWith('BRGW');
                                                                    return true;
                                                                });

                                                                if (filteredPaths.length === 0) {
                                                                    return <tr><td colSpan={5} className="text-text-muted italic opacity-50 py-4 text-center">No matching overlay peers discovered</td></tr>;
                                                                }

                                                                // Sort paths by Peer Name, then by Activity
                                                                filteredPaths.sort((a, b) => a.peerSite.localeCompare(b.peerSite));

                                                                return filteredPaths.map((p: any, idx: number) => {
                                                                    // Logic for CSS styling based on state
                                                                    let lineStyle = "border-t border-dashed border-text-muted/30"; // Default unknown
                                                                    let tagBg = "bg-card-secondary/20";
                                                                    let tagText = "text-text-muted";
                                                                    let label = "UNKNOWN";

                                                                    if (p.isRoutingActive) {
                                                                        lineStyle = "border-t border-solid border-green-500/50";
                                                                        tagBg = "bg-green-500/10";
                                                                        tagText = "text-green-500";
                                                                        label = "ACTIVE";
                                                                    } else if (p.isRoutingUsable || p.isLinkUp) {
                                                                        lineStyle = "border-t border-dashed border-blue-500/50";
                                                                        tagBg = "bg-blue-500/10";
                                                                        tagText = "text-blue-500";
                                                                        label = "BACKUP";
                                                                    } else {
                                                                        lineStyle = "border-t border-solid border-red-500/50";
                                                                        tagBg = "bg-red-500/10";
                                                                        label = "DOWN";
                                                                    }

                                                                    return (
                                                                        <tr key={idx} className="group hover:bg-card/40 transition-colors">

                                                                            {/* Source Site & Device */}
                                                                            <td className="py-2 pl-3 rounded-l-lg border-y border-l bg-card/20 border-border/20 group-hover:border-border/60 text-right whitespace-nowrap min-w-[50px]">
                                                                                <div className="flex items-center justify-end gap-1 text-[9px] font-mono">
                                                                                    <span className="text-text-primary hidden lg:inline">{p.sourceSite}</span>
                                                                                    <span className="text-text-muted/50 hidden lg:inline">:</span>
                                                                                    <span className="text-blue-500 font-bold">{p.sourceDevice}</span>
                                                                                </div>
                                                                            </td>

                                                                            {/* Source Circuit */}
                                                                            <td className="py-2 px-1 border-y bg-card/20 border-border/20 group-hover:border-border/60 text-right whitespace-nowrap w-[1%]">
                                                                                <span className="text-[9px] font-mono text-text-secondary bg-card-secondary/50 px-1 py-0.5 rounded uppercase tracking-tighter inline-block">{p.sourceCircuit}</span>
                                                                            </td>

                                                                            {/* Center Status Arrow */}
                                                                            <td className="py-2 px-2 border-y bg-card/20 border-border/20 group-hover:border-border/60 text-center whitespace-nowrap w-[1%]">
                                                                                <div className="flex justify-center items-center opacity-90 pb-[1px]">
                                                                                    <span className="text-[9px] font-mono text-text-muted tracking-tighter hidden sm:inline">&lt;=</span>
                                                                                    <span className={cn("px-1.5 py-[1px] mx-1 rounded font-black text-[8px] tracking-wider text-center border min-w-[45px]", tagBg, tagText, p.isRoutingActive ? "border-green-500/20" : p.isRoutingUsable ? "border-blue-500/20" : "border-red-500/20")}>
                                                                                        {label}
                                                                                    </span>
                                                                                    <span className="text-[9px] font-mono text-text-muted tracking-tighter hidden sm:inline">=&gt;</span>
                                                                                </div>
                                                                            </td>

                                                                            {/* Dest Circuit */}
                                                                            <td className="py-2 px-1 border-y bg-card/20 border-border/20 group-hover:border-border/60 text-left whitespace-nowrap w-[1%]">
                                                                                <span className="text-[9px] font-mono text-text-secondary bg-card-secondary/50 px-1 py-0.5 rounded uppercase tracking-tighter inline-block">{p.destCircuit}</span>
                                                                            </td>

                                                                            {/* Dest Device & Site */}
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
                                    )}
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
                </>
            )
            }
        </div >
    );
}
