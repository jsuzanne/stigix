import React, { useState, useEffect } from 'react';
import { Activity, Plus, Trash2, RefreshCw, Shield, Server, Wifi, Layout, CheckCircle, XCircle, AlertCircle, ChevronDown, ChevronRight, ChevronUp, Search, Monitor, Cpu, Zap, Clock, Terminal, MapPin, Globe, ExternalLink, Info, Settings, Edit2, Play, Download, Upload, Pause, Square, SkipBack, RotateCcw, PlayCircle, ArrowDownCircle, ArrowUpCircle, ShieldX, ShieldCheck, Eraser, Eye } from 'lucide-react';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import { isValidIpOrFqdn } from './utils/validation';
import { twMerge } from 'tailwind-merge';
import { clsx, type ClassValue } from 'clsx';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

const COMMAND_METADATA: Record<string, { label: string, icon: any, color: string, emoji: string }> = {
    'interface-down': { label: 'Shut', icon: ArrowDownCircle, color: 'text-red-500', emoji: '⬇️' },
    'interface-up': { label: 'No Shut', icon: ArrowUpCircle, color: 'text-green-500', emoji: '⬆️' },
    'set-qos': { label: 'Latency/Loss', icon: Activity, color: 'text-indigo-500', emoji: '〰️' },
    'clear-qos': { label: 'Clear Qos', icon: RotateCcw, color: 'text-blue-500', emoji: '🔄' },
    'deny-traffic': { label: 'Deny Traffic', icon: ShieldX, color: 'text-red-500', emoji: '🚫' },
    'allow-traffic': { label: 'Allow Traffic', icon: ShieldCheck, color: 'text-green-500', emoji: '✅' },
    'show-denied': { label: 'Show Denied', icon: Eye, color: 'text-blue-500', emoji: '📋' },
    'clear-all-blocks': { label: 'Clear All Blocks', icon: Eraser, color: 'text-amber-500', emoji: '🧹' },
};

function getCommandDisplayName(command: string): string {
    return COMMAND_METADATA[command]?.label || command;
}

function getCommandIcon(command: string, size: number = 16, className?: string) {
    const meta = COMMAND_METADATA[command];
    if (!meta) return <Activity size={size} className={className} />;
    const Icon = meta.icon;
    return <Icon size={size} className={cn(meta.color, className)} />;
}

// Format action parameters for clean display
function formatActionParameters(command: string, parameters: any): string {
    if (!parameters || Object.keys(parameters).length === 0) return '';

    switch (command) {
        case 'deny-traffic':
        case 'allow-traffic':
            return parameters.ip ? `IP: ${parameters.ip}` : '';
        case 'set-qos':
            const parts = [];
            if (parameters.latency) parts.push(`${parameters.latency}ms latency`);
            if (parameters.loss) parts.push(`${parameters.loss}% loss`);
            return parts.join(', ');
        default:
            return '';
    }
}

const socket = io();

export interface VyosRouterInterface {
    name: string;
    description: string | null;
    address: string[];
    status?: 'up' | 'down';
}

export interface VyosRouter {
    id: string;
    name: string;
    host: string;
    apiKey: string;
    version: string;
    location?: string;
    interfaces: VyosRouterInterface[];
    enabled: boolean;
    status: 'online' | 'offline' | 'unknown';
    lastSeen?: number;
}

export interface VyosAction {
    id: string;
    offset_minutes: number;
    router_id: string;
    interface: string;
    command: string;
    parameters?: any;
    status?: 'running' | 'success' | 'failed'; // NEW: Status for step tracking
    error?: string;                // NEW: Error message for step tracking
}

export interface VyosSequence {
    id: string;
    name: string;
    enabled: boolean;
    paused?: boolean;  // Paused state for running sequences
    executionMode: 'CYCLE' | 'STEP_BY_STEP'; // NEW: Execution mode
    currentStep?: number; // NEW: Pointer for Step-by-Step mode
    cycle_duration: number;
    actions: VyosAction[];
    lastRun?: number;
}

interface VyosProps {
    token: string;
}

function ActionSelector({ value, onChange }: { value: string, onChange: (val: string) => void }) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const options = [
        { id: 'interface-down', group: 'Interface' },
        { id: 'interface-up', group: 'Interface' },
        { id: 'set-qos', group: 'Interface' },
        { id: 'clear-qos', group: 'Interface' },
        { id: 'deny-traffic', group: 'Traffic Control' },
        { id: 'allow-traffic', group: 'Traffic Control' },
        { id: 'clear-all-blocks', group: 'Traffic Control' },
        { id: 'show-denied', group: 'Traffic Control' },
    ];

    return (
        <div className="relative" ref={containerRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-card border border-border/50 hover:border-purple-500/50 transition-all text-sm font-black uppercase tracking-tight"
            >
                {getCommandIcon(value, 16)}
                <span>{getCommandDisplayName(value)}</span>
                <ChevronDown size={14} className={cn("ml-2 transition-transform duration-300", isOpen ? "rotate-180" : "")} />
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 mt-2 w-72 min-w-[280px] bg-card/95 backdrop-blur-xl border border-border shadow-2xl z-[100] rounded-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    <div className="p-1 px-1.5 space-y-0.5 max-h-[400px] overflow-y-auto">
                        {['Interface', 'Traffic Control'].map(group => (
                            <div key={group} className="space-y-0.5 py-1">
                                <div className="px-3 py-1.5 text-[8px] font-black text-text-muted uppercase tracking-[0.2em] opacity-40">
                                    {group}
                                </div>
                                {options.filter(o => o.group === group).map(opt => (
                                    <button
                                        key={opt.id}
                                        type="button"
                                        onClick={() => {
                                            onChange(opt.id);
                                            setIsOpen(false);
                                        }}
                                        className={cn(
                                            "w-full flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all text-left",
                                            value === opt.id
                                                ? "bg-purple-500/10 text-purple-500"
                                                : "hover:bg-card-secondary text-text-secondary hover:text-text-primary"
                                        )}
                                    >
                                        <div className={cn(
                                            "p-1 rounded-lg border",
                                            value === opt.id ? "bg-card border-purple-500/20 shadow-sm" : "bg-card-secondary border-border/50"
                                        )}>
                                            {getCommandIcon(opt.id, 14)}
                                        </div>
                                        <span className="text-[11px] font-bold uppercase tracking-tight">{getCommandDisplayName(opt.id)}</span>
                                        {value === opt.id && <CheckCircle size={12} className="ml-auto" />}
                                    </button>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function Vyos(props: VyosProps) {
    const { token } = props;
    const [routers, setRouters] = useState<VyosRouter[]>([]);
    const [sequences, setSequences] = useState<VyosSequence[]>([]);
    const [history, setHistory] = useState<any[]>([]);
    const [view, setView] = useState<'routers' | 'sequences' | 'history' | 'timeline' | 'metrics'>('routers');
    const [historySearch, setHistorySearch] = useState('');
    const [historyMissionFilter, setHistoryMissionFilter] = useState('all');
    const [historyNodeFilter, setHistoryNodeFilter] = useState('all');
    const [historyStatusFilter, setHistoryStatusFilter] = useState('all');
    const [isGrouped, setIsGrouped] = useState(false);

    // Live Monitoring State
    const [activeExecution, setActiveExecution] = useState<{ sequenceId: string, step: string, status: string, error?: string } | null>(null);

    // Modals
    const [showAddModal, setShowAddModal] = useState(false);
    const [showSeqModal, setShowSeqModal] = useState(false);
    const [editingSeq, setEditingSeq] = useState<VyosSequence | null>(null);
    const [showEditRouterModal, setShowEditRouterModal] = useState(false);
    const [editingRouter, setEditingRouter] = useState<VyosRouter | null>(null);

    // Discovery Form
    const [discoveryHost, setDiscoveryHost] = useState('');
    const [discoveryKey, setDiscoveryKey] = useState('');
    const [discoveryLocation, setDiscoveryLocation] = useState('');
    const [discovering, setDiscovering] = useState(false);
    const [discoveryResult, setDiscoveryResult] = useState<VyosRouter | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showSettingsMenu, setShowSettingsMenu] = useState(false);

    // Confirmation Modal State
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        confirmText: string;
        onConfirm: () => void;
    }>({
        isOpen: false,
        title: '',
        message: '',
        confirmText: 'Confirm',
        onConfirm: () => { }
    });

    // Update countdowns when in timeline view
    useEffect(() => {
        if (view !== 'timeline') return;

        const interval = setInterval(() => {
            setView('timeline');
        }, 1000);

        return () => clearInterval(interval);
    }, [view]);

    const calculateMetrics = () => {
        const total = history.length;
        const successful = history.filter(h => h.status === 'success').length;
        const successRate = total > 0 ? ((successful / total) * 100).toFixed(1) : '0.0';

        const last24h = history.filter(h => Date.now() - h.timestamp < 86400000).length;
        const failedLastHour = history.filter(h =>
            h.status === 'failed' && Date.now() - h.timestamp < 3600000
        ).length;

        const routerCounts = history.reduce((acc, h) => {
            acc[h.router_id] = (acc[h.router_id] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const mostUsedRouterId = Object.keys(routerCounts).sort((a, b) =>
            routerCounts[b] - routerCounts[a]
        )[0];

        const mostUsedRouter = routers.find(r => r.id === mostUsedRouterId);

        return {
            total,
            successRate,
            last24h,
            activeSequences: sequences.filter(s => s.enabled).length,
            failedLastHour,
            mostUsedRouter: mostUsedRouter?.name || 'N/A'
        };
    };

    const metrics = calculateMetrics();

    const authHeaders = () => ({
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    });

    const fetchData = async () => {
        try {
            const [rRes, sRes, hRes] = await Promise.all([
                fetch('/api/vyos/routers', { headers: { 'Authorization': `Bearer ${token}` } }),
                fetch('/api/vyos/sequences', { headers: { 'Authorization': `Bearer ${token}` } }),
                fetch('/api/vyos/history', { headers: { 'Authorization': `Bearer ${token}` } })
            ]);

            const rData = await rRes.json();
            const sData = await sRes.json();
            const hData = await hRes.json();

            setRouters(Array.isArray(rData) ? rData : []);
            setSequences(Array.isArray(sData) ? sData : []);
            setHistory(Array.isArray(hData) ? hData : []);
        } catch (e) {
            console.error('Failed to fetch VyOS data');
        }
    };

    useEffect(() => {
        fetchData();

        socket.on('vyos:sequence_step', (data) => {
            setActiveExecution(data);
        });

        socket.on('vyos:sequence_completed', (_log) => {
            setActiveExecution(null);
            fetchData();
        });

        const interval = setInterval(fetchData, 60000); // Optimized: 60s instead of 10s
        return () => {
            socket.off('vyos:sequence_step');
            socket.off('vyos:sequence_completed');
            clearInterval(interval);
        };
    }, []);

    const startDiscovery = async () => {
        if (!discoveryHost || !discoveryKey) return;
        const toastId = toast.loading('Initiating router discovery scan...');
        setDiscovering(true);
        setDiscoveryResult(null);
        setError(null);
        try {
            const res = await fetch('/api/vyos/routers/discover', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ host: discoveryHost, apiKey: discoveryKey, location: discoveryLocation })
            });
            const data = await res.json();
            if (res.ok) {
                setDiscoveryResult(data.router);
                toast.success(`✓ Router ${data.router.name} discovered!`, { id: toastId });
            } else {
                const errMsg = data.error || 'Discovery failed';
                setError(errMsg);
                toast.error(`❌ ${errMsg}`, { id: toastId });
            }
        } catch (e: any) {
            setError('Network error during discovery');
            toast.error('❌ Network error during discovery', { id: toastId });
        } finally {
            setDiscovering(false);
        }
    };

    const saveRouter = async () => {
        if (!discoveryResult) return;
        // The router is already saved on discovery in this workflow
        setShowAddModal(false);
        resetDiscovery();
        fetchData();
        toast.success('✓ Router configuration deployed');
    };

    const editRouter = (router: VyosRouter) => {
        setEditingRouter(JSON.parse(JSON.stringify(router)));
        setShowEditRouterModal(true);
    };

    const saveRouterChanges = async () => {
        if (!editingRouter) return;
        const toastId = toast.loading('Syncing node parameters...');
        try {
            const res = await fetch(`/api/vyos/routers/${editingRouter.id}`, {
                method: 'POST', // Repurposing POST for update
                headers: authHeaders(),
                body: JSON.stringify(editingRouter)
            });
            if (res.ok) {
                toast.success('✓ Node parameters updated', { id: toastId });
                setShowEditRouterModal(false);
                fetchData();
            } else {
                toast.error('❌ Update failed', { id: toastId });
            }
        } catch (e) {
            toast.error('❌ Network error', { id: toastId });
        }
    };

    const deleteRouter = async (id: string) => {
        const router = routers.find(r => r.id === id);

        const performDeleteRouter = async (routerId: string) => {
            try {
                const res = await fetch(`/api/vyos/routers/${routerId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (res.ok) {
                    toast.success('✓ Router deleted');
                    fetchData();
                } else {
                    const data = await res.json();
                    toast.error(`❌ ${data.error || 'Failed to delete router'}`);
                }
            } catch (e: any) {
                toast.error(`❌ Network error: ${e.message}`);
            }
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
        };

        setConfirmModal({
            isOpen: true,
            title: 'Remove vyos router',
            message: `Are you sure you want to delete ${router?.name || 'this router'}? All associated sequences will be affected. This action cannot be undone.`,
            confirmText: 'Remove vyos router',
            onConfirm: () => performDeleteRouter(router?.id || id)
        });
    };

    const testRouter = async (id: string) => {
        const toastId = toast.loading('Testing connection...');
        try {
            const res = await fetch(`/api/vyos/routers/test/${id}`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            if (data.success) {
                toast.success('✓ Connection successful!', { id: toastId });
            } else {
                toast.error(`❌ Connection failed: ${data.status}`, { id: toastId });
            }
            fetchData();
        } catch (e: any) {
            toast.error(`❌ Error: ${e.message}`, { id: toastId });
        }
    };

    const refreshRouterInfo = async (id: string) => {
        const toastId = toast.loading('Refreshing node info...');
        try {
            const res = await fetch(`/api/vyos/routers/refresh/${id}`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            if (data.success) {
                toast.success('✓ Node information updated (interfaces, version, hostname)', { id: toastId });
                fetchData();
            } else {
                toast.error(`❌ Refresh failed: ${data.error}`, { id: toastId });
            }
        } catch (e: any) {
            toast.error(`❌ Error: ${e.message}`, { id: toastId });
        }
    };

    const runSequence = async (id: string) => {
        // Validate sequence is enabled
        const sequence = sequences.find(s => s.id === id);
        if (!sequence) {
            toast.error('❌ Sequence not found');
            return;
        }
        if (!sequence.enabled) {
            toast.error('❌ Cannot run disabled sequence. Enable it first.');
            return;
        }

        const toastId = toast.loading('Starting sequence...');
        try {
            const res = await fetch(`/api/vyos/sequences/run/${id}`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                toast.success('✓ Mission sequence initiated', { id: toastId });
            } else {
                toast.error('❌ Failed to start sequence', { id: toastId });
            }
            fetchData();
        } catch (e) {
            toast.error('❌ Network error starting sequence', { id: toastId });
        }
    };

    const deleteSequence = async (id: string) => {
        const sequence = sequences.find(s => s.id === id);

        setConfirmModal({
            isOpen: true,
            title: 'Delete Sequence',
            message: `Are you sure you want to delete "${sequence?.name || 'this sequence'}"? This action cannot be undone.`,
            confirmText: 'Delete Sequence',
            onConfirm: async () => {
                try {
                    await fetch(`/api/vyos/sequences/${id}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    toast.success('✓ Sequence deleted');
                    fetchData();
                } catch (e) {
                    toast.error('Failed to delete sequence');
                }
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
            }
        });
    };

    const openSeqModal = (seq?: VyosSequence) => {
        setEditingSeq(seq ? JSON.parse(JSON.stringify(seq)) : {
            id: `seq-${Date.now()}`,
            name: '',
            enabled: true,
            executionMode: 'CYCLE',
            currentStep: 0,
            cycle_duration: 0,  // Default to Manual Trigger Only
            actions: []
        });
        setShowSeqModal(true);
    };

    const saveSequence = async () => {
        if (!editingSeq) return;

        // NEW: Validate firewall commands
        for (const action of editingSeq.actions) {
            if (action.command === 'deny-traffic' || action.command === 'allow-traffic') {
                if (!action.parameters?.ip) {
                    toast.error(`IP address or subnet is required for ${action.command}`);
                    return;
                }

                // Validate CIDR format
                const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
                if (!cidrRegex.test(action.parameters.ip)) {
                    toast.error(`Invalid IP format for ${action.command}. Use CIDR notation (e.g., 8.8.8.8/32)`);
                    return;
                }

                // Validate IP octets (0-255)
                const octets = action.parameters.ip.split('/')[0].split('.');
                if (octets.some((o: string) => parseInt(o) > 255 || parseInt(o) < 0)) {
                    toast.error(`Invalid IP address in ${action.command}. Each octet must be 0-255`);
                    return;
                }

                // Validate CIDR mask (0-32)
                if (action.parameters.ip.includes('/')) {
                    const mask = parseInt(action.parameters.ip.split('/')[1]);
                    if (mask < 0 || mask > 32) {
                        toast.error(`Invalid subnet mask in ${action.command}. Must be 0-32`);
                        return;
                    }
                }
            }
        }

        const toastId = toast.loading('Saving mission ...');
        try {
            const res = await fetch('/api/vyos/sequences', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify(editingSeq)
            });
            if (res.ok) {
                fetchData();
                setShowSeqModal(false);
                toast.success('✓ Mission saved', { id: toastId });
            } else {
                toast.error('❌ Failed to save ', { id: toastId });
            }
        } catch (e) {
            toast.error('❌ Network error saving ', { id: toastId });
        }
    };

    const resetDiscovery = () => {
        setDiscoveryHost('');
        setDiscoveryKey('');
        setDiscoveryLocation('');
        setDiscoveryResult(null);
        setError(null);
    };

    const exportSequences = async () => {
        const toastId = toast.loading('Exporting sequences...');
        try {
            const data = {
                version: "1.0",
                exported_at: new Date().toISOString(),
                sequences: sequences.map(seq => ({
                    name: seq.name,
                    enabled: seq.enabled,
                    cycle_duration: seq.cycle_duration,
                    actions: seq.actions.map(action => ({
                        offset_minutes: action.offset_minutes,
                        router_id: action.router_id,
                        interface: action.interface,
                        command: action.command,
                        parameters: action.parameters,
                        comment: action.parameters?.comment || ''
                    }))
                }))
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `vyos-sequences-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success('✓ Sequences exported', { id: toastId });
        } catch (e: any) {
            toast.error(`❌ Export failed: ${e.message}`, { id: toastId });
        }
    };

    const importSequences = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const toastId = toast.loading('Importing sequences...');
        try {
            const text = await file.text();
            const data = JSON.parse(text);

            if (!data.sequences || !Array.isArray(data.sequences)) {
                throw new Error('Invalid JSON format: missing sequences array');
            }

            let imported = 0;
            for (const seq of data.sequences) {
                const newSeq = {
                    id: `seq-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    name: seq.name || 'Imported Sequence',
                    enabled: seq.enabled ?? true,
                    cycle_duration: seq.cycle_duration || 0,
                    actions: seq.actions || []
                };

                const res = await fetch('/api/vyos/sequences', {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify(newSeq)
                });

                if (res.ok) imported++;
            }

            fetchData();
            toast.success(`✓ Imported ${imported} sequence(s)`, { id: toastId });
        } catch (e: any) {
            toast.error(`❌ Import failed: ${e.message}`, { id: toastId });
        }

        // Reset file input
        event.target.value = '';
    };

    const exportUnifiedConfig = async () => {
        const toastId = toast.loading('Exporting VyOS configuration...');
        try {
            const res = await fetch('/api/vyos/config/export', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (!res.ok) throw new Error('Export failed');

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `vyos-config-full-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success('✓ Configuration exported', { id: toastId });
        } catch (e: any) {
            toast.error(`❌ Export failed: ${e.message}`, { id: toastId });
        }
        setShowSettingsMenu(false);
    };

    const importUnifiedConfig = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const toastId = toast.loading('Importing VyOS configuration...');
        try {
            const text = await file.text();
            const data = JSON.parse(text);

            const res = await fetch('/api/vyos/config/import', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Import failed');
            }

            fetchData();
            toast.success('✓ Configuration imported successfully', { id: toastId });
        } catch (e: any) {
            toast.error(`❌ Import failed: ${e.message}`, { id: toastId });
        }

        setShowSettingsMenu(false);
        // Reset file input
        event.target.value = '';
    };

    const resetUnifiedConfig = async () => {
        setConfirmModal({
            isOpen: true,
            title: 'Factory Reset VyOS Configuration',
            message: 'This will delete ALL routers and sequences. This action cannot be undone. Are you sure?',
            confirmText: 'YES, RESET ALL',
            onConfirm: async () => {
                const toastId = toast.loading('Resetting configuration...');
                try {
                    const res = await fetch('/api/vyos/config/reset', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    });

                    if (!res.ok) throw new Error('Reset failed');

                    fetchData();
                    toast.success('✓ Configuration reset successfully', { id: toastId });
                } catch (e: any) {
                    toast.error(`❌ Reset failed: ${e.message}`, { id: toastId });
                }
                setShowSettingsMenu(false);
            }
        });
    };

    const toggleSequenceEnabled = async (seq: VyosSequence) => {
        const toastId = toast.loading(seq.enabled ? 'Disabling sequence...' : 'Enabling sequence...');
        try {
            const updatedSeq = { ...seq, enabled: !seq.enabled };
            const res = await fetch('/api/vyos/sequences', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify(updatedSeq)
            });
            if (res.ok) {
                fetchData();
                toast.success(`✓ Sequence ${updatedSeq.enabled ? 'enabled' : 'disabled'}`, { id: toastId });
            } else {
                toast.error('❌ Failed to update sequence', { id: toastId });
            }
        } catch (e) {
            toast.error('❌ Network error', { id: toastId });
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-20">
            {/* Live Indicator Overlay */}
            {activeExecution && (
                <div className="fixed top-24 right-8 z-[100] animate-in slide-in-from-right-8 fade-in flex items-center gap-4 bg-purple-900/40 border border-purple-500/50 backdrop-blur-md px-6 py-4 rounded-2xl shadow-2xl shadow-purple-900/50">
                    <div className="relative">
                        <Zap size={24} className="text-purple-400 animate-pulse" />
                        <div className="absolute inset-0 bg-purple-400 rounded-full animate-ping opacity-20" />
                    </div>
                    <div>
                        <h4 className="text-xs font-black text-white tracking-tighter">Sequence In Progress</h4>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-purple-200 font-mono bg-purple-500/20 px-1.5 rounded">{activeExecution.step}</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Header / Nav */}
            <div className="bg-card border border-border p-6 rounded-2xl shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-purple-600/10 rounded-xl">
                            <Shield size={24} className="text-purple-500" />
                        </div>
                        <div className="relative">
                            <div className="flex items-center gap-3">
                                <h2 className="text-2xl font-black text-text-primary tracking-tight">VyOS Control</h2>
                                <button
                                    onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                                    className="p-1.5 text-text-muted hover:text-text-primary hover:bg-card-hover rounded-lg transition-all"
                                    title="Configuration Settings"
                                >
                                    <Settings size={20} className={cn("transition-transform duration-300", showSettingsMenu && "rotate-90 text-purple-500")} />
                                </button>

                                {showSettingsMenu && (
                                    <div className="absolute top-full left-0 mt-2 w-64 bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-left">
                                        <div className="p-3 border-b border-border bg-card-hover/50">
                                            <h4 className="text-[10px] font-black text-text-muted tracking-widest">Global Configuration</h4>
                                        </div>
                                        <div className="p-1">
                                            <button
                                                onClick={exportUnifiedConfig}
                                                className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold text-text-secondary hover:text-white hover:bg-green-600/20 rounded-lg transition-colors group"
                                            >
                                                <Download size={16} className="text-green-500 group-hover:scale-110 transition-transform" />
                                                EXPORT FULL CONFIG
                                            </button>
                                            <label className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold text-text-secondary hover:text-white hover:bg-blue-600/20 rounded-lg transition-colors group cursor-pointer">
                                                <Upload size={16} className="text-blue-500 group-hover:scale-110 transition-transform" />
                                                IMPORT FULL CONFIG
                                                <input
                                                    type="file"
                                                    accept=".json"
                                                    onChange={importUnifiedConfig}
                                                    className="hidden"
                                                />
                                            </label>
                                            <div className="h-px bg-border my-1 mx-2" />
                                            <button
                                                onClick={resetUnifiedConfig}
                                                className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold text-red-500 hover:text-white hover:bg-red-600/20 rounded-lg transition-colors group"
                                            >
                                                <AlertCircle size={16} className="text-red-500 group-hover:scale-110 transition-transform" />
                                                FACTORY RESET ALL
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center gap-4 mt-1">
                                <button onClick={() => setView('routers')} className={`text-xs font-bold tracking-wider transition-colors ${view === 'routers' ? 'text-blue-500 border-b-2 border-blue-500 pb-1' : 'text-text-muted hover:text-text-secondary'}`}>Routers</button>
                                <button onClick={() => setView('sequences')} className={`text-xs font-bold tracking-wider transition-colors ${view === 'sequences' ? 'text-purple-500 border-b-2 border-purple-500 pb-1' : 'text-text-muted hover:text-text-secondary'}`}>Sequences</button>
                                <button onClick={() => setView('history')} className={`text-xs font-bold tracking-wider transition-colors ${view === 'history' ? 'text-green-500 border-b-2 border-green-500 pb-1' : 'text-text-muted hover:text-text-secondary'}`}>History</button>
                                <button onClick={() => setView('timeline')} className={`text-xs font-bold tracking-wider transition-colors ${view === 'timeline' ? 'text-purple-500 border-b-2 border-purple-500 pb-1' : 'text-text-muted hover:text-text-secondary'}`}>Timeline</button>
                                <button onClick={() => setView('metrics')} className={`text-xs font-bold tracking-wider transition-colors ${view === 'metrics' ? 'text-orange-500 border-b-2 border-orange-500 pb-1' : 'text-text-muted hover:text-text-secondary'}`}>Metrics</button>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {view === 'routers' && (
                            <button
                                onClick={() => setShowAddModal(true)}
                                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold transition-all shadow-lg shadow-blue-900/20"
                            >
                                <Wifi size={18} /> Discover Router
                            </button>
                        )}
                        {view === 'sequences' && (
                            <button
                                onClick={() => openSeqModal()}
                                className="flex items-center gap-2 px-6 py-2.5 bg-purple-600/10 hover:bg-purple-600/20 text-purple-500 rounded-lg font-bold transition-all border border-purple-500/20"
                            >
                                <Plus size={18} /> New Sequence
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* View Content */}
            {view === 'routers' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in slide-in-from-bottom-4 duration-300">
                    {routers.map((router) => (
                        <div key={router.id} className="bg-card border border-border rounded-2xl overflow-hidden group hover:border-blue-500/30 transition-all flex flex-col shadow-sm hover:shadow-md">
                            <div className="p-6 border-b border-border/50 flex items-start justify-between bg-card-secondary/30">
                                <div className="flex items-center gap-4">
                                    <div className={`p-3 rounded-xl ${router.status === 'online' ? 'bg-green-500/5' : 'bg-red-500/5'} border border-transparent group-hover:border-border transition-colors`}>
                                        <Server size={22} className={router.status === 'online' ? 'text-green-500' : 'text-red-500'} />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-text-primary tracking-tight text-lg">{router.name}</h4>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-text-muted font-mono bg-card-secondary px-1.5 py-0.5 rounded border border-border/50">{router.host}</span>
                                            {router.location && (
                                                <span className="text-[9px] text-text-secondary font-bold uppercase flex items-center gap-1">
                                                    <MapPin size={8} /> {router.location}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                    <div className={`px-2 py-0.5 rounded text-[9px] font-black tracking-tighter border ${router.status === 'online' ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'}`}>
                                        {router.status}
                                    </div>
                                    {/* Last Seen Indicator */}
                                    {router.lastSeen && (
                                        <div className="flex items-center gap-1.5 text-[9px] text-text-muted">
                                            <Clock size={10} />
                                            <span>
                                                Checked {Math.floor((Date.now() - router.lastSeen) / 60000)}m ago
                                            </span>
                                        </div>
                                    )}

                                    {/* Offline Warning */}
                                    {router.status === 'offline' && router.lastSeen && (Date.now() - router.lastSeen) > 300000 && (
                                        <div className="text-[9px] text-red-500 dark:text-red-400 bg-red-500/10 px-2 py-1 rounded border border-red-500/20 animate-pulse">
                                            ⚠️ Offline for {Math.floor((Date.now() - router.lastSeen) / 60000)}m
                                        </div>
                                    )}
                                    <div className="text-[10px] text-text-muted font-mono font-bold uppercase">ID: {router.id}</div>
                                </div>
                            </div>

                            <div className="p-6 flex-1 space-y-5">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-text-muted uppercase font-black tracking-widest pl-1">VyOS Node Info</span>
                                    <span className="text-[10px] text-text-secondary font-mono bg-card-secondary px-2 py-0.5 rounded border border-border/50">v{router.version}</span>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex items-center justify-between text-[10px] mb-1">
                                        <span className="text-text-muted uppercase font-black tracking-widest pl-1">Network Interfaces</span>
                                        <span className="text-blue-500 font-black">{router.interfaces.length} DETECTED</span>
                                    </div>
                                    <div className="space-y-2 max-h-[120px] overflow-y-auto pr-2 custom-scrollbar group/list">
                                        {router.interfaces.map((iface) => (
                                            <div key={iface.name} className="flex flex-col p-3 bg-card-secondary/50 border border-border/50 rounded-xl hover:border-blue-500/30 transition-all group/iface">
                                                <div className="flex items-center justify-between mb-1">
                                                    <div className="flex items-center gap-2">
                                                        <div className={cn(
                                                            "w-1.5 h-1.5 rounded-full",
                                                            iface.status === 'up' ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]"
                                                        )} />
                                                        <span className="text-[11px] text-text-primary font-extrabold uppercase tracking-tight">{iface.name}</span>
                                                    </div>
                                                    <span className="text-[10px] text-text-muted font-mono bg-card px-1.5 py-0.5 rounded border border-border/50">{iface.address?.[0] || 'no-ip'}</span>
                                                </div>
                                                {iface.description && (
                                                    <div className="text-[10px] text-blue-500 font-bold uppercase tracking-tighter pl-3.5">
                                                        {iface.description}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="px-6 py-4 bg-card-secondary/30 border-t border-border/50 flex items-center justify-between">
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => testRouter(router.id)}
                                        className="p-2 bg-card-secondary hover:bg-blue-600/10 text-text-muted hover:text-blue-500 rounded-lg transition-all border border-border/50"
                                        title="Test Connectivity"
                                    >
                                        <Zap size={16} />
                                    </button>
                                    <button
                                        className="p-2 bg-card-secondary hover:bg-purple-600/10 text-text-muted hover:text-purple-500 rounded-lg transition-all border border-border/50"
                                        title="Refresh Info"
                                        onClick={() => refreshRouterInfo(router.id)}
                                    >
                                        <RefreshCw size={16} />
                                    </button>
                                    <button
                                        onClick={() => editRouter(router)}
                                        className="p-2 bg-card-secondary hover:bg-orange-600/10 text-text-muted hover:text-orange-500 rounded-lg transition-all border border-border/50"
                                        title="Edit Node"
                                    >
                                        <Edit2 size={16} />
                                    </button>
                                </div>
                                <button
                                    onClick={() => deleteRouter(router.id)}
                                    className="p-2 text-text-muted/40 hover:text-red-500 transition-colors"
                                    title="Revoke Router"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    ))}
                    {routers.length === 0 && (
                        <div className="col-span-full py-20 flex flex-col items-center justify-center bg-card border border-dashed border-border rounded-3xl text-text-muted shadow-inner">
                            <Monitor size={64} className="mb-6 opacity-10" />
                            <p className="text-lg font-bold uppercase tracking-[0.2em] opacity-40">Tactical Node Map Empty</p>
                            <p className="text-sm mt-2 opacity-30">Initiate router discovery to begin impairment testing.</p>
                        </div>
                    )}
                </div>
            )}

            {view === 'sequences' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4 animate-in slide-in-from-bottom-4 duration-300">
                    {sequences.map((seq) => (
                        <div key={seq.id} className="bg-card border border-border rounded-xl p-4 hover:border-purple-500/40 transition-all flex flex-col gap-3 shadow-sm hover:shadow-md group">
                            {/* Header: Title and Tools */}
                            <div className="flex justify-between items-start">
                                <div className="flex flex-col min-w-0">
                                    <h3 className="text-sm font-black text-text-primary tracking-tight truncate pr-2">
                                        {seq.name}
                                    </h3>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className={cn(
                                            "flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md border transition-colors",
                                            seq.executionMode === 'STEP_BY_STEP'
                                                ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
                                                : seq.cycle_duration > 0
                                                    ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                                                    : "bg-card-secondary text-text-muted border-border"
                                        )}>
                                            {seq.executionMode === 'STEP_BY_STEP' ? <Terminal size={10} /> : <Clock size={10} />}
                                            {seq.executionMode === 'STEP_BY_STEP' ? 'STEP-BY-STEP' : seq.cycle_duration > 0 ? `${seq.cycle_duration}M CRON` : 'MANUAL'}
                                        </span>
                                        <span className="text-[10px] text-text-muted font-mono opacity-50">#{seq.id.split('-').pop()?.slice(-4)}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {/* Enable/Disable Toggle */}
                                    <button
                                        onClick={() => toggleSequenceEnabled(seq)}
                                        className={cn(
                                            "relative w-10 h-5 rounded-full transition-all duration-300 border-2",
                                            seq.enabled
                                                ? "bg-green-500 border-green-600"
                                                : "bg-gray-700 border-gray-600"
                                        )}
                                        title={seq.enabled ? "Disable sequence" : "Enable sequence"}
                                    >
                                        <div className={cn(
                                            "absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform duration-300",
                                            seq.enabled ? "translate-x-5" : "translate-x-0.5"
                                        )} />
                                    </button>
                                    <button onClick={() => openSeqModal(seq)} className="p-1.5 text-text-muted hover:text-blue-500 hover:bg-blue-500/5 rounded-md transition-all">
                                        <Edit2 size={14} />
                                    </button>
                                    <button onClick={() => deleteSequence(seq.id)} className="p-1.5 text-text-muted hover:text-red-500 hover:bg-red-500/5 rounded-md transition-all">
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>

                            {/* Dense Stats Row */}
                            <div className="grid grid-cols-2 gap-2 py-2 border-y border-border/50">
                                <div className="flex flex-col">
                                    <label className="text-[9px] font-black text-text-muted uppercase tracking-widest opacity-60">Operations</label>
                                    <div className="flex items-center gap-2">
                                        {seq.actions.length === 1 && (
                                            <div className="p-1 bg-card rounded border border-border/50">
                                                {getCommandIcon(seq.actions[0].command, 12)}
                                            </div>
                                        )}
                                        <span className="text-xs font-bold text-text-primary uppercase tracking-tighter">
                                            {seq.actions.length === 1
                                                ? getCommandDisplayName(seq.actions[0].command)
                                                : `${seq.actions.length} commands`
                                            }
                                        </span>
                                    </div>
                                </div>
                                <div className="flex flex-col">
                                    <label className="text-[9px] font-black text-text-muted uppercase tracking-widest opacity-60">Deployment</label>
                                    <span className="text-xs font-bold text-text-primary uppercase tracking-tighter">{seq.enabled ? 'Enabled' : 'Staged'}</span>
                                </div>
                            </div>

                            {/* Target Preview - Compact */}
                            <div className="flex items-center gap-2 overflow-hidden">
                                <Server size={12} className="text-text-muted flex-shrink-0 opacity-50" />
                                <div className="flex gap-1.5 truncate">
                                    {seq.actions.slice(0, 2).map((a, i) => {
                                        const router = routers.find(r => r.id === a.router_id);
                                        const paramDisplay = formatActionParameters(a.command, a.parameters);
                                        return (
                                            <span key={i} className="text-[10px] bg-card-secondary/80 text-text-secondary px-2 py-0.5 rounded border border-border/50 whitespace-nowrap font-mono tracking-tighter">
                                                {paramDisplay ? (
                                                    <>{paramDisplay} on {router?.name || '?'}</>
                                                ) : (
                                                    <>
                                                        {router?.name || '?'}
                                                        {!['deny-traffic', 'allow-traffic', 'clear-all-blocks', 'show-denied'].includes(a.command) && `:${a.interface}`}
                                                    </>
                                                )}
                                            </span>
                                        );
                                    })}
                                    {seq.actions.length > 2 && (
                                        <span className="text-[9px] text-text-muted font-black uppercase tracking-tighter self-center">+{seq.actions.length - 2}</span>
                                    )}
                                </div>
                            </div>

                            {/* Footer: Status & Execution */}
                            <div className="flex items-center justify-between mt-auto pt-2">
                                <div className="flex items-center gap-2.5">
                                    <div className={cn(
                                        "w-2 h-2 rounded-full ring-2 ring-offset-2 ring-offset-card transition-all duration-500",
                                        activeExecution?.sequenceId === seq.id
                                            ? "bg-green-500 ring-green-500/30 animate-pulse"
                                            : seq.enabled ? "bg-blue-500 ring-blue-500/20" : "bg-zinc-700 ring-transparent"
                                    )} />
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-black text-text-primary uppercase tracking-tighter leading-none">
                                            {seq.cycle_duration > 0
                                                ? (seq.lastRun ? new Date(seq.lastRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Scheduled')
                                                : (seq.lastRun ? new Date(seq.lastRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Ready')
                                            }
                                        </span>
                                        <span className="text-[8px] text-text-muted font-bold uppercase tracking-widest mt-0.5 opacity-60">
                                            {seq.executionMode === 'STEP_BY_STEP' ? 'Interactive Mode' : seq.cycle_duration > 0 ? 'Last Pulse' : 'Manual Trigger'}
                                        </span>
                                    </div>
                                </div>

                                <button
                                    onClick={() => {
                                        if (seq.executionMode === 'STEP_BY_STEP') {
                                            setView('timeline');
                                        } else {
                                            runSequence(seq.id);
                                        }
                                    }}
                                    disabled={activeExecution !== null}
                                    className={cn(
                                        "flex items-center gap-2 px-4 py-2 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all shadow-sm active:scale-95 disabled:opacity-30 disabled:grayscale",
                                        activeExecution?.sequenceId === seq.id
                                            ? "bg-card-secondary text-text-muted cursor-not-allowed"
                                            : seq.executionMode === 'STEP_BY_STEP'
                                                ? "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30"
                                                : "bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/30"
                                    )}
                                >
                                    {activeExecution?.sequenceId === seq.id ? (
                                        <Activity size={14} className="animate-spin text-purple-400" />
                                    ) : (
                                        seq.executionMode === 'STEP_BY_STEP' ? <ChevronRight size={14} /> : <Play size={14} fill="currentColor" />
                                    )}
                                    {seq.executionMode === 'STEP_BY_STEP' ? 'Open Steps' : 'Run'}
                                </button>
                            </div>
                        </div>
                    ))}
                    {sequences.length === 0 && (
                        <div className="col-span-full py-20 flex flex-col items-center justify-center bg-card border border-dashed border-border rounded-3xl text-text-muted text-center shadow-inner">
                            <Terminal size={64} className="mb-6 opacity-10" />
                            <p className="text-lg font-bold uppercase tracking-[0.2em] opacity-40">Impairment Engine Standby</p>
                            <p className="text-sm mt-2 opacity-30 max-w-sm">No action loops programmed. Design a sequence to automate network failure testing.</p>
                        </div>
                    )}
                </div>
            )}

            {view === 'history' && (
                <div className="space-y-4">
                    {/* Tactical Filter Bar */}
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-3 bg-card border border-border p-4 rounded-2xl shadow-sm">
                        <div className="md:col-span-2 relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={14} />
                            <input
                                type="text"
                                placeholder="Search Mission, Node, or Command..."
                                value={historySearch}
                                onChange={(e) => setHistorySearch(e.target.value)}
                                className="w-full bg-card-secondary border border-border rounded-xl pl-9 pr-4 py-2.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-green-500/50 font-bold placeholder:text-text-muted/50 uppercase tracking-tight transition-all"
                            />
                        </div>
                        <select
                            value={historyMissionFilter}
                            onChange={(e) => setHistoryMissionFilter(e.target.value)}
                            className="bg-card-secondary border border-border rounded-xl px-4 py-2.5 text-xs text-text-secondary focus:outline-none font-bold uppercase cursor-pointer transition-all hover:border-text-muted/30"
                        >
                            <option value="all">ANY MISSION</option>
                            {[...new Set(history.map(h => h.sequence_name))].map(name => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                        <select
                            value={historyNodeFilter}
                            onChange={(e) => setHistoryNodeFilter(e.target.value)}
                            className="bg-card-secondary border border-border rounded-xl px-4 py-2.5 text-xs text-text-secondary focus:outline-none font-bold uppercase cursor-pointer transition-all hover:border-text-muted/30"
                        >
                            <option value="all">ANY NODE</option>
                            {[...new Set(history.map(h => h.router_id))].map(id => (
                                <option key={id} value={id}>{id}</option>
                            ))}
                        </select>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setIsGrouped(!isGrouped)}
                                className={`flex-1 px-4 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${isGrouped ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20' : 'bg-card-secondary text-text-muted border-border hover:border-text-muted/30'}`}
                            >
                                Group Runs
                            </button>
                        </div>
                    </div>

                    <div className="bg-card border border-border rounded-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-300 shadow-sm">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead className="bg-card-secondary/80 border-b border-border sticky top-0">
                                <tr>
                                    <th className="px-6 py-5 font-black text-text-muted uppercase tracking-[0.2em]">Execution Time</th>
                                    <th className="px-6 py-5 font-black text-text-muted uppercase tracking-[0.2em]">Mission Type</th>
                                    <th className="px-6 py-5 font-black text-text-muted uppercase tracking-[0.2em]">Target Node</th>
                                    <th className="px-6 py-5 font-black text-text-muted uppercase tracking-[0.2em]">Objective</th>
                                    <th className="px-6 py-5 font-black text-text-muted uppercase tracking-[0.2em] text-center">Verdict</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {(() => {
                                    let filtered = history.filter(log => {
                                        const matchesSearch = !historySearch ||
                                            log.sequence_name.toLowerCase().includes(historySearch.toLowerCase()) ||
                                            log.router_id.toLowerCase().includes(historySearch.toLowerCase()) ||
                                            log.command.toLowerCase().includes(historySearch.toLowerCase());
                                        const matchesMission = historyMissionFilter === 'all' || log.sequence_name === historyMissionFilter;
                                        const matchesNode = historyNodeFilter === 'all' || log.router_id === historyNodeFilter;
                                        const matchesStatus = historyStatusFilter === 'all' || log.status === historyStatusFilter;
                                        return matchesSearch && matchesMission && matchesNode && matchesStatus;
                                    });

                                    if (isGrouped) {
                                        // Grouping logic: Actions within 5 seconds with same sequence_id are grouped
                                        const groups: any[][] = [];
                                        filtered.forEach(log => {
                                            const lastGroup = groups[groups.length - 1];
                                            if (lastGroup &&
                                                lastGroup[0].sequence_id === log.sequence_id &&
                                                Math.abs(lastGroup[0].timestamp - log.timestamp) < 5000) {
                                                lastGroup.push(log);
                                            } else {
                                                groups.push([log]);
                                            }
                                        });

                                        return groups.map((group, gIdx) => (
                                            <React.Fragment key={gIdx}>
                                                <tr className="bg-background/40">
                                                    <td colSpan={5} className="px-6 py-2 border-b border-border/30">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-[9px] font-black text-text-muted uppercase tracking-[0.2em]">Run Sequence: {group[0].sequence_name}</span>
                                                            <div className="h-px flex-1 bg-border/20" />
                                                            <span className="text-[9px] font-mono text-text-muted/60">{new Date(group[0].timestamp).toLocaleString()}</span>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {group.map((log, idx) => (
                                                    <tr key={`${gIdx}-${idx}`} className="hover:bg-card-secondary/30 transition-colors group">
                                                        <td className="px-6 py-4 pl-12 border-l-2 border-border/50">
                                                            <div className="text-text-muted font-mono font-bold text-xs tracking-tight">{new Date(log.timestamp).toLocaleTimeString()}</div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <div className="flex items-center gap-2">
                                                                <div className="p-1 bg-card rounded border border-border/50">
                                                                    {getCommandIcon(log.command, 12)}
                                                                </div>
                                                                <div className="flex flex-col">
                                                                    <div className="p-1 px-2 bg-card-secondary rounded font-black text-[9px] uppercase tracking-tighter text-text-muted">Step {idx + 1}</div>
                                                                    {(() => {
                                                                        const seq = sequences.find(s => s.id === log.sequence_id);
                                                                        const action = seq?.actions.find(a => a.id === log.action_id);
                                                                        if (action && seq && seq.cycle_duration > 0) {
                                                                            return <span className="text-[8px] text-purple-500 font-black mt-0.5">T+{action.offset_minutes}M</span>;
                                                                        }
                                                                        return null;
                                                                    })()}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <div className="flex flex-col">
                                                                <span className="text-text-secondary font-bold uppercase text-[10px]">{log.router_id}</span>
                                                                {!['simple-block', 'simple-unblock', 'clear-blocks', 'get-blocks'].includes(log.command) && (
                                                                    <span className="text-[9px] text-text-muted/60 font-mono">{log.interface || 'global'}</span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <div className="flex items-center gap-2">
                                                                <span className="px-2 py-0.5 bg-card-secondary rounded text-text-secondary font-black uppercase text-[9px] tracking-widest border border-border/50">{log.command}</span>
                                                                {(() => {
                                                                    const paramDisplay = formatActionParameters(log.command, log.parameters);
                                                                    return paramDisplay ? (
                                                                        <span className="text-[9px] text-blue-400 font-mono">{paramDisplay}</span>
                                                                    ) : null;
                                                                })()}
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4 text-center">
                                                            <div className="flex justify-center">
                                                                <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-[9px] font-black uppercase tracking-widest ${log.status === 'success' ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'}`}>
                                                                    {log.status === 'success' ? <CheckCircle size={10} /> : <AlertCircle size={10} />}
                                                                    {log.status}
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </React.Fragment>
                                        ));
                                    }

                                    return filtered.map((log, idx) => (
                                        <tr key={idx} className="hover:bg-card-secondary transition-colors group">
                                            <td className="px-6 py-5">
                                                <div className="text-text-primary font-mono font-bold text-sm tracking-tight">{new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                                                <div className="text-[9px] text-text-muted font-black uppercase tracking-tighter mt-1">{new Date(log.timestamp).toLocaleDateString()}</div>
                                            </td>
                                            <td className="px-6 py-5">
                                                <div className="flex items-center gap-3">
                                                    <div className="p-1.5 bg-purple-500/10 rounded-lg">
                                                        {getCommandIcon(log.command, 14)}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="text-text-primary font-black uppercase tracking-tight">{log.sequence_name}</span>
                                                        {(() => {
                                                            const seq = sequences.find(s => s.id === log.sequence_id);
                                                            const action = seq?.actions.find(a => a.id === log.action_id);
                                                            if (action && seq && seq.cycle_duration > 0) {
                                                                return <span className="text-[9px] text-purple-500 font-black uppercase">T+{action.offset_minutes}m offset</span>;
                                                            }
                                                            return null;
                                                        })()}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-5">
                                                <div className="flex flex-col">
                                                    <span className="text-text-secondary font-bold uppercase text-[10px]">{log.router_id}</span>
                                                    {!['simple-block', 'simple-unblock', 'clear-blocks', 'get-blocks'].includes(log.command) && (
                                                        <span className="text-[9px] text-text-muted/60 font-mono">{log.interface || 'global'}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-5">
                                                <div className="flex items-center gap-2">
                                                    <span className="px-2 py-0.5 bg-card-secondary rounded text-text-secondary font-black uppercase text-[9px] tracking-widest border border-border/50">{log.command}</span>
                                                    {(() => {
                                                        const paramDisplay = formatActionParameters(log.command, log.parameters);
                                                        return paramDisplay ? (
                                                            <span className="text-[9px] text-blue-400 font-mono">{paramDisplay}</span>
                                                        ) : null;
                                                    })()}
                                                </div>
                                            </td>
                                            <td className="px-6 py-5 text-center">
                                                <div className="flex justify-center">
                                                    <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-[9px] font-black uppercase tracking-widest ${log.status === 'success' ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'}`}>
                                                        {log.status === 'success' ? <CheckCircle size={10} /> : <AlertCircle size={10} />}
                                                        {log.status}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    ));
                                })()}
                                {history.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-28 text-center">
                                            <div className="flex flex-col items-center gap-4 opacity-10">
                                                <Clock size={64} className="text-text-muted" />
                                                <span className="text-lg font-black uppercase tracking-[0.4em] text-text-muted">Chronicle Database Empty</span>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            {view === 'timeline' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in slide-in-from-bottom-4 duration-300">
                    <div className="lg:col-span-2 space-y-6">
                        {sequences.filter(s => s.enabled && (s.cycle_duration > 0 || s.executionMode === 'STEP_BY_STEP')).map(seq => (
                            <ExecutionTimeline
                                key={seq.id}
                                sequence={seq}
                                history={history}
                                routers={routers}
                                onRefresh={fetchData}
                            />
                        ))}

                        {sequences.filter(s => s.enabled && (s.cycle_duration > 0 || s.executionMode === 'STEP_BY_STEP')).length === 0 && (
                            <div className="py-20 flex flex-col items-center justify-center bg-card border border-dashed border-border rounded-3xl text-text-muted shadow-inner">
                                <Activity size={64} className="mb-6 opacity-10" />
                                <p className="text-lg font-bold uppercase tracking-wider opacity-40">No Active Missions</p>
                                <p className="text-sm mt-2 opacity-30">Enable a sequence to see its execution timeline.</p>
                            </div>
                        )}
                    </div>
                    <div className="lg:col-span-1">
                        <LiveFeed />
                    </div>
                </div>
            )}

            {view === 'metrics' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in zoom-in-95 duration-300">
                    <MetricCard title="Total Executions" value={metrics.total} icon={<Activity size={24} className="text-blue-500" />} />
                    <MetricCard title="Success Rate" value={`${metrics.successRate}%`} icon={<CheckCircle size={24} className="text-green-500" />} />
                    <MetricCard title="Last 24 Hours" value={metrics.last24h} icon={<Clock size={24} className="text-purple-500" />} />
                    <MetricCard title="Active Sequences" value={metrics.activeSequences} icon={<Zap size={24} className="text-yellow-500" />} />
                    <MetricCard title="Failed (1h)" value={metrics.failedLastHour} icon={<XCircle size={24} className="text-red-500" />} />
                    <MetricCard title="Top Router" value={metrics.mostUsedRouter} icon={<Server size={24} className="text-orange-500" />} />
                </div>
            )}

            {/* Router Discovery Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[110] flex items-center justify-center p-4">
                    <div className="bg-card border border-border w-full max-w-xl rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="p-8 border-b border-border flex items-center justify-between bg-card/80 sticky top-0 z-10">
                            <h3 className="text-2xl font-black text-text-primary flex items-center gap-3 capitalize">
                                <Globe size={28} className="text-blue-500" /> Tactical Node Discovery
                            </h3>
                            <button onClick={() => { setShowAddModal(false); resetDiscovery(); }} className="text-text-muted hover:text-text-primary transition-all bg-card-secondary p-2 rounded-full border border-border/50">
                                <XCircle size={24} />
                            </button>
                        </div>

                        <div className="p-8 space-y-8 overflow-y-auto custom-scrollbar">
                            {!discoveryResult ? (
                                <>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="space-y-3">
                                            <label className="text-[10px] font-black uppercase tracking-[0.2em] pl-1 flex justify-between items-center pr-2">
                                                <div className="flex items-center gap-2 text-text-muted">
                                                    <ExternalLink size={10} /> Node IPv4/FQDN Address
                                                </div>
                                                {discoveryHost && !isValidIpOrFqdn(discoveryHost) && (
                                                    <span className="text-red-500 flex items-center gap-1 font-bold">
                                                        <AlertCircle size={10} /> Invalid Format
                                                    </span>
                                                )}
                                            </label>
                                            <input
                                                type="text"
                                                placeholder="e.g. 192.168.122.64 or router.example.com"
                                                value={discoveryHost}
                                                onChange={(e) => setDiscoveryHost(e.target.value)}
                                                className={`w-full bg-card-secondary border rounded-xl px-5 py-4 text-text-primary focus:outline-none focus:ring-2 font-mono text-sm shadow-inner transition-all ${discoveryHost && !isValidIpOrFqdn(discoveryHost)
                                                    ? 'border-red-500/50 focus:ring-red-500/50'
                                                    : 'border-border focus:ring-blue-500/50'
                                                    }`}
                                            />
                                        </div>
                                        <div className="space-y-3">
                                            <label className="text-[10px] font-black text-text-muted uppercase tracking-[0.2em] pl-1 flex items-center gap-2">
                                                <Zap size={10} /> HTTPS API Key
                                            </label>
                                            <input
                                                type="password"
                                                placeholder="VyOS Secret Radius"
                                                value={discoveryKey}
                                                onChange={(e) => setDiscoveryKey(e.target.value)}
                                                className="w-full bg-card-secondary border border-border rounded-xl px-5 py-4 text-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500/50 font-mono text-sm shadow-inner transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <label className="text-[10px] font-black text-text-muted uppercase tracking-[0.2em] pl-1 flex items-center gap-2">
                                            <MapPin size={10} /> Physical Location (Optional)
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="e.g. Paris Edge-Point A"
                                            value={discoveryLocation}
                                            onChange={(e) => setDiscoveryLocation(e.target.value)}
                                            className="w-full bg-card-secondary border border-border rounded-xl px-5 py-4 text-text-primary focus:outline-none focus:ring-1 focus:ring-blue-500/50 uppercase tracking-tight font-black text-xs transition-all"
                                        />
                                    </div>

                                    {error && (
                                        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-4 text-red-600 dark:text-red-400 text-xs font-black uppercase tracking-tight animate-pulse shadow-sm">
                                            <AlertCircle size={20} />
                                            {error}
                                        </div>
                                    )}

                                    <div className="p-6 bg-blue-600/5 border border-blue-500/20 rounded-2xl">
                                        <div className="flex items-start gap-4">
                                            <Info size={20} className="text-blue-500 dark:text-blue-400 shrink-0 mt-0.5" />
                                            <p className="text-[10px] leading-relaxed text-text-muted font-medium"> Discovery will execute <code className="text-blue-600 dark:text-blue-300 bg-blue-500/10 dark:bg-blue-900/30 px-1 py-0.5 rounded">get-info</code> via the VyOS controller script to extract hardware, software, and interface metadata. Ensure the HTTPS API is enabled on the target router.</p>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="animate-in slide-in-from-right-8 duration-500 space-y-8 pb-4">
                                    <div className="p-8 bg-green-500/10 border border-green-500/20 rounded-3xl relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                                            <CheckCircle size={120} />
                                        </div>
                                        <div className="flex items-center gap-4 mb-8">
                                            <div className="p-3 bg-green-500/20 rounded-2xl border border-green-500/30">
                                                <Server size={32} className="text-green-600 dark:text-green-400" />
                                            </div>
                                            <div>
                                                <h4 className="text-2xl font-black text-text-primary uppercase tracking-tighter">{discoveryResult.name}</h4>
                                                <div className="flex items-center gap-3">
                                                    <span className="text-xs text-green-600 dark:text-green-400 font-black tracking-widest uppercase">Verified Connection</span>
                                                    <div className="w-1 h-1 bg-green-900 dark:bg-green-700 rounded-full" />
                                                    <span className="text-xs text-text-secondary font-mono bg-card-secondary px-2 py-0.5 rounded border border-border/50">ID: {discoveryResult.id}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-8 relative z-10">
                                            <div className="bg-card-secondary/50 p-5 rounded-2xl border border-border/50">
                                                <span className="text-[10px] text-text-muted block uppercase font-black tracking-[0.2em] mb-2">Hardware Node</span>
                                                <span className="text-text-primary font-black uppercase text-sm tracking-tight">{discoveryResult.host}</span>
                                            </div>
                                            <div className="bg-card-secondary/50 p-5 rounded-2xl border border-border/50">
                                                <span className="text-[10px] text-text-muted block uppercase font-black tracking-[0.2em] mb-2">VyOS Kernel</span>
                                                <span className="text-text-primary font-black uppercase text-sm tracking-tight">Version {discoveryResult.version}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between px-1">
                                            <span className="text-[11px] font-black text-text-muted uppercase tracking-[0.3em]">Extracted Interfaces</span>
                                            <span className="text-[11px] font-black text-blue-500">{discoveryResult.interfaces?.length} PATHS FOUND</span>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {discoveryResult.interfaces?.map(iface => (
                                                <div key={iface.name} className="flex flex-col p-4 bg-card-secondary/50 rounded-2xl border border-border/50 hover:border-blue-500/20 transition-all">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <div className="flex items-center gap-2">
                                                            <div className={cn(
                                                                "w-1.5 h-1.5 rounded-full",
                                                                iface.status === 'up' ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]"
                                                            )} />
                                                            <span className="font-black text-text-primary uppercase tracking-tighter text-sm">{iface.name}</span>
                                                        </div>
                                                        <Wifi size={14} className="text-text-muted/30" />
                                                    </div>
                                                    <div className="text-[10px] text-text-muted font-mono bg-card px-2 py-1 rounded inline-block w-fit mb-2 border border-border/50">{iface.address?.[0] || 'DHCP/NO-IP'}</div>
                                                    {iface.description && (
                                                        <div className="text-[9px] text-blue-600 dark:text-blue-400 font-medium bg-blue-500/5 p-2 rounded-lg italic pl-3.5">"{iface.description}"</div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="p-8 border-t border-border bg-card/80 backdrop-blur-md flex gap-4 sticky bottom-0">
                            <button
                                onClick={() => { setShowAddModal(false); resetDiscovery(); }}
                                className="flex-1 px-6 py-4 rounded-2xl bg-card-secondary hover:bg-card-hover text-text-muted font-black transition-all text-xs uppercase tracking-[0.3em] border border-border/50 shadow-inner"
                            >
                                ABORT
                            </button>
                            {!discoveryResult ? (
                                <button
                                    onClick={startDiscovery}
                                    disabled={discovering || !discoveryHost || !isValidIpOrFqdn(discoveryHost) || !discoveryKey}
                                    className="flex-2 px-10 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black transition-all shadow-xl shadow-blue-900/40 text-xs uppercase tracking-[0.3em] disabled:opacity-20 flex items-center justify-center gap-3 active:scale-95"
                                >
                                    {discovering ? <RefreshCw size={20} className="animate-spin" /> : <><Globe size={20} /> INITIATE SCAN</>}
                                </button>
                            ) : (
                                <button
                                    onClick={saveRouter}
                                    className="flex-2 px-10 py-4 rounded-2xl bg-green-600 hover:bg-green-500 text-white font-black transition-all shadow-xl shadow-green-900/40 text-xs uppercase tracking-[0.3em] flex items-center justify-center gap-3 active:scale-95 animate-in slide-in-from-bottom-2"
                                >
                                    <CheckCircle size={20} /> AUTHORIZE & DEPLOY
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Sequence Builder Modal */}
            {showSeqModal && editingSeq && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[110] flex items-center justify-center p-4">
                    <div className="bg-card border border-border w-full max-w-2xl rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
                        <div className="p-8 border-b border-border flex items-center justify-between bg-card/80 backdrop-blur-md sticky top-0 z-10">
                            <h3 className="text-2xl font-black text-text-primary flex items-center gap-4 tracking-tighter">
                                <Activity size={28} className="text-purple-500" />
                                {editingSeq.id ? 'Mission Parameters' : 'Blueprint Mission'}
                            </h3>
                            <button onClick={() => setShowSeqModal(false)} className="text-text-muted hover:text-text-primary transition-all bg-card-secondary p-2 rounded-full border border-border/50">
                                <XCircle size={24} />
                            </button>
                        </div>

                        <div className="p-8 overflow-y-auto flex-1 space-y-8 custom-scrollbar">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-3">
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-[0.3em] pl-1">Mission Identifier</label>
                                    <input
                                        type="text"
                                        value={editingSeq.name}
                                        onChange={(e) => setEditingSeq({ ...editingSeq, name: e.target.value })}
                                        placeholder="e.g. AWS-CONVERGENCE-STRESS"
                                        className="w-full bg-card-secondary border border-border rounded-2xl px-5 py-4 text-text-primary focus:outline-none focus:ring-2 focus:ring-purple-500/50 font-black uppercase tracking-tight text-sm shadow-inner transition-all"
                                    />
                                </div>
                                <div className="space-y-3">
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-[0.3em] pl-1">Execution Mode</label>
                                    <select
                                        value={editingSeq.executionMode}
                                        onChange={(e) => setEditingSeq({ ...editingSeq, executionMode: e.target.value as any })}
                                        className="w-full bg-card-secondary border border-border rounded-2xl px-5 py-4 text-text-primary focus:outline-none focus:ring-2 focus:ring-purple-500/50 font-black uppercase tracking-tight text-sm appearance-none cursor-pointer shadow-inner transition-all"
                                    >
                                        <option value="CYCLE">Timed Cycle</option>
                                        <option value="STEP_BY_STEP">Step-by-Step Sequence</option>
                                    </select>
                                </div>
                                <div className="space-y-3">
                                    {editingSeq.executionMode === 'CYCLE' ? (
                                        <>
                                            <label className="text-[10px] font-black text-text-muted uppercase tracking-[0.3em] pl-1">Cycle duration (Min)</label>
                                            <select
                                                value={editingSeq.cycle_duration}
                                                onChange={(e) => {
                                                    const val = Math.max(0, parseInt(e.target.value || '0'));
                                                    // CLAMPING: Proactively clamp all action offsets if duration is reduced
                                                    const updatedActions = editingSeq.actions.map(a => ({
                                                        ...a,
                                                        offset_minutes: Math.min(val, a.offset_minutes)
                                                    }));
                                                    setEditingSeq({ ...editingSeq, cycle_duration: val, actions: updatedActions });
                                                }}
                                                className="w-full bg-card-secondary border border-border rounded-2xl px-5 py-4 text-text-primary focus:outline-none focus:ring-2 focus:ring-purple-500/50 font-black uppercase tracking-tight text-sm appearance-none cursor-pointer shadow-inner transition-all"
                                            >
                                                <option value={0}>Manual Trigger Only</option>
                                                <option value={10}>10 Minute Cycle</option>
                                                <option value={30}>30 Minute Cycle</option>
                                                <option value={60}>60 Minute Cycle</option>
                                                <option value={120}>2 Hour Cycle</option>
                                                <option value={1440}>24 Hour Cycle</option>
                                            </select>
                                        </>
                                    ) : (
                                        <div className="p-4 bg-purple-600/5 border border-purple-500/10 rounded-2xl h-full flex flex-col justify-center">
                                            <p className="text-[10px] text-text-muted font-bold leading-tight uppercase">
                                                Manual Control: Actions run only when you click Next. Ideal for live POCs and design walkthroughs.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="flex items-center justify-between bg-purple-600/5 p-4 rounded-2xl border border-purple-500/20 shadow-sm">
                                    <div className="flex flex-col">
                                        <h4 className="text-[11px] font-black text-text-primary uppercase tracking-[0.3em]">Operational Flow</h4>
                                        <span className="text-[10px] text-text-muted font-bold uppercase">
                                            {editingSeq.executionMode === 'CYCLE'
                                                ? 'ACTIONS WILL TRIGGER AT DEFINED OFFSETS WITHIN THE CYCLE'
                                                : 'ACTIONS ARE ORDERED FOR STEP-BY-STEP MANUAL EXECUTION'}
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => {
                                            const lastAction = editingSeq.actions[editingSeq.actions.length - 1];
                                            const nextOffset = lastAction ? lastAction.offset_minutes + 10 : 0;
                                            const defaultInterface = routers[0]?.interfaces?.[0]?.name || 'eth0';
                                            setEditingSeq({
                                                ...editingSeq,
                                                actions: [...editingSeq.actions, {
                                                    id: `act-${Date.now()}`,
                                                    offset_minutes: nextOffset,
                                                    router_id: routers[0]?.id || '',
                                                    interface: defaultInterface, // Will be ignored for block/unblock/clear actions
                                                    command: 'interface-down',
                                                    parameters: {}
                                                }]
                                            });
                                        }}
                                        className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-purple-900/20 active:scale-95"
                                    >
                                        + APPEND ACTION
                                    </button>
                                </div>

                                <div className="space-y-6">
                                    {editingSeq.actions.map((action, idx) => (
                                        <div key={idx} className="bg-card-secondary/50 border border-border rounded-2xl p-4 space-y-4 group relative animate-in slide-in-from-left-6 duration-300 shadow-sm">
                                            <div className="absolute top-0 left-0 w-1.5 h-full bg-purple-500/20 group-hover:bg-purple-500/40 transition-all rounded-l-2xl" />

                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-6">
                                                    <div className="flex flex-col items-center justify-center p-3 bg-card rounded-xl border border-border shadow-sm">
                                                        <span className="text-[8px] text-text-muted font-black uppercase tracking-tighter mb-0.5">T+ (Min)</span>
                                                        <input
                                                            type="number"
                                                            value={action.offset_minutes}
                                                            onChange={(e) => {
                                                                const newActions = [...editingSeq.actions];
                                                                newActions[idx].offset_minutes = Math.min(editingSeq.cycle_duration, Math.max(0, parseInt(e.target.value) || 0));
                                                                setEditingSeq({ ...editingSeq, actions: newActions });
                                                            }}
                                                            className="bg-transparent border-none text-purple-400 font-black text-center w-10 p-0 text-sm focus:ring-0 shadow-none outline-none"
                                                        />
                                                    </div>
                                                    <ActionSelector
                                                        value={action.command}
                                                        onChange={(val) => {
                                                            const newActions = [...editingSeq.actions];
                                                            newActions[idx].command = val;
                                                            setEditingSeq({ ...editingSeq, actions: newActions });
                                                        }}
                                                    />
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        const newActions = editingSeq.actions.filter((_, i) => i !== idx);
                                                        setEditingSeq({ ...editingSeq, actions: newActions });
                                                    }}
                                                    className="p-2.5 text-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all border border-transparent hover:border-red-500/20"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                                <div className="space-y-1.5">
                                                    <label className="text-[9px] font-black text-text-muted uppercase tracking-widest pl-1 flex items-center gap-1.5"><Server size={8} /> Target Node</label>
                                                    <select
                                                        value={action.router_id}
                                                        onChange={(e) => {
                                                            const newActions = [...editingSeq.actions];
                                                            newActions[idx].router_id = e.target.value;
                                                            const r = routers.find(router => router.id === e.target.value);
                                                            if (r && r.interfaces.length > 0) {
                                                                newActions[idx].interface = r.interfaces[0].name;
                                                            }
                                                            setEditingSeq({ ...editingSeq, actions: newActions });
                                                        }}
                                                        className="w-full bg-card border border-border rounded-xl px-4 py-3 text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-purple-500/50 font-black uppercase appearance-none cursor-pointer transition-all"
                                                    >
                                                        {routers.map(r => <option key={r.id} value={r.id}>{r.name} ({r.host})</option>)}
                                                    </select>
                                                </div>

                                                {/* Interface Path - Hidden for block/unblock/clear actions */}
                                                {!['deny-traffic', 'allow-traffic', 'clear-all-blocks'].includes(action.command) && (
                                                    <div className="space-y-1.5">
                                                        <label className="text-[9px] font-black text-text-muted uppercase tracking-widest pl-1 flex items-center gap-1.5"><Wifi size={8} /> Interface Path</label>
                                                        <select
                                                            value={action.interface}
                                                            onChange={(e) => {
                                                                const newActions = [...editingSeq.actions];
                                                                newActions[idx].interface = e.target.value;
                                                                setEditingSeq({ ...editingSeq, actions: newActions });
                                                            }}
                                                            className="w-full bg-card border border-border rounded-xl px-4 py-3 text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-purple-500/50 font-black uppercase appearance-none cursor-pointer transition-all"
                                                        >
                                                            {(routers.find(r => r.id === action.router_id)?.interfaces || []).map(iface => (
                                                                <option key={iface.name} value={iface.name} title={iface.description || undefined}>{iface.name} {iface.description ? `- ${iface.description}` : ''}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                )}

                                                {action.command === 'set-qos' && (
                                                    <>
                                                        <div className="space-y-1.5">
                                                            <label className="text-[9px] font-black text-text-muted uppercase tracking-widest pl-1 flex items-center gap-1.5"><Activity size={8} /> Latency (ms)</label>
                                                            <input
                                                                type="number"
                                                                value={action.parameters?.latency || 0}
                                                                onChange={(e) => {
                                                                    const newActions = [...editingSeq.actions];
                                                                    newActions[idx].parameters = { ...newActions[idx].parameters, latency: parseInt(e.target.value) };
                                                                    setEditingSeq({ ...editingSeq, actions: newActions });
                                                                }}
                                                                className="w-full bg-card border border-border rounded-xl px-4 py-3 text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-purple-500/50 font-black shadow-inner transition-all"
                                                            />
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            <label className="text-[9px] font-black text-text-muted uppercase tracking-widest pl-1 flex items-center gap-1.5"><Activity size={8} /> Loss (%)</label>
                                                            <input
                                                                type="number"
                                                                value={action.parameters?.loss || 0}
                                                                onChange={(e) => {
                                                                    const newActions = [...editingSeq.actions];
                                                                    newActions[idx].parameters = { ...newActions[idx].parameters, loss: parseInt(e.target.value) };
                                                                    setEditingSeq({ ...editingSeq, actions: newActions });
                                                                }}
                                                                className="w-full bg-card border border-border rounded-xl px-4 py-3 text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-purple-500/50 font-black shadow-inner transition-all"
                                                            />
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            <label className="text-[9px] font-black text-text-muted uppercase tracking-widest pl-1 flex items-center gap-1.5"><Activity size={8} /> Rate (e.g. 10mbit)</label>
                                                            <input
                                                                type="text"
                                                                value={action.parameters?.rate || ''}
                                                                onChange={(e) => {
                                                                    const newActions = [...editingSeq.actions];
                                                                    newActions[idx].parameters = { ...newActions[idx].parameters, rate: e.target.value };
                                                                    setEditingSeq({ ...editingSeq, actions: newActions });
                                                                }}
                                                                className="w-full bg-card border border-border rounded-xl px-4 py-3 text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-purple-500/50 font-black shadow-inner transition-all"
                                                            />
                                                        </div>
                                                    </>
                                                )}

                                                {/* Deny Traffic From IP/Subnet (Updated: No interface needed) */}
                                                {action.command === 'deny-traffic' && (
                                                    <div className="space-y-3">
                                                        <div>
                                                            <label className="text-[9px] font-black text-text-muted uppercase tracking-widest pl-1 flex items-center gap-1.5">
                                                                IP Address or Subnet (CIDR) <span className="text-red-500">*</span>
                                                            </label>
                                                            <input
                                                                type="text"
                                                                placeholder="e.g., 8.8.8.8/32 or 10.0.0.0/24"
                                                                value={action.parameters?.ip || ''}
                                                                onChange={(e) => {
                                                                    const newActions = [...editingSeq.actions];
                                                                    newActions[idx].parameters = { ...newActions[idx].parameters, ip: e.target.value };
                                                                    setEditingSeq({ ...editingSeq, actions: newActions });
                                                                }}
                                                                className="w-full bg-card border border-border rounded-xl px-4 py-3 text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-purple-500/50 font-black shadow-inner transition-all"
                                                            />
                                                            <p className="text-[8px] text-text-muted mt-1 uppercase font-bold">
                                                                Uses global blackhole route (no interface needed)
                                                            </p>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* NEW: Allow Traffic From IP/Subnet */}
                                                {action.command === 'allow-traffic' && (
                                                    <div className="space-y-3">
                                                        <div>
                                                            <label className="text-[9px] font-black text-text-muted uppercase tracking-widest pl-1 flex items-center gap-1.5">
                                                                IP Address or Subnet to Allow <span className="text-red-500">*</span>
                                                            </label>
                                                            <input
                                                                type="text"
                                                                placeholder="e.g., 8.8.8.8/32"
                                                                value={action.parameters?.ip || ''}
                                                                onChange={(e) => {
                                                                    const newActions = [...editingSeq.actions];
                                                                    newActions[idx].parameters = { ...newActions[idx].parameters, ip: e.target.value };
                                                                    setEditingSeq({ ...editingSeq, actions: newActions });
                                                                }}
                                                                className="w-full bg-card border border-border rounded-xl px-4 py-3 text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-purple-500/50 font-black shadow-inner transition-all"
                                                            />
                                                        </div>
                                                    </div>
                                                )}

                                                {/* NEW: Show Denied Traffic */}
                                                {action.command === 'show-denied' && (
                                                    <div className="p-4 bg-blue-900/10 border border-blue-600/20 rounded-xl">
                                                        <p className="text-[10px] text-blue-400 font-bold uppercase leading-relaxed">
                                                            ℹ️ Lists all denied traffic rules on selected interface. No parameters required.
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {editingSeq.actions.length === 0 && (
                                        <div className="py-20 text-center bg-card-secondary/30 border border-dashed border-border rounded-[2.5rem] flex flex-col items-center gap-4 shadow-inner">
                                            <div className="p-4 bg-card rounded-full border border-border/50">
                                                <Cpu size={40} className="text-text-muted/20" />
                                            </div>
                                            <span className="text-[11px] font-black text-text-muted uppercase tracking-[0.4em]">Engine Logic Empty</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="p-8 border-t border-border bg-card/80 backdrop-blur-md rounded-b-3xl flex gap-4 sticky bottom-0 z-10">
                            <button
                                onClick={() => setShowSeqModal(false)}
                                className="flex-1 px-6 py-4 rounded-2xl bg-card-secondary hover:bg-card-hover text-text-muted font-black transition-all text-xs uppercase tracking-[0.3em] border border-border/50 shadow-inner"
                            >
                                DISCARD
                            </button>
                            <button
                                onClick={saveSequence}
                                disabled={!editingSeq.name || editingSeq.actions.length === 0}
                                title={
                                    !editingSeq.name ? "⚠️ Mission Identifier is required" :
                                        editingSeq.actions.length === 0 ? "⚠️ Add at least one action" :
                                            "Save this mission"
                                }
                                className="flex-2 px-10 py-4 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white font-black transition-all shadow-xl shadow-purple-900/40 text-xs uppercase tracking-[0.3em] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-purple-600 flex items-center justify-center gap-3 active:scale-95"
                            >
                                <CheckCircle size={20} /> SAVE
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Router Edit Modal */}
            {showEditRouterModal && editingRouter && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[110] flex items-center justify-center p-4">
                    <div className="bg-card border border-border w-full max-w-lg rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden flex flex-col">
                        <div className="p-8 border-b border-border flex items-center justify-between">
                            <h3 className="text-xl font-black text-text-primary flex items-center gap-3 uppercase tracking-tighter">
                                <Settings size={24} className="text-orange-500" /> Node Parameters: {editingRouter.name}
                            </h3>
                            <button onClick={() => setShowEditRouterModal(false)} className="text-text-muted hover:text-text-primary transition-all bg-card-secondary p-1.5 rounded-full border border-border/50">
                                <XCircle size={20} />
                            </button>
                        </div>

                        <div className="p-8 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5 opacity-50">
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest pl-1">Router ID</label>
                                    <input value={editingRouter.id} disabled className="w-full bg-card-secondary/50 border border-border rounded-xl px-4 py-3 text-xs font-mono text-text-primary" />
                                </div>
                                <div className="space-y-1.5 opacity-50">
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest pl-1">IP Address</label>
                                    <input value={editingRouter.host} disabled className="w-full bg-card-secondary/50 border border-border rounded-xl px-4 py-3 text-xs font-mono text-text-primary" />
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[10px] font-black text-text-muted uppercase tracking-widest pl-1">Tactical Location</label>
                                <input
                                    type="text"
                                    value={editingRouter.location || ''}
                                    onChange={(e) => setEditingRouter({ ...editingRouter, location: e.target.value })}
                                    className="w-full bg-card-secondary border border-border rounded-xl px-4 py-3 text-sm font-black text-text-primary uppercase tracking-tight focus:ring-1 focus:ring-orange-500/50 outline-none transition-all shadow-inner"
                                />
                            </div>

                            <div className="flex items-center justify-between p-4 bg-card-secondary/50 rounded-xl border border-border">
                                <div>
                                    <h4 className="text-xs font-black text-text-primary uppercase tracking-widest">Node Power State</h4>
                                    <p className="text-[10px] text-text-muted uppercase font-bold">ENABLE/DISABLE AUTOMATED IMPAIRMENT TARGETING</p>
                                </div>
                                <button
                                    onClick={() => setEditingRouter({ ...editingRouter, enabled: !editingRouter.enabled })}
                                    className={`w-12 h-6 rounded-full transition-all relative ${editingRouter.enabled ? 'bg-orange-600' : 'bg-card-secondary border border-border'}`}
                                >
                                    <div className={`absolute top-1 w-4 h-4 rounded-full transition-all bg-white ${editingRouter.enabled ? 'right-1' : 'left-1'}`} />
                                </button>
                            </div>
                        </div>

                        <div className="p-8 border-t border-border bg-card/50 flex gap-4">
                            <button onClick={() => setShowEditRouterModal(false)} className="flex-1 px-6 py-3 rounded-xl bg-card-secondary border border-border/50 text-text-muted font-black text-xs uppercase tracking-widest shadow-inner transition-all hover:bg-card-hover">ABORT</button>
                            <button onClick={saveRouterChanges} className="flex-2 px-6 py-3 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-black text-xs uppercase tracking-widest shadow-lg shadow-orange-900/20 transition-all active:scale-95">SYNC Node</button>
                        </div>
                    </div>
                </div>
            )}
            {/* Confirmation Modal */}
            <ConfirmModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                confirmText={confirmModal.confirmText}
                cancelText="Cancel"
                danger={true}
                onConfirm={confirmModal.onConfirm}
                onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
            />
        </div>
    );
}

interface ConfirmModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
    onCancel: () => void;
    danger?: boolean;
}


function ExecutionTimeline({
    sequence,
    history,
    routers,
    onRefresh
}: {
    sequence: VyosSequence;
    history: any[];
    routers: VyosRouter[];
    onRefresh: () => Promise<void>;
}) {
    const [countdown, setCountdown] = useState('');
    const [currentOffset, setCurrentOffset] = useState(-1);
    const [isStepRunning, setIsStepRunning] = useState(false);

    const getNextCycleTime = (seq: VyosSequence) => {
        if (!seq.lastRun || seq.cycle_duration === 0) return null;
        const nextRunMs = seq.lastRun + (seq.cycle_duration * 60 * 1000);
        const remainingMs = Math.max(0, nextRunMs - Date.now());
        const minutes = Math.floor(remainingMs / 60000);
        const seconds = Math.floor((remainingMs % 60000) / 1000);
        return `${minutes}m ${seconds}s`;
    };

    const getLastExecution = (actionId: string, seqId: string) => {
        return history
            .filter(h => h.sequence_id === seqId && h.action_id === actionId)
            .sort((a, b) => b.timestamp - a.timestamp)[0];
    };

    const getDotState = (actionOffset: number, current: number, index: number): 'past' | 'current' | 'future' => {
        if (sequence.executionMode === 'STEP_BY_STEP') {
            const currentStep = sequence.currentStep || 0;
            if (index < currentStep) return 'past';
            if (index === currentStep) return 'current';
            return 'future';
        }

        if (!sequence.enabled || current === -1) return 'past';
        const epsilon = 0.5; // 30s window
        if (current < actionOffset - epsilon) return 'future';
        if (current > actionOffset + epsilon) return 'past';
        return 'current';
    };

    const getDotStyles = (state: 'past' | 'current' | 'future', lastExec: any) => {
        if (state === 'current') {
            return 'bg-blue-500 border-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.5)] animate-pulse scale-125 dark:border-blue-300';
        }
        if (state === 'future') {
            return 'bg-card-secondary border-border opacity-30';
        }
        // Past state depends on history
        if (!lastExec) return 'bg-card-secondary border-border';
        if (lastExec.status === 'success') return 'bg-green-500 border-green-400 dark:border-green-300';
        return 'bg-red-500 border-red-400 dark:border-red-300';
    };

    // Update countdown and current offset every second
    useEffect(() => {
        const interval = setInterval(() => {
            if (sequence.executionMode === 'CYCLE' && sequence.cycle_duration > 0) {
                setCountdown(getNextCycleTime(sequence) || 'WAITING...');
                if (sequence.enabled && sequence.lastRun) {
                    const elapsed = (Date.now() - sequence.lastRun) / 60000;
                    setCurrentOffset(elapsed % sequence.cycle_duration);
                } else {
                    setCurrentOffset(-1);
                }
            } else {
                setCountdown('N/A');
                setCurrentOffset(-1);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [sequence]);

    const handlePause = async () => {
        const toastId = toast.loading('Pausing sequence...');
        try {
            const res = await fetch(`/api/vyos/sequences/pause/${sequence.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (res.ok) {
                toast.success('✓ Sequence paused', { id: toastId });
                await onRefresh();  // Refresh data without page reload
            } else {
                const data = await res.json();
                toast.error(`❌ ${data.error}`, { id: toastId });
            }
        } catch (e) {
            toast.error('❌ Network error', { id: toastId });
        }
    };

    const handleResume = async () => {
        const toastId = toast.loading('Resuming sequence...');
        try {
            const res = await fetch(`/api/vyos/sequences/resume/${sequence.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (res.ok) {
                toast.success('✓ Sequence resumed', { id: toastId });
                await onRefresh();  // Refresh data without page reload
            } else {
                const data = await res.json();
                toast.error(`❌ ${data.error}`, { id: toastId });
            }
        } catch (e) {
            toast.error('❌ Network error', { id: toastId });
        }
    };

    const handleStop = async () => {
        const toastId = toast.loading('Stopping sequence...');
        try {
            const res = await fetch(`/api/vyos/sequences/stop/${sequence.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (res.ok) {
                toast.success('✓ Sequence stopped - will restart from beginning', { id: toastId });
                await onRefresh();  // Refresh data without page reload
            } else {
                const data = await res.json();
                toast.error(`❌ ${data.error}`, { id: toastId });
            }
        } catch (e) {
            toast.error('❌ Network error', { id: toastId });
        }
    };

    const handleNextStep = async () => {
        if (isStepRunning) return;
        const currentStep = sequence.currentStep || 0;

        // Wrap-around: after last step, loop back to step 1
        if (currentStep >= sequence.actions.length) {
            try {
                const updatedSeq = { ...sequence, currentStep: 0 };
                await fetch('/api/vyos/sequences', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                    body: JSON.stringify(updatedSeq)
                });
                toast.success('🔁 Sequence looped — back to Step 1', { duration: 3000 });
                await onRefresh();
            } catch (e) {
                toast.error('Failed to reset sequence');
            }
            return;
        }

        setIsStepRunning(true);
        const toastId = toast.loading(`Executing step ${currentStep + 1}...`);
        try {
            const res = await fetch(`/api/vyos/sequences/step/${sequence.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: JSON.stringify({ stepIndex: currentStep })
            });

            if (res.ok) {
                toast.success(`✓ Step ${currentStep + 1} completed`, { id: toastId });
                await onRefresh();
            } else {
                const data = await res.json();
                toast.error(`❌ Step ${currentStep + 1} failed: ${data.error}`, { id: toastId });
            }
        } catch (e) {
            toast.error('❌ Network error', { id: toastId });
        } finally {
            setIsStepRunning(false);
        }
    };

    const handlePrevStep = async () => {
        const currentStep = sequence.currentStep || 0;
        if (currentStep <= 0) return;

        // Note: This only moves the UI pointer, it doesn't "undo" the previous command
        // This matches our design for "Rewind" in POCs
        try {
            const updatedSeq = { ...sequence, currentStep: currentStep - 1 };
            const res = await fetch('/api/vyos/sequences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: JSON.stringify(updatedSeq)
            });
            if (res.ok) {
                await onRefresh();
            }
        } catch (e) {
            toast.error('Failed to move pointer');
        }
    };

    const handleRestartStep = async () => {
        try {
            const updatedSeq = { ...sequence, currentStep: 0 };
            const res = await fetch('/api/vyos/sequences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: JSON.stringify(updatedSeq)
            });
            if (res.ok) {
                toast.success('Sequence reset to first step');
                await onRefresh();
            }
        } catch (e) {
            toast.error('Failed to reset sequence');
        }
    };

    return (
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            {/* Header with sequence name and status */}
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-border">
                <div>
                    <h3 className="text-xl font-black text-text-primary uppercase tracking-tighter">
                        {sequence.name}
                    </h3>
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-text-muted uppercase tracking-widest">
                            {sequence.executionMode === 'CYCLE'
                                ? `Cycle: ${sequence.cycle_duration}min`
                                : `Step-by-Step Mode`}
                        </span>
                        {sequence.executionMode === 'CYCLE' && currentOffset !== -1 && (
                            <span className="text-[10px] bg-card-secondary text-text-secondary px-2 py-0.5 rounded font-mono border border-border">
                                POSITION: T+{currentOffset.toFixed(1)}m
                            </span>
                        )}
                        {sequence.executionMode === 'STEP_BY_STEP' && (
                            <span className="text-[10px] bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded font-black border border-purple-500/20 uppercase">
                                Step {(sequence.currentStep || 0) + 1} of {sequence.actions.length}
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {sequence.executionMode === 'STEP_BY_STEP' ? (
                        <div className="flex items-center gap-2 bg-card-secondary p-1 rounded-xl border border-border">
                            <button
                                onClick={handleRestartStep}
                                className="p-2 hover:bg-white/5 text-text-muted hover:text-text-primary rounded-lg transition-all"
                                title="Restart sequence"
                            >
                                <RotateCcw size={16} />
                            </button>
                            <button
                                onClick={handlePrevStep}
                                disabled={isStepRunning || (sequence.currentStep || 0) <= 0}
                                className="p-2 hover:bg-white/5 text-text-muted hover:text-text-primary rounded-lg transition-all disabled:opacity-30"
                                title="Previous step"
                            >
                                <SkipBack size={16} />
                            </button>
                            <button
                                onClick={handleNextStep}
                                disabled={isStepRunning || (sequence.currentStep || 0) >= sequence.actions.length}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white rounded-lg transition-all shadow-lg font-black uppercase text-[10px] tracking-widest"
                            >
                                {isStepRunning ? (
                                    <RefreshCw size={14} className="animate-spin" />
                                ) : (
                                    getCommandIcon(sequence.actions[sequence.currentStep || 0]?.command, 14, "text-white")
                                )}
                                Execute
                            </button>
                        </div>
                    ) : (
                        sequence.enabled && (
                            <>
                                {sequence.paused ? (
                                    <>
                                        <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-500/10 border border-orange-500/20 rounded-lg">
                                            <Pause size={12} className="text-orange-400" />
                                            <span className="text-xs font-black text-orange-400 uppercase">PAUSED</span>
                                        </div>
                                        <button
                                            onClick={handleResume}
                                            className="p-2 bg-green-600 hover:bg-green-500 text-white rounded-lg transition-all shadow-sm"
                                            title="Resume sequence"
                                        >
                                            <Play size={14} />
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-lg">
                                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                            <span className="text-xs font-black text-green-400 uppercase">ACTIVE</span>
                                        </div>
                                        <button
                                            onClick={handlePause}
                                            className="p-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg transition-all shadow-sm"
                                            title="Pause sequence"
                                        >
                                            <Pause size={14} />
                                        </button>
                                    </>
                                )}
                                <button
                                    onClick={handleStop}
                                    className="p-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-all shadow-sm"
                                    title="Stop and reset sequence"
                                >
                                    <Square size={14} />
                                </button>
                            </>
                        )
                    )}
                </div>
            </div>

            {/* Action Timeline */}
            <div className="space-y-3 relative">
                {sequence.actions.map((action, idx) => {
                    const lastExec = getLastExecution(action.id, sequence.id);
                    const router = routers.find(r => r.id === action.router_id);
                    const state = getDotState(action.offset_minutes, currentOffset, idx);

                    return (
                        <div key={idx} className={`flex items-start gap-4 transition-all duration-500 ${state === 'future' ? 'opacity-40 grayscale-[0.5]' : ''}`}>
                            {/* T+ Offset Label or Step Number */}
                            <div className="flex flex-col items-center justify-center w-16">
                                <span className="text-[8px] text-text-muted font-black uppercase tracking-tighter">
                                    {sequence.executionMode === 'CYCLE' ? 'T+MIN' : 'STEP'}
                                </span>
                                <span className={`font-black text-lg transition-colors ${state === 'current' ? 'text-blue-500' : 'text-purple-500'}`}>
                                    {sequence.executionMode === 'CYCLE' ? action.offset_minutes : idx + 1}
                                </span>
                            </div>

                            {/* Vertical Dot & Line Column */}
                            <div className="flex flex-col items-center self-stretch">
                                {/* Status Dot */}
                                <div className={`w-4 h-4 rounded-full border-2 ${getDotStyles(state, lastExec)} mt-2 z-10 transition-all duration-500`} />

                                {/* Dynamic Connecting Line */}
                                {idx < sequence.actions.length - 1 && (
                                    <div className={`w-px flex-1 ${state === 'future' ? 'bg-border/30' : 'bg-border'} transition-colors duration-500`} />
                                )}
                            </div>

                            {/* Action Details Card */}
                            <div className={`flex-1 bg-card-secondary/30 border rounded-xl p-4 transition-all duration-500 
                                ${state === 'current' ? 'border-blue-500/50 shadow-[0_0_20px_rgba(59,130,246,0.1)]' : 'border-border'}
                                ${state === 'past' ? 'border-border/50' : ''}
                            `}>
                                <div className="flex items-center justify-between">
                                    {/* Command + Target */}
                                    <div className="flex items-center gap-3">
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-3">
                                                <div className="p-1.5 bg-card/50 rounded-lg border border-border/50">
                                                    {getCommandIcon(action.command, 16)}
                                                </div>
                                                <span className={`text-sm font-black uppercase tracking-tight ${state === 'current' ? 'text-blue-500' : 'text-text-primary'}`}>
                                                    {getCommandDisplayName(action.command)}
                                                </span>
                                                {state === 'current' && (
                                                    <span className="text-[8px] bg-blue-500 text-white px-1.5 py-0.5 rounded font-black animate-pulse">RUNNING</span>
                                                )}
                                            </div>
                                            <span className="text-[10px] text-text-muted flex items-center gap-1">
                                                {router?.name || 'Unknown'} <ChevronRight size={8} /> {action.interface}
                                                {(() => {
                                                    const iface = router?.interfaces?.find(i => i.name === action.interface);
                                                    return iface?.description ? ` [${iface.description}]` : '';
                                                })()}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Execution Status / Indicator */}
                                    <div className="flex items-center gap-2">
                                        {state === 'current' ? (
                                            <div className="flex items-center gap-1 px-2 py-1 bg-blue-500/10 rounded-md">
                                                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" />
                                                <span className="text-[9px] font-black text-blue-600 dark:text-blue-400 uppercase">Active Now</span>
                                            </div>
                                        ) : lastExec && (
                                            <div className="flex items-center gap-2 opacity-60">
                                                {lastExec.status === 'success' ? (
                                                    <CheckCircle size={14} className="text-green-500" />
                                                ) : (
                                                    <XCircle size={14} className="text-red-500" />
                                                )}
                                                <span className="text-[9px] text-text-muted font-mono">
                                                    {new Date(lastExec.timestamp).toLocaleTimeString()}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Impairment Parameters */}
                                {action.parameters && Object.keys(action.parameters).length > 0 && (
                                    <div className="flex items-center gap-2 mt-2 opacity-80">
                                        {action.parameters.latency && (
                                            <span className="text-[9px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20 font-bold">
                                                {action.parameters.latency}ms latency
                                            </span>
                                        )}
                                        {action.parameters.loss && (
                                            <span className="text-[9px] bg-orange-500/10 text-orange-400 px-2 py-0.5 rounded border border-orange-500/20 font-bold">
                                                {action.parameters.loss}% loss
                                            </span>
                                        )}
                                        {action.parameters.rate && (
                                            <span className="text-[9px] bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded border border-purple-500/20 font-bold">
                                                {action.parameters.rate} rate
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* Error Message (if failed) */}
                                {lastExec?.error && (
                                    <div className="mt-2 text-[9px] text-red-600 dark:text-red-400 bg-red-500/10 px-2 py-1 rounded border border-red-500/20">
                                        ⚠️ {lastExec.error}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Next Cycle Countdown */}
            {sequence.enabled && sequence.cycle_duration > 0 && (
                <div className="mt-6 pt-4 border-t border-border flex items-center justify-center gap-3">
                    <Clock size={14} className="text-blue-500" />
                    <span className="text-xs text-text-muted uppercase tracking-wider">Next Cycle In:</span>
                    <span className="text-sm font-black text-blue-500 font-mono">{countdown}</span>
                </div>
            )}

            {/* Manual Mode Notice */}
            {sequence.cycle_duration === 0 && (
                <div className="mt-6 pt-4 border-t border-border flex items-center justify-center gap-2 text-xs text-text-muted">
                    <AlertCircle size={12} />
                    <span>Manual trigger mode (no automatic cycling)</span>
                </div>
            )}
        </div>
    );
}

function ConfirmModal({
    isOpen,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    onConfirm,
    onCancel,
    danger = false
}: ConfirmModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[120] flex items-center justify-center p-4">
            <div className="bg-card border border-border max-w-md w-full rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="p-6 border-b border-border">
                    <h3 className="text-xl font-black text-text-primary tracking-tighter flex items-center gap-3">
                        {danger && <AlertCircle size={24} className="text-red-500 dark:text-red-400" />}
                        {title}
                    </h3>
                </div>

                {/* Body */}
                <div className="p-6">
                    <p className="text-sm text-text-secondary leading-relaxed">{message}</p>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-border flex gap-4">
                    <button
                        onClick={onCancel}
                        className="flex-1 px-6 py-3 rounded-xl bg-card-secondary hover:bg-card-hover text-text-muted font-black transition-all text-xs tracking-widest border border-border/50"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`flex-1 px-6 py-3 rounded-xl font-black transition-all text-xs tracking-widest shadow-lg ${danger
                            ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-900/20'
                            : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/20'
                            }`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}

function MetricCard({ title, value, icon }: { title: string, value: string | number, icon: React.ReactNode }) {
    return (
        <div className="bg-card border border-border p-6 rounded-2xl hover:border-blue-500/30 transition-all group shadow-sm hover:shadow-md">
            <div className="flex items-center justify-between mb-4">
                <div className="p-2.5 bg-card-secondary rounded-xl border border-border group-hover:border-border transition-colors">
                    {icon}
                </div>
                <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                    <span className="text-[8px] text-text-muted font-black uppercase tracking-widest">Live</span>
                </div>
            </div>
            <div className="text-2xl font-black text-text-primary tracking-tight mb-1">{value}</div>
            <div className="text-[10px] text-text-muted font-black uppercase tracking-widest">{title}</div>
        </div>
    );
}

function LiveFeed() {
    const [feed, setFeed] = useState<any[]>([]);

    useEffect(() => {
        socket.on('vyos:sequence:step', (data) => {
            setFeed(prev => [
                { ...data, timestamp: Date.now(), id: `${data.sequenceId}-${Date.now()}` },
                ...prev.slice(0, 49) // Keep last 50
            ]);
        });

        return () => {
            socket.off('vyos:sequence:step');
        };
    }, []);

    return (
        <div className="bg-card border border-border rounded-2xl p-6 h-full flex flex-col min-h-[500px] shadow-sm">
            <h3 className="text-sm font-black text-text-muted uppercase tracking-widest mb-6 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                Live Activity Feed
            </h3>
            <div className="space-y-4 overflow-y-auto custom-scrollbar flex-1 pr-2">
                {feed.map(item => (
                    <div key={item.id} className="flex items-start gap-4 text-[11px] animate-in fade-in slide-in-from-top-2 duration-300 border-b border-border/50 pb-3">
                        <div className="text-text-muted/60 font-mono text-[9px] mt-0.5 whitespace-nowrap">
                            {new Date(item.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.status === 'running' ? 'bg-blue-500 animate-pulse' :
                                    item.status === 'success' ? 'bg-green-500' :
                                        'bg-red-500'
                                    }`} />
                                <span className="text-text-primary font-black uppercase tracking-tight truncate">
                                    {item.sequenceId}
                                </span>
                                <ChevronRight size={10} className="text-text-muted/30" />
                                <span className="text-text-muted font-bold uppercase tracking-tighter truncate">{item.step}</span>
                            </div>
                            {item.error && (
                                <div className="text-red-600 dark:text-red-400 text-[10px] bg-red-500/10 px-2 py-1 rounded border border-red-500/20 mt-1">
                                    ⚠️ {item.error}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                {feed.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 text-text-muted">
                        <Activity size={48} className="mb-4 opacity-10 animate-pulse" />
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-30">Awaiting Signal</p>
                        <p className="text-[9px] mt-1 opacity-20 uppercase">Real-time telemetry will appear here</p>
                    </div>
                )}
            </div>
        </div>
    );
}
