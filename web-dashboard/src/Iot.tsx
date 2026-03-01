import React, { useState, useEffect } from 'react';
import {
    Cpu, Plus, Play, Square, Trash2, RefreshCcw,
    Wifi, Activity, Shield, Camera, Lightbulb,
    Thermometer, Speaker, HardDrive, Info,
    Search, CheckSquare, Square as SquareIcon,
    ArrowUpRight, Clock, AlertCircle, ChevronRight,
    LayoutGrid, List, Terminal, X, ExternalLink,
    Power, Edit2
} from 'lucide-react';
import LogViewer from './components/LogViewer';
import { isValidMacAddress } from './utils/validation';

interface IoTDevice {
    id: string;
    name: string;
    vendor: string;
    type: string;
    mac: string;
    ip_start?: string;
    protocols: string[];
    enabled: boolean;
    traffic_interval: number;
    description?: string;
    security?: {
        bad_behavior: boolean;
        behavior_type: string[];
    };
    running?: boolean;
    status?: {
        running: boolean;
        stats: any;
        logs: any[];
    };
}

interface IotProps {
    token: string;
}

export default function Iot({ token }: IotProps) {
    const [devices, setDevices] = useState<IoTDevice[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingDevice, setEditingDevice] = useState<Partial<IoTDevice> | null>(null);
    const [isCompact, setIsCompact] = useState(() => localStorage.getItem('iot-compact') === 'true');
    const [activeLogDevice, setActiveLogDevice] = useState<IoTDevice | null>(null);

    const authHeaders = () => ({
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    });

    const fetchDevices = async () => {
        try {
            const res = await fetch('/api/iot/devices', { headers: authHeaders() });
            const data = await res.json();
            console.log("IoT Devices API Response:", data);

            // Defensive: Handle if data is not an array (e.g. { error: "..." })
            if (Array.isArray(data)) {
                setDevices(data);
            } else if (data && typeof data === 'object' && Array.isArray((data as any).devices)) {
                // Fallback for unexpected wrap
                setDevices((data as any).devices);
            } else {
                console.warn("Expected array of devices, got:", data);
                setDevices([]);
            }
        } catch (e) {
            console.error("Failed to fetch IoT devices", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDevices();
        const interval = setInterval(fetchDevices, 5000); // Poll every 5s for stats
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        localStorage.setItem('iot-compact', String(isCompact));
    }, [isCompact]);

    const toggleDevice = async (id: string, currentlyRunning?: boolean) => {
        try {
            const endpoint = currentlyRunning ? `/api/iot/stop/${id}` : `/api/iot/start/${id}`;
            await fetch(endpoint, { method: 'POST', headers: authHeaders() });
            fetchDevices();
        } catch (e) {
            console.error("Failed to toggle device", e);
        }
    };

    const handleBulkStart = async () => {
        if (selectedIds.length === 0) return;
        try {
            await fetch('/api/iot/start-batch', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ ids: selectedIds })
            });
            setSelectedIds([]);
            fetchDevices();
        } catch (e) {
            console.error("Failed bulk start", e);
        }
    };

    const handleBulkStop = async () => {
        if (selectedIds.length === 0) return;
        try {
            await fetch('/api/iot/stop-batch', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ ids: selectedIds })
            });
            setSelectedIds([]);
            fetchDevices();
        } catch (e) {
            console.error("Failed bulk stop", e);
        }
    };

    const handleSelectAll = () => {
        if (selectedIds.length === filteredDevices.length) {
            setSelectedIds([]);
        } else {
            setSelectedIds(filteredDevices.map(d => d.id));
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this device configuration?")) return;
        try {
            await fetch(`/api/iot/devices/${id}`, { method: 'DELETE', headers: authHeaders() });
            fetchDevices();
        } catch (e) {
            console.error("Failed to delete device", e);
        }
    };

    const handleSaveDevice = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingDevice || !editingDevice.id) return;

        try {
            const res = await fetch('/api/iot/devices', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify(editingDevice)
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || `Server responded with ${res.status}`);
            }

            setShowAddModal(false);
            setEditingDevice(null);
            fetchDevices();
        } catch (e: any) {
            console.error("Failed to save device", e);
            alert("Failed to save device: " + e.message);
        }
    };

    const handleExportJson = async () => {
        try {
            const res = await fetch('/api/iot/config/export', { headers: authHeaders() });
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'iot-devices.json';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (e) {
            console.error("Failed to export JSON", e);
        }
    };

    const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const content = event.target?.result as string;
                const res = await fetch('/api/iot/config/import', {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({ content })
                });
                const data = await res.json();
                if (data.success) {
                    alert("IoT configuration imported successfully!");
                    fetchDevices();
                } else {
                    alert("Import failed: " + data.error);
                }
            } catch (err) {
                console.error("Failed to import JSON", err);
                alert("Import failed. Check file format.");
            }
        };
        reader.readAsText(file);
    };

    const filteredDevices = Array.isArray(devices) ? devices.filter(d => {
        const query = (searchQuery || '').toLowerCase();
        const name = (d.name || '').toLowerCase();
        const vendor = (d.vendor || '').toLowerCase();
        const id = (d.id || '').toLowerCase();
        return name.includes(query) || vendor.includes(query) || id.includes(query);
    }) : [];

    const getDeviceIcon = (type: string, size: number = 20) => {
        const t = (type || '').toLowerCase();
        if (t.includes('camera')) return <Camera size={size} />;
        if (t.includes('bulb') || t.includes('light')) return <Lightbulb size={size} />;
        if (t.includes('sensor') || t.includes('thermostat')) return <Thermometer size={size} />;
        if (t.includes('speaker') || t.includes('alexa') || t.includes('home')) return <Speaker size={size} />;
        return <Cpu size={size} />;
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-12">
            {/* Header section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="bg-blue-600/20 p-3 rounded-2xl">
                        <Cpu className="text-blue-400" size={32} />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-text-primary flex items-center gap-2">
                            IoT Device Simulation
                        </h2>
                        <div className="flex items-center gap-3">
                            <p className="text-text-muted text-sm">Scale your branch with realistic IoT traffic patterns per vendor.</p>
                            <span className="text-text-muted/30">|</span>
                            <button
                                onClick={() => {
                                    const sample = {
                                        "network": { "interface": "eth0", "gateway": "192.168.207.1" },
                                        "devices": [
                                            {
                                                "id": "camera_01",
                                                "name": "Sample Hikvision Camera",
                                                "vendor": "Hikvision",
                                                "type": "IP Camera",
                                                "mac": "00:12:34:56:78:01",
                                                "ip_start": "192.168.207.100",
                                                "protocols": ["dhcp", "arp", "http", "rtsp", "cloud"],
                                                "enabled": true,
                                                "traffic_interval": 60,
                                                "dhcp_fingerprint": {
                                                    "hostname": "hikvision-cam-01",
                                                    "vendor_class_id": "dhcpcd-5.5.6",
                                                    "parameter_request_list": "1,3,6,15,28,33,42"
                                                }
                                            }
                                        ]
                                    };
                                    const blob = new Blob([JSON.stringify(sample, null, 2)], { type: 'application/json' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = 'iot-sample.json';
                                    a.click();
                                    URL.revokeObjectURL(url);
                                }}
                                className="text-blue-400 hover:text-blue-300 text-xs font-bold transition-colors flex items-center gap-1"
                            >
                                <ExternalLink size={12} /> Download Sample
                            </button>
                            <span className="text-text-muted/30">|</span>
                            <a
                                href="https://github.com/jsuzanne/stigix/blob/main/docs/IOT_DEVICE_GENERATOR.md"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 text-xs font-bold transition-colors flex items-center gap-1"
                                title="Python Script Generator"
                            >
                                <ExternalLink size={12} /> Python Generator
                            </a>
                            <span className="text-text-muted/30">|</span>
                            <a
                                href="https://github.com/jsuzanne/stigix/blob/main/docs/IOT_LLM_GENERATION.md"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 text-xs font-bold transition-colors flex items-center gap-1"
                                title="LLM-based Generation"
                            >
                                <ExternalLink size={12} /> Llm Guide
                            </a>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {selectedIds.length > 0 && (
                        <div className="flex items-center gap-2 bg-card-secondary/80 px-3 py-1.5 rounded-xl border border-border animate-in slide-in-from-right duration-300">
                            <span className="text-xs font-bold text-blue-500">{selectedIds.length} selected</span>
                            <div className="w-px h-4 bg-border mx-1" />
                            <button
                                onClick={handleBulkStart}
                                className="flex items-center gap-1.5 text-xs font-bold text-green-400 hover:text-green-300 transition-colors"
                            >
                                <Play size={14} /> Start
                            </button>
                            <button
                                onClick={handleBulkStop}
                                className="flex items-center gap-1.5 text-xs font-bold text-red-400 hover:text-red-300 transition-colors"
                            >
                                <Square size={14} /> Stop
                            </button>
                        </div>
                    )}

                    <button
                        onClick={handleExportJson}
                        className="flex items-center gap-2 bg-card-secondary hover:bg-card-hover text-text-secondary px-4 py-2.5 rounded-xl text-sm font-bold transition-all border border-border"
                        title="Export JSON Configuration"
                    >
                        <ArrowUpRight size={18} /> Export Json
                    </button>

                    <label className="flex items-center gap-2 bg-card-secondary hover:bg-card-hover text-text-secondary px-4 py-2.5 rounded-xl text-sm font-bold transition-all border border-border cursor-pointer" title="Import JSON Configuration">
                        <Plus size={18} /> Import Json
                        <input type="file" accept=".json" className="hidden" onChange={handleImportJson} />
                    </label>

                    <button
                        onClick={() => { setEditingDevice({ enabled: true, protocols: ['dhcp', 'arp', 'http'], traffic_interval: 60 }); setShowAddModal(true); }}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-blue-900/20"
                    >
                        <Plus size={18} /> Add Device
                    </button>
                </div>
            </div>

            {/* Info Box */}
            <div className="bg-blue-600/5 border border-blue-500/20 p-4 rounded-2xl flex items-start gap-3">
                <Info size={20} className="text-blue-500 dark:text-blue-400 mt-0.5" />
                <div className="space-y-1">
                    <h4 className="text-sm font-bold text-blue-600 dark:text-blue-400 tracking-wider">Scale & Monitoring</h4>
                    <p className="text-xs text-text-muted leading-relaxed max-w-4xl">
                        Toggle **Compact View** to manage large environments. Click the terminal icon on any running device to view **Live Protocol Logs** (DHCP, LLDP, SNMP).
                    </p>
                </div>
            </div>

            {/* Filters Bar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card-secondary p-4 rounded-2xl border border-border shadow-sm">
                <div className="flex flex-col md:flex-row items-center gap-3 w-full md:w-auto">
                    <div className="relative w-full md:w-80">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
                        <input
                            type="text"
                            placeholder="Filter devices (Name, Vendor, ID)..."
                            className="bg-card border-border text-foreground pl-10 pr-4 py-2 rounded-xl text-sm w-full focus:ring-1 focus:ring-blue-500 transition-all border outline-none"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center gap-2 w-full md:w-auto">
                        <button
                            onClick={handleSelectAll}
                            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-card-secondary hover:bg-card-hover text-text-secondary hover:text-text-primary rounded-xl text-xs font-bold transition-all border border-border"
                        >
                            {selectedIds.length === filteredDevices.length && filteredDevices.length > 0 ? <CheckSquare size={16} className="text-blue-500" /> : <SquareIcon size={16} />}
                            Select All
                        </button>

                        <div className="flex bg-card-secondary rounded-xl p-1 border border-border">
                            <button
                                onClick={() => setIsCompact(false)}
                                className={cn("p-1.5 rounded-lg transition-all", !isCompact ? "bg-blue-600 text-white shadow-lg" : "text-text-muted hover:text-text-secondary")}
                            >
                                <LayoutGrid size={16} />
                            </button>
                            <button
                                onClick={() => setIsCompact(true)}
                                className={cn("p-1.5 rounded-lg transition-all", isCompact ? "bg-blue-600 text-white shadow-lg" : "text-text-muted hover:text-text-secondary")}
                            >
                                <List size={16} />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-[11px] font-bold text-text-muted tracking-widest">{devices.filter(d => d.running).length} Running</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-border" />
                        <span className="text-[11px] font-bold text-text-muted tracking-widest">{devices.filter(d => !d.running).length} Stopped</span>
                    </div>
                </div>
            </div>

            {/* Devices Grid */}
            {loading && devices.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-text-muted space-y-4">
                    <RefreshCcw className="animate-spin" size={32} />
                    <p className="text-sm font-medium">Provisioning simulation environment...</p>
                </div>
            ) : (
                <div className={cn(
                    "grid gap-6",
                    isCompact ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
                )}>
                    {filteredDevices.map(device => (
                        <div
                            key={device.id}
                            className={cn(
                                "relative bg-card border transition-all duration-300 overflow-hidden group shadow-sm hover:shadow-md",
                                isCompact ? "rounded-2xl" : "rounded-3xl",
                                device.running ? "border-blue-500/30 shadow-blue-500/5 ring-1 ring-blue-500/10" : "border-border",
                                selectedIds.includes(device.id) ? "ring-2 ring-blue-600" : ""
                            )}
                        >
                            {/* Selection Checkbox (overlay) */}
                            <button
                                onClick={() => setSelectedIds(prev => prev.includes(device.id) ? prev.filter(i => i !== device.id) : [...prev, device.id])}
                                className={cn(
                                    "absolute z-10 p-1 rounded-lg bg-background/60 backdrop-blur-sm border border-border text-text-primary transition-opacity",
                                    isCompact ? "right-2 top-1/2 -translate-y-1/2 opacity-100" : "top-4 left-4 opacity-0 group-hover:opacity-100"
                                )}
                            >
                                {selectedIds.includes(device.id) ? <CheckSquare size={16} className="text-blue-500" /> : <SquareIcon size={16} />}
                            </button>

                            <div className={cn("p-6", isCompact ? "flex items-center justify-between gap-6" : "")}>
                                <div className={cn("flex items-start gap-4", isCompact ? "w-1/4" : "mb-4")}>
                                    <div className={cn(
                                        "rounded-2xl transition-all duration-300 shrink-0 flex items-center justify-center",
                                        device.running ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" : "bg-card-secondary text-text-muted border border-border",
                                        isCompact ? "w-10 h-10" : "w-14 h-14"
                                    )}>
                                        {getDeviceIcon(device.type, isCompact ? 16 : 24)}
                                    </div>
                                    <div className="truncate">
                                        <h3 className={cn("font-bold text-text-primary transition-colors tracking-tight truncate", isCompact ? "text-sm" : "text-base group-hover:text-blue-500")}>{device.name}</h3>
                                        <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest truncate">{device.vendor} • {device.type}</p>
                                    </div>
                                </div>

                                {/* Stats & IP - Compact Alignment */}
                                <div className={cn("flex items-center gap-8", isCompact ? "flex-1" : "mb-6")}>
                                    <div className={cn(
                                        "grid gap-4 bg-card-secondary p-3 rounded-2xl border border-border shadow-sm",
                                        isCompact ? "grid-cols-3 flex-1" : "grid-cols-2 w-full"
                                    )}>
                                        <div className="space-y-0.5">
                                            <div className="text-[9px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                                                <Activity size={9} /> Packets
                                            </div>
                                            <div className={cn("font-mono font-bold text-foreground", isCompact ? "text-sm" : "text-lg")}>
                                                {device.status?.stats?.packets_sent?.toLocaleString() || '0'}
                                            </div>
                                        </div>
                                        <div className="space-y-0.5">
                                            <div className="text-[9px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                                                <Wifi size={9} /> IP
                                            </div>
                                            <div className={cn("font-mono font-black", isCompact ? "text-xs" : "text-sm", device.status?.stats?.current_ip ? "text-blue-400" : "text-text-muted")}>
                                                {device.status?.stats?.current_ip || '---.---.---.---'}
                                            </div>
                                        </div>
                                        {isCompact && (
                                            <div className="space-y-0.5">
                                                <div className="text-[9px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                                                    <Clock size={9} /> Uptime
                                                </div>
                                                <div className="text-xs font-mono font-bold text-text-secondary">
                                                    {device.status?.stats?.uptime_seconds ? `${Math.floor(device.status.stats.uptime_seconds / 60)}m` : '-'}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {!isCompact && (
                                        <div className="hidden lg:block shrink-0">
                                            <div className={cn(
                                                "px-2.5 py-1 rounded-full text-[10px] font-black tracking-widest border",
                                                device.running ? "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20" : "bg-card-secondary text-text-muted border-border"
                                            )}>
                                                {device.running ? 'Running' : 'Stopped'}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Meta Info (Hidden in compact) */}
                                {!isCompact && (
                                    <div className="space-y-3 mb-6 px-1">
                                        <div className="flex items-center justify-between text-[11px]">
                                            <span className="text-text-muted flex items-center gap-1.5">
                                                <Shield size={12} /> MAC Address
                                            </span>
                                            <span className="text-text-primary font-mono font-bold">{device.mac}</span>
                                        </div>
                                        <div className="flex items-center justify-between text-[11px]">
                                            <span className="text-text-muted flex items-center gap-1.5">
                                                <Clock size={12} /> Interval
                                            </span>
                                            <span className="text-text-primary font-bold">{device.traffic_interval}s</span>
                                        </div>
                                    </div>
                                )}

                                {!isCompact && device.security?.bad_behavior && (
                                    <div className="flex items-center gap-1.5 flex-wrap mb-2">
                                        {(device.security.behavior_type || []).map(bt => (
                                            <span key={bt} className="bg-red-500/10 text-red-400 text-[8px] font-black px-1.5 py-0.5 rounded border border-red-500/20 uppercase tracking-tight">
                                                {bt.replace(/_/g, ' ')}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {/* Protocols Icons (Dense in compact) */}
                                <div className={cn("flex flex-wrap gap-1.5", isCompact ? "w-1/5" : "mb-6")}>
                                    {device.protocols.slice(0, isCompact ? 4 : 10).map(p => (
                                        <span key={p} className="bg-card-secondary text-[8px] font-black px-1.5 py-0.5 rounded border border-border text-text-muted uppercase tracking-tight">
                                            {p}
                                        </span>
                                    ))}
                                    {isCompact && device.protocols.length > 4 && (
                                        <span className="text-[8px] font-bold text-text-muted">+{device.protocols.length - 4}</span>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className={cn("flex items-center", isCompact ? "gap-3 w-auto justify-end mr-12" : "gap-2")}>
                                    <button
                                        onClick={() => toggleDevice(device.id, device.running)}
                                        className={cn(
                                            "flex items-center justify-center transition-all border",
                                            isCompact ? "p-2 rounded-xl" : "flex-1 py-3 rounded-2xl text-xs font-black",
                                            device.running
                                                ? "bg-red-500/10 hover:bg-red-500/20 text-red-500 border-red-500/20"
                                                : "bg-blue-600 hover:bg-blue-500 text-white border-transparent shadow-lg shadow-blue-900/40"
                                        )}
                                        title={device.running ? "Shut Down" : "Initialize"}
                                    >
                                        <Power size={16} />
                                        {!isCompact && <span className="ml-2 tracking-widest">{device.running ? 'Shut' : 'Start'}</span>}
                                    </button>

                                    {!isCompact && (
                                        <button
                                            onClick={() => { setEditingDevice(device); setShowAddModal(true); }}
                                            className="p-3 bg-card-secondary hover:bg-card-hover text-text-muted hover:text-text-primary rounded-2xl transition-all border border-border"
                                            title="Edit Device"
                                        >
                                            <Edit2 size={18} />
                                        </button>
                                    )}

                                    <button
                                        onClick={() => setActiveLogDevice(device)}
                                        disabled={!device.running}
                                        className={cn(
                                            "flex items-center justify-center p-2 rounded-xl transition-all border disabled:opacity-30",
                                            device.running ? "bg-card-secondary hover:bg-card-hover text-blue-500 border-border shadow-sm" : "bg-card-secondary/50 text-text-muted border-transparent"
                                        )}
                                        title="View Live Logs"
                                    >
                                        <Terminal size={18} />
                                    </button>

                                    {!isCompact && (
                                        <button
                                            onClick={() => handleDelete(device.id)}
                                            disabled={device.running}
                                            className="p-3 bg-card-secondary hover:bg-red-500/20 text-text-muted hover:text-red-500 rounded-2xl transition-all border border-border disabled:opacity-30"
                                            title="Remove Device"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Running indicator bar */}
                            {device.running && (
                                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500/50 animate-pulse" />
                            )}
                        </div>
                    ))}

                    {filteredDevices.length === 0 && (
                        <div className="col-span-full py-20 flex flex-col items-center justify-center bg-card-secondary border border-dashed border-border rounded-3xl">
                            <Cpu size={48} className="text-text-muted mb-4 opacity-20" />
                            <p className="text-text-secondary font-medium">No IoT devices found.</p>
                            <p className="text-text-muted text-sm mt-1">Try adjusting your filters or add a new device.</p>
                        </div>
                    )}
                </div>
            )}

            {/* Add/Edit Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-300">
                    <div className="bg-card border border-border rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl">
                        <div className="p-6 border-b border-border flex items-center justify-between bg-card-secondary">
                            <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
                                <Plus size={24} className="text-blue-400" />
                                {editingDevice?.id ? 'Edit Device' : 'Add IoT Device'}
                            </h3>
                            <button onClick={() => setShowAddModal(false)} className="text-text-muted hover:text-foreground transition-colors">
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleSaveDevice} className="p-8 space-y-6">
                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-text-muted uppercase tracking-wider">Device ID</label>
                                    <input
                                        type="text"
                                        required
                                        disabled={!!editingDevice?.id}
                                        placeholder="e.g. cam_01"
                                        className="w-full bg-card-secondary border border-border rounded-xl px-4 py-3 text-sm text-foreground focus:ring-1 focus:ring-blue-500 outline-none disabled:opacity-50"
                                        value={editingDevice?.id || ''}
                                        onChange={e => setEditingDevice(prev => ({ ...prev!, id: e.target.value }))}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-text-muted uppercase tracking-wider">Device Name</label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="e.g. Office Camera"
                                        className="w-full bg-card-secondary border border-border rounded-xl px-4 py-3 text-sm text-foreground focus:ring-1 focus:ring-blue-500 outline-none"
                                        value={editingDevice?.name || ''}
                                        onChange={e => setEditingDevice(prev => ({ ...prev!, name: e.target.value }))}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-text-muted uppercase tracking-wider">Vendor</label>
                                    <select
                                        className="w-full bg-card-secondary border border-border rounded-xl px-4 py-3 text-sm text-foreground focus:ring-1 focus:ring-blue-500 outline-none appearance-none"
                                        value={editingDevice?.vendor || ''}
                                        onChange={e => setEditingDevice(prev => ({ ...prev!, vendor: e.target.value }))}
                                    >
                                        <option value="Generic">Generic</option>
                                        <option value="Hikvision">Hikvision</option>
                                        <option value="Dahua">Dahua</option>
                                        <option value="Philips">Philips</option>
                                        <option value="Xiaomi">Xiaomi</option>
                                        <option value="Amazon">Amazon</option>
                                        <option value="Google">Google</option>
                                        <option value="TP-Link">TP-Link</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
                                        <span className="text-text-muted">MAC Address</span>
                                        {editingDevice?.mac && !isValidMacAddress(editingDevice.mac) && (
                                            <span className="text-[9px] text-red-500 font-black px-1.5 py-0.5 rounded border border-red-500/20 bg-red-500/10 tracking-widest">
                                                Invalid MAC Form
                                            </span>
                                        )}
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="00:11:22:33:44:55"
                                        className={cn(
                                            "w-full bg-card-secondary border rounded-xl px-4 py-3 text-sm font-mono focus:ring-1 outline-none transition-all",
                                            editingDevice?.mac && !isValidMacAddress(editingDevice.mac)
                                                ? "border-red-500/50 focus:border-red-500 text-red-400 focus:ring-red-500/50"
                                                : "border-border text-foreground focus:ring-blue-500"
                                        )}
                                        value={editingDevice?.mac || ''}
                                        onChange={e => setEditingDevice(prev => ({ ...prev!, mac: e.target.value }))}
                                    />
                                </div>
                            </div>

                            {/* Security Testing Section */}
                            <div className="space-y-4 pt-4 border-t border-border">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-bold text-text-muted uppercase tracking-wider flex items-center gap-2">
                                        <Shield size={14} className="text-orange-500" /> Security Testing
                                    </label>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={editingDevice?.security?.bad_behavior || false}
                                            onChange={e => {
                                                const checked = e.target.checked;
                                                setEditingDevice(prev => ({
                                                    ...prev!,
                                                    security: {
                                                        bad_behavior: checked,
                                                        behavior_type: prev?.security?.behavior_type || ['random']
                                                    }
                                                }));
                                            }}
                                        />
                                        <div className="w-11 h-6 bg-card-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
                                        <span className="ml-3 text-xs font-bold text-text-secondary uppercase">Enable Bad Behavior</span>
                                    </label>
                                </div>

                                {editingDevice?.security?.bad_behavior && (
                                    <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                                        <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Attack Types</label>
                                        <div className="flex flex-wrap gap-2">
                                            {[
                                                { id: 'pan_test_domains', label: 'PAN Test Domains', guaranteed: true, tooltip: 'Official Palo Alto test domains' },
                                                { id: 'dns_flood', label: 'DNS Flood' },
                                                { id: 'beacon', label: 'C2 Beacon' },
                                                { id: 'port_scan', label: 'Port Scan' },
                                                { id: 'data_exfil', label: 'Data Exfil' },
                                                { id: 'random', label: 'Random Mix' }
                                            ].map(bt => (
                                                <label
                                                    key={bt.id}
                                                    title={bt.tooltip}
                                                    className={cn(
                                                        "px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-all uppercase flex items-center gap-1.5",
                                                        editingDevice?.security?.behavior_type?.includes(bt.id)
                                                            ? "bg-orange-500 border-transparent text-white shadow-lg shadow-orange-900/20"
                                                            : "bg-card-secondary border-border text-text-muted hover:border-orange-500/50 hover:text-orange-400"
                                                    )}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        className="hidden"
                                                        checked={editingDevice?.security?.behavior_type?.includes(bt.id)}
                                                        onChange={e => {
                                                            const current = editingDevice?.security?.behavior_type || [];
                                                            const next = e.target.checked
                                                                ? [...current, bt.id]
                                                                : current.filter(x => x !== bt.id);

                                                            setEditingDevice(prev => ({
                                                                ...prev!,
                                                                security: {
                                                                    ...prev!.security!,
                                                                    behavior_type: next.length > 0 ? next : ['random']
                                                                }
                                                            }));
                                                        }}
                                                    />
                                                    {bt.label}
                                                    {bt.guaranteed && <span className="text-[8px] bg-green-500 text-white px-1 rounded-sm">TARGET 🎯</span>}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-text-muted uppercase tracking-wider">Protocols</label>
                                <div className="flex flex-wrap gap-2 pt-1">
                                    {['dhcp', 'arp', 'lldp', 'snmp', 'http', 'mqtt', 'rtsp', 'cloud', 'dns', 'ntp'].map(p => (
                                        <label
                                            key={p}
                                            className={cn(
                                                "px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-all uppercase",
                                                editingDevice?.protocols?.includes(p)
                                                    ? "bg-blue-600 border-transparent text-white shadow-lg shadow-blue-900/20"
                                                    : "bg-card-secondary border-border text-text-muted hover:border-text-muted/50 hover:text-text-primary"
                                            )}
                                        >
                                            <input
                                                type="checkbox"
                                                className="hidden"
                                                checked={editingDevice?.protocols?.includes(p)}
                                                onChange={e => {
                                                    const current = editingDevice?.protocols || [];
                                                    const next = e.target.checked
                                                        ? [...current, p]
                                                        : current.filter(x => x !== p);
                                                    setEditingDevice(prev => ({ ...prev!, protocols: next }));
                                                }}
                                            />
                                            {p}
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="pt-4 border-t border-border flex gap-4">
                                <button
                                    type="button"
                                    onClick={() => setShowAddModal(false)}
                                    className="flex-1 px-4 py-3 bg-card-secondary border border-border text-text-muted font-bold rounded-xl hover:bg-card-hover transition-all tracking-widest text-xs"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={!editingDevice?.mac || !isValidMacAddress(editingDevice.mac)}
                                    className="flex-1 px-4 py-3 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-500 transition-all shadow-lg shadow-blue-900/20 uppercase tracking-widest text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Save Configuration
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Live Logs Overlay / Side Panel */}
            {activeLogDevice && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex justify-end animate-in fade-in duration-300" onClick={() => setActiveLogDevice(null)}>
                    <div
                        className="w-full max-w-2xl h-full bg-card border-l border-border shadow-2xl animate-in slide-in-from-right duration-500"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex flex-col h-full">
                            <div className="p-4 border-b border-border flex items-center justify-between bg-card-secondary/50 backdrop-blur-md">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-blue-600/20 rounded-lg text-blue-500">
                                        <Terminal size={20} />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-text-primary tracking-tight">Real-time Analysis</h3>
                                        <p className="text-xs text-text-muted font-medium">Monitoring {activeLogDevice.name}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setActiveLogDevice(null)}
                                    className="p-2 hover:bg-card-secondary rounded-lg text-text-muted hover:text-text-primary transition-all"
                                >
                                    <X size={24} />
                                </button>
                            </div>
                            <div className="flex-1 p-6 overflow-hidden">
                                <LogViewer
                                    deviceId={activeLogDevice.id}
                                    deviceName={activeLogDevice.name}
                                    onClose={() => setActiveLogDevice(null)}
                                />
                            </div>
                            <div className="p-4 bg-background/50 border-t border-border">
                                <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest text-center italic">
                                    Logs are streamed directly from the Python simulation engine
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function cn(...inputs: any[]) {
    return inputs.filter(Boolean).join(' ');
}
