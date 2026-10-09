import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
    Radio, Play, Square, Download, Loader2, RefreshCw, Search, Trash2, 
    Clock, HardDrive, Filter, Layers, Binary, CheckCircle2, 
    AlertCircle, ChevronRight, ChevronDown, Copy, Check, 
    FileText, ArrowRight, Zap, X, ShieldAlert, Cpu,
    BookmarkPlus, Sparkles, BookOpen, Plus, SlidersHorizontal, Terminal, Info
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { usePeerContext } from './PeerContext';

interface PacketCaptureProps {
    token: string;
    onNavigateToReplay?: () => void;
}

interface InterfaceItem {
    name: string;
    label: string;
    ip: string;
    mac: string;
    is_default: boolean;
    is_up: boolean;
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

export default function PacketCapture({ token, onNavigateToReplay }: PacketCaptureProps) {
    const { gFetch, activePeerId } = usePeerContext();

    const authHeaders = useMemo(() => ({
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    }), [token]);

    // System options
    const [interfaces, setInterfaces] = useState<InterfaceItem[]>([]);
    const [presets, setPresets] = useState<PresetItem[]>([]);
    const [selectedInterface, setSelectedInterface] = useState<string>('any');
    const [selectedPreset, setSelectedPreset] = useState<string>('all');
    const [bpfFilter, setBpfFilter] = useState<string>('');
    const [durationSec, setDurationSec] = useState<number>(30);
    const [maxPackets, setMaxPackets] = useState<number>(2000);

    // Active session state
    const [capturing, setCapturing] = useState<boolean>(false);
    const [activeSession, setActiveSession] = useState<any>(null);
    const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

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
        toast.success(`Custom BPF filter "${newPreset.name}" saved!`);
    };

    const handleDeleteCustomPreset = (presetId: string) => {
        const p = customBpfPresets.find(cp => cp.id === presetId);
        if (!p) return;
        setCustomBpfPresets(prev => prev.filter(cp => cp.id !== presetId));
        setSelectedPreset('all');
        setBpfFilter('');
        toast.success(`Deleted preset "${p.name}"`);
    };

    const handleApplyRecipe = (recipe: BpfRecipe) => {
        setBpfFilter(recipe.bpf);
        setSelectedPreset('custom');
        setShowBpfLibraryModal(false);
        toast.success(`Applied BPF filter: ${recipe.name}`);
    };

    // History modal
    const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
    const [savedCaptures, setSavedCaptures] = useState<SavedCapture[]>([]);
    const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
    const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

    // Copy indicator
    const [copiedHex, setCopiedHex] = useState<boolean>(false);

    const tableEndRef = useRef<HTMLDivElement>(null);

    // Initial load: interfaces and presets
    useEffect(() => {
        fetchInterfaces();
        fetchPresets();
        checkActiveStatus();
    }, []);

    const fetchInterfaces = async () => {
        try {
            const res = await gFetch('/api/capture/interfaces', { credentials: 'include', headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    setInterfaces(data);
                    const def = data.find(i => i.is_default);
                    if (def) setSelectedInterface(def.name);
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

    const checkActiveStatus = async () => {
        try {
            const res = await gFetch('/api/capture/status', { credentials: 'include', headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                if (data.active) {
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

    // Live capture polling timer
    useEffect(() => {
        let interval: ReturnType<typeof setInterval> | null = null;
        if (capturing) {
            interval = setInterval(async () => {
                try {
                    const res = await gFetch('/api/capture/status', { credentials: 'include', headers: authHeaders });
                    if (res.ok) {
                        const status = await res.json();
                        setElapsedSeconds(status.elapsed_seconds || 0);
                        setFileSizeBytes(status.file_size_bytes || 0);

                        if (!status.active) {
                            // Capture finished
                            setCapturing(false);
                            setActiveSession(null);
                            toast.success(`Packet capture completed (${status.elapsed_seconds || durationSec}s)!`);
                            if (status.pcap_filename) {
                                loadDissectedPackets(status.pcap_filename);
                            }
                        } else {
                            // Fetch incremental packets while running
                            fetchLivePackets();
                        }
                    }
                } catch (e) {
                    console.error('Status poll error', e);
                }
            }, 1800);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [capturing, activePcapFile]);

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
        setLoadingPackets(true);
        setPackets([]);
        setSelectedPacketNo(null);
        if (filename) setActivePcapFile(filename);
        const displayName = filename ? filename.split('/').pop() : 'capture';
        const toastId = toast.loading(`Dissecting ${displayName}...`);

        try {
            const fileQuery = filename ? `?file=${encodeURIComponent(filename)}&limit=250` : '?limit=250';
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
                toast.success(`Loaded ${data.packets.length} packets from ${displayName} (Total: ${data.total_packets || data.packets.length})`, { id: toastId });
            } else {
                toast.dismiss(toastId);
            }
        } catch (e: any) {
            toast.error(`Failed to load packets: ${e.message}`, { id: toastId });
        } finally {
            setLoadingPackets(false);
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
                toast.success(`Loaded +${data.packets.length} packets (${packets.length + data.packets.length}/${totalPackets})`);
            }
        } catch (e: any) {
            toast.error(`Failed to load more packets: ${e.message}`);
        } finally {
            setLoadingMore(false);
        }
    };

    const handleStartCapture = async () => {
        setPackets([]);
        setTotalPackets(0);
        setSelectedPacketNo(null);
        setElapsedSeconds(0);

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
                setCapturing(true);
                setActiveSession(data);
                setActivePcapFile(data.pcap_filename);
                toast.success(`Packet capture started on ${selectedInterface}!`);
            } else {
                toast.error(data.error || 'Failed to start capture');
            }
        } catch (e: any) {
            toast.error(`Error: ${e.message}`);
        }
    };

    const handleStopCapture = async () => {
        try {
            const res = await gFetch('/api/capture/stop', {
                method: 'POST',
                credentials: 'include',
                headers: authHeaders
            });
            if (res.ok) {
                const data = await res.json();
                setCapturing(false);
                setActiveSession(null);
                toast.success('Capture stopped');
                if (data.pcap_filename) {
                    loadDissectedPackets(data.pcap_filename);
                } else if (activePcapFile) {
                    loadDissectedPackets(activePcapFile);
                }
            }
        } catch (e: any) {
            toast.error(`Error stopping capture: ${e.message}`);
        }
    };

    const handleSendToReplay = async () => {
        if (!activePcapFile) {
            toast.error('No capture file active to send');
            return;
        }

        try {
            const res = await gFetch('/api/capture/send-to-replay', {
                method: 'POST',
                credentials: 'include',
                headers: authHeaders,
                body: JSON.stringify({ filename: activePcapFile })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                toast.success(data.message || 'PCAP trace transferred to Replay Engine!');
                if (onNavigateToReplay) {
                    setTimeout(() => onNavigateToReplay(), 1200);
                }
            } else {
                toast.error(data.error || 'Failed to transfer PCAP to replay catalog');
            }
        } catch (e: any) {
            toast.error(`Transfer error: ${e.message}`);
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
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            toast.success(`Downloaded ${filename}`);
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
            return false;
        });
    }, [packets, displayFilter]);

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
        toast.success('Hex dump copied to clipboard');
    };

    const getProtoColorClass = (proto: string, info: string) => {
        if (info.includes('RST')) return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
        switch (proto.toUpperCase()) {
            case 'TCP': return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30';
            case 'UDP': return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
            case 'ICMP': return 'bg-purple-500/10 text-purple-400 border-purple-500/30';
            case 'DNS': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
            case 'TLS': return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
            case 'HTTP': return 'bg-teal-500/10 text-teal-400 border-teal-500/30';
            case 'RTP': return 'bg-orange-500/10 text-orange-400 border-orange-500/30';
            case 'ARP': return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
            default: return 'bg-card-secondary text-text-muted border-border';
        }
    };

    return (
        <div className="space-y-4 animate-in fade-in duration-300 w-full">
            {/* Top Header Card */}
            <div className="bg-card border border-border p-5 rounded-2xl shadow-sm">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-cyan-600/10 rounded-xl text-cyan-400 border border-cyan-500/20">
                            <Radio size={24} className={capturing ? "animate-pulse text-rose-400" : ""} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2.5">
                                <h2 className="text-xl font-black text-text-primary tracking-tight">Live Packet Capture & Web Analyzer</h2>
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                                    BPF Kernel Sniffer
                                </span>
                                {capturing ? (
                                    <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500/15 text-rose-400 border border-rose-500/30 animate-pulse">
                                        <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                                        RECORDING ({elapsedSeconds}s / {durationSec}s)
                                    </span>
                                ) : loadingPackets ? (
                                    <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 animate-pulse">
                                        <Loader2 size={11} className="animate-spin" />
                                        DISSECTING {activePcapFile ? activePcapFile.split('/').pop() : 'PCAP'}...
                                    </span>
                                ) : activePcapFile ? (
                                    <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-card-secondary text-text-muted border border-border flex items-center gap-2">
                                        <span className="text-text-primary font-bold">{activePcapFile.split('/').pop()}</span>
                                        <span className="text-cyan-400 font-bold flex items-center gap-0.5">
                                            <Binary size={11} />
                                            {totalPackets.toLocaleString()} pkts
                                        </span>
                                        {durationSeconds > 0 && (
                                            <span className="text-amber-400 font-bold flex items-center gap-0.5">
                                                <Clock size={11} />
                                                {durationSeconds}s
                                            </span>
                                        )}
                                        <span className="text-text-muted">
                                            {fileSizeBytes ? `(${(fileSizeBytes / 1024).toFixed(1)} KB)` : ''}
                                        </span>
                                    </span>
                                ) : null}
                            </div>
                            <p className="text-xs text-text-muted mt-0.5">
                                Wireshark-grade 3-pane packet inspection, BPF kernel filtering, and 1-click injection into the PCAP Replay engine
                            </p>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
                        {capturing ? (
                            <button
                                onClick={handleStopCapture}
                                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg shadow-rose-900/40 cursor-pointer"
                            >
                                <Square size={14} fill="currentColor" />
                                Stop Capture
                            </button>
                        ) : (
                            <button
                                onClick={handleStartCapture}
                                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg shadow-emerald-900/40 cursor-pointer"
                            >
                                <Play size={14} fill="currentColor" />
                                Start Capture
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
                                    className="px-3.5 py-2.5 bg-card-secondary hover:bg-card-hover border border-border rounded-xl text-xs font-black uppercase tracking-wider text-text-muted hover:text-text-primary transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                                    title="Download raw .pcap for local Wireshark"
                                >
                                    {downloadingFile === activePcapFile ? (
                                        <Loader2 size={13} className="animate-spin text-cyan-400" />
                                    ) : (
                                        <Download size={13} />
                                    )}
                                    Download .pcap
                                </button>

                                <button
                                    onClick={handleSendToReplay}
                                    className="px-3.5 py-2.5 bg-purple-600/15 hover:bg-purple-600/25 border border-purple-500/30 text-purple-300 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer"
                                    title="Send trace to PCAP Replay engine"
                                >
                                    <Zap size={13} />
                                    Send to Replay
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Configuration Controls Bar - Ultra Compact 1-Row Grid */}
                <div className="mt-4 pt-3.5 border-t border-border/60 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">
                    {/* Interface */}
                    <div className="lg:col-span-2 space-y-1">
                        <label className="text-[10px] font-black uppercase tracking-wider text-text-muted">Interface</label>
                        <select
                            value={selectedInterface}
                            onChange={(e) => setSelectedInterface(e.target.value)}
                            disabled={capturing}
                            className="w-full bg-card-secondary border border-border rounded-xl px-3 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:border-cyan-500 h-9"
                        >
                            {interfaces.map(i => (
                                <option key={i.name} value={i.name}>{i.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Presets Dropdown */}
                    <div className="lg:col-span-3 space-y-1">
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
                        <select
                            value={selectedPreset}
                            onChange={(e) => handlePresetSelect(e.target.value)}
                            disabled={capturing}
                            className="w-full bg-card-secondary border border-border rounded-xl px-3 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:border-cyan-500 truncate h-9"
                        >
                            <optgroup label="⚡ Built-in Presets">
                                {presets.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </optgroup>
                            {customBpfPresets.length > 0 && (
                                <optgroup label="⭐ Custom BPF Filters">
                                    {customBpfPresets.map(cp => (
                                        <option key={cp.id} value={cp.id}>{cp.name}</option>
                                    ))}
                                </optgroup>
                            )}
                            <option value="custom">✍️ Custom BPF Expression</option>
                        </select>
                    </div>

                    {/* Kernel BPF Filter */}
                    <div className="lg:col-span-4 space-y-1">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] font-black uppercase tracking-wider text-text-muted">Kernel BPF Filter</label>
                            <div className="flex items-center gap-2 text-[10px]">
                                <button
                                    type="button"
                                    onClick={() => setShowBpfLibraryModal(true)}
                                    className="text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1 cursor-pointer transition-colors"
                                    title="Browse complex BPF recipes and recipes"
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
                                className="w-full bg-card-secondary border border-border rounded-xl px-3 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:border-cyan-500 pr-7 h-9"
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
                    <div className="lg:col-span-1.5 space-y-1">
                        <label className="text-[10px] font-black uppercase tracking-wider text-text-muted">Duration</label>
                        <select
                            value={durationSec}
                            onChange={(e) => setDurationSec(parseInt(e.target.value, 10))}
                            disabled={capturing}
                            className="w-full bg-card-secondary border border-border rounded-xl px-3 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:border-cyan-500 h-9"
                        >
                            <option value={10}>10s</option>
                            <option value={30}>30s (Default)</option>
                            <option value={60}>60s</option>
                            <option value={120}>120s</option>
                            <option value={300}>300s (Max)</option>
                        </select>
                    </div>

                    {/* Packet Limit */}
                    <div className="lg:col-span-1.5 space-y-1">
                        <label className="text-[10px] font-black uppercase tracking-wider text-text-muted">Packet Limit</label>
                        <select
                            value={maxPackets}
                            onChange={(e) => setMaxPackets(parseInt(e.target.value, 10))}
                            disabled={capturing}
                            className="w-full bg-card-secondary border border-border rounded-xl px-3 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:border-cyan-500 h-9"
                        >
                            <option value={500}>500 pkts</option>
                            <option value={2000}>2,000 pkts</option>
                            <option value={5000}>5,000 pkts</option>
                            <option value={10000}>10,000 pkts</option>
                            <option value={100000}>No limit (Time only)</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Display Search & Filter Bar */}
            <div className="bg-card border border-border px-4 py-2.5 rounded-2xl flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 flex-1">
                    <Filter size={14} className="text-text-muted shrink-0" />
                    <input
                        type="text"
                        value={displayFilter}
                        onChange={(e) => setDisplayFilter(e.target.value)}
                        placeholder="Apply display filter... (e.g. 'tcp', 'udp', 'rst', 'dns', '192.168.122.51', ':8080')"
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
                    <div className="h-64 sm:h-72 lg:h-80 overflow-y-auto font-mono text-xs scrollbar-thin scrollbar-thumb-border">
                        <table className="w-full text-left border-collapse">
                            <thead className="sticky top-0 bg-card-secondary/95 backdrop-blur border-b border-border text-[9px] uppercase tracking-wider text-text-muted z-10">
                                <tr>
                                    <th className="py-2 px-3 w-14">No.</th>
                                    <th className="py-2 px-3 w-24">Time (s)</th>
                                    <th className="py-2 px-3 w-40">Source</th>
                                    <th className="py-2 px-3 w-40">Destination</th>
                                    <th className="py-2 px-3 w-20">Protocol</th>
                                    <th className="py-2 px-3 w-16">Length</th>
                                    <th className="py-2 px-3">Info</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/20">
                                {loadingPackets ? (
                                    <tr>
                                        <td colSpan={7} className="py-20 text-center text-text-muted">
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
                                        <td colSpan={7} className="py-16 text-center text-text-muted">
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
                                        return (
                                            <tr
                                                key={pkt.no}
                                                onClick={() => setSelectedPacketNo(pkt.no)}
                                                className={`cursor-pointer transition-colors text-[11px] select-none ${
                                                    isSelected 
                                                        ? 'bg-blue-600/20 text-text-primary font-bold border-l-2 border-l-blue-500' 
                                                        : 'hover:bg-card-hover/60 text-text-secondary'
                                                }`}
                                            >
                                                <td className="py-1.5 px-3 text-text-muted">{pkt.no}</td>
                                                <td className="py-1.5 px-3 text-text-muted">{pkt.time.toFixed(6)}</td>
                                                <td className="py-1.5 px-3 text-text-primary truncate" title={pkt.source}>
                                                    {pkt.source}{pkt.sport ? `:${pkt.sport}` : ''}
                                                </td>
                                                <td className="py-1.5 px-3 text-text-primary truncate" title={pkt.destination}>
                                                    {pkt.destination}{pkt.dport ? `:${pkt.dport}` : ''}
                                                </td>
                                                <td className="py-1.5 px-3">
                                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border ${getProtoColorClass(pkt.protocol, pkt.info)}`}>
                                                        {pkt.protocol}
                                                    </span>
                                                </td>
                                                <td className="py-1.5 px-3 text-text-muted">{pkt.length}</td>
                                                <td className="py-1.5 px-3 truncate max-w-md font-mono text-[11px]" title={pkt.info}>
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
                                <span className={`text-[9px] font-black px-2 py-0.5 rounded border ${getProtoColorClass(activePacket.protocol, activePacket.info)}`}>
                                    {activePacket.protocol} • {activePacket.length} bytes
                                </span>
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
                                                <div className="p-2.5 bg-black/20 space-y-1 border-t border-border/30">
                                                    {typeof layerData === 'object' && layerData !== null ? (
                                                        Object.entries(layerData).map(([k, v]) => (
                                                            <div key={k} className="flex gap-2 text-[10px]">
                                                                <span className="text-text-muted shrink-0 min-w-36">{k}:</span>
                                                                <span className="text-cyan-300 font-bold break-all">{String(v)}</span>
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
                                <Binary size={15} className="text-purple-400" />
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
                                    {copiedHex ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                                    {copiedHex ? "Copied" : "Copy Hex"}
                                </button>
                            )}
                        </div>

                        <div className="flex-1 overflow-y-auto mt-2 bg-black/60 border border-border/40 rounded-xl p-3 font-mono text-[10px] leading-relaxed text-text-muted scrollbar-thin scrollbar-thumb-border">
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
                                    <div key={idx} className="flex gap-3 hover:bg-white/5 py-0.5 px-1 rounded transition-colors">
                                        <span className="text-purple-400/80 shrink-0 select-none">{line.offset}</span>
                                        <span className="text-cyan-300 tracking-wider shrink-0 select-text">{line.hex}</span>
                                        <span className="text-text-primary/90 tracking-widest pl-2 border-l border-border/40 select-text">{line.ascii}</span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>

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
