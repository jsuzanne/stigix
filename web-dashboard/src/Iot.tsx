import React, { useState, useEffect, useRef } from 'react';
import {
    Cpu, Plus, Play, Square, Trash2, RefreshCcw,
    Wifi, Activity, Shield, Camera, Lightbulb,
    Thermometer, Speaker, HardDrive, Info,
    Search, CheckSquare, Square as SquareIcon,
    ArrowUpRight, Clock, AlertCircle, ChevronRight,
    LayoutGrid, List, Terminal, X, ExternalLink, ChevronDown, FileJson,
    Power, Edit2, AlertTriangle, FileSpreadsheet, CheckCircle2, Loader2, DownloadCloud,
    Gauge, Heart, TrendingUp, Zap
} from 'lucide-react';
import { io } from 'socket.io-client';
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
    const [daemonFailed, setDaemonFailed] = useState<string | null>(null);
    const [badBehaviorEnabled, setBadBehaviorEnabled] = useState(false);
    const [showPrismaModal, setShowPrismaModal] = useState(false);
    const [prismaFile, setPrismaFile] = useState<File | null>(null);
    const [prismaOpts, setPrismaOpts] = useState({
        max_devices: 100,
        only_iot: false,
        bad_behavior: 'auto' as 'auto' | 'all' | 'none' | 'percentage',
        security_percentage: 30,
        merge: false,
    });
    const [prismaLoading, setPrismaLoading] = useState(false);
    const [prismaResult, setPrismaResult] = useState<{ imported: number; bad_behavior: number } | null>(null);
    const [expandedThreats, setExpandedThreats] = useState<{ [deviceId: string]: boolean }>({});
    const toggleThreat = (id: string) => setExpandedThreats(prev => ({ ...prev, [id]: !prev[id] }));
    // Vulnerability CSV import state
    const [showVulnModal, setShowVulnModal] = useState(false);
    const [vulnFile, setVulnFile] = useState<File | null>(null);
    const [vulnOpts, setVulnOpts] = useState({
        max_devices: 50,
        only_iot: false,
        bad_behavior: 'auto' as 'auto' | 'all' | 'none' | 'percentage',
        security_percentage: 80,
        merge: false,
    });
    const [vulnLoading, setVulnLoading] = useState(false);
    const [vulnResult, setVulnResult] = useState<{ imported: number; bad_behavior: number; ics_cert_devices: number } | null>(null);
    const [showImportDropdown, setShowImportDropdown] = useState(false);
    const importDropdownRef = useRef<HTMLDivElement>(null);

    // Concurrency state
    const [iotSettings, setIotSettings] = useState<{ max: number; active: number; queued: number; idle: number }>({ max: 30, active: 0, queued: 0, idle: 0 });
    const [sliderValue, setSliderValue] = useState(30);
    const [iotHealth, setIotHealth] = useState<any>(null);
    const [trafficRate, setTrafficRate] = useState<{ pps: number; ppm: number; bps: number; activeDevices: number } | null>(null);
    const sliderDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
    // State filter
    const [stateFilter, setStateFilter] = useState<'ALL' | 'ACTIVE' | 'QUEUED' | 'IDLE' | 'STOPPED'>('ALL');

    // Format elapsed seconds as "2m 14s" or "45s"
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, []);
    const fmtElapsed = (ms: number) => {
        const s = Math.max(0, Math.floor((now - ms) / 1000));
        const m = Math.floor(s / 60);
        return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
    };
    const fmtRemain = (idledAt: number, cycleSeconds: number) => {
        const elapsed = Math.floor((now - idledAt) / 1000);
        const remain = Math.max(0, cycleSeconds - elapsed);
        const m = Math.floor(remain / 60);
        return m > 0 ? `${m}m ${remain % 60}s` : `${remain}s`;
    };

    // Close dropdown on outside click
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (importDropdownRef.current && !importDropdownRef.current.contains(event.target as Node)) {
                setShowImportDropdown(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Listen for daemon crash + IoT health events
    useEffect(() => {
        const socket = io();
        socket.on('iot:daemon_failed', (info: any) => {
            setDaemonFailed(info.message || 'IoT daemon crashed — restart required');
        });
        socket.on('iot:health', (health: any) => {
            setIotHealth(health);
            setIotSettings({ max: health.maxConcurrentDevices || 30, active: health.activeDevices || 0, queued: health.queuedDevices || 0, idle: health.idleDevices || 0 });
            if (health.trafficRate) setTrafficRate(health.trafficRate);
        });
        return () => { socket.disconnect(); };
    }, []);

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
        // Fetch concurrency settings on mount
        fetch('/api/iot/settings', { headers: authHeaders() }).then(r => r.json()).then(d => {
            setIotSettings(d);
            setSliderValue(d.max);
        }).catch(() => {});
        // Sync bad behavior state from server (daemon starts with it enabled)
        fetch('/api/iot/bad-behavior', { headers: authHeaders() }).then(r => r.json()).then(d => {
            if (typeof d.enabled === 'boolean') setBadBehaviorEnabled(d.enabled);
        }).catch(() => {});
        fetchDevices();
        const interval = setInterval(fetchDevices, 5000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        localStorage.setItem('iot-compact', String(isCompact));
    }, [isCompact]);

    const toggleDevice = async (id: string, deviceState?: string) => {
        try {
            // STOPPED → start; ACTIVE / IDLE / QUEUED → stop (removes from rotation)
            const endpoint = (!deviceState || deviceState === 'STOPPED')
                ? `/api/iot/start/${id}`
                : `/api/iot/stop/${id}`;
            await fetch(endpoint, { method: 'POST', headers: authHeaders() });
            fetchDevices();
        } catch (e) {
            console.error('Failed to toggle device', e);
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

    const toggleBadBehavior = async () => {
        const next = !badBehaviorEnabled;
        try {
            await fetch('/api/iot/bad-behavior', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ enabled: next })
            });
            setBadBehaviorEnabled(next);
        } catch (e) {
            console.error('Failed to toggle bad behavior', e);
        }
    };


    // Required Prisma IoT Security CSV columns (subset — at least these must be present)
    const PRISMA_REQUIRED_COLS = ['hostname', 'mac address', 'category', 'profile_vertical'];
    const VULN_REQUIRED_COLS   = ['device name', 'ip address', 'mac address', 'cve', 'cvss', 'severity'];

    const handlePrismaImport = async () => {
        if (!prismaFile) return;
        setPrismaLoading(true);
        setPrismaResult(null);

        try {
            const csv_content = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target?.result as string);
                reader.onerror = reject;
                reader.readAsText(prismaFile);
            });

            // ── Client-side CSV format validation ─────────────────────────────
            const firstLine = csv_content.split(/\r?\n/)[0] || '';
            const headers = firstLine.split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
            const missing = PRISMA_REQUIRED_COLS.filter(col => !headers.includes(col));
            if (missing.length > 0) {
                alert(
                    `❌ Invalid CSV format.\n\nThis doesn't look like a Prisma IoT Security export.\n\nMissing columns: ${missing.join(', ')}\n\nExpected columns include: ${PRISMA_REQUIRED_COLS.join(', ')}`
                );
                setPrismaLoading(false);
                return;
            }
            // ──────────────────────────────────────────────────────────────────

            const body: Record<string, any> = {
                csv_content,
                merge: prismaOpts.merge,
            };
            if (prismaOpts.max_devices > 0)               body.max_devices = prismaOpts.max_devices;
            if (prismaOpts.only_iot)                       body.only_iot = true;
            if (prismaOpts.bad_behavior === 'all')         body.enable_security = true;
            if (prismaOpts.bad_behavior === 'none')        body.security_percentage = 0;
            if (prismaOpts.bad_behavior === 'percentage')  body.security_percentage = prismaOpts.security_percentage;
            // 'auto' = default (script uses CSV risk level) — no extra flag needed

            const res = await fetch('/api/iot/import-prisma-csv', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify(body),
            });
            const data = await res.json();

            if (data.success) {
                setPrismaResult({ imported: data.imported, bad_behavior: data.bad_behavior });
                fetchDevices();
            } else {
                alert('❌ Import failed: ' + (data.detail || data.error));
            }
        } catch (e: any) {
            alert('❌ Import error: ' + e.message);
        } finally {
            setPrismaLoading(false);
        }
    };

    const handleVulnImport = async () => {
        if (!vulnFile) return;
        setVulnLoading(true);
        setVulnResult(null);

        try {
            const csv_content = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target?.result as string);
                reader.onerror = reject;
                reader.readAsText(vulnFile);
            });

            // Client-side format validation
            const firstLine = csv_content.split(/\r?\n/)[0] || '';
            const headers = firstLine.split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
            const missing = VULN_REQUIRED_COLS.filter(col => !headers.includes(col));
            if (missing.length > 0) {
                alert(
                    `❌ Invalid CSV format.\n\nThis doesn't look like a Palo Alto Vulnerability export.\n\nMissing columns: ${missing.join(', ')}\n\nExpected columns include: ${VULN_REQUIRED_COLS.join(', ')}`
                );
                setVulnLoading(false);
                return;
            }

            const body: Record<string, any> = {
                csv_content,
                merge: vulnOpts.merge,
            };
            if (vulnOpts.max_devices > 0)               body.max_devices = vulnOpts.max_devices;
            if (vulnOpts.only_iot)                       body.only_iot = true;
            if (vulnOpts.bad_behavior === 'all')         body.enable_security = true;
            if (vulnOpts.bad_behavior === 'none')        body.security_percentage = 0;
            if (vulnOpts.bad_behavior === 'percentage')  body.security_percentage = vulnOpts.security_percentage;

            const res = await fetch('/api/iot/import-vuln-csv', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify(body),
            });
            const data = await res.json();

            if (data.success) {
                setVulnResult({ imported: data.imported, bad_behavior: data.bad_behavior, ics_cert_devices: data.ics_cert_devices || 0 });
                fetchDevices();
            } else {
                alert('❌ Import failed: ' + (data.detail || data.error));
            }
        } catch (e: any) {
            alert('❌ Import error: ' + e.message);
        } finally {
            setVulnLoading(false);
        }
    };

    const filteredDevices = Array.isArray(devices) ? devices.filter(d => {
        const query = (searchQuery || '').toLowerCase();
        const name = (d.name || '').toLowerCase();
        const vendor = (d.vendor || '').toLowerCase();
        const id = (d.id || '').toLowerCase();
        const mac = (d.mac || '').toLowerCase();
        const textMatch = name.includes(query) || vendor.includes(query) || id.includes(query) || mac.includes(query);
        const ds = (d as any).deviceState || 'STOPPED';
        const stateMatch = stateFilter === 'ALL' || ds === stateFilter;
        return textMatch && stateMatch;
    // Always sort by original sequence index (#1, #2, … #N) so the order stays stable across all filters
    }).sort((a, b) => devices.indexOf(a) - devices.indexOf(b)) : [];

    const getDeviceIcon = (type: string, size: number = 20) => {
        const t = (type || '').toLowerCase();
        if (t.includes('camera')) return <Camera size={size} />;
        if (t.includes('bulb') || t.includes('light')) return <Lightbulb size={size} />;
        if (t.includes('sensor') || t.includes('thermostat')) return <Thermometer size={size} />;
        if (t.includes('speaker') || t.includes('alexa') || t.includes('home')) return <Speaker size={size} />;
        return <Cpu size={size} />;
    };

    const handleSliderChange = (val: number) => {
        setSliderValue(val);
        if (sliderDebounce.current) clearTimeout(sliderDebounce.current);
        sliderDebounce.current = setTimeout(() => {
            fetch('/api/iot/settings', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ maxConcurrentDevices: val }) })
                .then(r => r.json()).then(d => setIotSettings(d)).catch(() => {});
        }, 500);
    };

    const getRiskColor = (level: string) => {
        if (level === 'HIGH') return { text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', dot: 'bg-red-500' };
        if (level === 'MEDIUM') return { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', dot: 'bg-amber-500' };
        return { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', dot: 'bg-emerald-500' };
    };

    const getStateBadge = (state: string) => {
        switch (state) {
            case 'ACTIVE':  return <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wide">Active</span>;
            case 'QUEUED':  return <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-wide">Queued</span>;
            case 'IDLE':    return <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase tracking-wide">Idle</span>;
            default:        return <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-card-secondary text-text-muted border border-border uppercase tracking-wide">Off</span>;
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-12">
            {/* Daemon crash alert */}
            {daemonFailed && (
                <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/30 rounded-2xl px-5 py-4">
                    <AlertTriangle className="text-red-400 shrink-0" size={20} />
                    <div className="flex-1">
                        <p className="text-red-400 font-semibold text-sm">{daemonFailed}</p>
                        <p className="text-red-400/70 text-xs mt-0.5">The IoT emulator daemon crashed repeatedly. Restart the Stigix container to recover.</p>
                    </div>
                    <button onClick={() => setDaemonFailed(null)} className="text-red-400/60 hover:text-red-400">
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* ── Concurrency Control Panel — compact single row ──────── */}
            <div className={cn(
                "bg-card border rounded-2xl px-5 py-3 shadow-sm",
                iotSettings.active > 80 ? "border-red-500/40" : "border-border"
            )}>
                <div className="flex items-center gap-3 flex-wrap">
                    {/* Label */}
                    <div className="flex items-center gap-1.5 shrink-0">
                        <Gauge size={13} className="text-blue-400" />
                        <span className="text-[10px] font-black text-text-primary uppercase tracking-widest">IoT</span>
                    </div>
                    <div className="h-3.5 w-px bg-border shrink-0" />
                    {/* Slider */}
                    <div className="flex items-center gap-2 flex-1 min-w-[180px]">
                        <span className="text-[10px] text-text-muted whitespace-nowrap shrink-0">Max:</span>
                        <input
                            type="range" min={1} max={Math.max(devices.length, sliderValue, 163)}
                            value={sliderValue}
                            onChange={e => handleSliderChange(Number(e.target.value))}
                            className="flex-1 accent-blue-500 h-1 rounded-full cursor-pointer"
                        />
                        <span className="text-sm font-black text-blue-400 w-7 text-right shrink-0">{sliderValue}</span>
                    </div>
                    <div className="h-3.5 w-px bg-border shrink-0" />
                    {/* State counts */}
                    <div className="flex items-center gap-3 shrink-0 text-[11px]">
                        <span className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            <span className="text-text-muted">Active: <span className="font-black text-emerald-400">{iotSettings.active}</span></span>
                        </span>
                        <span className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                            <span className="text-text-muted">Queued: <span className="font-black text-amber-400">{iotSettings.queued}</span></span>
                        </span>
                        <span className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                            <span className="text-text-muted">Idle: <span className="font-black text-blue-400">{iotSettings.idle}</span></span>
                        </span>
                    </div>
                    {/* Inline health metrics */}
                    {iotHealth && (
                        <>
                            <div className="h-3.5 w-px bg-border shrink-0" />
                            <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
                                <span className={cn("text-[10px] font-bold", iotHealth.containerCpuPercent > 80 ? 'text-red-400' : 'text-text-muted')}>
                                    CPU <span className="font-black">{iotHealth.containerCpuPercent}%</span>
                                </span>
                                <span className={cn("text-[10px] font-bold", iotHealth.udpReceiveErrorsDelta > 20 ? 'text-red-400' : 'text-text-muted')}>
                                    UDP <span className="font-black">+{iotHealth.udpReceiveErrorsDelta}</span>
                                </span>
                                <span className={cn("text-[10px] font-bold", iotHealth.pythonProcessesStateD >= 2 ? 'text-red-400' : 'text-text-muted')}>
                                    D-state <span className="font-black">{iotHealth.pythonProcessesStateD}</span>
                                </span>
                                {trafficRate && trafficRate.activeDevices > 0 && (
                                    <span className="text-[10px] font-bold text-blue-400 flex items-center gap-1">
                                        <TrendingUp size={9} />
                                        <span className="font-black">{trafficRate.pps} pps</span>
                                        <span className="text-text-muted/50">·</span>
                                        <span className="font-black">{trafficRate.ppm.toLocaleString()} ppm</span>
                                    </span>
                                )}
                                <span className={cn(
                                    "px-2 py-0.5 rounded-full text-[9px] font-black border flex items-center gap-1",
                                    getRiskColor(iotHealth.voipRiskLevel).text,
                                    getRiskColor(iotHealth.voipRiskLevel).bg,
                                    getRiskColor(iotHealth.voipRiskLevel).border
                                )}>
                                    <div className={cn("w-1 h-1 rounded-full animate-pulse", getRiskColor(iotHealth.voipRiskLevel).dot)} />
                                    {iotHealth.voipRiskLevel}
                                </span>
                            </div>
                        </>
                    )}
                </div>
                {/* Recommendation banner */}
                {iotHealth?.recommendation && (
                    <p className={cn("text-[9px] mt-2 font-medium", getRiskColor(iotHealth.voipRiskLevel).text)}>
                        {iotHealth.recommendation}
                    </p>
                )}
            </div>
            {/* Header section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0 flex-shrink">
                    <div className="bg-blue-600/20 p-3 rounded-2xl flex-shrink-0">
                        <Cpu className="text-blue-400" size={32} />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-2xl font-bold text-text-primary flex items-center gap-2">
                            IoT Device Simulation
                        </h2>
                        <div className="flex items-center gap-3 flex-wrap">
                            <p className="text-text-muted text-sm whitespace-nowrap">Scale your branch with realistic IoT traffic patterns per vendor.</p>
                            <span className="text-text-muted/30">|</span>
                            <a
                                href="https://raw.githubusercontent.com/jsuzanne/stigix/main/sample%20config/iot-devices.json"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 text-xs font-bold transition-colors flex items-center gap-1 whitespace-nowrap"
                                title="Download Full IoT Sample Configuration"
                            >
                                <ExternalLink size={12} /> Download Sample
                            </a>
                            <span className="text-text-muted/30">|</span>
                            <a
                                href="https://github.com/jsuzanne/stigix/blob/main/docs/IOT_DEVICE_GENERATOR.md"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 text-xs font-bold transition-colors flex items-center gap-1 whitespace-nowrap"
                                title="Python Script Generator"
                            >
                                <ExternalLink size={12} /> Python Generator
                            </a>
                            <span className="text-text-muted/30">|</span>
                            <a
                                href="https://github.com/jsuzanne/stigix/blob/main/docs/IOT_LLM_GENERATION.md"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 text-xs font-bold transition-colors flex items-center gap-1 whitespace-nowrap"
                                title="LLM-based Generation"
                            >
                                <ExternalLink size={12} /> Llm Guide
                            </a>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                    {selectedIds.length > 0 && (
                        <div className="flex items-center gap-2 bg-blue-600/10 px-4 py-2 rounded-xl border border-blue-500/30 animate-in slide-in-from-right duration-300">
                            <span className="text-sm font-bold text-blue-400 whitespace-nowrap">{selectedIds.length} selected</span>
                            <div className="w-px h-5 bg-blue-500/30 mx-1" />
                            <button
                                onClick={handleBulkStart}
                                className="flex items-center gap-1.5 text-sm font-bold text-green-400 hover:text-green-300 transition-colors whitespace-nowrap px-2 py-1 rounded-lg hover:bg-green-500/10"
                            >
                                <Play size={14} /> Start
                            </button>
                            <button
                                onClick={handleBulkStop}
                                className="flex items-center gap-1.5 text-sm font-bold text-red-400 hover:text-red-300 transition-colors whitespace-nowrap px-2 py-1 rounded-lg hover:bg-red-500/10"
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

                    <div className="relative" ref={importDropdownRef}>
                        <button
                            onClick={() => setShowImportDropdown(!showImportDropdown)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all border",
                                showImportDropdown ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20" : "bg-card-secondary hover:bg-card-hover text-text-secondary border-border"
                            )}
                            title="Import Configurations or Assets"
                        >
                            <DownloadCloud size={18} /> Import <ChevronDown size={14} className={cn("transition-transform duration-200", showImportDropdown && "rotate-180")} />
                        </button>
                        
                        {showImportDropdown && (
                            <div className="absolute right-0 mt-2 w-72 bg-card border border-border rounded-2xl shadow-2xl z-50 p-2 animate-in fade-in slide-in-from-top-2 duration-200">
                                <label className="flex flex-col gap-1 p-3 hover:bg-blue-600/10 rounded-xl cursor-pointer group transition-colors">
                                    <div className="flex items-center gap-2 text-blue-400">
                                        <FileJson size={18} />
                                        <span className="text-sm font-bold">Stigix JSON Config</span>
                                    </div>
                                    <p className="text-[10px] text-text-muted leading-relaxed">Restore a full IoT simulation environment from a previously exported .json file.</p>
                                    <input type="file" accept=".json" className="hidden" onChange={(e) => { setShowImportDropdown(false); handleImportJson(e); }} />
                                </label>
                                
                                <div className="h-px bg-border my-1 mx-2" />
                                
                                <button
                                    onClick={() => { setShowImportDropdown(false); setPrismaFile(null); setPrismaResult(null); setShowPrismaModal(true); }}
                                    className="w-full flex flex-col gap-1 p-3 hover:bg-purple-500/10 rounded-xl text-left group transition-colors"
                                >
                                    <div className="flex items-center gap-2 text-purple-400">
                                        <FileSpreadsheet size={18} />
                                        <span className="text-sm font-bold">Device Security Assets</span>
                                    </div>
                                    <p className="text-[10px] text-text-muted leading-relaxed">Import devices from a Palo Alto IoT Security CSV report (Inventory Export).</p>
                                </button>

                                <div className="h-px bg-border my-1 mx-2" />

                                <button
                                    onClick={() => { setShowImportDropdown(false); setVulnFile(null); setVulnResult(null); setShowVulnModal(true); }}
                                    className="w-full flex flex-col gap-1 p-3 hover:bg-orange-500/10 rounded-xl text-left group transition-colors"
                                >
                                    <div className="flex items-center gap-2 text-orange-400">
                                        <AlertTriangle size={18} />
                                        <span className="text-sm font-bold">Vulnerability Report</span>
                                    </div>
                                    <p className="text-[10px] text-text-muted leading-relaxed">Import from a Palo Alto CVE/Vulnerability export — aggregates by device, ranks by danger score (CVEs + APT groups + ICS-CERT).</p>
                                </button>
                            </div>
                        )}
                    </div>

                    <button
                        onClick={() => { setEditingDevice({ enabled: true, protocols: ['dhcp', 'arp', 'http'], traffic_interval: 60 }); setShowAddModal(true); }}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-blue-900/20"
                    >
                        <Plus size={18} /> Add Device
                    </button>
                </div>
            </div>

            {/* Filters Bar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card-secondary p-4 rounded-2xl border border-border shadow-sm">
                <div className="flex flex-col md:flex-row items-center gap-3 w-full md:w-auto">
                    <div className="relative w-full md:w-80">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
                        <input
                            type="text"
                            placeholder="Filter by Name, Vendor, ID, MAC..."
                            className="bg-card border-border text-foreground pl-10 pr-4 py-2 rounded-xl text-sm w-full focus:ring-1 focus:ring-blue-500 transition-all border outline-none"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center gap-2 w-full md:w-auto">
                        {/* Global Bad Behavior Toggle */}
                        <button
                            id="bad-behavior-toggle"
                            onClick={toggleBadBehavior}
                            title={badBehaviorEnabled
                                ? 'Attacks active — click to stop all bad behavior (Clean Mode)'
                                : 'No attacks — click to enable bad behavior on all configured devices'}
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                                badBehaviorEnabled
                                    ? 'bg-red-500/10 border-red-500/40 text-red-400 hover:bg-red-500/20 animate-pulse'
                                    : 'bg-card-secondary border-border text-text-muted hover:text-text-secondary hover:bg-card-hover'
                            }`}
                        >
                            <span>{badBehaviorEnabled ? '💀' : '🛡️'}</span>
                            <span>{badBehaviorEnabled ? 'Attacks ON' : 'Clean'}</span>
                        </button>

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

                {/* State filter pills — clickable, double as count badges */}
                <div className="flex items-center gap-1.5 flex-wrap">
                    {(['ALL', 'ACTIVE', 'QUEUED', 'IDLE', 'STOPPED'] as const).map(s => {
                        const count = s === 'ALL' ? devices.length
                            : s === 'ACTIVE'  ? devices.filter(d => (d as any).deviceState === 'ACTIVE').length
                            : s === 'QUEUED'  ? devices.filter(d => (d as any).deviceState === 'QUEUED').length
                            : s === 'IDLE'    ? devices.filter(d => (d as any).deviceState === 'IDLE').length
                            : devices.filter(d => !(d as any).deviceState || (d as any).deviceState === 'STOPPED').length;
                        const dot = s === 'ACTIVE' ? 'bg-emerald-500' : s === 'QUEUED' ? 'bg-amber-500' : s === 'IDLE' ? 'bg-blue-500' : s === 'STOPPED' ? 'bg-zinc-500' : 'bg-blue-500';
                        const active = stateFilter === s;
                        const activeStyle = s === 'ACTIVE'  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                            : s === 'QUEUED'  ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                            : s === 'IDLE'    ? 'bg-blue-500/15 border-blue-500/40 text-blue-400'
                            : s === 'STOPPED' ? 'bg-zinc-500/15 border-zinc-500/40 text-zinc-400'
                            : 'bg-blue-600/20 border-blue-500/50 text-blue-300';
                        return (
                            <button
                                key={s}
                                onClick={() => setStateFilter(s)}
                                className={cn(
                                    "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black border transition-all",
                                    active ? activeStyle : 'bg-card-secondary border-border text-text-muted hover:text-text-secondary hover:bg-card-hover'
                                )}
                            >
                                {s !== 'ALL' && <div className={cn('w-1.5 h-1.5 rounded-full', dot)} />}
                                {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()} <span className="opacity-60">({count})</span>
                            </button>
                        );
                    })}
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
                                    <div className="truncate flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[11px] font-mono font-bold text-text-muted/60">#{devices.findIndex(d => d.id === device.id) + 1}</span>
                                            <h3 className={cn("font-bold text-text-primary transition-colors tracking-tight truncate", isCompact ? "text-sm" : "text-base group-hover:text-blue-500")}>{device.name}</h3>
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                            <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest truncate">{device.vendor} • {device.type}</p>
                                            {(device as any).deviceState && getStateBadge((device as any).deviceState)}
                                        </div>
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
                                        <div className="hidden lg:block shrink-0 text-right">
                                            <div className={cn(
                                                "px-2.5 py-1 rounded-full text-[10px] font-black tracking-widest border",
                                                (device as any).deviceState === 'ACTIVE' ? "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20" :
                                                (device as any).deviceState === 'QUEUED' ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                                                (device as any).deviceState === 'IDLE'   ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                                                "bg-card-secondary text-text-muted border-border"
                                            )}>
                                                {(device as any).deviceState === 'ACTIVE' ? 'Running' :
                                                 (device as any).deviceState === 'QUEUED' ? 'Queued' :
                                                 (device as any).deviceState === 'IDLE'   ? 'Idle' : 'Stopped'}
                                            </div>
                                            {/* Timing info below the badge */}
                                            {(device as any).timing && (() => {
                                                const t = (device as any).timing;
                                                const state = (device as any).deviceState;
                                                if (state === 'ACTIVE' && t.activatedAt)
                                                    return <div className="text-[9px] text-green-500/70 font-mono mt-1">{fmtElapsed(t.activatedAt)}</div>;
                                                if (state === 'IDLE' && t.idledAt)
                                                    return <div className="text-[9px] text-blue-400/70 font-mono mt-1">{fmtRemain(t.idledAt, t.cycleSeconds || 60)} left</div>;
                                                if (state === 'QUEUED' && t.queuePosition)
                                                    return <div className="text-[9px] text-amber-400/70 font-mono mt-1">#{t.queuePosition}</div>;
                                                return null;
                                            })()}
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

                                {/* Description + Vulnerability threat intel panel (non-compact only) */}
                                {!isCompact && device.description && (() => {
                                    const meta = (device as any)._vuln_meta;
                                    const parts = device.description.split(' | ');
                                    return (
                                        <div className="mb-4 space-y-2">
                                            {meta ? (() => {
                                                const devKey = device.id || device.name;
                                                const isExpanded = !!expandedThreats[devKey];
                                                return (
                                                    <div className="bg-card-secondary/40 border border-orange-500/20 rounded-xl p-2.5 transition-all">
                                                        {/* Compact Header Summary Row */}
                                                        <div 
                                                            className="flex items-center justify-between gap-1.5 cursor-pointer select-none group/threat"
                                                            onClick={() => toggleThreat(devKey)}
                                                            title="Click to expand/collapse threat intelligence details"
                                                        >
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <span className="bg-orange-500/15 text-orange-400 text-[9px] font-black px-2 py-0.5 rounded border border-orange-500/30 uppercase tracking-tight">
                                                                    Score {meta.danger_score}
                                                                </span>
                                                                {meta.critical_cves > 0 && (
                                                                    <span className="bg-red-500/15 text-red-400 text-[9px] font-black px-2 py-0.5 rounded border border-red-500/25 uppercase tracking-tight">
                                                                        {meta.critical_cves} Critical
                                                                    </span>
                                                                )}
                                                                {meta.os && (
                                                                    <span className="text-[9px] font-mono text-text-muted bg-card-secondary px-1.5 py-0.5 rounded border border-border">
                                                                        {meta.os}
                                                                    </span>
                                                                )}
                                                            </div>

                                                            <button
                                                                type="button"
                                                                className="flex items-center gap-1 text-[9px] font-bold text-text-muted group-hover/threat:text-orange-400 transition-colors px-1 py-0.5"
                                                            >
                                                                <span>{isExpanded ? 'Hide' : 'Details'}</span>
                                                                <ChevronDown size={12} className={cn("transition-transform duration-200", isExpanded && "rotate-180")} />
                                                            </button>
                                                        </div>

                                                        {/* Expandable Detailed Intel */}
                                                        {isExpanded && (
                                                            <div className="mt-2.5 pt-2 border-t border-border/40 space-y-2 animate-in fade-in duration-150">
                                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                                    <span className="bg-card-secondary text-text-muted text-[9px] font-bold px-2 py-0.5 rounded border border-border uppercase tracking-tight">
                                                                        {meta.cve_count} CVEs
                                                                    </span>
                                                                    {meta.high_cves > 0 && (
                                                                        <span className="bg-orange-500/15 text-orange-400 text-[9px] font-bold px-2 py-0.5 rounded border border-orange-500/25 uppercase tracking-tight">
                                                                            {meta.high_cves} High
                                                                        </span>
                                                                    )}
                                                                    {meta.max_cvss > 0 && (
                                                                        <span className="bg-card-secondary text-text-secondary text-[9px] font-bold px-2 py-0.5 rounded border border-border uppercase tracking-tight">
                                                                            CVSS {meta.max_cvss.toFixed(1)}
                                                                        </span>
                                                                    )}
                                                                    {meta.apt_groups?.length > 0 && (
                                                                        <span className="bg-purple-500/15 text-purple-400 text-[9px] font-bold px-2 py-0.5 rounded border border-purple-500/25 uppercase tracking-tight">
                                                                            {meta.apt_groups.length} APT
                                                                        </span>
                                                                    )}
                                                                    {meta.has_ics_cert && (
                                                                        <span className="bg-yellow-500/15 text-yellow-400 text-[9px] font-black px-2 py-0.5 rounded border border-yellow-500/25 uppercase tracking-tight">
                                                                            ⚠ ICS-CERT
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                {meta.top_cves?.length > 0 && (
                                                                    <div className="flex flex-wrap gap-1">
                                                                        {(meta.top_cves as string[]).slice(0, 4).map((cve) => (
                                                                            <span key={cve} className="text-[8px] font-mono text-text-muted bg-card px-1.5 py-0.5 rounded border border-border">
                                                                                {cve}
                                                                            </span>
                                                                        ))}
                                                                        {meta.top_cves.length > 4 && (
                                                                            <span className="text-[8px] text-text-muted font-bold">+{meta.top_cves.length - 4}</span>
                                                                        )}
                                                                    </div>
                                                                )}
                                                                {meta.apt_groups?.length > 0 && (
                                                                    <p className="text-[9px] text-text-muted leading-relaxed">
                                                                        <span className="text-purple-400 font-bold">APT: </span>
                                                                        {(meta.apt_groups as string[]).slice(0, 5).join(', ')}
                                                                        {meta.apt_groups.length > 5 && <span className="font-bold"> +{meta.apt_groups.length - 5}</span>}
                                                                    </p>
                                                                )}
                                                                {meta.site && (
                                                                    <p className="text-[9px] text-text-muted">
                                                                        Site: <span className="text-text-secondary">{meta.site}</span>
                                                                    </p>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })() : parts.length > 1 ? (
                                                <div className="flex flex-wrap gap-1 px-1">
                                                    {parts.map((p, i) => (
                                                        <span key={i} className="text-[9px] text-text-muted bg-card-secondary px-2 py-0.5 rounded border border-border">
                                                            {p}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-[10px] text-text-muted leading-relaxed px-1 italic">{device.description}</p>
                                            )}
                                        </div>
                                    );
                                })()}

                                {!isCompact && (
                                    <div className="flex items-center gap-1.5 flex-wrap mb-2 min-h-[22px]">
                                        {device.security?.bad_behavior && (device.security.behavior_type || []).map(bt => (
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
                                        onClick={() => toggleDevice(device.id, (device as any).deviceState)}
                                        className={cn(
                                            "flex items-center justify-center transition-all border",
                                            isCompact ? "p-2 rounded-xl" : "flex-1 py-3.5 rounded-2xl text-sm font-black",
                                            (device as any).deviceState === 'QUEUED'
                                                ? "bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border-amber-500/20"
                                                : (device as any).deviceState === 'ACTIVE' || (device as any).deviceState === 'IDLE'
                                                    ? "bg-red-500/10 hover:bg-red-500/20 text-red-500 border-red-500/20"
                                                    : "bg-blue-600 hover:bg-blue-500 text-white border-transparent shadow-lg shadow-blue-900/40"
                                        )}
                                        title={
                                            (device as any).deviceState === 'QUEUED' ? "Remove from Queue" :
                                            (device as any).deviceState === 'ACTIVE' || (device as any).deviceState === 'IDLE' ? "Shut Down" :
                                            "Start"
                                        }
                                    >
                                        <Power size={18} />
                                        {!isCompact && <span className="ml-2 tracking-widest">
                                            {(device as any).deviceState === 'QUEUED' ? 'Dequeue' :
                                             (device as any).deviceState === 'ACTIVE' || (device as any).deviceState === 'IDLE' ? 'Shut' :
                                             'Start'}
                                        </span>}
                                    </button>

                                    <button
                                        onClick={() => { setEditingDevice(device); setShowAddModal(true); }}
                                        className={cn(
                                            "bg-card-secondary hover:bg-card-hover text-text-muted hover:text-text-primary transition-all border border-border",
                                            isCompact ? "p-2 rounded-xl" : "p-3 rounded-2xl"
                                        )}
                                        title="Edit Device"
                                    >
                                        <Edit2 size={18} />
                                    </button>

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

                            {/* Cumulative Timing Bar */}
                            {(() => {
                                const t = (device as any).timing?.cumulative;
                                if (!t) return device.running ? <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-500/50 animate-pulse" /> : null;
                                
                                const total = (t.active || 0) + (t.idle || 0) + (t.queued || 0);
                                if (total === 0) return device.running ? <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-500/50 animate-pulse" /> : null;
                                
                                const pctA = Math.round(((t.active || 0) / total) * 100);
                                const pctQ = Math.round(((t.queued || 0) / total) * 100);
                                const pctI = 100 - pctA - pctQ;
                                
                                const formatMs = (ms: number) => {
                                    if (!ms) return '0s';
                                    const s = Math.floor(ms / 1000);
                                    if (s < 60) return `${s}s`;
                                    const m = Math.floor(s / 60);
                                    return `${m}m ${s % 60}s`;
                                };

                                return (
                                    <div 
                                        className="absolute bottom-0 left-0 right-0 h-1.5 flex group/timing cursor-help opacity-80 hover:opacity-100 transition-opacity"
                                        title={`Cumulative Time:\n🟩 Active: ${formatMs(t.active)}\n🟧 Queued: ${formatMs(t.queued)}\n🟦 Idle: ${formatMs(t.idle)}`}
                                    >
                                        {pctA > 0 && <div style={{ width: `${pctA}%` }} className="bg-emerald-500 transition-all" />}
                                        {pctQ > 0 && <div style={{ width: `${pctQ}%` }} className="bg-amber-500 transition-all" />}
                                        {pctI > 0 && <div style={{ width: `${pctI}%` }} className="bg-blue-500 transition-all" />}
                                    </div>
                                );
                            })()}
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


            {/* Prisma IoT Security CSV Import Modal */}
            {showPrismaModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-300">
                    <div className="bg-card border border-border rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                        <div className="p-6 border-b border-border flex items-center justify-between bg-card-secondary shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-purple-500/20 rounded-xl">
                                    <FileSpreadsheet size={20} className="text-purple-400" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-foreground">Device Security Assets</h3>
                                    <p className="text-xs text-text-muted">Import from Palo Alto IoT Security</p>
                                </div>
                            </div>
                            <button onClick={() => { setShowPrismaModal(false); setPrismaResult(null); }} className="text-text-muted hover:text-foreground transition-colors shrink-0">
                                <X size={22} />
                            </button>
                        </div>

                        <div className="p-6 space-y-5 overflow-y-auto">
                            {/* File picker */}
                            <label className={cn(
                                "flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-2xl p-6 cursor-pointer transition-all",
                                prismaFile ? "border-purple-500/50 bg-purple-500/5" : "border-border hover:border-purple-500/40 hover:bg-purple-500/5"
                            )}>
                                <FileSpreadsheet size={28} className={prismaFile ? "text-purple-400" : "text-text-muted"} />
                                {prismaFile ? (
                                    <div className="text-center w-full overflow-hidden">
                                        <p className="text-sm font-bold text-purple-400 truncate w-full px-2" title={prismaFile.name}>{prismaFile.name}</p>
                                        <p className="text-xs text-text-muted mt-0.5">{(prismaFile.size / 1024).toFixed(1)} KB</p>
                                    </div>
                                ) : (
                                    <div className="text-center">
                                        <p className="text-sm font-bold text-text-secondary">Drop CSV file or click to browse</p>
                                        <p className="text-xs text-text-muted mt-0.5">Palo Alto Device Security inventory export (.csv)</p>
                                    </div>
                                )}
                                <input
                                    type="file"
                                    accept=".csv,text/csv"
                                    className="hidden"
                                    onChange={e => { setPrismaFile(e.target.files?.[0] || null); setPrismaResult(null); }}
                                />
                            </label>

                            {/* Options */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Max Devices</label>
                                    <div className="flex gap-1 flex-wrap">
                                        {[30, 50, 100, 0].map(n => (
                                            <button
                                                key={n}
                                                onClick={() => setPrismaOpts(o => ({ ...o, max_devices: n }))}
                                                className={cn(
                                                    "px-2.5 py-1 rounded-lg text-xs font-bold border transition-all",
                                                    prismaOpts.max_devices === n
                                                        ? "bg-purple-600 border-transparent text-white"
                                                        : "bg-card-secondary border-border text-text-muted hover:border-purple-500/50"
                                                )}
                                            >
                                                {n === 0 ? 'All' : n}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Device Filter</label>
                                    <div className="flex gap-1">
                                        {[{ v: false, l: 'All devices' }, { v: true, l: 'IoT only' }].map(({ v, l }) => (
                                            <button
                                                key={l}
                                                onClick={() => setPrismaOpts(o => ({ ...o, only_iot: v }))}
                                                className={cn(
                                                    "px-2.5 py-1 rounded-lg text-xs font-bold border transition-all",
                                                    prismaOpts.only_iot === v
                                                        ? "bg-purple-600 border-transparent text-white"
                                                        : "bg-card-secondary border-border text-text-muted hover:border-purple-500/50"
                                                )}
                                            >{l}</button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Bad Behavior</label>
                                <div className="flex gap-1 flex-wrap">
                                    {[
                                        { v: 'auto',       l: 'Auto (risk level)' },
                                        { v: 'all',        l: 'All devices' },
                                        { v: 'percentage', l: 'Percentage' },
                                        { v: 'none',       l: 'None' },
                                    ].map(({ v, l }) => (
                                        <button
                                            key={v}
                                            onClick={() => setPrismaOpts(o => ({ ...o, bad_behavior: v as any }))}
                                            className={cn(
                                                "px-2.5 py-1 rounded-lg text-xs font-bold border transition-all",
                                                prismaOpts.bad_behavior === v
                                                    ? "bg-red-600 border-transparent text-white"
                                                    : "bg-card-secondary border-border text-text-muted hover:border-red-500/50"
                                            )}
                                        >{l}</button>
                                    ))}
                                </div>
                                {prismaOpts.bad_behavior === 'percentage' && (
                                    <div className="flex items-center gap-3 pt-1 animate-in fade-in duration-200">
                                        <input
                                            type="range" min={1} max={100}
                                            value={prismaOpts.security_percentage}
                                            onChange={e => setPrismaOpts(o => ({ ...o, security_percentage: Number(e.target.value) }))}
                                            className="flex-1 accent-red-500"
                                        />
                                        <span className="text-xs font-black text-red-400 w-10 text-right">{prismaOpts.security_percentage}%</span>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center justify-between p-3 bg-card-secondary rounded-2xl border border-border">
                                <div>
                                    <p className="text-xs font-bold text-text-secondary">Import mode</p>
                                    <p className="text-[10px] text-text-muted">{prismaOpts.merge ? 'Add to existing devices (dedup by ID)' : 'Replace all existing devices'}</p>
                                </div>
                                <button
                                    onClick={() => setPrismaOpts(o => ({ ...o, merge: !o.merge }))}
                                    className={cn(
                                        "px-3 py-1.5 rounded-xl text-xs font-bold border transition-all",
                                        prismaOpts.merge
                                            ? "bg-green-500/20 border-green-500/40 text-green-400"
                                            : "bg-orange-500/20 border-orange-500/40 text-orange-400"
                                    )}
                                >
                                    {prismaOpts.merge ? '➕ Merge' : '🔄 Replace'}
                                </button>
                            </div>

                            {/* Result banner */}
                            {prismaResult && (
                                <div className="flex items-center gap-3 bg-green-500/10 border border-green-500/30 rounded-2xl px-4 py-3 animate-in fade-in duration-300">
                                    <CheckCircle2 size={18} className="text-green-400 shrink-0" />
                                    <div>
                                        <p className="text-sm font-bold text-green-400">Import successful!</p>
                                        <p className="text-xs text-text-muted">{prismaResult.imported} devices imported — {prismaResult.bad_behavior} with bad behavior</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="px-6 pb-6 pt-4 flex gap-3 shrink-0 border-t border-border">
                            <button
                                onClick={() => { setShowPrismaModal(false); setPrismaResult(null); }}
                                className="flex-1 px-4 py-3 bg-card-secondary border border-border text-text-muted font-bold rounded-xl hover:bg-card-hover transition-all tracking-widest text-xs"
                            >
                                {prismaResult ? 'Close' : 'Cancel'}
                            </button>
                            {!prismaResult && (
                                <button
                                    onClick={handlePrismaImport}
                                    disabled={!prismaFile || prismaLoading}
                                    className="flex-1 px-4 py-3 bg-purple-600 text-white font-black rounded-xl hover:bg-purple-500 transition-all shadow-lg shadow-purple-900/20 uppercase tracking-widest text-xs disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {prismaLoading ? <><Loader2 size={16} className="animate-spin" /> Converting...</> : <><FileSpreadsheet size={16} /> Convert & Import</>}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Vulnerability CSV Import Modal ── */}
            {showVulnModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-300">
                    <div className="bg-card border border-border rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                        <div className="p-6 border-b border-border flex items-center justify-between bg-card-secondary shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-orange-500/20 rounded-xl">
                                    <AlertTriangle size={20} className="text-orange-400" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-foreground">Vulnerability Report</h3>
                                    <p className="text-xs text-text-muted">Palo Alto IoT Security — CVE export (one row per CVE)</p>
                                </div>
                            </div>
                            <button onClick={() => { setShowVulnModal(false); setVulnResult(null); }} className="text-text-muted hover:text-foreground transition-colors shrink-0">
                                <X size={22} />
                            </button>
                        </div>

                        <div className="p-6 space-y-5 overflow-y-auto">
                            {/* File picker */}
                            <label className={cn(
                                "flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-2xl p-6 cursor-pointer transition-all",
                                vulnFile ? "border-orange-500/50 bg-orange-500/5" : "border-border hover:border-orange-500/40 hover:bg-orange-500/5"
                            )}>
                                <AlertTriangle size={28} className={vulnFile ? "text-orange-400" : "text-text-muted"} />
                                {vulnFile ? (
                                    <div className="text-center w-full overflow-hidden">
                                        <p className="text-sm font-bold text-orange-400 truncate w-full px-2" title={vulnFile.name}>{vulnFile.name}</p>
                                        <p className="text-xs text-text-muted mt-0.5">{(vulnFile.size / 1024).toFixed(1)} KB</p>
                                    </div>
                                ) : (
                                    <div className="text-center">
                                        <p className="text-sm font-bold text-text-secondary">Drop CSV file or click to browse</p>
                                        <p className="text-xs text-text-muted mt-0.5">Palo Alto Vulnerability export (.csv) — one row per CVE</p>
                                    </div>
                                )}
                                <input
                                    type="file"
                                    accept=".csv,text/csv"
                                    className="hidden"
                                    onChange={e => { setVulnFile(e.target.files?.[0] || null); setVulnResult(null); }}
                                />
                            </label>

                            {/* Info banner: danger score explanation */}
                            <div className="flex items-start gap-2 p-3 bg-orange-500/5 border border-orange-500/20 rounded-xl">
                                <AlertTriangle size={14} className="text-orange-400 mt-0.5 shrink-0" />
                                <p className="text-[10px] text-text-muted leading-relaxed">
                                    Devices are ranked by <span className="text-orange-400 font-bold">Danger Score</span>: Risk Score + Critical CVEs×15 + High CVEs×8 + APT groups×5 + ICS-CERT×10 + Max CVSS×2. Top N are selected.
                                </p>
                            </div>

                            {/* Options */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Max Devices</label>
                                    <div className="flex gap-1 flex-wrap">
                                        {[30, 50, 100, 0].map(n => (
                                            <button
                                                key={n}
                                                onClick={() => setVulnOpts(o => ({ ...o, max_devices: n }))}
                                                className={cn(
                                                    "px-2.5 py-1 rounded-lg text-xs font-bold border transition-all",
                                                    vulnOpts.max_devices === n
                                                        ? "bg-orange-600 border-transparent text-white"
                                                        : "bg-card-secondary border-border text-text-muted hover:border-orange-500/50"
                                                )}
                                            >
                                                {n === 0 ? 'All' : n}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Device Filter</label>
                                    <div className="flex gap-1">
                                        {[{ v: false, l: 'All' }, { v: true, l: 'IoT only' }].map(({ v, l }) => (
                                            <button
                                                key={l}
                                                onClick={() => setVulnOpts(o => ({ ...o, only_iot: v }))}
                                                className={cn(
                                                    "px-2.5 py-1 rounded-lg text-xs font-bold border transition-all",
                                                    vulnOpts.only_iot === v
                                                        ? "bg-orange-600 border-transparent text-white"
                                                        : "bg-card-secondary border-border text-text-muted hover:border-orange-500/50"
                                                )}
                                            >{l}</button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Bad Behavior (Attack Simulation)</label>
                                <div className="flex gap-1 flex-wrap">
                                    {[
                                        { v: 'auto',       l: 'Auto (CVE/APT)' },
                                        { v: 'all',        l: 'All devices' },
                                        { v: 'percentage', l: 'Percentage' },
                                        { v: 'none',       l: 'None' },
                                    ].map(({ v, l }) => (
                                        <button
                                            key={v}
                                            onClick={() => setVulnOpts(o => ({ ...o, bad_behavior: v as any }))}
                                            className={cn(
                                                "px-2.5 py-1 rounded-lg text-xs font-bold border transition-all",
                                                vulnOpts.bad_behavior === v
                                                    ? "bg-red-600 border-transparent text-white"
                                                    : "bg-card-secondary border-border text-text-muted hover:border-red-500/50"
                                            )}
                                        >{l}</button>
                                    ))}
                                </div>
                                {vulnOpts.bad_behavior === 'percentage' && (
                                    <div className="flex items-center gap-3 pt-1 animate-in fade-in duration-200">
                                        <input
                                            type="range" min={1} max={100}
                                            value={vulnOpts.security_percentage}
                                            onChange={e => setVulnOpts(o => ({ ...o, security_percentage: Number(e.target.value) }))}
                                            className="flex-1 accent-red-500"
                                        />
                                        <span className="text-xs font-black text-red-400 w-10 text-right">{vulnOpts.security_percentage}%</span>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center justify-between p-3 bg-card-secondary rounded-2xl border border-border">
                                <div>
                                    <p className="text-xs font-bold text-text-secondary">Import mode</p>
                                    <p className="text-[10px] text-text-muted">{vulnOpts.merge ? 'Add to existing devices (dedup by ID)' : 'Replace all existing devices'}</p>
                                </div>
                                <button
                                    onClick={() => setVulnOpts(o => ({ ...o, merge: !o.merge }))}
                                    className={cn(
                                        "px-3 py-1.5 rounded-xl text-xs font-bold border transition-all",
                                        vulnOpts.merge
                                            ? "bg-green-500/20 border-green-500/40 text-green-400"
                                            : "bg-orange-500/20 border-orange-500/40 text-orange-400"
                                    )}
                                >
                                    {vulnOpts.merge ? '➕ Merge' : '🔄 Replace'}
                                </button>
                            </div>

                            {/* Result banner */}
                            {vulnResult && (
                                <div className="flex items-center gap-3 bg-green-500/10 border border-green-500/30 rounded-2xl px-4 py-3 animate-in fade-in duration-300">
                                    <CheckCircle2 size={18} className="text-green-400 shrink-0" />
                                    <div>
                                        <p className="text-sm font-bold text-green-400">Import successful!</p>
                                        <p className="text-xs text-text-muted">
                                            {vulnResult.imported} devices imported — {vulnResult.bad_behavior} with bad behavior
                                            {vulnResult.ics_cert_devices > 0 && <span className="text-orange-400 font-bold ml-1">· {vulnResult.ics_cert_devices} ICS-CERT ⚠️</span>}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="px-6 pb-6 pt-4 flex gap-3 shrink-0 border-t border-border">
                            <button
                                onClick={() => { setShowVulnModal(false); setVulnResult(null); }}
                                className="flex-1 px-4 py-3 bg-card-secondary border border-border text-text-muted font-bold rounded-xl hover:bg-card-hover transition-all tracking-widest text-xs"
                            >
                                {vulnResult ? 'Close' : 'Cancel'}
                            </button>
                            {!vulnResult && (
                                <button
                                    onClick={handleVulnImport}
                                    disabled={!vulnFile || vulnLoading}
                                    className="flex-1 px-4 py-3 bg-orange-600 text-white font-black rounded-xl hover:bg-orange-500 transition-all shadow-lg shadow-orange-900/20 uppercase tracking-widest text-xs disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {vulnLoading ? <><Loader2 size={16} className="animate-spin" /> Analyzing...</> : <><AlertTriangle size={16} /> Analyze & Import</>}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Add/Edit Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-300">
                    <div className="bg-card border border-border rounded-3xl w-full max-w-3xl overflow-hidden shadow-2xl">
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
                                    <input
                                        type="text"
                                        placeholder="e.g. Hikvision, Apple Inc., VMware"
                                        className="w-full bg-card-secondary border border-border rounded-xl px-4 py-3 text-sm text-foreground focus:ring-1 focus:ring-blue-500 outline-none"
                                        value={editingDevice?.vendor || ''}
                                        onChange={e => setEditingDevice(prev => ({ ...prev!, vendor: e.target.value }))}
                                    />
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
                                        <div className="w-full flex flex-nowrap overflow-x-auto gap-1.5 pb-1 custom-scrollbar">
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
                                                        "px-2 py-1 rounded-md text-[10px] font-bold border cursor-pointer transition-all uppercase flex items-center gap-1 whitespace-nowrap shrink-0",
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
                                <div className="w-full flex flex-nowrap overflow-x-auto gap-1.5 pt-1 pb-1 custom-scrollbar">
                                    {['dhcp', 'arp', 'lldp', 'snmp', 'http', 'mqtt', 'rtsp', 'cloud', 'dns', 'ntp'].map(p => (
                                        <label
                                            key={p}
                                            className={cn(
                                                "px-2 py-1 rounded-md text-[10px] font-bold border cursor-pointer transition-all uppercase whitespace-nowrap shrink-0",
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
