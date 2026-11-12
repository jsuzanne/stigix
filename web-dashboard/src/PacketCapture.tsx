import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
    Radio, Play, Square, Download, Loader2, RefreshCw, Search, Trash2, 
    Clock, HardDrive, Filter, Layers, Binary, CheckCircle2, 
    AlertCircle, ChevronRight, ChevronDown, Copy, Check, 
    FileText, ArrowRight, Zap, X, ShieldAlert, Cpu,
    BookmarkPlus, Sparkles, BookOpen, Plus, SlidersHorizontal, Terminal, Info, Globe, Server
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { usePeerContext } from './PeerContext';
import { StigixSelect, type StigixSelectGroup, type StigixSelectOption } from './components/common/StigixSelect';
import type { TargetDefinition } from './types/targets';

interface PacketCaptureProps {
    token: string;
    localSiteName?: string;
    onNavigateToReplay?: () => void;
}

interface InterfaceItem {
    name: string;
    label: string;
    ip: string;
    mac: string;
    is_default: boolean;
    is_egress?: boolean;
    category?: 'physical' | 'any' | 'tunnel' | 'loopback' | 'virtual';
    is_up: boolean;
}

function classifyInterfaceCategory(name: string): 'physical' | 'any' | 'tunnel' | 'loopback' | 'virtual' {
    if (name === 'any') return 'any';
    if (name === 'lo' || name.startsWith('lo')) return 'loopback';
    if (/^(veth|br-|docker|virbr|cni|flannel|cali)/.test(name)) return 'virtual';
    if (/^(tailscale|wg|tun|tap|zt|utun|ipsec|vti)/.test(name)) return 'tunnel';
    return 'physical';
}

interface PresetItem {
    id: string;
    name: string;
    bpf: string;
    description: string;
}

interface PacketItem {
    no: number;
    time: number;
    epoch: number;
    source: string;
    sport: number | null;
    destination: string;
    dport: number | null;
    protocol: string;
    length: number;
    info: string;
    tree: Record<string, any>;
    hex_dump: Array<{ offset: string; hex: string; ascii: string }>;
}

interface SavedCapture {
    filename: string;
    size_bytes: number;
    total_packets?: number;
    duration_seconds?: number;
    created_at: string;
    modified_at: string;
}

interface CustomBpfPreset {
    id: string;
    name: string;
    bpf: string;
    description?: string;
}

interface BpfRecipe {
    name: string;
    category: string;
    bpf: string;
    description: string;
}

const DEFAULT_CUSTOM_PRESETS: CustomBpfPreset[] = [
    {
        id: 'cust_tcp_syn_fin',
        name: 'TCP SYN or FIN Handshakes',
        bpf: 'tcp[tcpflags] & (tcp-syn|tcp-fin) != 0',
        description: 'Track connection setups (SYN) and teardowns (FIN)'
    },
    {
        id: 'cust_wan_isolate',
        name: 'WAN Traffic (Exclude Local LAN)',
        bpf: 'not (src net 192.168.0.0/16 and dst net 192.168.0.0/16)',
        description: 'Filter out local LAN chatter to inspect external WAN or overlay traffic'
    },
    {
        id: 'cust_jumbo_mtu',
        name: 'Jumbo Frames (> 1400 Bytes)',
        bpf: 'len > 1400',
        description: 'Examine high-throughput data transfer bursts and MTU payload sizes'
    },
    {
        id: 'cust_dns_encrypted',
        name: 'DNS Queries & Answers (Port 53 & 853)',
        bpf: 'port 53 or port 853',
        description: 'Capture standard DNS and DNS-over-TLS lookups'
    }
];

const BPF_RECIPES: BpfRecipe[] = [
    {
        category: 'TCP Handshake & Flags',
        name: 'TCP SYN Only (New Connections)',
        bpf: 'tcp[tcpflags] & (tcp-syn) != 0 and tcp[tcpflags] & (tcp-ack) == 0',
        description: 'Filter new outgoing or incoming TCP connection attempts (SYN scan detection)'
    },
    {
        category: 'TCP Handshake & Flags',
        name: 'TCP SYN-ACK (Server Accepts)',
        bpf: 'tcp[tcpflags] & (tcp-syn|tcp-ack) == (tcp-syn|tcp-ack)',
        description: 'Filter successful connection acknowledgments from remote servers or peers'
    },
    {
        category: 'TCP Handshake & Flags',
        name: 'TCP RST (Connection Resets)',
        bpf: 'tcp[tcpflags] & (tcp-rst) != 0',
        description: 'Detect aborted connections, firewall resets, or closed port rejections'
    },
    {
        category: 'TCP Handshake & Flags',
        name: 'TCP FIN or NULL Scans',
        bpf: 'tcp[tcpflags] & (tcp-fin) != 0 or tcp[13] == 0',
        description: 'Identify stealth port scans (XMAS, NULL, or FIN scans)'
    },
    {
        category: 'TCP Handshake & Flags',
        name: 'Zero Window (Buffer Saturation)',
        bpf: 'tcp[14:2] == 0 and not (tcp[tcpflags] & (tcp-rst) != 0)',
        description: 'Track TCP Zero Window advertisements indicating receiver buffer exhaustion'
    },
    {
        category: 'Network & Subnets',
        name: 'WAN Traffic Only (Exclude RFC1918 LAN)',
        bpf: 'not (src net 192.168.0.0/16 and dst net 192.168.0.0/16)',
        description: 'Filter out local LAN chatter to inspect external WAN or overlay traffic'
    },
    {
        category: 'Network & Subnets',
        name: 'Specific Subnet Cross-Talk',
        bpf: 'net 192.168.122.0/24 or net 10.0.0.0/8',
        description: 'Filter packets with either source or destination in designated subnets'
    },
    {
        category: 'Network & Subnets',
        name: 'Broadcast & Multicast Chatter',
        bpf: 'ether broadcast or ether multicast',
        description: 'Capture ARP, mDNS, LLDP, and routing broadcast announcements'
    },
    {
        category: 'Payload, MTU & Anomalies',
        name: 'Jumbo / Max MTU Packets (>1400B)',
        bpf: 'len > 1400',
        description: 'Examine high-throughput data transfer bursts and maximum segment sizes'
    },
    {
        category: 'Payload, MTU & Anomalies',
        name: 'Small Frames / Keepalives (<80B)',
        bpf: 'len < 80',
        description: 'Isolate pure ACKs, keepalives, and small control frames'
    },
    {
        category: 'Payload, MTU & Anomalies',
        name: 'Low TTL (< 5 Hops, Traceroute)',
        bpf: 'ip[8] < 5',
        description: 'Detect traceroutes, routing loops, or near-expiry transit packets'
    },
    {
        category: 'Payload, MTU & Anomalies',
        name: 'IP Fragmented Packets',
        bpf: 'ip[6:2] & 0x1fff != 0',
        description: 'Filter packets fragmented by intermediate MTU bottlenecks'
    },
    {
        category: 'Services & Protocols',
        name: 'DNS Queries & Answers (Port 53 & 853)',
        bpf: 'port 53 or port 853',
        description: 'Domain name resolution queries and DNS over TLS security flows'
    },
    {
        category: 'Services & Protocols',
        name: 'Web HTTP & HTTPS (80, 443, 8080)',
        bpf: 'tcp and (port 80 or port 443 or port 8080)',
        description: 'Unencrypted and TLS-encrypted web transactions'
    },
    {
        category: 'Services & Protocols',
        name: 'VoIP RTP & SIP Signaling',
        bpf: 'udp and (port 5060 or portrange 6000-6500)',
        description: 'Voice telephony session control and RTP audio streaming'
    },
    {
        category: 'Services & Protocols',
        name: 'ICMP Errors (Unreachable / Expired)',
        bpf: 'icmp and (icmp[0] == 3 or icmp[0] == 11)',
        description: 'Destination unreachable and Time-to-Live exceeded notifications'
    },
    {
        category: 'Services & Protocols',
        name: 'Network Infrastructure (DHCP & NTP)',
        bpf: 'udp and (port 67 or port 68 or port 123)',
        description: 'Address allocation and network time synchronization probes'
    }
];

interface ResolvedTarget {
    label: string;
    isKnownTarget: boolean;
    isLocal: boolean;
    type: 'stigix' | 'local' | 'lan' | 'wan' | 'special';
}

function cleanHost(host: string): string {
    if (!host) return '';
    const h = host.trim();
    if (h.startsWith('[') && h.includes(']')) {
        return h.substring(1, h.indexOf(']'));
    }
    if (h.includes('.') && h.includes(':')) {
        return h.split(':')[0];
    }
    return h;
}

function TargetBadge({ target, onClick }: { target: ResolvedTarget; onClick?: (label: string) => void }) {
    let colorClass = 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20';
    let icon: React.ReactNode = null;

    if (target.type === 'stigix') {
        colorClass = 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/25 hover:border-indigo-500/50 hover:bg-indigo-500/20';
        icon = <Server size={10} className="shrink-0 text-indigo-500 dark:text-indigo-400" />;
    } else if (target.type === 'local') {
        colorClass = 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/25 hover:border-cyan-500/50 hover:bg-cyan-500/20';
        icon = <Server size={10} className="shrink-0 text-cyan-500 dark:text-cyan-400" />;
    } else if (target.type === 'wan') {
        colorClass = 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25 hover:border-amber-500/50 hover:bg-amber-500/20';
        icon = <Globe size={10} className="shrink-0 text-amber-500 dark:text-amber-400" />;
    } else if (target.type === 'lan') {
        colorClass = 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/25 hover:border-slate-500/50 hover:bg-slate-500/20';
    } else if (target.type === 'special') {
        colorClass = 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/25 hover:border-purple-500/50 hover:bg-purple-500/20';
    }

    return (
        <button
            type="button"
            onClick={(e) => {
                if (onClick) {
                    e.stopPropagation();
                    onClick(target.label);
                }
            }}
            title={`Filter by target: ${target.label}`}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border max-w-full truncate transition-colors cursor-pointer select-none ${colorClass}`}
        >
            {icon}
            <span className="truncate">{target.label}</span>
        </button>
    );
}

export default function PacketCapture({ token, localSiteName, onNavigateToReplay }: PacketCaptureProps) {
    const { gFetch, activePeerId, activePeer, peers } = usePeerContext();

    const authHeaders = useMemo(() => ({
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    }), [token]);

    // System options
    const [interfaces, setInterfaces] = useState<InterfaceItem[]>([]);
    const [presets, setPresets] = useState<PresetItem[]>([]);
    const [targets, setTargets] = useState<TargetDefinition[]>([]);
    const [selectedInterface, setSelectedInterface] = useState<string>('any');
    const [selectedPreset, setSelectedPreset] = useState<string>('all');
    const [bpfFilter, setBpfFilter] = useState<string>('');
    const [durationSec, setDurationSec] = useState<number>(30);
    const [maxPackets, setMaxPackets] = useState<number>(2000);

    // Active session state
    const [capturing, setCapturing] = useState<boolean>(false);
    const [startingCapture, setStartingCapture] = useState<boolean>(false);
    const [stoppingCapture, setStoppingCapture] = useState<boolean>(false);
    const [dissectReadyFlash, setDissectReadyFlash] = useState<boolean>(false);
    const [downloadedFlash, setDownloadedFlash] = useState<boolean>(false);
    const [sendingReplay, setSendingReplay] = useState<boolean>(false);
    const [sentReplayFlash, setSentReplayFlash] = useState<boolean>(false);
    const [bpfAppliedFlash, setBpfAppliedFlash] = useState<string | null>(null);
    const [activeSession, setActiveSession] = useState<any>(null);
    const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

    // Control & deduplication refs
    const isCapturingRef = useRef<boolean>(false);
    const isStoppingRef = useRef<boolean>(false);
    const completedSessionIdRef = useRef<string | null>(null);
    const dissectingFileRef = useRef<string | null>(null);

    // Dissected packets
    const [packets, setPackets] = useState<PacketItem[]>([]);
    const [totalPackets, setTotalPackets] = useState<number>(0);
    const [selectedPacketNo, setSelectedPacketNo] = useState<number | null>(null);
    const [activePcapFile, setActivePcapFile] = useState<string>('');
    const [fileSizeBytes, setFileSizeBytes] = useState<number>(0);
    const [durationSeconds, setDurationSeconds] = useState<number>(0);
    const [loadingPackets, setLoadingPackets] = useState<boolean>(false);
    const [loadingMore, setLoadingMore] = useState<boolean>(false);
    const [autoScroll, setAutoScroll] = useState<boolean>(true);

    // Display filtering
    const [displayFilter, setDisplayFilter] = useState<string>('');

    // Accordion tree expansion
    const [expandedLayers, setExpandedLayers] = useState<Record<string, boolean>>({});

    // Custom BPF Presets
    const [customBpfPresets, setCustomBpfPresets] = useState<CustomBpfPreset[]>(() => {
        try {
            const stored = localStorage.getItem('stigix_custom_bpf_presets');
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch {}
        return DEFAULT_CUSTOM_PRESETS;
    });

    // Custom BPF Modals
    const [showSavePresetModal, setShowSavePresetModal] = useState<boolean>(false);
    const [newPresetName, setNewPresetName] = useState<string>('');
    const [newPresetDesc, setNewPresetDesc] = useState<string>('');
    const [newPresetBpf, setNewPresetBpf] = useState<string>('');

    const [showBpfLibraryModal, setShowBpfLibraryModal] = useState<boolean>(false);
    const [recipeSearch, setRecipeSearch] = useState<string>('');
    const [selectedRecipeCategory, setSelectedRecipeCategory] = useState<string>('All');

    // Sync custom presets to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('stigix_custom_bpf_presets', JSON.stringify(customBpfPresets));
        } catch {}
    }, [customBpfPresets]);

    const handlePresetSelect = (presetId: string) => {
        setSelectedPreset(presetId);
        if (presetId === 'custom') return;
        const builtIn = presets.find(p => p.id === presetId);
        if (builtIn) {
            setBpfFilter(builtIn.bpf);
            return;
        }
        const custom = customBpfPresets.find(p => p.id === presetId);
        if (custom) {
            setBpfFilter(custom.bpf);
            return;
        }
    };

    const isCustomPresetSelected = useMemo(() => {
        return customBpfPresets.some(p => p.id === selectedPreset);
    }, [customBpfPresets, selectedPreset]);

    const handleOpenSaveCustomBpfModal = () => {
        setNewPresetBpf(bpfFilter);
        setNewPresetName('');
        setNewPresetDesc('');
        setShowSavePresetModal(true);
    };

    const handleSaveCustomPreset = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!newPresetName.trim() || !newPresetBpf.trim()) {
            toast.error('Preset name and BPF expression are required');
            return;
        }
        const newId = `cust_${Date.now()}`;
        const newPreset: CustomBpfPreset = {
            id: newId,
            name: newPresetName.trim(),
            bpf: newPresetBpf.trim(),
            description: newPresetDesc.trim() || 'Custom user-defined BPF expression'
        };
        setCustomBpfPresets(prev => [...prev, newPreset]);
        setSelectedPreset(newId);
        setBpfFilter(newPreset.bpf);
        setShowSavePresetModal(false);
        setBpfAppliedFlash(`Saved "${newPreset.name}"`);
        setTimeout(() => setBpfAppliedFlash(null), 2000);
    };

    const handleDeleteCustomPreset = (presetId: string) => {
        const p = customBpfPresets.find(cp => cp.id === presetId);
        if (!p) return;
        setCustomBpfPresets(prev => prev.filter(cp => cp.id !== presetId));
        setSelectedPreset('all');
        setBpfFilter('');
    };

    const handleApplyRecipe = (recipe: BpfRecipe) => {
        setBpfFilter(recipe.bpf);
        setSelectedPreset('custom');
        setShowBpfLibraryModal(false);
        setBpfAppliedFlash('Recipe applied');
        setTimeout(() => setBpfAppliedFlash(null), 2000);
    };

    // History modal
    const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
    const [savedCaptures, setSavedCaptures] = useState<SavedCapture[]>([]);
    const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
    const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

    // Copy indicator
    const [copiedHex, setCopiedHex] = useState<boolean>(false);

    // Custom toolbar dropdown state
    const [openDropdown, setOpenDropdown] = useState<'interface' | 'preset' | 'duration' | 'limit' | null>(null);
    const [showVirtualInterfaces, setShowVirtualInterfaces] = useState<boolean>(false);
    const dropdownBarRef = useRef<HTMLDivElement>(null);

    // ── E2E Flow & Path Trace (NWPI) State ──
    const [captureMode, setCaptureMode] = useState<'local' | 'trace'>('local');
    const [traceSites, setTraceSites] = useState<Array<{
        site_id: string;
        site_name: string;
        role: string;
        connected: boolean;
        elements: Array<{ id: string; name: string; connected: boolean; role: string; software_version: string }>;
        stigix_peer?: { name: string; host: string; port: number; version: string; is_local: boolean } | null;
    }>>([]);
    const [detectedLocalSite, setDetectedLocalSite] = useState<string>(localSiteName || '');
    const [traceSourceSite, setTraceSourceSite] = useState<string>(localSiteName || 'BR8');
    const [traceSourceMode, setTraceSourceMode] = useState<'auto' | 'ion_only'>('auto');
    const [traceSrcIp, setTraceSrcIp] = useState<string>('');
    const [traceDestination, setTraceDestination] = useState<string>('192.168.212.100');
    const [traceDstPort, setTraceDstPort] = useState<number>(8098);
    const [traceProtocol, setTraceProtocol] = useState<'tcp' | 'udp' | 'icmp'>('tcp');
    const [traceGenerateProbe, setTraceGenerateProbe] = useState<boolean>(true);
    const [tracingFlow, setTracingFlow] = useState<boolean>(false);
    const [traceProgress, setTraceProgress] = useState<any>(null);
    const [traceResult, setTraceResult] = useState<any>(null);
    const [selectedHopId, setSelectedHopId] = useState<string>('hop_ingress_ion');
    const [traceEvidenceTab, setTraceEvidenceTab] = useState<'packets' | 'flows' | 'limits'>('packets');
    const [selectedTraceFlow, setSelectedTraceFlow] = useState<any | null>(null);
    const [showOnlyExactFlows, setShowOnlyExactFlows] = useState<boolean>(false);
    const [showTraceAdvanced, setShowTraceAdvanced] = useState<boolean>(false);
    const activeTraceIdRef = useRef<string>('');

    // Draggable Column Widths for Virtual Packet Table
    const DEFAULT_COL_WIDTHS = useMemo(() => ({
        no: 56,
        time: 95,
        source: 195,
        srcTarget: 145,
        destination: 195,
        dstTarget: 145,
        protocol: 80,
        length: 70,
        info: 380
    }), []);

    const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
        try {
            const saved = localStorage.getItem('stigix_pcap_col_widths');
            if (saved) return { ...DEFAULT_COL_WIDTHS, ...JSON.parse(saved) };
        } catch {}
        return DEFAULT_COL_WIDTHS;
    });

    // Save column widths to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('stigix_pcap_col_widths', JSON.stringify(colWidths));
        } catch {}
    }, [colWidths]);

    const resizingRef = useRef<{ colKey: string; startX: number; startWidth: number } | null>(null);

    const handleMouseDownResize = useCallback((colKey: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        resizingRef.current = {
            colKey,
            startX: e.clientX,
            startWidth: colWidths[colKey] || 100
        };

        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (!resizingRef.current) return;
            const diff = moveEvent.clientX - resizingRef.current.startX;
            const newWidth = Math.max(35, resizingRef.current.startWidth + diff);
            setColWidths(prev => ({ ...prev, [resizingRef.current!.colKey]: newWidth }));
        };

        const handleMouseUp = () => {
            resizingRef.current = null;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [colWidths]);

    const handleResetColWidths = useCallback(() => {
        setColWidths(DEFAULT_COL_WIDTHS);
        try {
            localStorage.removeItem('stigix_pcap_col_widths');
        } catch {}
    }, [DEFAULT_COL_WIDTHS]);

    useEffect(() => {
        if (!openDropdown) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownBarRef.current && !dropdownBarRef.current.contains(e.target as Node)) {
                setOpenDropdown(null);
            }
        };
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setOpenDropdown(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [openDropdown]);

    const tableEndRef = useRef<HTMLDivElement>(null);

    // Initial load: interfaces, presets, and targets (re-run when activePeerId changes)
    useEffect(() => {
        fetchInterfaces();
        fetchPresets();
        fetchTargets();
        checkActiveStatus();
        fetchTraceSites();
    }, [activePeerId]);

    const fetchTraceSites = async (force = false) => {
        try {
            const res = await gFetch(`/api/capture/trace-sites${force ? '?refresh=1' : ''}`, {
                credentials: 'include',
                headers: authHeaders
            });
            if (res.ok) {
                const data = await res.json();
                if (data.local_site_name) {
                    setDetectedLocalSite(data.local_site_name);
                    setTraceSourceSite(prev => prev || data.local_site_name);
                }
                if (Array.isArray(data.sites)) {
                    setTraceSites(data.sites);
                    if (data.local_site_name && data.sites.some((s: any) => s.site_name.toUpperCase() === data.local_site_name.toUpperCase())) {
                        const match = data.sites.find((s: any) => s.site_name.toUpperCase() === data.local_site_name.toUpperCase());
                        if (match) setTraceSourceSite(match.site_name);
                    } else if (data.sites.length > 0 && !traceSourceSite) {
                        setTraceSourceSite(data.sites[0].site_name);
                    }
                }
            }
        } catch (e) {
            console.error('Failed to load trace sites', e);
        }
    };

    // Poll real-time hop-by-hop progress while E2E Flow Trace is running
    useEffect(() => {
        if (!tracingFlow) return;
        let cancelled = false;
        const pollProgress = async () => {
            if (cancelled) return;
            try {
                const res = await gFetch('/api/capture/trace-flow/progress', {
                    credentials: 'include',
                    headers: authHeaders
                });
                if (!cancelled && res.ok) {
                    const prog = await res.json();
                    if (prog && prog.active && (!activeTraceIdRef.current || prog.trace_id === activeTraceIdRef.current)) {
                        setTraceProgress(prog);
                        const runningHop = (prog.hops || []).find((h: any) => h.status === 'RUNNING');
                        if (runningHop?.id) {
                            setSelectedHopId(runningHop.id);
                        }
                    }
                }
            } catch {}
        };
        const intervalId = setInterval(pollProgress, 750);
        return () => {
            cancelled = true;
            clearInterval(intervalId);
        };
    }, [tracingFlow, gFetch, authHeaders]);

    const handleRunFlowTrace = async (overrideParams?: {
        destination?: string;
        dstPort?: number;
        protocol?: 'tcp' | 'udp' | 'icmp';
        srcIp?: string;
        sourceSite?: string;
    }) => {
        if (tracingFlow) return;
        const effDst = (overrideParams?.destination ?? traceDestination).trim();
        const effPort = overrideParams?.dstPort ?? traceDstPort;
        const effProto = overrideParams?.protocol ?? traceProtocol;
        const effSrcIp = (overrideParams?.srcIp ?? traceSrcIp).trim();
        const effSite = (overrideParams?.sourceSite ?? traceSourceSite).trim() || detectedLocalSite || localSiteName || 'BR8';

        if (!effDst && !effSrcIp) {
            toast.error('Enter a destination IP/Domain or a Source IP to trace');
            return;
        }

        const currentTraceId = `trace_${Date.now()}`;
        activeTraceIdRef.current = currentTraceId;
        const effLocal = detectedLocalSite || localSiteName || 'BR8';
        const isLocalTrace = traceSourceMode !== 'ion_only' && effSite.toUpperCase() === effLocal.toUpperCase();
        const matchedSiteObj = traceSites.find((s) => s.site_name.toUpperCase() === effSite.toUpperCase());
        const remotePeer = !isLocalTrace && traceSourceMode !== 'ion_only' ? (matchedSiteObj?.stigix_peer || null) : null;
        const hasRemotePeer = Boolean(remotePeer && !remotePeer.is_local);
        const dstPortLabelInit = effProto === 'icmp' ? 'ICMP' : `${effProto.toUpperCase()}/${effPort || '*'}`;

        setSelectedTraceFlow(null);
        setDisplayFilter('');
        setSelectedHopId(isLocalTrace || hasRemotePeer ? 'hop_source' : 'hop_ingress_ion');
        setTraceProgress({
            active: true,
            trace_id: currentTraceId,
            phase: isLocalTrace ? 'LOCAL_CAPTURE_AND_PROBE' : hasRemotePeer ? 'REMOTE_PEER_AND_ION_CLI' : 'INGRESS_ION_CLI',
            phase_label: isLocalTrace
                ? `Recording local PCAP & dispatching synthetic ${effProto.toUpperCase()} probe from ${effSite}...`
                : hasRemotePeer && remotePeer
                ? `Triggering remote Stigix Peer ${remotePeer.name} (${remotePeer.host}) & querying ${effSite} vION CLI...`
                : `Querying ${effSite} vION flow table via WebSocket CLI...`,
            flow_identity: {
                probe_5tuple: `${effSrcIp || (hasRemotePeer && remotePeer ? remotePeer.host : 'Auto Source')} → ${effDst}${effPort && effProto !== 'icmp' ? `:${effPort}` : ''} · ${effProto.toUpperCase()}`
            },
            hops: [
                {
                    id: 'hop_source',
                    role: isLocalTrace ? 'SOURCE_STIGIX' : hasRemotePeer ? 'SOURCE_REMOTE_STIGIX' : 'SOURCE_CLIENT_AGENTLESS',
                    role_label: isLocalTrace ? 'Source Probe' : hasRemotePeer ? 'Remote Stigix Peer' : 'Site Client (Agentless)',
                    title: isLocalTrace || hasRemotePeer ? `Stigix ${effSite}` : `Client (${effSite})`,
                    subtitle: effSrcIp || (isLocalTrace ? 'Capturing local NIC...' : hasRemotePeer && remotePeer ? `${remotePeer.host} (${remotePeer.name})` : 'Agentless Mode'),
                    status: isLocalTrace || hasRemotePeer ? 'RUNNING' : 'PASSIVE',
                    badge: isLocalTrace ? 'Capturing PCAP + Probe...' : hasRemotePeer && remotePeer ? `Stigix Peer (${remotePeer.host})` : 'No Local Probe',
                    evidence_type: isLocalTrace ? 'Local PCAP + Active Probe' : hasRemotePeer && remotePeer ? `Remote Stigix Peer (${remotePeer.version ? 'v' + remotePeer.version : 'Active'})` : 'Agentless (No Local Probe)'
                },
                {
                    id: 'hop_ingress_ion',
                    role: 'INGRESS_ION',
                    role_label: 'Ingress ION',
                    title: `ION ${effSite}`,
                    subtitle: 'Waiting for probe generation',
                    status: isLocalTrace ? 'PENDING' : 'RUNNING',
                    badge: isLocalTrace ? 'Pending' : 'Inspecting Flow Table...',
                    evidence_type: 'vION Flow Table'
                },
                {
                    id: 'hop_transit',
                    role: 'TRANSIT_ION',
                    role_label: 'Transit / Egress Path',
                    title: 'Transit Hub / Egress',
                    subtitle: 'Pending ingress routing decision',
                    status: 'PENDING',
                    badge: 'Pending',
                    evidence_type: 'SD-WAN Control & Dataplane'
                },
                {
                    id: 'hop_destination',
                    role: 'DESTINATION',
                    role_label: `Destination ${dstPortLabelInit}`,
                    title: effDst || 'Destination',
                    subtitle: effDst,
                    status: 'PENDING',
                    badge: 'Pending',
                    evidence_type: 'Source Probe · No Remote Capture'
                }
            ]
        });
        setTracingFlow(true);

        try {
            const res = await gFetch('/api/capture/trace-flow', {
                method: 'POST',
                credentials: 'include',
                headers: authHeaders,
                body: JSON.stringify({
                    traceId: currentTraceId,
                    sourceSite: effSite,
                    sourceMode: traceSourceMode,
                    srcIp: effSrcIp,
                    destination: effDst,
                    dstPort: effPort,
                    protocol: effProto,
                    generateProbe: traceGenerateProbe,
                    interface: selectedInterface
                })
            });
            const data = await res.json();
            if (activeTraceIdRef.current !== currentTraceId) {
                return;
            }
            if (!res.ok || data.success === false) {
                throw new Error(data.error || `Trace failed (HTTP ${res.status})`);
            }
            setTraceResult(data);
            setTraceProgress(null);

            // Smart auto-selection of the most relevant hop for the detail panel
            const hopsList: any[] = Array.isArray(data.hops) ? data.hops : [];
            const anomalyHop = hopsList.find((h) =>
                ['BLOCKED', 'UNREACHABLE', 'UNAVAILABLE', 'NOT_OBSERVED'].includes(String(h.status || '').toUpperCase())
            );
            if (anomalyHop?.id) {
                setSelectedHopId(anomalyHop.id);
            } else if (hopsList.some((h) => h.id === 'hop_ingress_ion')) {
                setSelectedHopId('hop_ingress_ion');
            } else if (hopsList[0]?.id) {
                setSelectedHopId(hopsList[0].id);
            }

            // If local PCAP packets were captured during the trace, load them directly into the 3-Pane Wireshark Dissector!
            if (data.pcap && Array.isArray(data.pcap.packets)) {
                setPackets(data.pcap.packets);
                setTotalPackets(data.pcap.total_packets || data.pcap.packets.length);
                setActivePcapFile(data.pcap.filename || '');
                setFileSizeBytes(data.pcap.file_size_bytes || 0);
                setDurationSeconds(data.pcap.duration_seconds || 0);
                if (data.pcap.packets.length > 0) {
                    setSelectedPacketNo(data.pcap.packets[0].no);
                    setExpandedLayers({
                        'Frame': true,
                        'Internet Protocol Version 4': true,
                        'Transmission Control Protocol': true,
                        'User Datagram Protocol': true
                    });
                }
                setTraceEvidenceTab('packets');
            } else {
                setPackets([]);
                setTotalPackets(0);
                setActivePcapFile('');
                setFileSizeBytes(0);
                setDurationSeconds(0);
                setSelectedPacketNo(null);
                setTraceEvidenceTab('flows');
            }
        } catch (e: any) {
            if (activeTraceIdRef.current === currentTraceId) {
                toast.error(`Flow Trace error: ${e.message}`);
            }
        } finally {
            if (activeTraceIdRef.current === currentTraceId) {
                setTracingFlow(false);
            }
        }
    };

    const fetchInterfaces = async () => {
        try {
            const [res, cfgRes] = await Promise.all([
                gFetch('/api/capture/interfaces', { credentials: 'include', headers: authHeaders }),
                gFetch('/api/config/interfaces', { credentials: 'include', headers: authHeaders }).catch(() => null)
            ]);

            let configuredPrimary = '';
            if (cfgRes && cfgRes.ok) {
                try {
                    const cfgList = await cfgRes.json();
                    if (Array.isArray(cfgList) && cfgList.length > 0 && typeof cfgList[0] === 'string') {
                        configuredPrimary = cfgList[0].trim().split(/\s+/)[0].split(':')[0];
                    }
                } catch {}
            }

            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    // Normalize categories & egress detection (handles both new and legacy remote engines)
                    const enriched: InterfaceItem[] = data.map((item: InterfaceItem) => {
                        const category = item.category || classifyInterfaceCategory(item.name);
                        const isEgress = Boolean(
                            item.is_egress ||
                            (configuredPrimary && item.name === configuredPrimary) ||
                            (item.is_default && item.name !== 'any')
                        );
                        return {
                            ...item,
                            category,
                            is_egress: isEgress
                        };
                    });

                    // If no egress interface was explicitly flagged yet, pick the first UP physical interface with an IPv4
                    if (!enriched.some(i => i.is_egress)) {
                        const fallbackPhysical = enriched.find(
                            i => i.category === 'physical' && i.is_up && i.ip && i.ip !== '-' && i.ip !== '0.0.0.0'
                        );
                        if (fallbackPhysical) {
                            fallbackPhysical.is_egress = true;
                        }
                    }

                    // Sort: egress first -> physical (with IP first) -> any -> tunnel -> loopback -> virtual
                    const catOrder: Record<string, number> = {
                        physical: 1,
                        any: 2,
                        tunnel: 3,
                        loopback: 4,
                        virtual: 5
                    };
                    enriched.sort((a, b) => {
                        if (Boolean(a.is_egress) !== Boolean(b.is_egress)) {
                            return a.is_egress ? -1 : 1;
                        }
                        const catA = catOrder[a.category || 'physical'] || 3;
                        const catB = catOrder[b.category || 'physical'] || 3;
                        if (catA !== catB) return catA - catB;
                        const hasIpA = a.ip && a.ip !== '-' && a.ip !== '0.0.0.0' ? 0 : 1;
                        const hasIpB = b.ip && b.ip !== '-' && b.ip !== '0.0.0.0' ? 0 : 1;
                        if (hasIpA !== hasIpB) return hasIpA - hasIpB;
                        return a.name.localeCompare(b.name);
                    });

                    setInterfaces(enriched);

                    // Select egress interface by default (fallback to 'any')
                    const preferred = enriched.find(i => i.is_egress) || enriched.find(i => i.is_default) || enriched[0];
                    if (preferred) {
                        setSelectedInterface(preferred.name);
                    }
                }
            }
        } catch (e) {
            console.error('Failed to load interfaces', e);
        }
    };

    const fetchPresets = async () => {
        try {
            const res = await gFetch('/api/capture/presets', { credentials: 'include', headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) setPresets(data);
            }
        } catch (e) {
            console.error('Failed to load presets', e);
        }
    };

    const fetchTargets = async () => {
        try {
            const res = await gFetch('/api/targets', { credentials: 'include', headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) setTargets(data);
            }
        } catch (e) {
            console.error('Failed to load targets', e);
        }
    };

    const checkActiveStatus = async () => {
        try {
            const res = await gFetch('/api/capture/status', { credentials: 'include', headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                if (data.active) {
                    isCapturingRef.current = true;
                    setCapturing(true);
                    setActiveSession(data);
                    setActivePcapFile(data.pcap_filename || '');
                    setElapsedSeconds(data.elapsed_seconds || 0);
                } else if (data.pcap_filename && !activePcapFile) {
                    setActivePcapFile(data.pcap_filename);
                    setFileSizeBytes(data.file_size_bytes || 0);
                }
            }
        } catch (e) {
            console.error('Failed to check capture status', e);
        }
    };

    // Live capture polling timer (sequential chained setTimeout prevents overlapping polls and duplicate events)
    useEffect(() => {
        if (!capturing) return;

        let timerId: ReturnType<typeof setTimeout> | null = null;
        let isCancelled = false;

        const pollStatus = async () => {
            if (isCancelled || !isCapturingRef.current || isStoppingRef.current) {
                return;
            }

            try {
                const res = await gFetch('/api/capture/status', { credentials: 'include', headers: authHeaders });
                if (isCancelled || !isCapturingRef.current || isStoppingRef.current) {
                    return;
                }

                if (res.ok) {
                    const status = await res.json();
                    setElapsedSeconds(status.elapsed_seconds || 0);
                    setFileSizeBytes(status.file_size_bytes || 0);

                    if (!status.active) {
                        // Capture finished on server (auto-stopped by duration or max packets)
                        const sessionKey = status.session_id || status.pcap_filename || 'completed';
                        if (completedSessionIdRef.current !== sessionKey) {
                            completedSessionIdRef.current = sessionKey;
                            isCapturingRef.current = false;
                            setCapturing(false);
                            setActiveSession(null);
                            if (status.pcap_filename) {
                                loadDissectedPackets(status.pcap_filename);
                            }
                        }
                        return; // Stop polling loop
                    } else {
                        // Fetch incremental packets while running
                        await fetchLivePackets();
                    }
                }
            } catch (e) {
                console.error('Status poll error', e);
            }

            // Schedule next poll only if still actively capturing and not cancelled
            if (!isCancelled && isCapturingRef.current && !isStoppingRef.current) {
                timerId = setTimeout(pollStatus, 1800);
            }
        };

        timerId = setTimeout(pollStatus, 1800);

        return () => {
            isCancelled = true;
            if (timerId) clearTimeout(timerId);
        };
    }, [capturing]);

    const fetchLivePackets = async () => {
        try {
            const res = await gFetch(`/api/capture/packets?limit=500`, { credentials: 'include', headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.packets) && data.packets.length > 0) {
                    setPackets(data.packets);
                    setTotalPackets(data.total_packets || data.packets.length);
                    if (selectedPacketNo === null && data.packets.length > 0) {
                        setSelectedPacketNo(data.packets[0].no);
                    }
                }
            }
        } catch (e) {}
    };

    const loadDissectedPackets = async (filename?: string) => {
        const targetFile = filename || activePcapFile;
        if (!targetFile) return;

        // Prevent duplicate concurrent dissection calls for the exact same file
        if (dissectingFileRef.current === targetFile) {
            return;
        }
        dissectingFileRef.current = targetFile;

        setLoadingPackets(true);
        setDissectReadyFlash(false);
        setPackets([]);
        setSelectedPacketNo(null);
        setActivePcapFile(targetFile);

        try {
            const fileQuery = `?file=${encodeURIComponent(targetFile)}&limit=250`;
            const res = await gFetch(`/api/capture/packets${fileQuery}`, { credentials: 'include', headers: authHeaders });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${res.status}`);
            }
            const data = await res.json();
            if (data.error) {
                throw new Error(data.error);
            }
            if (Array.isArray(data.packets)) {
                setPackets(data.packets);
                setTotalPackets(data.total_packets || data.packets.length);
                setFileSizeBytes(data.file_size_bytes || 0);
                setDurationSeconds(data.duration_seconds || 0);
                if (data.file) setActivePcapFile(data.file);
                if (data.packets.length > 0) {
                    setSelectedPacketNo(data.packets[0].no);
                    // Expand top two layers by default
                    setExpandedLayers({
                        'Frame': true,
                        'Internet Protocol Version 4': true,
                        'Transmission Control Protocol': true,
                        'User Datagram Protocol': true
                    });
                }
                setDissectReadyFlash(true);
                setTimeout(() => setDissectReadyFlash(false), 1800);
            }
        } catch (e: any) {
            toast.error(`Failed to load packets: ${e.message}`);
        } finally {
            setLoadingPackets(false);
            dissectingFileRef.current = null;
        }
    };

    const handleLoadMorePackets = async () => {
        if (loadingMore || !activePcapFile || packets.length >= totalPackets) return;
        setLoadingMore(true);
        try {
            const fileQuery = `?file=${encodeURIComponent(activePcapFile)}&offset=${packets.length}&limit=150`;
            const res = await gFetch(`/api/capture/packets${fileQuery}`, { credentials: 'include', headers: authHeaders });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${res.status}`);
            }
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            if (Array.isArray(data.packets) && data.packets.length > 0) {
                setPackets(prev => [...prev, ...data.packets]);
            }
        } catch (e: any) {
            toast.error(`Failed to load more packets: ${e.message}`);
        } finally {
            setLoadingMore(false);
        }
    };

    const handleStartCapture = async () => {
        if (startingCapture || capturing) return;
        setStartingCapture(true);
        setDissectReadyFlash(false);
        setPackets([]);
        setTotalPackets(0);
        setSelectedPacketNo(null);
        setElapsedSeconds(0);
        completedSessionIdRef.current = null;
        isStoppingRef.current = false;

        try {
            const res = await gFetch('/api/capture/start', {
                method: 'POST',
                credentials: 'include',
                headers: authHeaders,
                body: JSON.stringify({
                    interface: selectedInterface,
                    bpf: bpfFilter,
                    duration: durationSec,
                    maxPackets: maxPackets,
                    snaplen: 1500
                })
            });

            const data = await res.json();
            if (res.ok && data.active) {
                isCapturingRef.current = true;
                setCapturing(true);
                setActiveSession(data);
                setActivePcapFile(data.pcap_filename);
            } else {
                toast.error(data.error || 'Failed to start capture');
            }
        } catch (e: any) {
            toast.error(`Error: ${e.message}`);
        } finally {
            setStartingCapture(false);
        }
    };

    const handleStopCapture = async () => {
        if (isStoppingRef.current) return;
        isStoppingRef.current = true;
        isCapturingRef.current = false;
        setStoppingCapture(true);
        setCapturing(false);

        try {
            const res = await gFetch('/api/capture/stop', {
                method: 'POST',
                credentials: 'include',
                headers: authHeaders
            });
            if (res.ok) {
                const data = await res.json();
                setActiveSession(null);
                const targetFile = data.pcap_filename || activePcapFile;
                // Mark session as completed so background poller doesn't trigger duplicate notifications
                completedSessionIdRef.current = data.session_id || targetFile || 'stopped';
                if (targetFile) {
                    loadDissectedPackets(targetFile);
                }
            }
        } catch (e: any) {
            toast.error(`Error stopping capture: ${e.message}`);
        } finally {
            isStoppingRef.current = false;
            setStoppingCapture(false);
        }
    };

    const handleSendToReplay = async () => {
        if (!activePcapFile || sendingReplay) {
            return;
        }
        setSendingReplay(true);

        try {
            const res = await gFetch('/api/capture/send-to-replay', {
                method: 'POST',
                credentials: 'include',
                headers: authHeaders,
                body: JSON.stringify({ filename: activePcapFile })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setSentReplayFlash(true);
                setTimeout(() => setSentReplayFlash(false), 2000);
                if (onNavigateToReplay) {
                    setTimeout(() => onNavigateToReplay(), 800);
                }
            } else {
                toast.error(data.error || 'Failed to transfer PCAP to replay catalog');
            }
        } catch (e: any) {
            toast.error(`Transfer error: ${e.message}`);
        } finally {
            setSendingReplay(false);
        }
    };

    const handleOpenHistory = async () => {
        setShowHistoryModal(true);
        setLoadingHistory(true);
        try {
            const res = await gFetch('/api/capture/history', { credentials: 'include', headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) setSavedCaptures(data);
            }
        } catch (e) {
            toast.error('Failed to load capture history');
        } finally {
            setLoadingHistory(false);
        }
    };

    const handleDeleteCapture = async (filename: string) => {
        if (!confirm(`Permanently delete capture "${filename}"?`)) return;
        try {
            const res = await gFetch(`/api/capture/${encodeURIComponent(filename)}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: authHeaders
            });
            if (res.ok) {
                setSavedCaptures(prev => prev.filter(c => c.filename !== filename));
                if (activePcapFile === filename) {
                    setActivePcapFile('');
                    setPackets([]);
                    setSelectedPacketNo(null);
                }
                toast.success('Capture deleted');
            }
        } catch (e: any) {
            toast.error(`Delete failed: ${e.message}`);
        }
    };

    const handleDownloadCapture = async (filename: string) => {
        if (!filename) return;
        setDownloadingFile(filename);
        try {
            const downloadUrl = `/api/capture/download/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}`;
            const res = await gFetch(downloadUrl, {
                credentials: 'include',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (!res.ok) {
                let errMsg = `Download failed with status ${res.status}`;
                try {
                    const errJson = await res.json();
                    if (errJson?.error) errMsg = errJson.error;
                } catch {
                    // Ignore non-json body
                }
                throw new Error(errMsg);
            }
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            }, 2000);
            setDownloadedFlash(true);
            setTimeout(() => setDownloadedFlash(false), 2000);
        } catch (e: any) {
            console.error('Download capture error:', e);
            toast.error(e.message || 'Download failed');
        } finally {
            setDownloadingFile(null);
        }
    };

    const handleSelectPreset = (preset: PresetItem) => {
        setSelectedPreset(preset.id);
        setBpfFilter(preset.bpf);
    };

    // Map of IP -> ResolvedTarget
    const ipToTargetMap = useMemo(() => {
        const map = new Map<string, ResolvedTarget>();

        // 1. Determine local node site name
        const leaderPeer = peers.find(p => p.is_leader);
        const localSite = localSiteName || activePeer?.site || leaderPeer?.site || 'BR8';

        // 2. Register local node interfaces
        interfaces.forEach(iface => {
            const clean = cleanHost(iface.ip);
            if (clean && clean !== '-' && clean !== '0.0.0.0') {
                map.set(clean, {
                    label: localSite,
                    isKnownTarget: true,
                    isLocal: true,
                    type: 'local'
                });
            }
        });
        if (activePeer?.ip_private) {
            const clean = cleanHost(activePeer.ip_private);
            if (clean) {
                map.set(clean, {
                    label: localSite,
                    isKnownTarget: true,
                    isLocal: true,
                    type: 'local'
                });
            }
        }

        // 3. Register peers from PeerContext
        peers.forEach(peer => {
            const isLocal = Boolean(activePeer?.instance_id ? peer.instance_id === activePeer.instance_id : peer.is_leader);
            const siteName = peer.site || peer.instance_id;
            const label = isLocal ? localSite : siteName;
            if (peer.ip_private) {
                const clean = cleanHost(peer.ip_private);
                if (clean && !map.has(clean)) {
                    map.set(clean, {
                        label,
                        isKnownTarget: true,
                        isLocal,
                        type: isLocal ? 'local' : 'stigix'
                    });
                }
            }
        });

        // 4. Register targets from /api/targets
        targets.forEach(tgt => {
            const cleanHostIp = cleanHost(tgt.host);
            if (cleanHostIp && !map.has(cleanHostIp)) {
                map.set(cleanHostIp, {
                    label: tgt.name,
                    isKnownTarget: true,
                    isLocal: false,
                    type: 'stigix'
                });
            }
            if (tgt.meta?.ip_public) {
                const cleanPub = cleanHost(tgt.meta.ip_public);
                if (cleanPub && !map.has(cleanPub)) {
                    map.set(cleanPub, {
                        label: tgt.name,
                        isKnownTarget: true,
                        isLocal: false,
                        type: 'stigix'
                    });
                }
            }
        });

        return map;
    }, [targets, interfaces, peers, activePeer]);

    // Resolve an IP address to a Stigix Target, LAN, WAN, or special category
    const resolveTarget = useCallback((rawIp: string): ResolvedTarget => {
        if (!rawIp) {
            return { label: '-', isKnownTarget: false, isLocal: false, type: 'special' };
        }
        const ip = cleanHost(rawIp);
        if (!ip || ip === '-') {
            return { label: '-', isKnownTarget: false, isLocal: false, type: 'special' };
        }
        if (ipToTargetMap.has(ip)) {
            return ipToTargetMap.get(ip)!;
        }

        // Loopback
        if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.')) {
            return { label: 'Loopback', isKnownTarget: false, isLocal: false, type: 'special' };
        }

        // Broadcast / Multicast
        if (ip === '255.255.255.255' || ip.endsWith('.255')) {
            return { label: 'Bcast', isKnownTarget: false, isLocal: false, type: 'special' };
        }
        if (ip.startsWith('224.') || ip.startsWith('239.') || ip.startsWith('ff')) {
            return { label: 'Mcast', isKnownTarget: false, isLocal: false, type: 'special' };
        }

        // MAC address check (e.g. ARP frame with MAC in source)
        if (/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(ip)) {
            return { label: 'L2 MAC', isKnownTarget: false, isLocal: false, type: 'special' };
        }

        // RFC 1918 Private Ranges
        const isRfc1918 = 
            ip.startsWith('10.') || 
            ip.startsWith('192.168.') || 
            /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip) ||
            /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./.test(ip) || // CGNAT
            ip.startsWith('169.254.'); // Link-local

        if (isRfc1918) {
            return { label: 'LAN', isKnownTarget: false, isLocal: false, type: 'lan' };
        }

        // External / Public WAN
        return { label: 'WAN', isKnownTarget: false, isLocal: false, type: 'wan' };
    }, [ipToTargetMap]);

    // Filtered packet list based on display filter
    const filteredPackets = useMemo(() => {
        if (!displayFilter.trim()) return packets;
        const q = displayFilter.trim().toLowerCase();
        return packets.filter(p => {
            if (p.protocol.toLowerCase().includes(q)) return true;
            if (p.source.toLowerCase().includes(q)) return true;
            if (p.destination.toLowerCase().includes(q)) return true;
            if (p.info.toLowerCase().includes(q)) return true;
            if (String(p.sport).includes(q) || String(p.dport).includes(q)) return true;
            if (q === 'rst' && p.info.includes('RST')) return true;
            if (q === 'syn' && p.info.includes('SYN')) return true;
            if (q === 'ack' && p.info.includes('ACK')) return true;
            const srcTarget = resolveTarget(p.source);
            if (srcTarget.label.toLowerCase().includes(q)) return true;
            const dstTarget = resolveTarget(p.destination);
            if (dstTarget.label.toLowerCase().includes(q)) return true;
            return false;
        });
    }, [packets, displayFilter, resolveTarget]);

    // Currently selected packet
    const activePacket = useMemo(() => {
        if (selectedPacketNo === null) return packets[0] || null;
        return packets.find(p => p.no === selectedPacketNo) || packets[0] || null;
    }, [packets, selectedPacketNo]);

    const toggleLayer = (layerName: string) => {
        setExpandedLayers(prev => ({
            ...prev,
            [layerName]: !prev[layerName]
        }));
    };

    const copyRawHex = () => {
        if (!activePacket || !activePacket.hex_dump) return;
        const fullHex = activePacket.hex_dump.map(h => `${h.offset}  ${h.hex}  ${h.ascii}`).join('\n');
        navigator.clipboard.writeText(fullHex);
        setCopiedHex(true);
        setTimeout(() => setCopiedHex(false), 2000);
    };

    const getProtoColorClass = (proto: string, info: string) => {
        if (info.includes('RST')) return 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30';
        switch (proto.toUpperCase()) {
            case 'TCP': return 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-400 border-cyan-500/30';
            case 'UDP': return 'bg-amber-500/15 text-amber-800 dark:text-amber-400 border-amber-500/30';
            case 'ICMP': return 'bg-purple-500/15 text-purple-800 dark:text-purple-400 border-purple-500/30';
            case 'DNS': return 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border-emerald-500/30';
            case 'TLS': return 'bg-blue-500/15 text-blue-800 dark:text-blue-400 border-blue-500/30';
            case 'HTTP': return 'bg-teal-500/15 text-teal-800 dark:text-teal-400 border-teal-500/30';
            case 'RTP': return 'bg-orange-500/15 text-orange-800 dark:text-orange-400 border-orange-500/30';
            case 'ARP': return 'bg-slate-500/15 text-slate-800 dark:text-slate-400 border-slate-500/30';
            default: return 'bg-card-secondary text-text-muted border-border';
        }
    };

    return (
        <div className="space-y-4 animate-in fade-in duration-300 w-full">
            {/* Top Header Card */}
            <div className="bg-card border border-border p-4 rounded-2xl shadow-sm">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-cyan-600/10 rounded-xl text-cyan-400 border border-cyan-500/20 shrink-0">
                            <Radio size={22} className={capturing ? "animate-pulse text-rose-400" : ""} />
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                            <h2 className="text-lg font-black text-text-primary tracking-tight whitespace-nowrap">Packet Capture</h2>

                            {/* Mode Switcher: Local PCAP vs E2E Flow & Path Trace (NWPI) */}
                            <div className="inline-flex items-center bg-card-secondary border border-border rounded-xl p-0.5 text-[11px] font-black">
                                <button
                                    type="button"
                                    onClick={() => setCaptureMode('local')}
                                    className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                                        captureMode === 'local'
                                            ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/40 dark:border-cyan-500/30 shadow-sm'
                                            : 'text-text-muted hover:text-text-primary border border-transparent'
                                    }`}
                                >
                                    <Radio size={12} />
                                    <span>Local PCAP</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setCaptureMode('trace')}
                                    className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                                        captureMode === 'trace'
                                            ? 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-500/40 dark:border-indigo-500/30 shadow-sm'
                                            : 'text-text-muted hover:text-text-primary border border-transparent'
                                    }`}
                                >
                                    <Sparkles size={12} />
                                    <span>E2E Flow &amp; Path Trace (NWPI)</span>
                                </button>
                            </div>

                            {captureMode === 'local' && !capturing && !loadingPackets && activePcapFile && (
                                <span className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold border flex items-center gap-2 whitespace-nowrap transition-colors ${
                                    dissectReadyFlash
                                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40'
                                        : 'bg-card-secondary text-text-muted border-border'
                                }`}>
                                    <span className="text-text-primary font-bold">{activePcapFile.split('/').pop()}</span>
                                    <span className="text-cyan-600 dark:text-cyan-400 font-bold flex items-center gap-0.5">
                                        <Binary size={11} />
                                        {totalPackets.toLocaleString()} pkts
                                    </span>
                                    {durationSeconds > 0 && (
                                        <span className="text-amber-600 dark:text-amber-400 font-bold flex items-center gap-0.5">
                                            <Clock size={11} />
                                            {durationSeconds}s
                                        </span>
                                    )}
                                    <span className="text-text-muted">
                                        {fileSizeBytes ? `(${(fileSizeBytes / 1024).toFixed(1)} KB)` : ''}
                                    </span>
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Action Buttons (Full toolbar in Local PCAP mode; discrete Captures history access in E2E Trace mode) */}
                    <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
                        {captureMode === 'local' ? (
                            <>
                                {/* 5-Phase Evolving Primary Capture Button */}
                                {capturing ? (
                                    <button
                                        onClick={handleStopCapture}
                                        className="relative overflow-hidden px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg shadow-rose-900/40 cursor-pointer"
                                        title="Click to stop capture and dissect packets immediately"
                                    >
                                        <span
                                            className="absolute inset-y-0 left-0 bg-white/15 transition-all duration-700 pointer-events-none"
                                            style={{ width: `${Math.min(100, Math.round((elapsedSeconds / Math.max(1, durationSec)) * 100))}%` }}
                                        />
                                        <span className="relative flex items-center gap-2">
                                            <Square size={13} fill="currentColor" className="animate-pulse" />
                                            <span>Stop Capture</span>
                                            <span className="font-mono text-[11px] bg-black/25 px-2 py-0.5 rounded-md">
                                                {elapsedSeconds}s / {durationSec}s
                                                {totalPackets > 0 ? ` · ${totalPackets.toLocaleString()} pkts` : ''}
                                            </span>
                                        </span>
                                    </button>
                                ) : stoppingCapture ? (
                                    <button
                                        disabled
                                        className="px-5 py-2.5 bg-amber-600/80 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg cursor-wait"
                                    >
                                        <Loader2 size={14} className="animate-spin" />
                                        <span>Stopping capture…</span>
                                    </button>
                                ) : loadingPackets ? (
                                    <button
                                        disabled
                                        className="px-5 py-2.5 bg-cyan-600/90 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg shadow-cyan-900/30 cursor-wait"
                                    >
                                        <Loader2 size={14} className="animate-spin" />
                                        <span>Dissecting {activePcapFile ? activePcapFile.split('/').pop() : 'PCAP'}…</span>
                                    </button>
                                ) : startingCapture ? (
                                    <button
                                        disabled
                                        className="px-5 py-2.5 bg-emerald-600/80 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg cursor-wait"
                                    >
                                        <Loader2 size={14} className="animate-spin" />
                                        <span>Starting on {selectedInterface}…</span>
                                    </button>
                                ) : dissectReadyFlash ? (
                                    <button
                                        onClick={handleStartCapture}
                                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg shadow-emerald-900/40 ring-2 ring-emerald-400/60 cursor-pointer"
                                    >
                                        <Check size={14} />
                                        <span>{totalPackets.toLocaleString()} pkts Ready · New Capture</span>
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleStartCapture}
                                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg shadow-emerald-900/40 cursor-pointer"
                                    >
                                        <Play size={14} fill="currentColor" />
                                        <span>Start Capture</span>
                                    </button>
                                )}

                                <button
                                    onClick={handleOpenHistory}
                                    className="px-3.5 py-2.5 bg-card-secondary hover:bg-card-hover border border-border rounded-xl text-xs font-black uppercase tracking-wider text-text-muted hover:text-text-primary transition-all flex items-center gap-1.5 cursor-pointer"
                                    title="View saved PCAP captures"
                                >
                                    <HardDrive size={13} />
                                    Captures
                                </button>

                                {activePcapFile && (
                                    <>
                                        <button
                                            onClick={() => handleDownloadCapture(activePcapFile)}
                                            disabled={downloadingFile === activePcapFile}
                                            className={`px-3.5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 border ${
                                                downloadedFlash
                                                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-300'
                                                    : 'bg-card-secondary hover:bg-card-hover border-border text-text-muted hover:text-text-primary'
                                            }`}
                                            title="Download raw .pcap for local Wireshark"
                                        >
                                            {downloadingFile === activePcapFile ? (
                                                <>
                                                    <Loader2 size={13} className="animate-spin text-cyan-600 dark:text-cyan-400" />
                                                    <span>Downloading…</span>
                                                </>
                                            ) : downloadedFlash ? (
                                                <>
                                                    <Check size={13} className="text-emerald-500" />
                                                    <span>Downloaded</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Download size={13} />
                                                    <span>Download .pcap</span>
                                                </>
                                            )}
                                        </button>

                                        <button
                                            onClick={handleSendToReplay}
                                            disabled={sendingReplay}
                                            className={`px-3.5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer border ${
                                                sentReplayFlash
                                                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-300'
                                                    : 'bg-purple-600/15 hover:bg-purple-600/25 border-purple-500/40 dark:border-purple-500/30 text-purple-700 dark:text-purple-300'
                                            }`}
                                            title="Send trace to PCAP Replay engine"
                                        >
                                            {sendingReplay ? (
                                                <>
                                                    <Loader2 size={13} className="animate-spin" />
                                                    <span>Transferring…</span>
                                                </>
                                            ) : sentReplayFlash ? (
                                                <>
                                                    <Check size={13} className="text-emerald-500" />
                                                    <span>Sent to Replay</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Zap size={13} />
                                                    <span>Send to Replay</span>
                                                </>
                                            )}
                                        </button>
                                    </>
                                )}
                            </>
                        ) : (
                            <button
                                onClick={handleOpenHistory}
                                className="px-3 py-1.5 bg-card-secondary hover:bg-card-hover border border-border rounded-xl text-[11px] font-bold text-text-muted hover:text-text-primary transition-all flex items-center gap-1.5 cursor-pointer"
                                title="Open saved PCAP capture history"
                            >
                                <HardDrive size={12} />
                                <span>Captures</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* Configuration Controls Bar - Mode Aware */}
                {captureMode === 'trace' ? (
                    <div className="mt-3.5 pt-3.5 border-t border-border/60 space-y-2.5">
                        {/* Main Diagnostic Composer Row: FROM → TO → TEST → RUN TRACE */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">
                            {/* FROM: Source SD-WAN Site Selector */}
                            <div className="lg:col-span-3 space-y-1">
                                <div className="flex items-center justify-between gap-1">
                                    <label className="text-[10px] font-black uppercase tracking-wider text-text-muted">From · Source Site</label>
                                    {(() => {
                                        const effLocal = detectedLocalSite || localSiteName || 'BR8';
                                        const isLocal = traceSourceMode !== 'ion_only' && traceSourceSite.toUpperCase() === effLocal.toUpperCase();
                                        const selectedSiteObj = traceSites.find((s) => s.site_name.toUpperCase() === traceSourceSite.toUpperCase());
                                        const remotePeer = !isLocal && traceSourceMode !== 'ion_only' ? (selectedSiteObj?.stigix_peer || null) : null;
                                        return (
                                            <span className={`text-[9px] font-mono font-bold truncate ${
                                                isLocal
                                                    ? 'text-emerald-600 dark:text-emerald-400'
                                                    : remotePeer
                                                    ? 'text-cyan-600 dark:text-cyan-300'
                                                    : 'text-amber-600 dark:text-amber-400'
                                            }`}>
                                                {isLocal
                                                    ? 'Local probe + ION CLI'
                                                    : remotePeer
                                                    ? `Peer probe (${remotePeer.host})`
                                                    : 'ION CLI only (agentless)'}
                                            </span>
                                        );
                                    })()}
                                </div>
                                <div className="flex items-center gap-1.5">
                                    {(() => {
                                        const effLocal = detectedLocalSite || localSiteName || 'BR8';
                                        const buildSiteOption = (s: {
                                            site_id: string;
                                            site_name: string;
                                            role: string;
                                            connected: boolean;
                                            elements: Array<{ id: string; name: string; connected: boolean; role: string; software_version: string }>;
                                            stigix_peer?: { name: string; host: string; port: number; version: string; is_local: boolean } | null;
                                        }): StigixSelectOption => {
                                            const isLocal = s.site_name.toUpperCase() === effLocal.toUpperCase();
                                            const peer = s.stigix_peer || null;
                                            const elNames = s.elements.map((e) => e.name).filter(Boolean);
                                            const hasDistinctEls =
                                                elNames.length > 1 ||
                                                (elNames.length === 1 && elNames[0].toUpperCase() !== s.site_name.toUpperCase());
                                            const swVer = s.elements[0]?.software_version ? `vION ${s.elements[0].software_version}` : '';

                                            let sublabel: string | undefined;
                                            if (isLocal) {
                                                const ionTarget = hasDistinctEls ? elNames.join(', ') : s.site_name;
                                                sublabel = `ION: ${ionTarget} • ${s.connected ? 'Online' : 'Offline'}${swVer ? ` (${swVer})` : ''}`;
                                            } else if (peer) {
                                                const ionPart = hasDistinctEls ? elNames.join(', ') : (swVer || 'ION Online');
                                                sublabel = `${peer.name} (${peer.host}) • ${ionPart}`;
                                            } else if (hasDistinctEls) {
                                                sublabel = `${elNames.join(', ')}${swVer ? ` • ${swVer}` : ''}`;
                                            } else if (swVer) {
                                                sublabel = `${s.role === 'HUB' ? 'Hub' : 'Branch'} • ${swVer}`;
                                            }

                                            const badge = isLocal
                                                ? 'Local Stigix'
                                                : peer
                                                ? 'Stigix Peer'
                                                : s.connected
                                                ? 'ION Online'
                                                : 'Offline';

                                            const badgeClassName = isLocal
                                                ? 'px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-mono font-bold text-emerald-700 dark:text-emerald-400'
                                                : peer
                                                ? 'px-1.5 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-[10px] font-mono font-bold text-cyan-700 dark:text-cyan-300'
                                                : s.connected
                                                ? 'px-1.5 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-[10px] font-mono font-bold text-indigo-700 dark:text-indigo-300'
                                                : 'px-1.5 py-0.5 rounded-md bg-slate-500/15 border border-slate-500/30 text-[10px] font-mono text-text-muted';

                                            const dotClass = isLocal && s.connected
                                                ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]'
                                                : peer && s.connected
                                                ? 'bg-cyan-500 shadow-[0_0_6px_rgba(6,182,212,0.6)]'
                                                : s.connected
                                                ? 'bg-indigo-400 shadow-[0_0_6px_rgba(129,140,248,0.5)]'
                                                : 'bg-slate-500';

                                            return {
                                                value: s.site_name,
                                                label: s.site_name,
                                                sublabel,
                                                badge,
                                                badgeClassName,
                                                icon: <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
                                            };
                                        };

                                        const fallbackSites = [
                                            { site_id: 'local', site_name: effLocal, role: 'SPOKE', connected: true, elements: [{ id: 'local', name: effLocal, connected: true, role: 'SPOKE', software_version: '' }] },
                                            { site_id: 'br5', site_name: 'BR5', role: 'SPOKE', connected: true, elements: [{ id: 'br5', name: 'BR5', connected: true, role: 'SPOKE', software_version: '' }] },
                                            { site_id: 'br1', site_name: 'BR1', role: 'SPOKE', connected: true, elements: [{ id: 'br1', name: 'BR1', connected: true, role: 'SPOKE', software_version: '' }] },
                                            { site_id: 'dc1', site_name: 'DC1', role: 'HUB', connected: true, elements: [{ id: 'dc1-r1', name: 'DC1-R1', connected: true, role: 'HUB', software_version: '' }, { id: 'dc1-r2', name: 'DC1-R2', connected: true, role: 'HUB', software_version: '' }] },
                                            { site_id: 'dc2', site_name: 'DC2', role: 'HUB', connected: true, elements: [{ id: 'dc2-r1', name: 'DC2-R1', connected: true, role: 'HUB', software_version: '' }, { id: 'dc2-r2', name: 'DC2-R2', connected: false, role: 'HUB', software_version: '' }] }
                                        ];

                                        const sourceList = traceSites.length > 0 ? traceSites : fallbackSites;
                                        const localGroup = sourceList.filter((s) => s.site_name.toUpperCase() === effLocal.toUpperCase()).map(buildSiteOption);
                                        const hubGroup = sourceList.filter((s) => s.site_name.toUpperCase() !== effLocal.toUpperCase() && s.role === 'HUB').map(buildSiteOption);
                                        const spokeGroup = sourceList.filter((s) => s.site_name.toUpperCase() !== effLocal.toUpperCase() && s.role !== 'HUB').map(buildSiteOption);

                                        const siteGroups: StigixSelectGroup[] = [];
                                        if (localGroup.length > 0) siteGroups.push({ label: '★ Local Stigix Site', options: localGroup });
                                        if (spokeGroup.length > 0) siteGroups.push({ label: 'Branch Spokes', options: spokeGroup });
                                        if (hubGroup.length > 0) siteGroups.push({ label: 'Data Center Hubs', options: hubGroup });

                                        return (
                                            <StigixSelect
                                                value={traceSourceSite}
                                                onChange={(val) => setTraceSourceSite(val)}
                                                groups={siteGroups}
                                                disabled={tracingFlow}
                                                accent="indigo"
                                                menuMinWidth={300}
                                                className="flex-1 min-w-0"
                                                triggerClassName="bg-card-secondary rounded-xl h-9 font-mono font-bold"
                                            />
                                        );
                                    })()}
                                    <button
                                        type="button"
                                        onClick={() => fetchTraceSites(true)}
                                        title="Refresh Prisma SD-WAN tenant sites"
                                        className="p-2 bg-card-secondary hover:bg-card-hover border border-border rounded-xl text-text-muted hover:text-text-primary h-9 cursor-pointer shrink-0"
                                    >
                                        <RefreshCw size={13} />
                                    </button>
                                </div>
                            </div>

                            {/* TO: Destination IP or Domain/FQDN */}
                            <div className="lg:col-span-4 space-y-1">
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-black uppercase tracking-wider text-text-muted">To · Destination (IP or Domain)</label>
                                    <span
                                        className="text-[9px] text-text-muted font-mono flex items-center gap-1 cursor-help"
                                        title="Domain names are resolved automatically on the source node before probing and inspecting vION flow tables."
                                    >
                                        <Info size={10} className="text-indigo-500 dark:text-indigo-400" />
                                        <span>Auto DNS</span>
                                    </span>
                                </div>
                                <input
                                    type="text"
                                    value={traceDestination}
                                    onChange={(e) => setTraceDestination(e.target.value)}
                                    disabled={tracingFlow}
                                    placeholder="e.g. 192.168.212.100, login.microsoftonline.com, 1.1.1.1"
                                    className="w-full bg-card-secondary border border-border rounded-xl px-3 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:border-indigo-500 h-9"
                                />
                            </div>

                            {/* TEST: Protocol & Port */}
                            <div className="lg:col-span-3 grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black uppercase tracking-wider text-text-muted">Test · Protocol</label>
                                    <StigixSelect
                                        value={traceProtocol}
                                        onChange={(val) => setTraceProtocol(val as 'tcp' | 'udp' | 'icmp')}
                                        disabled={tracingFlow}
                                        accent="indigo"
                                        menuMinWidth={190}
                                        triggerClassName="bg-card-secondary rounded-xl h-9 font-mono font-bold"
                                        options={[
                                            { value: 'tcp', label: 'TCP', sublabel: 'Proto 6 • 3-Way / TLS', badge: 'L4' },
                                            { value: 'udp', label: 'UDP', sublabel: 'Proto 17 • Datagram', badge: 'L4' },
                                            { value: 'icmp', label: 'ICMP', sublabel: 'Proto 1 • Echo Ping', badge: 'L3' }
                                        ]}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black uppercase tracking-wider text-text-muted">Port</label>
                                    {traceProtocol === 'icmp' ? (
                                        <div
                                            title="ICMP operates at Layer 3 (Echo Request/Reply) and does not use a TCP/UDP transport port"
                                            className="w-full bg-card-secondary/50 border border-border/60 rounded-xl px-2.5 py-1.5 text-[11px] text-text-muted font-mono flex items-center h-9 select-none"
                                        >
                                            Not applicable
                                        </div>
                                    ) : (
                                        <input
                                            type="number"
                                            value={traceDstPort}
                                            onChange={(e) => setTraceDstPort(parseInt(e.target.value, 10) || 0)}
                                            disabled={tracingFlow}
                                            placeholder="443"
                                            className="w-full bg-card-secondary border border-border rounded-xl px-2.5 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:border-indigo-500 h-9"
                                        />
                                    )}
                                </div>
                            </div>

                            {/* LAUNCH: Run trace button directly aligned with test inputs */}
                            <div className="lg:col-span-2">
                                <button
                                    type="button"
                                    onClick={() => handleRunFlowTrace()}
                                    disabled={tracingFlow}
                                    className="w-full h-9 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-md shadow-indigo-900/30 cursor-pointer"
                                >
                                    {tracingFlow ? (
                                        <>
                                            <Loader2 size={14} className="animate-spin shrink-0" />
                                            <span>Tracing...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles size={14} className="shrink-0" />
                                            <span>Run trace</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Secondary Row: Compact Favorites + Collapsible Advanced Options with Live Summary */}
                        <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
                            {/* Compact Favorites with active state matching & full details on hover */}
                            <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                                <span className="font-black uppercase tracking-wider text-text-muted mr-0.5">Favorites:</span>
                                {[
                                    {
                                        id: 'dc1_app',
                                        label: 'DC1 App',
                                        dst: '192.168.212.100',
                                        port: 8098,
                                        proto: 'tcp' as const,
                                        tooltip: 'DC1 Private App · 192.168.212.100 · TCP/8098'
                                    },
                                    {
                                        id: 'onprem_app',
                                        label: 'OnPrem App',
                                        dst: '192.168.203.100',
                                        port: 8085,
                                        proto: 'tcp' as const,
                                        tooltip: 'OnPrem App 8085 · 192.168.203.100 · TCP/8085'
                                    },
                                    {
                                        id: 'o365_ip',
                                        label: 'O365 via DC2',
                                        dst: '40.99.155.50',
                                        port: 443,
                                        proto: 'tcp' as const,
                                        tooltip: 'Microsoft 365 Backhaul · 40.99.155.50 · TCP/443'
                                    },
                                    {
                                        id: 'm365_fqdn',
                                        label: 'Microsoft 365',
                                        dst: 'login.microsoftonline.com',
                                        port: 443,
                                        proto: 'tcp' as const,
                                        tooltip: 'Microsoft 365 Login FQDN · login.microsoftonline.com · TCP/443'
                                    },
                                    {
                                        id: 'br5_dia',
                                        label: 'BR5 DIA',
                                        site: 'BR5',
                                        dst: '172.217.20.46',
                                        port: 443,
                                        proto: 'tcp' as const,
                                        tooltip: 'Remote Branch BR5 Direct Internet Breakout · 172.217.20.46 · TCP/443'
                                    }
                                ].map((fav) => {
                                    const isFavActive =
                                        traceDestination.trim().toLowerCase() === fav.dst.toLowerCase() &&
                                        traceProtocol === fav.proto &&
                                        (String(fav.proto) === 'icmp' || traceDstPort === fav.port) &&
                                        (!fav.site || traceSourceSite.toUpperCase() === fav.site.toUpperCase());
                                    return (
                                        <button
                                            key={fav.id}
                                            type="button"
                                            title={fav.tooltip}
                                            onClick={() => {
                                                if (fav.site) setTraceSourceSite(fav.site);
                                                setTraceDestination(fav.dst);
                                                setTraceDstPort(fav.port);
                                                setTraceProtocol(fav.proto);
                                                setTraceSrcIp('');
                                            }}
                                            className={`px-2.5 py-0.5 rounded-lg border font-mono font-bold transition-all cursor-pointer ${
                                                isFavActive
                                                    ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-700 dark:text-indigo-300 shadow-xs'
                                                    : 'bg-card-secondary hover:bg-indigo-500/10 border-border hover:border-indigo-500/35 text-text-secondary hover:text-indigo-700 dark:hover:text-indigo-300'
                                            }`}
                                        >
                                            {fav.label}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Collapsible Advanced Options Toggle + Persistent Summary */}
                            {(() => {
                                const effLocal = detectedLocalSite || localSiteName || 'BR8';
                                const isLocal = traceSourceSite.toUpperCase() === effLocal.toUpperCase();
                                const selectedSiteObj = traceSites.find((s) => s.site_name.toUpperCase() === traceSourceSite.toUpperCase());
                                const hasPeer = Boolean(selectedSiteObj?.stigix_peer);
                                const isAgentlessSite = !isLocal && !hasPeer;
                                const modeShortLabel =
                                    traceSourceMode === 'ion_only' || isAgentlessSite
                                        ? 'ION CLI only'
                                        : traceGenerateProbe
                                        ? 'Probe + PCAP'
                                        : 'Passive + PCAP';
                                const srcSummary = traceSrcIp.trim() ? traceSrcIp.trim() : 'Auto';
                                return (
                                    <button
                                        type="button"
                                        onClick={() => setShowTraceAdvanced((prev) => !prev)}
                                        className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-card-secondary/80 hover:bg-card-hover border border-border/70 text-[10px] font-mono text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                                    >
                                        <span className="font-sans font-black uppercase tracking-wider text-text-muted flex items-center gap-1">
                                            <span>Advanced options</span>
                                            <ChevronDown size={11} className={`transition-transform ${showTraceAdvanced ? 'rotate-180 text-indigo-400' : ''}`} />
                                        </span>
                                        <span className="text-border">|</span>
                                        <span className="font-bold text-indigo-700 dark:text-indigo-300">{modeShortLabel}</span>
                                        <span className="text-text-muted">·</span>
                                        <span>
                                            Source IP: <strong className="text-text-primary">{srcSummary}</strong>
                                        </span>
                                    </button>
                                );
                            })()}
                        </div>

                        {/* Collapsible Advanced Options Drawer */}
                        {showTraceAdvanced && (
                            <div className="pt-2.5 mt-1 border-t border-border/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end animate-in fade-in duration-150">
                                <div className="lg:col-span-4 space-y-1">
                                    <div className="flex items-center justify-between">
                                        <label className="text-[10px] font-black uppercase tracking-wider text-text-muted">Collection Mode</label>
                                        <span className="text-[9px] font-mono text-text-muted">
                                            {traceSourceMode === 'ion_only' ? 'Agentless CLI' : traceGenerateProbe ? 'Synthetic Probe + PCAP' : 'Passive Capture'}
                                        </span>
                                    </div>
                                    <StigixSelect
                                        value={
                                            traceSourceMode === 'ion_only'
                                                ? 'ion_only'
                                                : traceGenerateProbe
                                                ? 'active_probe'
                                                : 'passive_pcap'
                                        }
                                        onChange={(val) => {
                                            if (val === 'ion_only') {
                                                setTraceSourceMode('ion_only');
                                                setTraceGenerateProbe(false);
                                            } else if (val === 'passive_pcap') {
                                                setTraceSourceMode('auto');
                                                setTraceGenerateProbe(false);
                                            } else {
                                                setTraceSourceMode('auto');
                                                setTraceGenerateProbe(true);
                                            }
                                        }}
                                        disabled={tracingFlow}
                                        accent="indigo"
                                        menuMinWidth={280}
                                        triggerClassName="bg-card-secondary rounded-xl h-9 font-mono font-bold"
                                        options={[
                                            {
                                                value: 'active_probe',
                                                label: 'Probe + PCAP',
                                                sublabel: 'Send live socket/ICMP probe, capture PCAP & inspect IONs',
                                                badge: 'Default'
                                            },
                                            {
                                                value: 'passive_pcap',
                                                label: 'Passive + PCAP',
                                                sublabel: 'Observe existing LAN traffic without sending a synthetic probe',
                                                badge: 'Passive'
                                            },
                                            {
                                                value: 'ion_only',
                                                label: 'ION CLI only',
                                                sublabel: 'Inspect vION flow tables via WebSocket without PCAP capture',
                                                badge: 'Agentless'
                                            }
                                        ]}
                                    />
                                </div>

                                <div className="lg:col-span-4 space-y-1">
                                    <div className="flex items-center justify-between">
                                        <label className="text-[10px] font-black uppercase tracking-wider text-text-muted">Source IP (Optional LAN Host)</label>
                                        <span className="text-[9px] text-text-muted font-mono">
                                            {traceSrcIp.trim() ? 'Filtering LAN Host' : 'Auto (Probe IP)'}
                                        </span>
                                    </div>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            value={traceSrcIp}
                                            onChange={(e) => setTraceSrcIp(e.target.value)}
                                            disabled={tracingFlow}
                                            placeholder="Auto (leave blank for Stigix probe IP)"
                                            className="w-full bg-card-secondary border border-border rounded-xl px-3 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:border-indigo-500 h-9 pr-7"
                                        />
                                        {traceSrcIp && !tracingFlow && (
                                            <button
                                                type="button"
                                                onClick={() => setTraceSrcIp('')}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary p-0.5 cursor-pointer"
                                                title="Reset to Auto Source IP"
                                            >
                                                <X size={12} />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="lg:col-span-4 text-[10px] text-text-muted leading-relaxed pb-1">
                                    When <strong className="text-text-secondary">Source IP</strong> is blank, Stigix uses its own LAN interface IP for the synthetic probe. Specify a LAN host IP to filter existing client flows in <code className="font-mono">tcpdump</code> and <code className="font-mono">inspect flow brief</code>.
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                <div ref={dropdownBarRef} className="mt-4 pt-3.5 border-t border-border/60 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">
                    {/* Interface Custom Selector */}
                    {(() => {
                        const activeIface = interfaces.find(i => i.name === selectedInterface) || {
                            name: selectedInterface,
                            label: selectedInterface === 'any' ? 'All Interfaces (any)' : selectedInterface,
                            ip: '-',
                            mac: '-',
                            is_default: false,
                            is_egress: false,
                            category: classifyInterfaceCategory(selectedInterface),
                            is_up: true
                        };
                        const primaryGroup = interfaces.filter(i => i.category === 'physical' || i.category === 'any');
                        const tunnelGroup = interfaces.filter(i => i.category === 'tunnel' || i.category === 'loopback');
                        const virtualGroup = interfaces.filter(i => i.category === 'virtual');

                        const renderInterfaceRow = (iface: InterfaceItem) => {
                            const isSelected = iface.name === selectedInterface;
                            const isAny = iface.name === 'any';
                            const hasIp = iface.ip && iface.ip !== '-' && iface.ip !== '0.0.0.0';
                            return (
                                <button
                                    key={iface.name}
                                    type="button"
                                    onClick={() => {
                                        setSelectedInterface(iface.name);
                                        setOpenDropdown(null);
                                    }}
                                    className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2 rounded-xl transition-all cursor-pointer ${
                                        isSelected
                                            ? 'bg-cyan-500/15 text-text-primary border border-cyan-500/30'
                                            : 'hover:bg-card-secondary text-text-secondary border border-transparent'
                                    }`}
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span
                                            className={`w-2 h-2 rounded-full shrink-0 ${
                                                isAny
                                                    ? 'bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.6)]'
                                                    : iface.is_up
                                                    ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]'
                                                    : 'bg-slate-500'
                                            }`}
                                        />
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <span className="text-xs font-black font-mono text-text-primary truncate">
                                                {isAny ? 'any' : iface.name}
                                            </span>
                                            {isAny && (
                                                <span className="text-[10px] text-text-muted font-sans truncate">
                                                    (All Interfaces)
                                                </span>
                                            )}
                                            {iface.is_egress && (
                                                <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                                                    Egress
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        {hasIp && (
                                            <span className="px-1.5 py-0.5 rounded-md bg-card-secondary border border-border text-[10px] font-mono text-text-muted">
                                                {iface.ip}
                                            </span>
                                        )}
                                        {isSelected && <Check size={12} className="text-cyan-400 shrink-0" />}
                                    </div>
                                </button>
                            );
                        };

                        return (
                            <div className="lg:col-span-3 space-y-1 relative">
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-black uppercase tracking-wider text-text-muted">Interface</label>
                                    {activeIface.is_egress && (
                                        <span className="text-[9px] font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                            Traffic Egress
                                        </span>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    disabled={capturing}
                                    onClick={() => setOpenDropdown(prev => prev === 'interface' ? null : 'interface')}
                                    className={`w-full bg-card-secondary border rounded-xl px-3 py-1.5 text-xs text-text-primary font-mono flex items-center justify-between gap-2 h-9 transition-all cursor-pointer disabled:opacity-50 ${
                                        openDropdown === 'interface' ? 'border-cyan-500 ring-2 ring-cyan-500/15' : 'border-border hover:border-cyan-500/40'
                                    }`}
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span
                                            className={`w-2 h-2 rounded-full shrink-0 ${
                                                activeIface.name === 'any'
                                                    ? 'bg-cyan-400'
                                                    : activeIface.is_up
                                                    ? 'bg-emerald-500'
                                                    : 'bg-slate-500'
                                            }`}
                                        />
                                        <span className="font-black text-text-primary truncate">
                                            {activeIface.name === 'any' ? 'All Interfaces (any)' : activeIface.name}
                                        </span>
                                        {activeIface.ip && activeIface.ip !== '-' && activeIface.ip !== '0.0.0.0' && (
                                            <span className="px-1.5 py-0.5 rounded bg-card border border-border text-[10px] text-text-muted font-mono truncate">
                                                {activeIface.ip}
                                            </span>
                                        )}
                                    </div>
                                    <ChevronDown size={13} className={`text-text-muted shrink-0 transition-transform ${openDropdown === 'interface' ? 'rotate-180 text-cyan-400' : ''}`} />
                                </button>

                                {openDropdown === 'interface' && (
                                    <div className="absolute left-0 top-full mt-1.5 w-80 bg-card border border-border rounded-2xl shadow-2xl z-50 p-2 space-y-2 animate-in fade-in zoom-in-95 duration-150">
                                        {/* Primary & Physical NICs */}
                                        <div className="space-y-0.5">
                                            <div className="px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-text-muted opacity-60 flex items-center justify-between">
                                                <span>Traffic &amp; Physical NICs</span>
                                                <span>IPv4</span>
                                            </div>
                                            {primaryGroup.map(renderInterfaceRow)}
                                        </div>

                                        {/* Tunnels & Loopback */}
                                        {tunnelGroup.length > 0 && (
                                            <div className="space-y-0.5 pt-1.5 border-t border-border/60">
                                                <div className="px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-text-muted opacity-60">
                                                    Overlay &amp; Loopback
                                                </div>
                                                {tunnelGroup.map(renderInterfaceRow)}
                                            </div>
                                        )}

                                        {/* Virtual / Docker Bridges (Collapsible) */}
                                        {virtualGroup.length > 0 && (
                                            <div className="pt-1.5 border-t border-border/60">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowVirtualInterfaces(prev => !prev)}
                                                    className="w-full px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-text-muted hover:text-text-primary hover:bg-card-secondary flex items-center justify-between transition-colors cursor-pointer"
                                                >
                                                    <span>
                                                        {showVirtualInterfaces ? 'Hide' : 'Show'} virtual / Docker interfaces ({virtualGroup.length})
                                                    </span>
                                                    <ChevronDown size={12} className={`transition-transform ${showVirtualInterfaces ? 'rotate-180' : ''}`} />
                                                </button>
                                                {showVirtualInterfaces && (
                                                    <div className="mt-1 space-y-0.5 max-h-40 overflow-y-auto pr-0.5">
                                                        {virtualGroup.map(renderInterfaceRow)}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {/* Presets Custom Dropdown */}
                    {(() => {
                        const presetGroups: StigixSelectGroup[] = [
                            {
                                label: '⚡ Built-in Presets',
                                options: presets.map(p => ({
                                    value: p.id,
                                    label: p.name,
                                    sublabel: p.bpf || 'Capture all interface traffic'
                                }))
                            }
                        ];
                        if (customBpfPresets.length > 0) {
                            presetGroups.push({
                                label: '⭐ Custom BPF Filters',
                                options: customBpfPresets.map(cp => ({
                                    value: cp.id,
                                    label: cp.name,
                                    sublabel: cp.bpf
                                }))
                            });
                        }
                        if (selectedPreset === 'custom') {
                            presetGroups[0].options = [
                                ...presetGroups[0].options,
                                { value: 'custom', label: 'Custom BPF Expression', sublabel: bpfFilter || 'User-defined filter' }
                            ];
                        }

                        return (
                            <div className="lg:col-span-3 space-y-1 relative">
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-black uppercase tracking-wider text-text-muted">BPF Preset</label>
                                    {isCustomPresetSelected && (
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteCustomPreset(selectedPreset)}
                                            disabled={capturing}
                                            className="text-[10px] text-rose-400 hover:text-rose-300 font-bold flex items-center gap-0.5 cursor-pointer disabled:opacity-50 transition-colors"
                                            title="Delete selected custom preset"
                                        >
                                            <Trash2 size={10} />
                                            <span>Delete</span>
                                        </button>
                                    )}
                                </div>
                                <StigixSelect
                                    value={selectedPreset}
                                    onChange={(val) => handlePresetSelect(val)}
                                    groups={presetGroups}
                                    disabled={capturing}
                                    accent="cyan"
                                    menuMinWidth={320}
                                    triggerClassName="bg-card-secondary rounded-xl h-9 font-mono font-bold"
                                />
                            </div>
                        );
                    })()}

                    {/* Kernel BPF Filter */}
                    <div className="lg:col-span-4 space-y-1">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <label className="text-[10px] font-black uppercase tracking-wider text-text-muted">Kernel BPF Filter</label>
                                {bpfAppliedFlash && (
                                    <span className="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-500/15 px-1.5 py-0.2 rounded border border-emerald-500/30 flex items-center gap-1">
                                        <Check size={9} />
                                        {bpfAppliedFlash}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2 text-[10px]">
                                <button
                                    type="button"
                                    onClick={() => setShowBpfLibraryModal(true)}
                                    className="text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1 cursor-pointer transition-colors"
                                    title="Browse complex BPF recipes"
                                >
                                    <Sparkles size={11} />
                                    <span>Recipes</span>
                                </button>
                                <span className="text-border">|</span>
                                <button
                                    type="button"
                                    onClick={handleOpenSaveCustomBpfModal}
                                    disabled={!bpfFilter.trim() || capturing}
                                    className="text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                    title="Save this filter as a custom preset"
                                >
                                    <BookmarkPlus size={11} />
                                    <span>Save Preset</span>
                                </button>
                            </div>
                        </div>
                        <div className="relative">
                            <input
                                type="text"
                                value={bpfFilter}
                                onChange={(e) => {
                                    setBpfFilter(e.target.value);
                                    setSelectedPreset('custom');
                                }}
                                disabled={capturing}
                                placeholder="e.g. tcp[tcpflags] & (tcp-syn) != 0 or port 53"
                                className={`w-full bg-card-secondary border rounded-xl px-3 py-1.5 text-xs text-text-primary font-mono focus:outline-none pr-7 h-9 transition-colors ${
                                    bpfAppliedFlash ? 'border-emerald-500/50' : 'border-border focus:border-cyan-500'
                                }`}
                            />
                            {bpfFilter && !capturing && (
                                <button
                                    type="button"
                                    onClick={() => { setBpfFilter(''); setSelectedPreset('all'); }}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary p-0.5 cursor-pointer"
                                    title="Clear filter"
                                >
                                    <X size={12} />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Duration Limit */}
                    <div className="lg:col-span-1 space-y-1 relative">
                        <label className="text-[10px] font-black uppercase tracking-wider text-text-muted">Duration</label>
                        <StigixSelect
                            value={durationSec}
                            onChange={(val) => setDurationSec(Number(val))}
                            disabled={capturing}
                            accent="cyan"
                            menuMinWidth={160}
                            triggerClassName="bg-card-secondary rounded-xl h-9 font-mono font-bold"
                            options={[
                                { value: 10, label: '10s', sublabel: 'Quick burst' },
                                { value: 30, label: '30s', sublabel: 'Default (30s)' },
                                { value: 60, label: '60s', sublabel: '1 minute' },
                                { value: 120, label: '120s', sublabel: '2 minutes' },
                                { value: 300, label: '300s', sublabel: 'Max (5 minutes)' }
                            ]}
                        />
                    </div>

                    {/* Packet Limit */}
                    <div className="lg:col-span-1 space-y-1 relative">
                        <label className="text-[10px] font-black uppercase tracking-wider text-text-muted">Packet Limit</label>
                        <StigixSelect
                            value={maxPackets}
                            onChange={(val) => setMaxPackets(Number(val))}
                            disabled={capturing}
                            accent="cyan"
                            menuMinWidth={190}
                            triggerClassName="bg-card-secondary rounded-xl h-9 font-mono font-bold"
                            options={[
                                { value: 500, label: '500', sublabel: '500 packets' },
                                { value: 2000, label: '2,000', sublabel: 'Default (2,000 pkts)' },
                                { value: 5000, label: '5,000', sublabel: '5,000 packets' },
                                { value: 10000, label: '10,000', sublabel: '10,000 packets' },
                                { value: 100000, label: 'Max', sublabel: 'Time-bounded only (100k)' }
                            ]}
                        />
                    </div>
                </div>
                )}
            </div>

            {/* ── E2E FLOW & PATH TRACE PIPELINE (NWPI COMPACT TIMELINE & EVIDENCE VIEW) ── */}
            {captureMode === 'trace' && (tracingFlow || traceResult) && (() => {
                const activeHops: any[] = tracingFlow
                    ? (traceProgress?.hops || [])
                    : (traceResult?.hops || []);
                const selectedHop =
                    activeHops.find((h: any) => h.id === selectedHopId) ||
                    activeHops.find((h: any) => h.id === 'hop_ingress_ion') ||
                    activeHops[0] ||
                    null;

                const flowIdObj = tracingFlow
                    ? traceProgress?.flow_identity
                    : traceResult?.flow_identity;
                const synthesisObj = !tracingFlow ? traceResult?.synthesis : null;
                const verdictObj = !tracingFlow ? traceResult?.verdict : null;

                const ingressFlowsAll: any[] = Array.isArray(traceResult?.ingress_flows) ? traceResult.ingress_flows : [];
                const transitFlowsAll: any[] = Array.isArray(traceResult?.transit_flows) ? traceResult.transit_flows : [];
                const totalIonFlows = ingressFlowsAll.length + transitFlowsAll.length;
                const exactIonFlowsCount =
                    ingressFlowsAll.filter((f) => f.match_scope === 'EXACT_PCAP_5TUPLE' || f.match_scope === 'SESSION_PROBE_FLOW').length +
                    transitFlowsAll.filter((f) => f.match_scope === 'EXACT_PCAP_5TUPLE' || f.match_scope === 'SESSION_PROBE_FLOW').length;

                const getNodeTheme = (statusRaw: string, roleRaw?: string) => {
                    const st = String(statusRaw || '').toUpperCase();
                    const role = String(roleRaw || '').toUpperCase();
                    if (st === 'RUNNING') {
                        return {
                            card: 'border-indigo-500/50 bg-indigo-500/10 shadow-[0_0_15px_rgba(99,102,241,0.12)]',
                            badge: 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border-indigo-500/40',
                            dot: 'bg-indigo-500 dark:bg-indigo-400 ring-4 ring-indigo-500/20',
                            icon: <Loader2 size={13} className="animate-spin text-indigo-600 dark:text-indigo-300 shrink-0" />,
                            label: 'ANALYZING'
                        };
                    }
                    if (st === 'OBSERVED') {
                        const roleLabel =
                            role === 'SOURCE_STIGIX' || role === 'SOURCE_REMOTE_STIGIX'
                                ? 'CAPTURED'
                                : role === 'INGRESS_ION' || role === 'TRANSIT_ION'
                                ? 'FLOW MATCHED'
                                : role === 'DESTINATION'
                                ? 'REPLY RECEIVED'
                                : role === 'TRANSIT_DIA'
                                ? 'LOCAL BREAKOUT'
                                : role === 'TRANSIT_SERVICELINK'
                                ? 'TUNNEL UP'
                                : 'OBSERVED';
                        return {
                            card: 'border-emerald-500/35 dark:border-emerald-500/30 bg-emerald-500/[0.06] dark:bg-emerald-500/[0.04] hover:border-emerald-500/70',
                            badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35',
                            dot: 'bg-emerald-500 dark:bg-emerald-400 ring-4 ring-emerald-500/20',
                            icon: <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400 shrink-0" />,
                            label: roleLabel
                        };
                    }
                    if (st === 'FORWARDED') {
                        const fwdLabel =
                            role === 'TRANSIT_DIA'
                                ? 'LOCAL BREAKOUT'
                                : role === 'TRANSIT_SERVICELINK'
                                ? 'TUNNEL UP'
                                : 'FORWARDED';
                        return {
                            card: 'border-cyan-500/35 dark:border-cyan-500/30 bg-cyan-500/[0.06] dark:bg-cyan-500/[0.04] hover:border-cyan-500/70',
                            badge: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/35',
                            dot: 'bg-cyan-500 dark:bg-cyan-400 ring-4 ring-cyan-500/20',
                            icon: <CheckCircle2 size={13} className="text-cyan-600 dark:text-cyan-400 shrink-0" />,
                            label: fwdLabel
                        };
                    }
                    if (st === 'NO_RESPONSE' || st === 'UNREACHABLE') {
                        return {
                            card: 'border-amber-500/50 dark:border-amber-500/40 bg-amber-500/[0.08] dark:bg-amber-500/[0.06] hover:border-amber-500/80',
                            badge: 'bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-500/40',
                            dot: 'bg-amber-500 dark:bg-amber-400 ring-4 ring-amber-500/20',
                            icon: <AlertCircle size={13} className="text-amber-600 dark:text-amber-400 shrink-0" />,
                            label: 'NO RESPONSE'
                        };
                    }
                    if (st === 'BLOCKED') {
                        return {
                            card: 'border-rose-500/50 dark:border-rose-500/45 bg-rose-500/[0.08] hover:border-rose-500/80',
                            badge: 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/40',
                            dot: 'bg-rose-500 dark:bg-rose-400 ring-4 ring-rose-500/20',
                            icon: <AlertCircle size={13} className="text-rose-600 dark:text-rose-400 shrink-0" />,
                            label: 'BLOCKED'
                        };
                    }
                    if (st === 'NOT_OBSERVED' || st === 'UNAVAILABLE') {
                        return {
                            card: 'border-amber-500/40 dark:border-amber-500/35 bg-amber-500/[0.06] dark:bg-amber-500/[0.04] hover:border-amber-500/70',
                            badge: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/35',
                            dot: 'bg-amber-500 dark:bg-amber-400 ring-4 ring-amber-500/15',
                            icon: <AlertCircle size={13} className="text-amber-600 dark:text-amber-400 shrink-0" />,
                            label: st === 'NOT_OBSERVED' ? 'NO MATCH' : 'CLI ERROR'
                        };
                    }
                    if (st === 'PASSIVE') {
                        return {
                            card: 'border-slate-500/35 bg-card-secondary/50 hover:border-slate-400/60',
                            badge: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/35',
                            dot: 'bg-slate-400 ring-4 ring-slate-500/15',
                            icon: <Info size={13} className="text-slate-600 dark:text-slate-400 shrink-0" />,
                            label: 'PASSIVE'
                        };
                    }
                    return {
                        card: 'border-border/60 bg-card-secondary/25 opacity-75',
                        badge: 'bg-card-secondary text-text-muted border-border',
                        dot: 'bg-slate-500/70 ring-4 ring-slate-500/10',
                        icon: <Clock size={13} className="text-text-muted shrink-0" />,
                        label: 'PENDING'
                    };
                };

                const isIcmpFlow = String(flowIdObj?.protocol || traceProtocol || '').toUpperCase() === 'ICMP';
                const activePcapFilename = traceResult?.pcap?.filename || activePcapFile || '';

                const handleSelectIonFlowRow = (fl: any, hopOrigin: 'ingress' | 'transit') => {
                    setSelectedTraceFlow({ ...fl, hopOrigin });
                    const cPort = fl.client_port || fl.source_port;
                    const pcapPorts: number[] = Array.isArray(flowIdObj?.pcap_ports) ? flowIdObj.pcap_ports : [];
                    if (cPort && pcapPorts.includes(Number(cPort))) {
                        setDisplayFilter(String(cPort));
                    } else if (fl.destination_ip) {
                        setDisplayFilter(String(fl.destination_ip));
                    }
                };

                return (
                    <div className="space-y-3 animate-in fade-in duration-200">
                        {/* ── SECTION B: DIAGNOSTIC SYNTHESIS & ANALYZED FLOW IDENTITY ── */}
                        <div className="bg-card border border-indigo-500/30 rounded-2xl p-4 shadow-sm space-y-3">
                            {/* Top Row: Flow 5-Tuple Identity + Match Scope + SD-WAN Triad */}
                            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 pb-3 border-b border-border/60">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-text-muted">
                                        Analyzed Flow:
                                    </span>
                                    <span className="px-2.5 py-1 rounded-lg bg-card-secondary border border-indigo-500/30 font-mono text-xs font-black text-text-primary flex items-center gap-1.5">
                                        <Zap size={12} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                                        <span>{flowIdObj?.probe_5tuple || `${traceSrcIp || 'Auto'} → ${traceDestination}:${traceDstPort} · ${traceProtocol.toUpperCase()}`}</span>
                                    </span>

                                    {/* Precision / Match Scope Pill */}
                                    {tracingFlow ? (
                                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/40 dark:border-indigo-500/30 flex items-center gap-1.5">
                                            <Loader2 size={11} className="animate-spin" />
                                            <span>{traceProgress?.phase_label || 'Collecting dataplane evidence...'}</span>
                                        </span>
                                    ) : flowIdObj?.primary_match_scope === 'EXACT_PCAP_5TUPLE' ? (
                                        <span
                                            title={
                                                isIcmpFlow
                                                    ? 'Correlated between PCAP and ION flow table using Source IP, Destination IP, Protocol (ICMP), and session activity window'
                                                    : 'Correlated between PCAP and ION flow table using exact 5-tuple (Source IP, Ephemeral Source Port, Destination IP, Destination Port, Protocol)'
                                            }
                                            className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 dark:border-emerald-500/30 flex items-center gap-1 cursor-help"
                                        >
                                            <CheckCircle2 size={11} />
                                            <span>{isIcmpFlow ? 'Exact Flow Match (ICMP)' : 'Exact Flow Match (5-Tuple)'}</span>
                                        </span>
                                    ) : flowIdObj?.primary_match_scope === 'SESSION_PROBE_FLOW' ? (
                                        <span
                                            title={
                                                isIcmpFlow
                                                    ? 'Matched active ICMP probe flow in ION dataplane table (Source IP, Destination IP, Protocol)'
                                                    : 'Matched active synthetic probe 5-tuple in ION dataplane table'
                                            }
                                            className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/40 dark:border-cyan-500/30 flex items-center gap-1 cursor-help"
                                        >
                                            <CheckCircle2 size={11} />
                                            <span>{isIcmpFlow ? 'Session Probe Match (ICMP)' : 'Session Probe Match (5-Tuple)'}</span>
                                        </span>
                                    ) : flowIdObj?.primary_match_scope ? (
                                        <span
                                            title="Matched by host IP and destination protocol/port within the active flow table"
                                            className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/40 dark:border-amber-500/30 flex items-center gap-1 cursor-help"
                                        >
                                            <Info size={11} />
                                            <span>{flowIdObj.primary_match_label || 'Host / Destination Match'}</span>
                                        </span>
                                    ) : null}

                                    {(flowIdObj?.associated_flows_count || 0) > 0 && !tracingFlow && (
                                        <button
                                            type="button"
                                            onClick={() => setTraceEvidenceTab('flows')}
                                            className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-card-secondary hover:bg-card-hover text-text-muted hover:text-text-primary border border-border transition-colors cursor-pointer"
                                            title="Other flows to the same destination with different ephemeral ports"
                                        >
                                            +{flowIdObj.associated_flows_count} associated flow{flowIdObj.associated_flows_count > 1 ? 's' : ''}
                                        </button>
                                    )}
                                </div>

                                {/* Right side: SD-WAN Classification Triad Badges */}
                                {!tracingFlow && verdictObj && (
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {verdictObj.app_id && (
                                            <span className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-black bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/40 dark:border-purple-500/30 flex items-center gap-1">
                                                <Cpu size={11} />
                                                <span>App-ID: {verdictObj.app_id}</span>
                                            </span>
                                        )}
                                        {verdictObj.sec_action && (
                                            <span className={`px-2 py-1 rounded-lg text-[10px] font-mono font-black border ${
                                                String(verdictObj.sec_action).toUpperCase() === 'ALLOW'
                                                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 dark:border-emerald-500/30'
                                                    : 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40 dark:border-rose-500/30'
                                            }`}>
                                                ZBFW: {verdictObj.sec_action}
                                            </span>
                                        )}
                                        {verdictObj.egress_path && (
                                            <span className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold bg-cyan-500/15 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border border-cyan-500/40 dark:border-cyan-500/30">
                                                {verdictObj.egress_path}
                                            </span>
                                        )}
                                        {traceResult?.duration_ms && (
                                            <span className="text-[10px] font-mono text-text-muted">
                                                ({(traceResult.duration_ms / 1000).toFixed(1)}s)
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Diagnostic Synthesis Sentences (Level 1 Outcome + Level 2 Path Summary + Compact Scope/Boundary) */}
                            {!tracingFlow && synthesisObj && (() => {
                                const vSt = String(verdictObj?.status || '');
                                const isAnomaly =
                                    vSt === 'UNIDIRECTIONAL_NO_REPLY' ||
                                    vSt === 'NO_RESPONSE' ||
                                    vSt === 'UNREACHABLE' ||
                                    vSt === 'BLOCKED' ||
                                    vSt === 'DNS_ERROR' ||
                                    vSt === 'NO_MATCHING_FLOW';
                                const badgeLabel =
                                    vSt === 'VERIFIED_E2E'
                                        ? 'REPLY RECEIVED'
                                        : vSt === 'FLOW_ACTIVE'
                                        ? 'FLOW OBSERVED'
                                        : vSt === 'UNIDIRECTIONAL_NO_REPLY' || vSt === 'NO_RESPONSE' || vSt === 'UNREACHABLE'
                                        ? 'NO RESPONSE'
                                        : vSt === 'BLOCKED'
                                        ? 'BLOCKED BY ZBFW'
                                        : vSt.replace(/_/g, ' ') || 'DIAGNOSTIC';

                                return (
                                    <div className="space-y-2">
                                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2">
                                            {/* Level 1 — Primary Test Outcome */}
                                            <div className="flex items-center gap-2.5 flex-wrap">
                                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border shrink-0 ${
                                                    vSt === 'VERIFIED_E2E'
                                                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40'
                                                        : vSt === 'FLOW_ACTIVE'
                                                        ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/40'
                                                        : vSt === 'BLOCKED' || vSt === 'DNS_ERROR'
                                                        ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40'
                                                        : 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/40'
                                                }`}>
                                                    {badgeLabel}
                                                </span>
                                                <span className="text-sm font-black text-text-primary leading-snug">
                                                    {synthesisObj.connectivity_headline}
                                                </span>
                                            </div>

                                            {/* Compact 1-Line Scope Pill in Normal Cases */}
                                            {!isAnomaly && synthesisObj.limit_or_diagnosis && (
                                                <button
                                                    type="button"
                                                    onClick={() => setTraceEvidenceTab('limits')}
                                                    title="View full diagnostic collection scope & limits"
                                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-card-secondary/80 hover:bg-card-hover border border-border/60 text-[10px] font-mono text-text-muted hover:text-text-primary transition-colors cursor-pointer shrink-0 self-start lg:self-auto"
                                                >
                                                    <Info size={11} className="text-indigo-500 dark:text-indigo-400 shrink-0" />
                                                    <span>{synthesisObj.limit_or_diagnosis}</span>
                                                </button>
                                            )}
                                        </div>

                                        {/* Level 2 — Path Summary */}
                                        <p className="text-xs text-text-secondary leading-relaxed">
                                            {synthesisObj.visibility_headline}
                                        </p>

                                        {/* Highlighted Callout Only When Anomaly or Partial Visibility */}
                                        {isAnomaly && synthesisObj.limit_or_diagnosis && (
                                            <div className="rounded-xl px-3 py-2 border bg-amber-500/10 border-amber-500/35 text-amber-900 dark:text-amber-200 text-[11px] flex items-start gap-2">
                                                <Info size={13} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                                <div>
                                                    <span className="font-black uppercase text-[9px] tracking-wider mr-1.5">
                                                        {vSt === 'UNIDIRECTIONAL_NO_REPLY' || vSt === 'NO_RESPONSE'
                                                            ? 'Observation Boundary & Suggested Checks:'
                                                            : 'Diagnostic Scope:'}
                                                    </span>
                                                    <span>{synthesisObj.limit_or_diagnosis}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* Active Associated Flow Override Banner (if user clicked another flow in the table) */}
                            {selectedTraceFlow && (
                                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-[11px]">
                                    <div className="flex items-center gap-2 flex-wrap font-mono">
                                        <span className="font-black uppercase text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-700 dark:text-indigo-300">
                                            Selected Flow Filter
                                        </span>
                                        <span className="text-text-primary font-bold">
                                            {selectedTraceFlow.source_ip}:{selectedTraceFlow.source_port} → {selectedTraceFlow.destination_ip}:{selectedTraceFlow.destination_port}
                                        </span>
                                        <span className="text-text-muted">
                                            ({selectedTraceFlow.match_label || selectedTraceFlow.match_scope})
                                        </span>
                                        {selectedTraceFlow.match_scope !== 'EXACT_PCAP_5TUPLE' && (
                                            <span className="text-amber-700 dark:text-amber-300 text-[10px]">
                                                • Note: This flow used port :{selectedTraceFlow.client_port || selectedTraceFlow.source_port} outside the initial 3s PCAP snapshot.
                                            </span>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectedTraceFlow(null);
                                            setDisplayFilter('');
                                        }}
                                        className="px-2 py-0.5 rounded-lg bg-card hover:bg-card-hover border border-border text-[10px] font-bold text-text-secondary hover:text-text-primary cursor-pointer shrink-0"
                                    >
                                        Reset to Probe Flow
                                    </button>
                                </div>
                            )}

                            {/* ── SECTION C: CONNECTED HORIZONTAL PROGRESSION TIMELINE (●──────●──────●──────●) ── */}
                            <div className="pt-2">
                                <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                                    {activeHops.map((hop: any, idx: number) => {
                                        const theme = getNodeTheme(hop.status, hop.role);
                                        const isSelected = selectedHop?.id === hop.id;
                                        const hopSt = String(hop.status || '').toUpperCase();
                                        const prevHop = idx > 0 ? activeHops[idx - 1] : null;
                                        const nextHop = activeHops[idx + 1] || null;
                                        const prevSt = String(prevHop?.status || '').toUpperCase();
                                        const nextSt = String(nextHop?.status || '').toUpperCase();

                                        const hopConfirmed = hopSt === 'OBSERVED' || hopSt === 'FORWARDED';
                                        const prevConfirmed =
                                            prevSt === 'OBSERVED' ||
                                            prevSt === 'FORWARDED' ||
                                            (idx === 1 && prevSt === 'PASSIVE');
                                        const nextConfirmed = nextSt === 'OBSERVED' || nextSt === 'FORWARDED';

                                        const leftConfirmed = prevConfirmed && hopConfirmed;
                                        const rightConfirmed =
                                            (hopConfirmed || (idx === 0 && hopSt === 'PASSIVE')) && nextConfirmed;
                                        const leftWarning =
                                            !leftConfirmed &&
                                            (hopSt === 'NO_RESPONSE' ||
                                                hopSt === 'UNREACHABLE' ||
                                                hopSt === 'BLOCKED' ||
                                                hopSt === 'NOT_OBSERVED' ||
                                                prevSt === 'NOT_OBSERVED');
                                        const rightWarning =
                                            !rightConfirmed &&
                                            (nextSt === 'NO_RESPONSE' ||
                                                nextSt === 'UNREACHABLE' ||
                                                nextSt === 'BLOCKED' ||
                                                nextSt === 'NOT_OBSERVED' ||
                                                hopSt === 'NOT_OBSERVED');

                                        // Connector pill shown on the right track segment between Hop 2 and Hop 3
                                        let connectorPill: string | null = null;
                                        if (idx === 1) {
                                            connectorPill =
                                                hop.metrics?.egress_path ||
                                                verdictObj?.egress_path ||
                                                null;
                                        }

                                        return (
                                            <div key={hop.id || idx} className="flex flex-col min-w-0">
                                                {/* Horizontal Progression Axis Track (●──────────) — -mx-1.5 bridges the gap-3 between grid columns */}
                                                <div className="hidden lg:flex items-center h-7 mb-1.5 relative -mx-1.5">
                                                    {/* Left half-line */}
                                                    <div
                                                        className={`flex-1 h-[2px] ${
                                                            idx === 0
                                                                ? 'bg-transparent'
                                                                : leftConfirmed
                                                                ? 'bg-emerald-500/70'
                                                                : leftWarning
                                                                ? 'border-t-2 border-dashed border-amber-500/60 bg-transparent'
                                                                : 'border-t-2 border-dashed border-slate-500/40 bg-transparent'
                                                        }`}
                                                    />
                                                    {/* Progression Node Circle (●) */}
                                                    <button
                                                        type="button"
                                                        onClick={() => setSelectedHopId(hop.id)}
                                                        title={`Select ${hop.title}`}
                                                        className={`w-6 h-6 rounded-full flex items-center justify-center border transition-all cursor-pointer z-10 ${
                                                            theme.badge
                                                        } ${
                                                            isSelected
                                                                ? 'ring-2 ring-indigo-500 dark:ring-indigo-400 scale-110 shadow-sm'
                                                                : 'hover:scale-105'
                                                        }`}
                                                    >
                                                        {theme.icon}
                                                    </button>
                                                    {/* Right half-line */}
                                                    <div
                                                        className={`flex-1 h-[2px] relative ${
                                                            !nextHop
                                                                ? 'bg-transparent'
                                                                : rightConfirmed
                                                                ? 'bg-emerald-500/70'
                                                                : rightWarning
                                                                ? 'border-t-2 border-dashed border-amber-500/60 bg-transparent'
                                                                : 'border-t-2 border-dashed border-slate-500/40 bg-transparent'
                                                        }`}
                                                    >
                                                        {connectorPill && nextHop && (
                                                            <span
                                                                className="absolute right-0 -top-2.5 translate-x-1/2 px-1.5 py-0.5 rounded bg-card border border-cyan-500/35 text-[8px] font-mono font-bold text-cyan-700 dark:text-cyan-300 whitespace-nowrap z-20 shadow-xs"
                                                                title={connectorPill}
                                                            >
                                                                {connectorPill}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Lighter Selectable Timeline Node Card */}
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedHopId(hop.id)}
                                                    className={`flex-1 min-w-0 text-left rounded-xl px-3 py-2.5 border transition-all duration-150 cursor-pointer flex flex-col justify-between gap-1.5 ${
                                                        theme.card
                                                    } ${
                                                        isSelected
                                                            ? 'ring-2 ring-indigo-500/80 dark:ring-indigo-400/70 shadow-sm'
                                                            : 'opacity-90 hover:opacity-100'
                                                    }`}
                                                >
                                                    <div className="space-y-1">
                                                        {/* Role + Status Label */}
                                                        <div className="flex items-center justify-between gap-1.5">
                                                            <span className="text-[9px] font-black uppercase tracking-wider text-text-muted truncate">
                                                                {idx + 1}. {hop.role_label || hop.role?.replace(/_/g, ' ')}
                                                            </span>
                                                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase border flex items-center gap-1 shrink-0 ${theme.badge}`}>
                                                                <span className="lg:hidden">{theme.icon}</span>
                                                                <span>{theme.label}</span>
                                                            </span>
                                                        </div>

                                                        {/* Equipment / Destination Name */}
                                                        <div className="text-xs font-black text-text-primary truncate" title={hop.title}>
                                                            {hop.title}
                                                        </div>

                                                        {/* Concise State Summary */}
                                                        <div className="text-[11px] font-mono font-bold text-text-primary/90 truncate" title={hop.badge}>
                                                            {hop.badge || hop.subtitle}
                                                        </div>
                                                    </div>

                                                    {/* Discrete Evidence Footer */}
                                                    <div className="pt-1 border-t border-border/35 flex items-center justify-between gap-1.5 text-[9px] font-mono text-text-muted">
                                                        <span className="truncate" title={hop.evidence_type}>
                                                            {hop.evidence_type || 'Telemetry'}
                                                        </span>
                                                        {hop.secondary_info && (
                                                            <span className="text-cyan-700 dark:text-cyan-300 font-bold truncate shrink-0" title={hop.secondary_info}>
                                                                {hop.secondary_info}
                                                            </span>
                                                        )}
                                                    </div>
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* ── SECTION D: SELECTED POINT DETAIL PANEL ── */}
                            {selectedHop && (
                                <div className="mt-2 pt-3 border-t border-border/60 bg-card-secondary/35 rounded-xl p-3.5 border border-border/50 space-y-2.5">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-500/40 dark:border-indigo-500/30">
                                                Selected Point Detail
                                            </span>
                                            <span className="text-xs font-black text-text-primary">
                                                {selectedHop.title}
                                            </span>
                                            <span className="text-[11px] font-mono text-text-muted">
                                                ({selectedHop.subtitle})
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] font-mono">
                                            <span className="text-text-muted">
                                                Evidence: <strong className="text-text-primary">{selectedHop.evidence_type || 'Dataplane'}</strong>
                                            </span>
                                            {!tracingFlow && selectedHop.role === 'SOURCE_STIGIX' && traceResult?.pcap && (
                                                <button
                                                    type="button"
                                                    onClick={() => setTraceEvidenceTab('packets')}
                                                    className="px-2 py-0.5 rounded bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-700 dark:text-cyan-300 border border-cyan-500/40 dark:border-cyan-500/30 font-bold cursor-pointer"
                                                >
                                                    View PCAP ({traceResult.pcap.total_packets} frames)
                                                </button>
                                            )}
                                            {!tracingFlow && (selectedHop.role === 'INGRESS_ION' || selectedHop.role === 'TRANSIT_ION') && totalIonFlows > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() => setTraceEvidenceTab('flows')}
                                                    className="px-2 py-0.5 rounded bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-700 dark:text-indigo-300 border border-indigo-500/40 dark:border-indigo-500/30 font-bold cursor-pointer"
                                                >
                                                    View vION Flows ({totalIonFlows})
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {selectedHop.error && (
                                        <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs font-mono text-rose-700 dark:text-rose-300">
                                            {selectedHop.error}
                                        </div>
                                    )}

                                    {/* Hop-specific detailed metrics grid */}
                                    {selectedHop.metrics && Object.keys(selectedHop.metrics).length > 0 ? (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-[11px] font-mono">
                                            {selectedHop.role === 'SOURCE_STIGIX' && (
                                                <>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50">
                                                        <div className="text-[9px] uppercase text-text-muted">Synthetic Probe Result</div>
                                                        <div className="font-bold text-text-primary mt-0.5">{selectedHop.metrics.probe_detail || '-'}</div>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50">
                                                        <div className="text-[9px] uppercase text-text-muted">Captured Packets (TX / RX)</div>
                                                        <div className="font-bold text-cyan-700 dark:text-cyan-300 mt-0.5">
                                                            {selectedHop.metrics.tx_packets ?? 0} TX / {selectedHop.metrics.rx_packets ?? 0} RX ({selectedHop.metrics.flow_packets ?? 0} flow frames)
                                                        </div>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50">
                                                        <div className="text-[9px] uppercase text-text-muted">TCP Handshake Flags</div>
                                                        <div className="font-bold text-text-primary mt-0.5">
                                                            SYN-ACK: <span className={selectedHop.metrics.syn_ack_seen ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>{selectedHop.metrics.syn_ack_seen ? 'Observed' : 'Not Seen'}</span>
                                                            {' • '}
                                                            RST: <span className={selectedHop.metrics.rst_seen ? 'text-rose-600 dark:text-rose-400' : 'text-text-muted'}>{selectedHop.metrics.rst_seen ? 'Observed' : 'None'}</span>
                                                        </div>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50">
                                                        <div className="text-[9px] uppercase text-text-muted">Local Socket &amp; PCAP File</div>
                                                        <div className="font-bold text-text-primary mt-0.5 truncate" title={selectedHop.metrics.pcap_file || ''}>
                                                            Port :{selectedHop.metrics.local_port || '-'} • {selectedHop.metrics.pcap_file || 'No PCAP'}
                                                        </div>
                                                    </div>
                                                </>
                                            )}

                                            {selectedHop.role === 'SOURCE_REMOTE_STIGIX' && (
                                                <>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50">
                                                        <div className="text-[9px] uppercase text-text-muted">Remote Stigix Instance</div>
                                                        <div className="font-bold text-cyan-700 dark:text-cyan-300 mt-0.5">
                                                            {selectedHop.metrics.peer_name} (v{selectedHop.metrics.peer_version || '3.1'})
                                                        </div>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50">
                                                        <div className="text-[9px] uppercase text-text-muted">Peer LAN IP &amp; Port</div>
                                                        <div className="font-bold text-text-primary mt-0.5">
                                                            {selectedHop.metrics.source_ip}{selectedHop.metrics.source_port ? `:${selectedHop.metrics.source_port}` : ''}
                                                        </div>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50 sm:col-span-2">
                                                        <div className="text-[9px] uppercase text-text-muted">Collection Mode</div>
                                                        <div className="font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">{selectedHop.metrics.mode}</div>
                                                    </div>
                                                </>
                                            )}

                                            {selectedHop.role === 'SOURCE_CLIENT_AGENTLESS' && (
                                                <>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50">
                                                        <div className="text-[9px] uppercase text-text-muted">Client Source IP</div>
                                                        <div className="font-bold text-text-primary mt-0.5">{selectedHop.metrics.source_ip}</div>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50">
                                                        <div className="text-[9px] uppercase text-text-muted">Client Source Port</div>
                                                        <div className="font-bold text-cyan-700 dark:text-cyan-300 mt-0.5">{selectedHop.metrics.source_port || 'Any'}</div>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50 sm:col-span-2">
                                                        <div className="text-[9px] uppercase text-text-muted">Collection Mode</div>
                                                        <div className="font-bold text-amber-700 dark:text-amber-300 mt-0.5">{selectedHop.metrics.mode}</div>
                                                    </div>
                                                </>
                                            )}

                                            {selectedHop.role === 'INGRESS_ION' && (
                                                <>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50">
                                                        <div className="text-[9px] uppercase text-text-muted">Application &amp; ZBFW</div>
                                                        <div className="font-bold text-purple-700 dark:text-purple-300 mt-0.5">
                                                            App-ID: {selectedHop.metrics.app_id || 'None'} • ZBFW: {selectedHop.metrics.sec_action || '-'}
                                                        </div>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50">
                                                        <div className="text-[9px] uppercase text-text-muted">Enforced Policies (Path / QoS / Sec)</div>
                                                        <div className="font-bold text-text-primary mt-0.5 truncate" title={`${selectedHop.metrics.net_policy || '-'} / ${selectedHop.metrics.pri_policy || '-'} / ${selectedHop.metrics.sec_policy || '-'}`}>
                                                            {selectedHop.metrics.net_policy || '-'} / {selectedHop.metrics.pri_policy || '-'} / {selectedHop.metrics.sec_policy || '-'}
                                                        </div>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50">
                                                        <div className="text-[9px] uppercase text-text-muted">Selected Egress WAN Path</div>
                                                        <div className="font-bold text-cyan-700 dark:text-cyan-300 mt-0.5">
                                                            {selectedHop.metrics.egress_path || '-'} ({selectedHop.metrics.raw_path_type || '-'})
                                                        </div>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50">
                                                        <div className="text-[9px] uppercase text-text-muted">Flow Table Correlation</div>
                                                        <div className="font-bold text-text-primary mt-0.5">
                                                            {selectedHop.metrics.matched_flows_count ?? 0} matched / {selectedHop.metrics.total_table_flows ?? 0} active ({selectedHop.metrics.match_label || 'Scanned'})
                                                        </div>
                                                    </div>
                                                </>
                                            )}

                                            {selectedHop.role === 'TRANSIT_ION' && (
                                                <>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50">
                                                        <div className="text-[9px] uppercase text-text-muted">Overlay Tunnel Arrival</div>
                                                        <div className="font-bold text-cyan-700 dark:text-cyan-300 mt-0.5">
                                                            {selectedHop.metrics.tunnel || '-'} ({selectedHop.metrics.raw_path_type || 'Not Observed'})
                                                        </div>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50">
                                                        <div className="text-[9px] uppercase text-text-muted">Hub HA Elements Checked</div>
                                                        <div className="font-bold text-text-primary mt-0.5">
                                                            {Array.isArray(selectedHop.metrics.ha_elements_checked) && selectedHop.metrics.ha_elements_checked.length > 0
                                                                ? selectedHop.metrics.ha_elements_checked.map((h: any) => `${h.element}: ${h.matched_flows}/${h.total_flows}`).join(' • ')
                                                                : (selectedHop.metrics.element || '-')}
                                                        </div>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50 sm:col-span-2">
                                                        <div className="text-[9px] uppercase text-text-muted">Hub Dataplane Observation Note</div>
                                                        <div className="text-text-secondary mt-0.5 text-[10px]">
                                                            {selectedHop.metrics.note || 'Hub ION inspects vpn_to_core transit sessions across the HA pair.'}
                                                        </div>
                                                    </div>
                                                </>
                                            )}

                                            {selectedHop.role === 'TRANSIT_SERVICELINK' && (
                                                <div className="p-2 rounded-lg bg-card border border-border/50 sm:col-span-4">
                                                    <div className="text-[9px] uppercase text-text-muted">ServiceLink Tunnel Status (dump servicelink summary all)</div>
                                                    <div className="font-bold text-text-primary mt-1 flex flex-wrap gap-2">
                                                        {Array.isArray(selectedHop.metrics.servicelinks) && selectedHop.metrics.servicelinks.length > 0
                                                            ? selectedHop.metrics.servicelinks.map((sl: any, sIdx: number) => (
                                                                <span key={sIdx} className="px-2 py-0.5 rounded bg-card-secondary border border-border">
                                                                    {sl.device} ({sl.name}): <span className={sl.status === 'up' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{sl.status}/{sl.ext_state}</span> → {sl.peer}
                                                                </span>
                                                            ))
                                                            : <span>Tunnel: {selectedHop.metrics.egress_path}</span>}
                                                    </div>
                                                </div>
                                            )}

                                            {selectedHop.role === 'TRANSIT_DIA' && (
                                                <>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50 sm:col-span-2">
                                                        <div className="text-[9px] uppercase text-text-muted">Direct Internet Breakout Circuit</div>
                                                        <div className="font-bold text-cyan-700 dark:text-cyan-300 mt-0.5">{selectedHop.metrics.circuit || 'Direct WAN'}</div>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50 sm:col-span-2">
                                                        <div className="text-[9px] uppercase text-text-muted">Forwarding Mode</div>
                                                        <div className="font-bold text-text-primary mt-0.5">{selectedHop.metrics.raw_path_type || 'direct'} (WANPATH {selectedHop.metrics.wanpath_id || '-'})</div>
                                                    </div>
                                                </>
                                            )}

                                            {selectedHop.role === 'DESTINATION' && (
                                                <>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50">
                                                        <div className="text-[9px] uppercase text-text-muted">Target &amp; Resolved IP</div>
                                                        <div className="font-bold text-text-primary mt-0.5">
                                                            {selectedHop.metrics.destination_input || '-'} → {selectedHop.metrics.resolved_ip || '-'}
                                                        </div>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50">
                                                        <div className="text-[9px] uppercase text-text-muted">Protocol / Service Port</div>
                                                        <div className="font-bold text-cyan-700 dark:text-cyan-300 mt-0.5">
                                                            {selectedHop.metrics.protocol}/{selectedHop.metrics.port || '*'}
                                                            {selectedHop.metrics.dns_resolution_ms !== null && selectedHop.metrics.dns_resolution_ms !== undefined
                                                                ? ` (DNS: ${selectedHop.metrics.dns_resolution_ms}ms)`
                                                                : ''}
                                                        </div>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-card border border-border/50 sm:col-span-2">
                                                        <div className="text-[9px] uppercase text-text-muted">Instrumentation &amp; Proof Boundary</div>
                                                        <div className="text-text-secondary mt-0.5 text-[10px]">
                                                            {selectedHop.metrics.unidirectional_diagnosis ||
                                                                'Uninstrumented remote endpoint (no Stigix capture agent on destination). Reachability is verified via return traffic received by the source probe.'}
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="text-[11px] font-mono text-text-muted italic">
                                            {tracingFlow ? 'Waiting for live telemetry collection on this hop...' : 'No additional metrics recorded for this hop.'}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* ── SECTION E: TABBED EVIDENCE WORKSPACE ── */}
                        {!tracingFlow && traceResult && (
                            <div className="bg-card border border-border rounded-2xl p-3 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div className="inline-flex items-center bg-card-secondary border border-border rounded-xl p-1 gap-1 flex-wrap">
                                    <button
                                        type="button"
                                        onClick={() => setTraceEvidenceTab('packets')}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                                            traceEvidenceTab === 'packets'
                                                ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/40 dark:border-cyan-500/30 shadow-sm'
                                                : 'text-text-muted hover:text-text-primary border border-transparent'
                                        }`}
                                    >
                                        <Binary size={13} />
                                        <span>Captured Packets</span>
                                        <span className="px-1.5 py-0.2 rounded bg-card text-[10px] font-mono">
                                            {filteredPackets.length}/{totalPackets}
                                        </span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setTraceEvidenceTab('flows')}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                                            traceEvidenceTab === 'flows'
                                                ? 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-500/40 dark:border-indigo-500/30 shadow-sm'
                                                : 'text-text-muted hover:text-text-primary border border-transparent'
                                        }`}
                                    >
                                        <Terminal size={13} />
                                        <span>vION Flow Records</span>
                                        <span className="px-1.5 py-0.2 rounded bg-card text-[10px] font-mono">
                                            {totalIonFlows}
                                        </span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setTraceEvidenceTab('limits')}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                                            traceEvidenceTab === 'limits'
                                                ? 'bg-purple-500/20 text-purple-700 dark:text-purple-300 border border-purple-500/40 dark:border-purple-500/30 shadow-sm'
                                                : 'text-text-muted hover:text-text-primary border border-transparent'
                                        }`}
                                    >
                                        <Info size={13} />
                                        <span>Collection &amp; Limits</span>
                                    </button>
                                </div>

                                <div className="flex items-center gap-2 flex-wrap">
                                    {/* Capture Summary Pill */}
                                    {activePcapFilename && (
                                        <span
                                            title={`Active capture file: ${activePcapFilename}${traceResult.query?.bpf_used ? ` • BPF: ${traceResult.query.bpf_used}` : ''}`}
                                            className="px-2.5 py-1 rounded-lg bg-card-secondary border border-border/70 text-[10px] font-mono text-text-secondary flex items-center gap-1.5"
                                        >
                                            <HardDrive size={11} className="text-cyan-600 dark:text-cyan-400 shrink-0" />
                                            <span>
                                                Capture · <strong className="text-text-primary">{totalPackets}</strong> packet{totalPackets === 1 ? '' : 's'}
                                                {fileSizeBytes ? ` · ${(fileSizeBytes / 1024).toFixed(1)} KB` : ''}
                                            </span>
                                        </span>
                                    )}

                                    {traceEvidenceTab === 'flows' && (
                                        <span className="text-[10px] font-mono text-text-muted px-2 py-1">
                                            <strong className="text-emerald-700 dark:text-emerald-300">{exactIonFlowsCount}</strong> exact match / <strong className="text-text-primary">{totalIonFlows}</strong> records
                                        </span>
                                    )}

                                    {/* Contextual PCAP Actions attached to Evidence Bar */}
                                    <button
                                        type="button"
                                        onClick={handleOpenHistory}
                                        title="Browse or manage saved PCAP captures"
                                        className="px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-all flex items-center gap-1.5 cursor-pointer bg-card-secondary text-text-secondary border-border hover:text-text-primary hover:border-border/80"
                                    >
                                        <HardDrive size={12} />
                                        <span>Captures</span>
                                    </button>

                                    {activePcapFilename && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => handleDownloadCapture(activePcapFilename)}
                                                disabled={downloadingFile === activePcapFilename}
                                                title={`Download ${activePcapFilename}`}
                                                className="px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                                            >
                                                {downloadingFile === activePcapFilename ? (
                                                    <Loader2 size={12} className="animate-spin" />
                                                ) : (
                                                    <Download size={12} />
                                                )}
                                                <span>Download PCAP</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleSendToReplay}
                                                title="Send trace to PCAP Replay engine"
                                                className="px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-purple-600/15 hover:bg-purple-600/25 border border-purple-500/40 dark:border-purple-500/30 text-purple-700 dark:text-purple-300 transition-all flex items-center gap-1.5 cursor-pointer"
                                            >
                                                <Zap size={12} />
                                                <span>Replay</span>
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* TAB 2 CONTENT: vION FLOW RECORDS */}
                        {!tracingFlow && traceResult && traceEvidenceTab === 'flows' && (
                            <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
                                <div className="px-4 py-2.5 bg-card-secondary border-b border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <Terminal size={14} className="text-indigo-600 dark:text-indigo-400" />
                                        <span className="text-xs font-black uppercase tracking-wider text-text-primary">
                                            vION Dataplane Flow Records (inspect flow brief)
                                        </span>
                                        <span className="text-[10px] text-text-muted font-mono">
                                            — Click a row to synchronize packet filter
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setShowOnlyExactFlows((prev) => !prev)}
                                            className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase border cursor-pointer transition-colors ${
                                                showOnlyExactFlows
                                                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 dark:border-emerald-500/30'
                                                    : 'bg-card text-text-muted hover:text-text-primary border-border'
                                            }`}
                                        >
                                            {showOnlyExactFlows ? 'Showing Probe 5-Tuple Only' : `Show All Flows (${totalIonFlows})`}
                                        </button>
                                    </div>
                                </div>

                                {totalIonFlows === 0 ? (
                                    <div className="py-12 text-center text-text-muted space-y-1 font-mono text-xs">
                                        <div>No matching dataplane flows returned by vION CLI.</div>
                                        <div className="text-[10px] opacity-70">Check the "Collection &amp; Limits" tab for CLI command details.</div>
                                    </div>
                                ) : (
                                    <div className="max-h-80 overflow-y-auto overflow-x-auto font-mono text-[11px]">
                                        <table className="w-full text-left border-collapse whitespace-nowrap">
                                            <thead className="sticky top-0 bg-card-secondary/95 backdrop-blur text-[9px] uppercase text-text-muted border-b border-border/40 z-10">
                                                <tr>
                                                    <th className="py-2 px-2.5">Match</th>
                                                    <th className="py-2 px-2.5">Hop / Element</th>
                                                    <th className="py-2 px-2.5">Source</th>
                                                    <th className="py-2 px-2.5">Destination</th>
                                                    <th className="py-2 px-2">Proto</th>
                                                    <th className="py-2 px-2.5">App-ID</th>
                                                    <th className="py-2 px-2.5">Path / QoS Policy</th>
                                                    <th className="py-2 px-2.5">ZBFW Security</th>
                                                    <th className="py-2 px-2.5">Egress / Tunnel Path</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border/20">
                                                {ingressFlowsAll
                                                    .filter((fl) => !showOnlyExactFlows || fl.match_scope === 'EXACT_PCAP_5TUPLE' || fl.match_scope === 'SESSION_PROBE_FLOW')
                                                    .map((fl: any, i: number) => {
                                                        const isExact = fl.match_scope === 'EXACT_PCAP_5TUPLE';
                                                        const isSession = fl.match_scope === 'SESSION_PROBE_FLOW';
                                                        const isRowSelected =
                                                            selectedTraceFlow &&
                                                            selectedTraceFlow.hopOrigin === 'ingress' &&
                                                            selectedTraceFlow.source_port === fl.source_port &&
                                                            selectedTraceFlow.destination_port === fl.destination_port;
                                                        const netPol = fl.net_policy || '-';
                                                        const qosPol = fl.pri_policy || '-';
                                                        const combinedPol = netPol === qosPol ? netPol : `${netPol} / ${qosPol}`;
                                                        return (
                                                            <tr
                                                                key={`ing-${i}`}
                                                                onClick={() => handleSelectIonFlowRow(fl, 'ingress')}
                                                                className={`cursor-pointer transition-colors ${
                                                                    isRowSelected
                                                                        ? 'bg-indigo-500/20 border-l-4 border-l-indigo-500 dark:border-l-indigo-400'
                                                                        : isExact
                                                                        ? 'bg-emerald-500/5 hover:bg-indigo-500/10'
                                                                        : 'hover:bg-indigo-500/10'
                                                                }`}
                                                            >
                                                                <td className="py-2 px-2.5">
                                                                    <span
                                                                        title={isExact ? 'Exact probe flow matched in PCAP and ION flow table' : isSession ? 'Active synthetic probe keepalive flow' : 'Associated flow to same destination'}
                                                                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black uppercase border whitespace-nowrap ${
                                                                            isExact
                                                                                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 dark:border-emerald-500/30'
                                                                                : isSession
                                                                                ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/40 dark:border-cyan-500/30'
                                                                                : 'bg-slate-500/20 text-slate-700 dark:text-slate-300 border-slate-500/40 dark:border-slate-500/30'
                                                                        }`}
                                                                    >
                                                                        {isExact ? (isIcmpFlow ? '★ Exact ICMP' : '★ Exact 5-Tuple') : isSession ? 'Probe Keepalive' : 'Associated'}
                                                                    </span>
                                                                </td>
                                                                <td className="py-2 px-2.5 font-bold text-cyan-700 dark:text-cyan-400">
                                                                    Ingress ({traceResult.hops?.[1]?.metrics?.element || traceResult.query?.source_site})
                                                                </td>
                                                                <td className="py-2 px-2.5 text-text-primary">{fl.source_ip}:{fl.source_port}</td>
                                                                <td className="py-2 px-2.5 text-text-primary">{fl.destination_ip}:{fl.destination_port}</td>
                                                                <td className="py-2 px-2 text-text-muted">{fl.protocol === 6 ? 'TCP' : fl.protocol === 17 ? 'UDP' : fl.protocol === 1 ? 'ICMP' : fl.protocol}</td>
                                                                <td className="py-2 px-2.5 font-bold text-purple-700 dark:text-purple-300 max-w-[160px] truncate" title={fl.app_id}>
                                                                    {fl.app_id}
                                                                </td>
                                                                <td
                                                                    className="py-2 px-2.5 text-text-secondary max-w-[170px] truncate"
                                                                    title={`Path Policy: ${netPol} • QoS Policy: ${qosPol}`}
                                                                >
                                                                    {combinedPol}
                                                                </td>
                                                                <td className="py-2 px-2.5" title={`Rule: ${fl.sec_policy || '-'} • Action: ${fl.sec_action || '-'}`}>
                                                                    <div className="inline-flex items-center gap-1.5">
                                                                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${
                                                                            String(fl.sec_action).toUpperCase() === 'ALLOW'
                                                                                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                                                                                : 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
                                                                        }`}>
                                                                            {fl.sec_action}
                                                                        </span>
                                                                        <span className="text-text-secondary max-w-[130px] truncate">
                                                                            {fl.sec_policy || '-'}
                                                                        </span>
                                                                    </div>
                                                                </td>
                                                                <td
                                                                    className="py-2 px-2.5 text-cyan-700 dark:text-cyan-300 font-bold"
                                                                    title={`${fl.egress_path || '-'} (${fl.raw_path_type || '-'})${fl.wanpath_id ? ` • WANPATH ${fl.wanpath_id}` : ''}`}
                                                                >
                                                                    <span>{fl.egress_path}</span>
                                                                    {fl.raw_path_type && (
                                                                        <span className="text-text-muted font-normal text-[10px] ml-1">({fl.raw_path_type})</span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                {transitFlowsAll
                                                    .filter((fl) => !showOnlyExactFlows || fl.match_scope === 'EXACT_PCAP_5TUPLE' || fl.match_scope === 'SESSION_PROBE_FLOW')
                                                    .map((fl: any, i: number) => {
                                                        const isExact = fl.match_scope === 'EXACT_PCAP_5TUPLE';
                                                        const isSession = fl.match_scope === 'SESSION_PROBE_FLOW';
                                                        const hubEl = traceResult.hops?.[2]?.metrics?.element || traceResult.verdict?.peer_site_name;
                                                        const appUnknownOnHub = !fl.app_id || String(fl.app_id).toLowerCase() === 'unknown';
                                                        return (
                                                            <tr
                                                                key={`tr-${i}`}
                                                                onClick={() => handleSelectIonFlowRow(fl, 'transit')}
                                                                className="hover:bg-emerald-500/10 cursor-pointer transition-colors bg-emerald-500/5"
                                                            >
                                                                <td className="py-2 px-2.5">
                                                                    <span
                                                                        title={isExact ? 'Exact probe flow matched on Transit Hub ION' : isSession ? 'Active synthetic probe keepalive flow' : 'Associated flow on Transit Hub ION'}
                                                                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black uppercase border whitespace-nowrap ${
                                                                            isExact
                                                                                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 dark:border-emerald-500/30'
                                                                                : isSession
                                                                                ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/40 dark:border-cyan-500/30'
                                                                                : 'bg-slate-500/20 text-slate-700 dark:text-slate-300 border-slate-500/40 dark:border-slate-500/30'
                                                                        }`}
                                                                    >
                                                                        {isExact ? (isIcmpFlow ? '★ Exact ICMP' : '★ Exact 5-Tuple') : isSession ? 'Probe Keepalive' : 'Associated'}
                                                                    </span>
                                                                </td>
                                                                <td className="py-2 px-2.5 font-bold text-emerald-700 dark:text-emerald-400" title={`Transit Hub (${hubEl})`}>
                                                                    Hub ({hubEl})
                                                                </td>
                                                                <td className="py-2 px-2.5 text-text-primary">{fl.source_ip}:{fl.source_port}</td>
                                                                <td className="py-2 px-2.5 text-text-primary">{fl.destination_ip}:{fl.destination_port}</td>
                                                                <td className="py-2 px-2 text-text-muted">{fl.protocol === 6 ? 'TCP' : fl.protocol === 17 ? 'UDP' : fl.protocol === 1 ? 'ICMP' : fl.protocol}</td>
                                                                <td
                                                                    className="py-2 px-2.5 text-text-muted italic"
                                                                    title="App-ID classification is enforced at the Ingress Branch ION; Transit Hub inspects vpn_to_core overlay sessions"
                                                                >
                                                                    {appUnknownOnHub ? 'Inherited (Ingress)' : fl.app_id}
                                                                </td>
                                                                <td className="py-2 px-2.5 text-text-muted">
                                                                    {fl.net_policy && fl.net_policy !== '--' ? fl.net_policy : '—'}
                                                                </td>
                                                                <td className="py-2 px-2.5 text-text-muted">
                                                                    {fl.sec_action && fl.sec_action !== 'N/A' ? fl.sec_action : '—'}
                                                                </td>
                                                                <td
                                                                    className="py-2 px-2.5 text-emerald-700 dark:text-emerald-300 font-bold"
                                                                    title={`Transit path: ${fl.raw_path_type || 'vpn_to_core'}${fl.wanpath_id ? ` • WANPATH ${fl.wanpath_id}` : ''}`}
                                                                >
                                                                    <span>{fl.raw_path_type || 'vpn_to_core'}</span>
                                                                    {fl.wanpath_id && (
                                                                        <span className="text-text-muted font-normal text-[10px] ml-1.5">
                                                                            (WANPATH …{String(fl.wanpath_id).slice(-6)})
                                                                        </span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* TAB 3 CONTENT: COLLECTION AUDIT & DIAGNOSTIC LIMITS */}
                        {!tracingFlow && traceResult && traceEvidenceTab === 'limits' && (
                            <div className="bg-card border border-border rounded-2xl p-4 shadow-sm grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs font-mono">
                                <div className="p-3 rounded-xl bg-card-secondary/50 border border-border/60 space-y-2">
                                    <div className="text-[10px] font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                                        1. Search Criteria vs Probe Identity
                                    </div>
                                    <div className="space-y-1 text-[11px]">
                                        <div>Source Site: <strong className="text-text-primary">{traceResult.query?.source_site}</strong> ({traceResult.query?.source_mode})</div>
                                        <div>Input Source IP: <strong className="text-text-primary">{traceResult.query?.src_ip_input || 'Auto (Detected from Probe)'}</strong></div>
                                        <div>Actual Probe 5-Tuple: <strong className="text-cyan-700 dark:text-cyan-300">{flowIdObj?.probe_5tuple}</strong></div>
                                        <div>PCAP Snapshot Ports: <strong className="text-text-primary">{(flowIdObj?.pcap_ports || []).join(', ') || 'None'}</strong></div>
                                        <div>Kernel BPF Filter: <code className="text-emerald-700 dark:text-emerald-300">{traceResult.query?.bpf_used || 'N/A (Agentless)'}</code></div>
                                    </div>
                                </div>

                                <div className="p-3 rounded-xl bg-card-secondary/50 border border-border/60 space-y-2">
                                    <div className="text-[10px] font-black uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
                                        2. vION WebSocket CLI Collection Audit
                                    </div>
                                    <div className="space-y-1 text-[11px]">
                                        <div>
                                            Ingress ION ({traceResult.hops?.[1]?.metrics?.element || traceResult.query?.source_site}):{' '}
                                            <code className="text-text-primary">{traceResult.hops?.[1]?.metrics?.command || 'inspect flow brief'}</code>
                                            {traceResult.hops?.[1]?.metrics?.duration_ms ? ` (${traceResult.hops[1].metrics.duration_ms}ms)` : ''}
                                        </div>
                                        {traceResult.hops?.[2]?.role === 'TRANSIT_ION' && (
                                            <div>
                                                Transit Hub ({traceResult.hops?.[2]?.metrics?.element || traceResult.verdict?.peer_site_name}):{' '}
                                                <code className="text-text-primary">{traceResult.hops?.[2]?.metrics?.command || 'inspect flow brief'}</code>
                                                {traceResult.hops?.[2]?.metrics?.duration_ms ? ` (${traceResult.hops[2].metrics.duration_ms}ms)` : ''}
                                            </div>
                                        )}
                                        <div>
                                            Total Trace Duration: <strong className="text-text-primary">{(traceResult.duration_ms / 1000).toFixed(2)}s</strong>
                                        </div>
                                    </div>
                                </div>

                                <div className="p-3 rounded-xl bg-card-secondary/50 border border-border/60 space-y-2 font-sans">
                                    <div className="text-[10px] font-black uppercase tracking-wider text-amber-800 dark:text-amber-300 font-mono">
                                        3. Methodological Scope &amp; Limits
                                    </div>
                                    <ul className="space-y-1 text-[11px] text-text-secondary list-disc pl-4">
                                        <li><strong>Destination Node:</strong> External/remote targets do not run a Stigix probe; reachability is inferred from return frames captured at the source.</li>
                                        <li><strong>Hub Policy Columns:</strong> Prisma SD-WAN enforces App-ID, Path, QoS, and ZBFW at the ingress Branch ION; Hub IONs display overlay transit state (<code className="font-mono text-cyan-700 dark:text-cyan-300">vpn_to_core</code>).</li>
                                        <li><strong>PCAP Window vs CLI Keepalive:</strong> Local PCAP records the initial ~3s probe handshake, while Stigix pulses keepalive probes during CLI collection so embryonic flows do not expire.</li>
                                    </ul>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* Display Search & Filter Bar + 3-Pane Wireshark Inspector (Always visible in Local PCAP mode, or in Trace mode when 'Captured Packets' tab is selected) */}
            {(captureMode === 'local' || (captureMode === 'trace' && !tracingFlow && traceResult && traceEvidenceTab === 'packets') || (captureMode === 'trace' && !tracingFlow && !traceResult)) && (
            <>
            <div className="bg-card border border-border px-4 py-2.5 rounded-2xl flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 flex-1">
                    <Filter size={14} className="text-text-muted shrink-0" />
                    <input
                        type="text"
                        value={displayFilter}
                        onChange={(e) => setDisplayFilter(e.target.value)}
                        placeholder="Filter by protocol, IP, target (e.g. 'DC1', 'WAN', 'tcp', 'rst', '8080')..."
                        className="bg-transparent border-0 text-xs text-text-primary font-mono placeholder:text-text-muted/50 focus:outline-none w-full"
                    />
                    {displayFilter && (
                        <button onClick={() => setDisplayFilter('')} className="text-text-muted hover:text-text-primary p-1 cursor-pointer">
                            <X size={13} />
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-2 shrink-0 text-[10px] font-mono text-text-muted">
                    <div className="flex gap-1">
                        {['tcp', 'udp', 'icmp', 'dns', 'rst'].map(tag => (
                            <button
                                key={tag}
                                onClick={() => setDisplayFilter(tag)}
                                className={`px-2 py-0.5 rounded uppercase text-[9px] font-black border cursor-pointer transition-colors ${
                                    displayFilter.toLowerCase() === tag
                                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                                        : 'bg-card-secondary text-text-muted hover:text-text-primary border-border/40'
                                }`}
                            >
                                {tag}
                            </button>
                        ))}
                    </div>
                    <span className="hidden sm:inline border-l border-border/60 pl-2">
                        {loadingPackets ? (
                            <span className="flex items-center gap-1.5 text-cyan-400">
                                <Loader2 size={11} className="animate-spin" />
                                Dissecting...
                            </span>
                        ) : (
                            `${filteredPackets.length} / ${totalPackets} frames`
                        )}
                    </span>
                    {activePcapFile && packets.length < totalPackets && !loadingPackets && (
                        <button
                            onClick={handleLoadMorePackets}
                            disabled={loadingMore}
                            className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                            title="Load next batch of packets"
                        >
                            {loadingMore ? <Loader2 size={10} className="animate-spin" /> : null}
                            + More ({totalPackets - packets.length})
                        </button>
                    )}
                </div>
            </div>

            {/* ── 3-PANE INSPECTOR LAYOUT ── */}
            <div className="space-y-4">
                {/* PANE 1: Virtual Packet Table */}
                <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
                    <div className="h-64 sm:h-72 lg:h-80 overflow-y-auto overflow-x-auto font-mono text-xs scrollbar-thin scrollbar-thumb-border">
                        <table className="w-full text-left border-collapse min-w-[1100px]">
                            <thead className="sticky top-0 bg-card-secondary/95 backdrop-blur border-b border-border text-[9px] uppercase tracking-wider text-text-muted z-10 select-none">
                                <tr>
                                    <th style={{ width: colWidths.no, minWidth: colWidths.no }} className="relative py-2 px-3 font-bold group">
                                        <span>No.</span>
                                        <div
                                            onMouseDown={(e) => handleMouseDownResize('no', e)}
                                            onDoubleClick={handleResetColWidths}
                                            title="Drag to resize, double-click to reset widths"
                                            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-cyan-500/60 active:bg-cyan-500 transition-colors z-20"
                                        />
                                    </th>
                                    <th style={{ width: colWidths.time, minWidth: colWidths.time }} className="relative py-2 px-3 font-bold group">
                                        <span>Time (s)</span>
                                        <div
                                            onMouseDown={(e) => handleMouseDownResize('time', e)}
                                            onDoubleClick={handleResetColWidths}
                                            title="Drag to resize, double-click to reset widths"
                                            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-cyan-500/60 active:bg-cyan-500 transition-colors z-20"
                                        />
                                    </th>
                                    <th style={{ width: colWidths.source, minWidth: colWidths.source }} className="relative py-2 px-3 font-bold group">
                                        <span>Source</span>
                                        <div
                                            onMouseDown={(e) => handleMouseDownResize('source', e)}
                                            onDoubleClick={handleResetColWidths}
                                            title="Drag to resize, double-click to reset widths"
                                            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-cyan-500/60 active:bg-cyan-500 transition-colors z-20"
                                        />
                                    </th>
                                    <th style={{ width: colWidths.srcTarget, minWidth: colWidths.srcTarget }} className="relative py-2 px-3 font-bold group">
                                        <span>Src Target</span>
                                        <div
                                            onMouseDown={(e) => handleMouseDownResize('srcTarget', e)}
                                            onDoubleClick={handleResetColWidths}
                                            title="Drag to resize, double-click to reset widths"
                                            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-cyan-500/60 active:bg-cyan-500 transition-colors z-20"
                                        />
                                    </th>
                                    <th style={{ width: colWidths.destination, minWidth: colWidths.destination }} className="relative py-2 px-3 font-bold group">
                                        <span>Destination</span>
                                        <div
                                            onMouseDown={(e) => handleMouseDownResize('destination', e)}
                                            onDoubleClick={handleResetColWidths}
                                            title="Drag to resize, double-click to reset widths"
                                            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-cyan-500/60 active:bg-cyan-500 transition-colors z-20"
                                        />
                                    </th>
                                    <th style={{ width: colWidths.dstTarget, minWidth: colWidths.dstTarget }} className="relative py-2 px-3 font-bold group">
                                        <span>Dst Target</span>
                                        <div
                                            onMouseDown={(e) => handleMouseDownResize('dstTarget', e)}
                                            onDoubleClick={handleResetColWidths}
                                            title="Drag to resize, double-click to reset widths"
                                            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-cyan-500/60 active:bg-cyan-500 transition-colors z-20"
                                        />
                                    </th>
                                    <th style={{ width: colWidths.protocol, minWidth: colWidths.protocol }} className="relative py-2 px-3 font-bold group">
                                        <span>Protocol</span>
                                        <div
                                            onMouseDown={(e) => handleMouseDownResize('protocol', e)}
                                            onDoubleClick={handleResetColWidths}
                                            title="Drag to resize, double-click to reset widths"
                                            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-cyan-500/60 active:bg-cyan-500 transition-colors z-20"
                                        />
                                    </th>
                                    <th style={{ width: colWidths.length, minWidth: colWidths.length }} className="relative py-2 px-3 font-bold group">
                                        <span>Length</span>
                                        <div
                                            onMouseDown={(e) => handleMouseDownResize('length', e)}
                                            onDoubleClick={handleResetColWidths}
                                            title="Drag to resize, double-click to reset widths"
                                            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-cyan-500/60 active:bg-cyan-500 transition-colors z-20"
                                        />
                                    </th>
                                    <th style={{ width: colWidths.info, minWidth: colWidths.info }} className="relative py-2 px-3 font-bold group">
                                        <span>Info</span>
                                        <div
                                            onMouseDown={(e) => handleMouseDownResize('info', e)}
                                            onDoubleClick={handleResetColWidths}
                                            title="Drag to resize, double-click to reset widths"
                                            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-cyan-500/60 active:bg-cyan-500 transition-colors z-20"
                                        />
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/20">
                                {loadingPackets ? (
                                    <tr>
                                        <td colSpan={9} className="py-20 text-center text-text-muted">
                                            <div className="space-y-3">
                                                <Loader2 size={32} className="animate-spin mx-auto text-cyan-400" />
                                                <p className="text-xs font-bold text-text-primary">
                                                    Dissecting packets with Scapy engine...
                                                </p>
                                                <p className="text-[10px] text-text-muted">
                                                    Decoding OSI protocols, packet headers, and hex dumps
                                                </p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : filteredPackets.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="py-16 text-center text-text-muted">
                                            {capturing ? (
                                                <div className="space-y-2">
                                                    <RefreshCw size={24} className="animate-spin mx-auto text-cyan-400" />
                                                    <p className="text-xs font-bold">Listening for packets matching filter on {selectedInterface}...</p>
                                                </div>
                                            ) : (
                                                <div className="space-y-2">
                                                    <Binary size={24} className="mx-auto opacity-40" />
                                                    <p className="text-xs font-bold">No packets captured yet.</p>
                                                    <p className="text-[10px] opacity-60">Click « Start Capture » to begin recording traffic.</p>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredPackets.map((pkt) => {
                                        const isSelected = selectedPacketNo === pkt.no;
                                        const srcTarget = resolveTarget(pkt.source);
                                        const dstTarget = resolveTarget(pkt.destination);
                                        return (
                                            <tr
                                                key={pkt.no}
                                                onClick={() => setSelectedPacketNo(pkt.no)}
                                                className={`cursor-pointer transition-colors text-[11px] select-none ${
                                                    isSelected 
                                                        ? 'bg-blue-500/15 dark:bg-blue-600/25 text-blue-900 dark:text-text-primary font-bold border-l-4 border-l-blue-500' 
                                                        : 'hover:bg-card-hover/60 text-text-secondary'
                                                }`}
                                            >
                                                <td style={{ width: colWidths.no, minWidth: colWidths.no }} className="py-1.5 px-3 text-text-muted truncate">
                                                    {pkt.no}
                                                </td>
                                                <td style={{ width: colWidths.time, minWidth: colWidths.time }} className="py-1.5 px-3 text-text-muted truncate">
                                                    {pkt.time.toFixed(6)}
                                                </td>
                                                <td style={{ width: colWidths.source, minWidth: colWidths.source }} className="py-1.5 px-3 text-text-primary truncate" title={pkt.source + (pkt.sport ? `:${pkt.sport}` : '')}>
                                                    {pkt.source}{pkt.sport ? `:${pkt.sport}` : ''}
                                                </td>
                                                <td style={{ width: colWidths.srcTarget, minWidth: colWidths.srcTarget }} className="py-1.5 px-3 truncate">
                                                    <TargetBadge
                                                        target={srcTarget}
                                                        onClick={(lbl) => setDisplayFilter(prev => prev === lbl ? '' : lbl)}
                                                    />
                                                </td>
                                                <td style={{ width: colWidths.destination, minWidth: colWidths.destination }} className="py-1.5 px-3 text-text-primary truncate" title={pkt.destination + (pkt.dport ? `:${pkt.dport}` : '')}>
                                                    {pkt.destination}{pkt.dport ? `:${pkt.dport}` : ''}
                                                </td>
                                                <td style={{ width: colWidths.dstTarget, minWidth: colWidths.dstTarget }} className="py-1.5 px-3 truncate">
                                                    <TargetBadge
                                                        target={dstTarget}
                                                        onClick={(lbl) => setDisplayFilter(prev => prev === lbl ? '' : lbl)}
                                                    />
                                                </td>
                                                <td style={{ width: colWidths.protocol, minWidth: colWidths.protocol }} className="py-1.5 px-3">
                                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border ${getProtoColorClass(pkt.protocol, pkt.info)}`}>
                                                        {pkt.protocol}
                                                    </span>
                                                </td>
                                                <td style={{ width: colWidths.length, minWidth: colWidths.length }} className="py-1.5 px-3 text-text-muted truncate">
                                                    {pkt.length}
                                                </td>
                                                <td style={{ width: colWidths.info, minWidth: colWidths.info }} className="py-1.5 px-3 truncate font-mono text-[11px]" title={pkt.info}>
                                                    {pkt.info}
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* BOTTOM SPLIT: Pane 2 (Protocol Tree) & Pane 3 (Hex Dump) */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* PANE 2: OSI Layer Protocol Tree */}
                    <div className="bg-card border border-border rounded-2xl p-4 shadow-sm flex flex-col h-72 lg:h-80">
                        <div className="flex items-center justify-between pb-3 border-b border-border/60">
                            <div className="flex items-center gap-2">
                                <Layers size={15} className="text-cyan-400" />
                                <h3 className="text-xs font-black uppercase tracking-wider text-text-primary">
                                    Protocol Dissection Tree {activePacket ? `(Frame #${activePacket.no})` : ''}
                                </h3>
                            </div>
                            {activePacket && (
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const dstIp = cleanHost(activePacket.destination);
                                            const srcIp = cleanHost(activePacket.source);
                                            const protoLower = activePacket.protocol.toLowerCase();
                                            const mappedProto: 'tcp' | 'udp' | 'icmp' =
                                                protoLower === 'udp' || protoLower === 'dns' || protoLower === 'rtp'
                                                    ? 'udp'
                                                    : protoLower === 'icmp'
                                                    ? 'icmp'
                                                    : 'tcp';
                                            const port = activePacket.dport || activePacket.sport || 443;
                                            setCaptureMode('trace');
                                            setTraceDestination(dstIp);
                                            setTraceSrcIp(srcIp);
                                            setTraceDstPort(port);
                                            setTraceProtocol(mappedProto);
                                            handleRunFlowTrace({
                                                destination: dstIp,
                                                srcIp,
                                                dstPort: port,
                                                protocol: mappedProto
                                            });
                                        }}
                                        title="Trace this packet's 5-tuple across Branch & DC IONs (NWPI E2E Flow Trace)"
                                        className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 flex items-center gap-1 transition-colors cursor-pointer"
                                    >
                                        <Sparkles size={10} />
                                        Trace Flow E2E
                                    </button>
                                    <span className={`text-[9px] font-black px-2 py-0.5 rounded border ${getProtoColorClass(activePacket.protocol, activePacket.info)}`}>
                                        {activePacket.protocol} • {activePacket.length} bytes
                                    </span>
                                </div>
                            )}
                        </div>

                        <div className="flex-1 overflow-y-auto mt-2 font-mono text-[11px] space-y-1.5 scrollbar-thin scrollbar-thumb-border">
                            {loadingPackets ? (
                                <div className="h-full flex flex-col items-center justify-center gap-2 text-text-muted text-xs">
                                    <Loader2 size={20} className="animate-spin text-cyan-400" />
                                    <span>Decoding protocol layers...</span>
                                </div>
                            ) : !activePacket || !activePacket.tree ? (
                                <div className="h-full flex items-center justify-center text-text-muted text-xs italic">
                                    Select a packet above to inspect its protocol layers
                                </div>
                            ) : (
                                Object.entries(activePacket.tree).map(([layerName, layerData]: [string, any]) => {
                                    const isExpanded = !!expandedLayers[layerName];
                                    return (
                                        <div key={layerName} className="border border-border/40 rounded-xl overflow-hidden bg-card-secondary/20">
                                            <button
                                                onClick={() => toggleLayer(layerName)}
                                                className="w-full flex items-center justify-between px-3 py-1.5 text-left bg-card-secondary/40 hover:bg-card-hover/60 transition-colors cursor-pointer select-none"
                                            >
                                                <div className="flex items-center gap-2 font-bold text-text-primary">
                                                    {isExpanded ? <ChevronDown size={13} className="text-cyan-400" /> : <ChevronRight size={13} />}
                                                    <span>{layerName}</span>
                                                </div>
                                            </button>

                                             {isExpanded && (
                                                <div className="p-2.5 bg-slate-100/70 dark:bg-black/20 space-y-1 border-t border-border/30">
                                                    {typeof layerData === 'object' && layerData !== null ? (
                                                        Object.entries(layerData).map(([k, v]) => (
                                                            <div key={k} className="flex gap-2 text-[10px]">
                                                                <span className="text-slate-600 dark:text-text-muted shrink-0 min-w-36 font-semibold">{k}:</span>
                                                                <span className="text-cyan-700 dark:text-cyan-300 font-bold break-all">{String(v)}</span>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <div className="text-[10px] text-text-primary">{String(layerData)}</div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* PANE 3: Hex & ASCII Dump Viewer */}
                    <div className="bg-card border border-border rounded-2xl p-4 shadow-sm flex flex-col h-72 lg:h-80">
                        <div className="flex items-center justify-between pb-3 border-b border-border/60">
                            <div className="flex items-center gap-2">
                                <Binary size={15} className="text-purple-600 dark:text-purple-400" />
                                <h3 className="text-xs font-black uppercase tracking-wider text-text-primary">
                                    Hex / ASCII Raw Stream
                                </h3>
                            </div>
                            {activePacket && (
                                <button
                                    onClick={copyRawHex}
                                    className="p-1 px-2 text-[10px] font-bold text-text-muted hover:text-text-primary bg-card-secondary hover:bg-card-hover rounded-lg border border-border flex items-center gap-1 transition-all cursor-pointer"
                                    title="Copy raw hex stream"
                                >
                                    {copiedHex ? <Check size={11} className="text-emerald-500 dark:text-emerald-400" /> : <Copy size={11} />}
                                    {copiedHex ? "Copied" : "Copy Hex"}
                                </button>
                            )}
                        </div>

                        <div className="flex-1 overflow-y-auto mt-2 bg-slate-900 dark:bg-black/60 border border-slate-700/60 dark:border-border/40 rounded-xl p-3 font-mono text-[10px] leading-relaxed text-slate-300 dark:text-text-muted scrollbar-thin scrollbar-thumb-border shadow-inner">
                            {loadingPackets ? (
                                <div className="h-full flex flex-col items-center justify-center gap-2 text-text-muted text-xs">
                                    <Loader2 size={20} className="animate-spin text-purple-400" />
                                    <span>Generating hex & ASCII stream...</span>
                                </div>
                            ) : !activePacket || !activePacket.hex_dump || activePacket.hex_dump.length === 0 ? (
                                <div className="h-full flex items-center justify-center text-text-muted text-xs italic">
                                    No byte stream available
                                </div>
                            ) : (
                                activePacket.hex_dump.map((line, idx) => (
                                    <div key={idx} className="flex gap-3 hover:bg-white/10 py-0.5 px-1 rounded transition-colors">
                                        <span className="text-purple-300 dark:text-purple-400/80 shrink-0 select-none font-semibold">{line.offset}</span>
                                        <span className="text-cyan-300 dark:text-cyan-300 tracking-wider shrink-0 select-text">{line.hex}</span>
                                        <span className="text-slate-100 dark:text-text-primary/90 tracking-widest pl-2 border-l border-slate-700 dark:border-border/40 select-text">{line.ascii}</span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
            </>
            )}

            {/* Save Custom BPF Preset Modal */}
            {showSavePresetModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-card border border-border rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl p-6 space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-border/60">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-emerald-600/10 rounded-xl text-emerald-400">
                                    <BookmarkPlus size={20} />
                                </div>
                                <div>
                                    <h3 className="text-base font-black text-text-primary">Save Custom BPF Filter</h3>
                                    <p className="text-xs text-text-muted">Create a reusable kernel packet filter preset</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowSavePresetModal(false)}
                                className="p-1 text-text-muted hover:text-text-primary rounded-lg cursor-pointer"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleSaveCustomPreset} className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-[10px] font-black uppercase tracking-wider text-text-muted">Preset Name *</label>
                                <input
                                    type="text"
                                    required
                                    value={newPresetName}
                                    onChange={(e) => setNewPresetName(e.target.value)}
                                    placeholder="e.g. TCP SYN Flood & Scans"
                                    className="w-full bg-card-secondary border border-border rounded-xl px-3 py-2 text-xs text-text-primary focus:outline-none focus:border-cyan-500 font-bold"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-[10px] font-black uppercase tracking-wider text-text-muted">Kernel BPF Filter Expression *</label>
                                <textarea
                                    required
                                    rows={3}
                                    value={newPresetBpf}
                                    onChange={(e) => setNewPresetBpf(e.target.value)}
                                    placeholder="e.g. tcp[tcpflags] & (tcp-syn) != 0 and not src net 192.168.0.0/16"
                                    className="w-full bg-card-secondary border border-border rounded-xl p-3 text-xs text-cyan-300 font-mono focus:outline-none focus:border-cyan-500"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-[10px] font-black uppercase tracking-wider text-text-muted">Description (Optional)</label>
                                <input
                                    type="text"
                                    value={newPresetDesc}
                                    onChange={(e) => setNewPresetDesc(e.target.value)}
                                    placeholder="e.g. Filter inbound SYN packets outside internal subnets"
                                    className="w-full bg-card-secondary border border-border rounded-xl px-3 py-2 text-xs text-text-primary focus:outline-none focus:border-cyan-500"
                                />
                            </div>

                            <div className="pt-2 flex items-center justify-end gap-2 border-t border-border/60">
                                <button
                                    type="button"
                                    onClick={() => setShowSavePresetModal(false)}
                                    className="px-4 py-2 text-xs font-bold text-text-muted hover:text-text-primary bg-card-secondary hover:bg-card-hover rounded-xl border border-border transition-colors cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-5 py-2 text-xs font-black uppercase tracking-wider text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition-all cursor-pointer shadow-lg shadow-emerald-950/40"
                                >
                                    Save Preset
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* BPF Recipe Library & Syntax Builder Modal */}
            {showBpfLibraryModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-card border border-border rounded-3xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl p-6 space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-border/60 shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-cyan-600/10 rounded-xl text-cyan-400">
                                    <Sparkles size={20} />
                                </div>
                                <div>
                                    <h3 className="text-base font-black text-text-primary">Kernel BPF Recipe Library</h3>
                                    <p className="text-xs text-text-muted">Wireshark & tcpdump-grade complex Berkeley Packet Filter recipes</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowBpfLibraryModal(false)}
                                className="p-1 text-text-muted hover:text-text-primary rounded-lg cursor-pointer"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Search & Category Filter */}
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
                            <div className="relative w-full sm:w-72">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                                <input
                                    type="text"
                                    value={recipeSearch}
                                    onChange={(e) => setRecipeSearch(e.target.value)}
                                    placeholder="Search recipes (e.g. syn, rst, ttl, jumbo)..."
                                    className="w-full bg-card-secondary border border-border rounded-xl pl-9 pr-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-cyan-500 font-mono"
                                />
                            </div>

                            <div className="flex items-center gap-1.5 flex-wrap w-full sm:w-auto">
                                {['All', 'TCP Handshake & Flags', 'Network & Subnets', 'Payload, MTU & Anomalies', 'Services & Protocols'].map(cat => (
                                    <button
                                        key={cat}
                                        onClick={() => setSelectedRecipeCategory(cat)}
                                        className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all border cursor-pointer ${
                                            selectedRecipeCategory === cat
                                                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-sm'
                                                : 'bg-card-secondary/60 text-text-muted hover:text-text-primary border-border/60'
                                        }`}
                                    >
                                        {cat === 'All' ? 'All Recipes' : cat}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Recipe Grid */}
                        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 scrollbar-thin scrollbar-thumb-border">
                            {BPF_RECIPES
                                .filter(r => {
                                    if (selectedRecipeCategory !== 'All' && r.category !== selectedRecipeCategory) return false;
                                    if (recipeSearch.trim()) {
                                        const q = recipeSearch.toLowerCase();
                                        return r.name.toLowerCase().includes(q) || r.bpf.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
                                    }
                                    return true;
                                })
                                .map((recipe, idx) => (
                                    <div
                                        key={idx}
                                        className="p-3 bg-card-secondary/30 hover:bg-card-secondary/60 border border-border/60 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
                                    >
                                        <div className="space-y-1 flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                                                    {recipe.category}
                                                </span>
                                                <h4 className="text-xs font-bold text-text-primary truncate">{recipe.name}</h4>
                                            </div>
                                            <p className="text-[11px] text-text-muted">{recipe.description}</p>
                                            <div className="p-1.5 bg-black/40 border border-border/40 rounded-lg font-mono text-[11px] text-cyan-300 select-all overflow-x-auto">
                                                {recipe.bpf}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0 sm:self-center">
                                            <button
                                                onClick={() => {
                                                    navigator.clipboard.writeText(recipe.bpf);
                                                    toast.success('Copied BPF expression');
                                                }}
                                                className="p-2 text-text-muted hover:text-text-primary bg-card-secondary hover:bg-card-hover rounded-xl border border-border transition-colors cursor-pointer"
                                                title="Copy BPF expression"
                                            >
                                                <Copy size={13} />
                                            </button>
                                            <button
                                                onClick={() => handleApplyRecipe(recipe)}
                                                className="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-md shadow-cyan-950/40"
                                            >
                                                Apply Filter
                                            </button>
                                        </div>
                                    </div>
                                ))}
                        </div>
                    </div>
                </div>
            )}

            {/* History Modal */}
            {showHistoryModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-card border border-border rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl space-y-4 p-6">
                        <div className="flex items-center justify-between pb-3 border-b border-border/60">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-cyan-600/10 rounded-xl text-cyan-400">
                                    <HardDrive size={20} />
                                </div>
                                <div>
                                    <h3 className="text-base font-black text-text-primary">Saved PCAP Captures</h3>
                                    <p className="text-xs text-text-muted">Browse, analyze, and manage packet traces stored on disk</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowHistoryModal(false)}
                                className="p-1.5 text-text-muted hover:text-text-primary rounded-xl hover:bg-card-hover transition-colors cursor-pointer"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="max-h-80 overflow-y-auto space-y-2 font-mono text-xs">
                            {loadingHistory ? (
                                <div className="py-12 text-center text-text-muted">Loading captures...</div>
                            ) : savedCaptures.length === 0 ? (
                                <div className="py-12 text-center text-text-muted">No saved captures found on this node.</div>
                            ) : (
                                savedCaptures.map(c => (
                                    <div
                                        key={c.filename}
                                        className="p-3 bg-card-secondary/30 border border-border/60 rounded-2xl flex items-center justify-between gap-4 hover:border-cyan-500/40 transition-colors"
                                    >
                                        <div className="space-y-1">
                                            <p className="font-bold text-text-primary text-xs">{c.filename}</p>
                                            <div className="flex items-center gap-2 text-[10px] text-text-muted font-mono flex-wrap">
                                                <span className="flex items-center gap-1 bg-cyan-500/10 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-500/20 font-bold">
                                                    <Binary size={10} />
                                                    {(c.total_packets || 0).toLocaleString()} pkts
                                                </span>
                                                {c.duration_seconds !== undefined && c.duration_seconds > 0 && (
                                                    <span className="flex items-center gap-1 bg-amber-500/10 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/20 font-bold">
                                                        <Clock size={10} />
                                                        {c.duration_seconds}s
                                                    </span>
                                                )}
                                                <span>{(c.size_bytes / 1024).toFixed(1)} KB</span>
                                                <span>•</span>
                                                <span>{c.created_at}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => {
                                                    setShowHistoryModal(false);
                                                    loadDissectedPackets(c.filename);
                                                }}
                                                disabled={loadingPackets}
                                                className="px-3 py-1.5 bg-cyan-600/15 hover:bg-cyan-600/25 border border-cyan-500/30 text-cyan-300 rounded-xl text-xs font-black uppercase transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                                            >
                                                {loadingPackets && activePcapFile === c.filename ? (
                                                    <Loader2 size={12} className="animate-spin" />
                                                ) : null}
                                                Inspect
                                            </button>
                                            <button
                                                onClick={() => handleDownloadCapture(c.filename)}
                                                disabled={downloadingFile === c.filename}
                                                className="p-1.5 text-text-muted hover:text-text-primary bg-card-secondary hover:bg-card-hover rounded-xl border border-border transition-colors cursor-pointer disabled:opacity-50"
                                                title="Download .pcap"
                                            >
                                                {downloadingFile === c.filename ? (
                                                    <Loader2 size={14} className="animate-spin text-cyan-400" />
                                                ) : (
                                                    <Download size={14} />
                                                )}
                                            </button>
                                            <button
                                                onClick={() => handleDeleteCapture(c.filename)}
                                                className="p-1.5 text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 rounded-xl border border-rose-500/20 transition-colors cursor-pointer"
                                                title="Delete"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="pt-3 border-t border-border/60 flex justify-end">
                            <button
                                onClick={() => setShowHistoryModal(false)}
                                className="px-5 py-2 bg-card-secondary hover:bg-card-hover border border-border rounded-xl text-xs font-bold text-text-primary transition-all cursor-pointer"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
