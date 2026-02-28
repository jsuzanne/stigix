import React, { useState, useEffect } from 'react';
import {
    RefreshCw, Download, AlertCircle, CheckCircle, Shield, Globe, Lock, Terminal,
    Network, Sliders, ChevronDown, ChevronRight, Server, CheckCircle2, Upload, Power,
    Settings as SettingsIcon, Database, Activity, Cpu, Plus, Edit2, Trash2
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

// Interfaces & Types
interface AppConfig {
    domain: string;
    weight: number;
    endpoint: string;
}

interface Category {
    name: string;
    apps: AppConfig[];
    expanded?: boolean;
}

interface CustomProbe {
    name: string;
    type: 'HTTP' | 'HTTPS' | 'TCP' | 'PING' | 'DNS' | 'UDP';
    target: string;
    timeout: number;
    enabled?: boolean;
}

interface MaintenanceStatus {
    current: string;
    latest: string;
    updateAvailable: boolean;
    dockerReady?: boolean;
}

interface UpgradeStatus {
    inProgress: boolean;
    version: string | null;
    stage: 'idle' | 'pulling' | 'restarting' | 'failed' | 'complete';
    logs: string[];
    error: string | null;
    startTime: number | null;
}

const BetaBadge = ({ className }: { className?: string }) => (
    <span className={cn(
        "px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-amber-500/20 text-amber-400 border border-amber-500/30",
        className
    )}>
        Beta
    </span>
);

export default function Settings({ token }: { token: string }) {
    const [activeTab, setActiveTab] = useState<'interfaces' | 'probes' | 'distribution' | 'maintenance' | 'power' | 'backup'>('interfaces');

    // Shared State
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Config State (from Config.tsx)
    const [categories, setCategories] = useState<Category[]>([]);
    const [interfaces, setInterfaces] = useState<string[]>([]);
    const [availableInterfaces, setAvailableInterfaces] = useState<string[]>([]);
    const [customProbes, setCustomProbes] = useState<CustomProbe[]>([]);
    const [newProbe, setNewProbe] = useState<CustomProbe>({ name: '', type: 'HTTP', target: '', timeout: 5000 });
    const [editingIndex, setEditingIndex] = useState<number | null>(null);

    // Maintenance State (from System.tsx)
    const [status, setStatus] = useState<MaintenanceStatus | null>(null);
    const [upgradeStatus, setUpgradeStatus] = useState<UpgradeStatus | null>(null);
    const [upgrading, setUpgrading] = useState(false);

    const showSuccess = (msg: string) => {
        setSuccessMsg(msg);
        setTimeout(() => setSuccessMsg(null), 3000);
    };

    const authHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };

    // Data Fetching
    useEffect(() => {
        setLoading(true);
        Promise.all([
            // Config data
            fetch('/api/config/apps', { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()),
            fetch('/api/config/interfaces', { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()),
            fetch('/api/connectivity/custom', { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()),
            // System data
            fetch('/api/admin/maintenance/version', { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()),
            fetch('/api/admin/maintenance/status', { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json())
        ]).then(([catsData, ifaceData, probesData, maintenanceData, upgradeData]) => {
            // Config initialization
            setCategories(catsData.map((c: any) => ({ ...c, expanded: true })));
            setInterfaces(ifaceData);
            setCustomProbes(probesData || []);

            // Maintenance initialization
            setStatus(maintenanceData);
            setUpgradeStatus(upgradeData);
            if (upgradeData.inProgress) setUpgrading(true);

            // Fetch ALL detected interfaces
            fetch('/api/config/interfaces?all=true', { headers: { 'Authorization': `Bearer ${token}` } })
                .then(r => r.json())
                .then(setAvailableInterfaces)
                .catch(() => { });

            setLoading(false);
        }).catch(() => setLoading(false));
    }, [token]);

    // Polling for upgrade status
    useEffect(() => {
        const interval = setInterval(async () => {
            try {
                const res = await fetch('/api/admin/maintenance/status', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json();
                if (res.ok) {
                    setUpgradeStatus(data);
                    if (data.inProgress) {
                        setUpgrading(true);
                    } else if (data.stage === 'complete') {
                        showSuccess("Upgrade complete! System is restarting...");
                        setUpgrading(false);
                    } else if (data.stage === 'failed') {
                        setErrorMsg(data.error || 'Upgrade failed');
                        setUpgrading(false);
                    }
                }
            } catch (e) {
                console.error('Failed to fetch upgrade status');
            }
        }, 2000);
        return () => clearInterval(interval);
    }, [token]);

    // Handlers
    const GLOBAL_TOTAL = 1000;

    const handleAppPercentageChange = (categoryName: string, domain: string, newAppPercent: number) => {
        const category = categories.find(c => c.name === categoryName);
        if (!category) return;
        const categoryApps = category.apps;
        const currentCategoryTotalWeight = categoryApps.reduce((s, a) => s + a.weight, 0) || (GLOBAL_TOTAL / categories.length);

        const newApps = categoryApps.map(a => {
            if (a.domain === domain) {
                return { ...a, weight: Math.round((newAppPercent / 100) * currentCategoryTotalWeight) };
            }
            const currentObj = categoryApps.find(o => o.domain === domain);
            const otherPercentOriginal = 100 - (currentObj?.weight || 0) / currentCategoryTotalWeight * 100;
            const otherPercentTarget = 100 - newAppPercent;

            if (otherPercentOriginal <= 0) {
                return { ...a, weight: Math.round((otherPercentTarget / (categoryApps.length - 1) / 100) * currentCategoryTotalWeight) };
            }
            const currentShareOfOthers = (a.weight / currentCategoryTotalWeight * 100) / otherPercentOriginal;
            return { ...a, weight: Math.round((otherPercentTarget * currentShareOfOthers / 100) * currentCategoryTotalWeight) };
        });

        const finalSum = newApps.reduce((s, a) => s + a.weight, 0);
        if (finalSum > 0 && finalSum !== currentCategoryTotalWeight) {
            const ratio = currentCategoryTotalWeight / finalSum;
            newApps.forEach(a => a.weight = Math.round(a.weight * ratio));
        }

        const newCats = categories.map(c => c.name === categoryName ? { ...c, apps: newApps } : c);
        setCategories(newCats);
        saveCategoryBulk(newApps);
    };

    const handleCategoryPercentageChange = (categoryName: string, newGroupPercent: number) => {
        const currentTotal = categories.reduce((sum, c) => sum + c.apps.reduce((asum, a) => asum + a.weight, 0), 0) || GLOBAL_TOTAL;
        const otherCategories = categories.filter(c => c.name !== categoryName);
        const otherCategoriesWeight = otherCategories.reduce((s, c) => s + c.apps.reduce((as, a) => as + a.weight, 0), 0);
        const otherPercentOriginal = (otherCategoriesWeight / currentTotal) * 100;
        const otherPercentTarget = 100 - newGroupPercent;

        const newCats = categories.map(c => {
            const currentCatWeight = c.apps.reduce((s, a) => s + a.weight, 0);
            let targetCatWeight = 0;
            if (c.name === categoryName) {
                targetCatWeight = (newGroupPercent / 100) * currentTotal;
            } else if (otherPercentOriginal <= 0) {
                targetCatWeight = (otherPercentTarget / otherCategories.length / 100) * currentTotal;
            } else {
                const currentShareOfOthers = (currentCatWeight / currentTotal * 100) / otherPercentOriginal;
                targetCatWeight = (otherPercentTarget * currentShareOfOthers / 100) * currentTotal;
            }
            const appCount = c.apps.length;
            if (currentCatWeight <= 0) {
                return { ...c, apps: c.apps.map(a => ({ ...a, weight: Math.round(targetCatWeight / appCount) })) };
            }
            const scale = targetCatWeight / currentCatWeight;
            return { ...c, apps: c.apps.map(a => ({ ...a, weight: Math.round(a.weight * scale) })) };
        });

        const finalGlobalSum = newCats.reduce((sum, c) => sum + c.apps.reduce((as, a) => as + a.weight, 0), 0);
        if (finalGlobalSum > 0 && finalGlobalSum !== GLOBAL_TOTAL) {
            const globalRatio = GLOBAL_TOTAL / finalGlobalSum;
            newCats.forEach(c => c.apps.forEach(a => a.weight = Math.round(a.weight * globalRatio)));
        }
        setCategories(newCats);
        saveAllBulk(newCats);
    };

    const saveCategoryBulk = async (apps: AppConfig[]) => {
        const updates: Record<string, number> = {};
        apps.forEach(a => updates[a.domain] = a.weight);
        try {
            await fetch('/api/config/apps-bulk', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ updates })
            });
        } catch (e) { console.error("Failed to save category bulk"); }
    };

    const saveAllBulk = async (allCats: Category[]) => {
        const updates: Record<string, number> = {};
        allCats.forEach(c => c.apps.forEach(a => updates[a.domain] = a.weight));
        try {
            await fetch('/api/config/apps-bulk', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ updates })
            });
        } catch (e) { console.error("Failed to save all bulk"); }
    };

    const toggleInterface = (iface: string) => {
        const newInterfaces = interfaces.includes(iface)
            ? interfaces.filter(i => i !== iface)
            : [...interfaces, iface];
        setInterfaces(newInterfaces);
        saveInterfaces(newInterfaces);
    };

    const saveInterfaces = async (newInterfaces: string[]) => {
        try {
            await fetch('/api/config/interfaces', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ interfaces: newInterfaces })
            });
            showSuccess('Interfaces saved');
        } catch (e) { console.error('Failed to save interfaces'); }
    };

    const addProbe = async () => {
        if (!newProbe.name || !newProbe.target) return;
        let formattedTarget = newProbe.target.trim();
        if ((newProbe.type === 'HTTP' || newProbe.type === 'HTTPS') && !formattedTarget.startsWith('http://') && !formattedTarget.startsWith('https://')) {
            formattedTarget = `${newProbe.type.toLowerCase()}://${formattedTarget}`;
        }
        const probeToSave = { ...newProbe, target: formattedTarget, enabled: newProbe.enabled ?? true };
        let updatedProbes: CustomProbe[];
        if (editingIndex !== null) {
            updatedProbes = [...customProbes];
            updatedProbes[editingIndex] = probeToSave;
            setEditingIndex(null);
        } else {
            updatedProbes = [...customProbes, probeToSave];
        }
        await saveProbes(updatedProbes);
        setCustomProbes(updatedProbes);
        setNewProbe({ name: '', type: 'HTTP', target: '', timeout: 5000 });
    };

    const saveProbes = async (probes: CustomProbe[]) => {
        try {
            await fetch('/api/connectivity/custom', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ endpoints: probes })
            });
            showSuccess('Probes updated');
        } catch (e) { console.error('Failed to save probes'); }
    };

    const startEditProbe = (index: number) => {
        const probe = customProbes[index];
        setNewProbe({ ...probe });
        setEditingIndex(index);
    };

    const deleteProbe = async (index: number) => {
        const updatedProbes = customProbes.filter((_, i) => i !== index);
        await saveProbes(updatedProbes);
        setCustomProbes(updatedProbes);
    };

    const toggleProbeEnabled = async (index: number) => {
        const updatedProbes = [...customProbes];
        updatedProbes[index].enabled = !updatedProbes[index].enabled;
        await saveProbes(updatedProbes);
        setCustomProbes(updatedProbes);
    };

    const handleExportProbes = async () => {
        try {
            const res = await fetch('/api/connectivity/custom/export', { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                const data = await res.json();
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `probes-config-${new Date().toISOString().split('T')[0]}.json`;
                a.click();
            }
        } catch (e) { alert('Export failed'); }
    };

    const handleImportProbes = async (content: string) => {
        try {
            const data = JSON.parse(content);
            const endpoints = Array.isArray(data) ? data : data.endpoints;
            if (!endpoints) throw new Error("Invalid format");

            await fetch('/api/connectivity/custom', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ endpoints })
            });
            showSuccess('Probes imported successfully');
            setTimeout(() => window.location.reload(), 1500);
        } catch (e) { alert('Import failed: ' + (e as Error).message); }
    };

    const handleExportApps = async () => {
        try {
            const res = await fetch('/api/config/applications/export?format=json', { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                const data = await res.json();
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `applications-config-${new Date().toISOString().split('T')[0]}.json`;
                a.click();
            }
        } catch (e) { alert('Export failed'); }
    };

    const handleImportApps = async (content: string) => {
        try {
            const res = await fetch('/api/config/applications/import', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ content })
            });
            if (res.ok) {
                showSuccess('Applications imported successfully');
                setTimeout(() => window.location.reload(), 1500);
            } else {
                const err = await res.json();
                throw new Error(err.error || 'Server error');
            }
        } catch (e) { alert('Import failed: ' + (e as Error).message); }
    };

    const handleUpgrade = async () => {
        if (!status?.latest) return;
        if (!confirm(`This will pull v${status.latest} images and restart the dashboard. Proceed?`)) return;
        setUpgrading(true);
        setErrorMsg(null);
        try {
            const res = await fetch('/api/admin/maintenance/upgrade', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ version: status.latest })
            });
            if (res.ok) {
                showSuccess(`Upgrade to v${status.latest} started in background.`);
            } else {
                const data = await res.json();
                setErrorMsg(data.details || data.error || 'Upgrade failed');
                setUpgrading(false);
            }
        } catch (e) {
            setErrorMsg('Connection lost during upgrade initiation');
            setUpgrading(false);
        }
    };

    const handleRestart = async (type: 'restart' | 'redeploy') => {
        const msg = type === 'restart'
            ? 'Are you sure you want to restart all services? The dashboard will be briefly unavailable.'
            : 'This will recreate containers and reload configuration. Are you sure?';
        if (!confirm(msg)) return;
        setUpgrading(true);
        try {
            await fetch('/api/admin/maintenance/restart', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ type })
            });
        } catch (e) { setUpgrading(false); }
    };

    if (loading) return <div className="p-8 text-center text-text-muted animate-pulse font-bold uppercase tracking-widest text-xs">Loading Settings...</div>;

    const tabs = [
        { id: 'interfaces', label: 'Network Interfaces' },
        { id: 'probes', label: 'Synthetic Probes' },
        { id: 'distribution', label: 'Traffic Distribution' },
        { id: 'maintenance', label: 'System Maintenance' },
        { id: 'power', label: 'Power & Restart' },
        { id: 'backup', label: 'Configuration Backup' },
    ];

    return (
        <div className="space-y-6 animate-in fade-in duration-500 w-full">
            {/* Header / Nav */}
            <div className="bg-card border border-border p-6 rounded-2xl shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-purple-600/10 rounded-xl">
                            <SettingsIcon size={24} className="text-purple-500" />
                        </div>
                        <div>
                            <div className="flex items-center gap-3">
                                <h2 className="text-2xl font-black text-text-primary tracking-tight">Settings</h2>
                                <span className="text-[10px] text-text-muted font-bold uppercase tracking-widest opacity-60">Control Center • {status?.current || 'v1.2.1-patch.112'}</span>
                            </div>
                            <div className="flex items-center gap-4 mt-1">
                                {tabs.map((tab) => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id as any)}
                                        className={cn(
                                            "text-xs font-bold tracking-wider transition-colors pt-1",
                                            activeTab === tab.id
                                                ? "text-purple-500 border-b-2 border-purple-500 pb-1"
                                                : "text-text-muted hover:text-text-secondary"
                                        )}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Success/Error Toasts */}
            {successMsg && (
                <div className="fixed top-24 right-8 bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 px-6 py-3.5 rounded-2xl flex items-center gap-3 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-4 z-50">
                    <CheckCircle size={18} />
                    <span className="text-[10px] font-black uppercase tracking-[0.15em]">{successMsg}</span>
                </div>
            )}
            {errorMsg && (
                <div className="fixed top-24 right-8 bg-red-600/10 border border-red-500/20 text-red-600 dark:text-red-400 px-6 py-3.5 rounded-2xl flex items-center gap-3 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-4 z-50">
                    <AlertCircle size={18} />
                    <span className="text-[10px] font-black uppercase tracking-[0.15em]">{errorMsg}</span>
                </div>
            )}

            {/* Active Tab Content */}
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                {activeTab === 'interfaces' && (
                    <div className="bg-card border border-border rounded-2xl p-8 shadow-sm space-y-8">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-purple-600/10 rounded-lg text-purple-600 dark:text-purple-400 font-bold">
                                <Network size={20} />
                            </div>
                            <div>
                                <h2 className="text-lg font-black text-text-primary tracking-tight">Network Interfaces</h2>
                                <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mt-1 opacity-70">Physical interfaces for traffic egress</p>
                            </div>
                        </div>

                        <div className="flex flex-col gap-6">
                            <div className="flex gap-4 items-center">
                                <input
                                    type="text"
                                    placeholder="inject interface name (e.g. eth0)..."
                                    className="flex-1 bg-card-secondary/50 border border-border text-[11px] font-black tracking-widest text-text-primary rounded-xl px-5 py-3 outline-none focus:ring-1 focus:ring-purple-500 transition-all shadow-inner"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            const val = e.currentTarget.value.trim();
                                            if (val && !interfaces.includes(val)) {
                                                toggleInterface(val);
                                                e.currentTarget.value = '';
                                            }
                                        }
                                    }}
                                />
                                <button
                                    onClick={(e) => {
                                        const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                                        const val = input.value.trim();
                                        if (val && !interfaces.includes(val)) {
                                            toggleInterface(val);
                                            input.value = '';
                                        }
                                    }}
                                    className="bg-purple-600 hover:bg-purple-500 text-white px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2 shadow-lg shadow-purple-900/20"
                                >
                                    <Plus size={16} />
                                    Register
                                </button>
                            </div>

                            <div className="flex flex-wrap gap-2.5">
                                {availableInterfaces.map(iface => {
                                    const isSelected = interfaces.includes(iface);
                                    return (
                                        <button
                                            key={iface}
                                            onClick={() => toggleInterface(iface)}
                                            className={cn(
                                                "px-4 py-2 rounded-xl text-[10px] font-black border transition-all flex items-center gap-3 uppercase tracking-widest shadow-sm",
                                                isSelected
                                                    ? "bg-purple-600/10 border-purple-500/30 text-purple-600 dark:text-purple-400"
                                                    : "bg-card-secondary/30 border-border text-text-muted hover:border-text-muted/30"
                                            )}
                                        >
                                            <div className={cn("w-1.5 h-1.5 rounded-full", isSelected ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-text-muted/30")} />
                                            {iface}
                                            {isSelected && <CheckCircle2 size={12} />}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'probes' && (
                    <div className="bg-card border border-border rounded-2xl p-8 shadow-sm space-y-8">
                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-600/10 rounded-lg text-blue-600 dark:text-blue-400">
                                    <Activity size={20} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-black text-text-primary tracking-tight">Synthetic Probes (DEM)</h2>
                                    <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mt-1 opacity-70">Custom telemetry for real-time monitoring</p>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleExportProbes}
                                    className="px-4 py-2 bg-card-secondary hover:bg-card-hover border border-border rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2"
                                >
                                    <Download size={14} />
                                    Export
                                </button>
                                <input
                                    type="file"
                                    id="import-probes"
                                    className="hidden"
                                    accept=".json"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                            const reader = new FileReader();
                                            reader.onload = (ev) => handleImportProbes(ev.target?.result as string);
                                            reader.readAsText(file);
                                        }
                                    }}
                                />
                                <button
                                    onClick={() => document.getElementById('import-probes')?.click()}
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 shadow-lg shadow-blue-900/20"
                                >
                                    <Upload size={14} />
                                    Import
                                </button>
                            </div>
                        </div>

                        <div className="max-w-4xl mx-auto space-y-8">
                            <div className="grid grid-cols-1 md:grid-cols-5 gap-6 bg-card-secondary/30 p-6 rounded-2xl border border-border shadow-inner">
                                <div className="space-y-2">
                                    <label className="text-[9px] font-black text-text-muted uppercase tracking-[0.2em] ml-1">Probe Name</label>
                                    <input
                                        type="text"
                                        placeholder="HQ-GATEWAY"
                                        className="w-full bg-card border border-border text-text-primary rounded-xl px-4 py-2.5 outline-none focus:ring-1 focus:ring-blue-500 text-[11px] font-black tracking-widest shadow-sm"
                                        value={newProbe.name}
                                        onChange={e => setNewProbe({ ...newProbe, name: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[9px] font-black text-text-muted uppercase tracking-[0.2em] ml-1">Protocol</label>
                                    <select
                                        className="w-full bg-card border border-border text-text-primary rounded-xl px-4 py-2.5 outline-none focus:ring-1 focus:ring-blue-500 text-[11px] font-black uppercase tracking-widest shadow-sm"
                                        value={newProbe.type}
                                        onChange={e => setNewProbe({ ...newProbe, type: e.target.value as any, timeout: e.target.value === 'PING' ? 2000 : 5000 })}
                                    >
                                        <option value="HTTP">HTTP</option>
                                        <option value="HTTPS">HTTPS</option>
                                        <option value="PING">ICMP</option>
                                        <option value="TCP">TCP</option>
                                        <option value="DNS">DNS</option>
                                        <option value="UDP">UDP</option>
                                    </select>
                                </div>
                                <div className="md:col-span-2 space-y-2">
                                    <label className="text-[9px] font-black text-text-muted uppercase tracking-[0.2em] ml-1">Target URI/IP</label>
                                    <input
                                        type="text"
                                        placeholder="google.com"
                                        className="w-full bg-card border border-border text-text-primary rounded-xl px-4 py-2.5 outline-none focus:ring-1 focus:ring-blue-500 text-[11px] font-black tracking-widest shadow-sm"
                                        value={newProbe.target}
                                        onChange={e => setNewProbe({ ...newProbe, target: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2 flex flex-col justify-end">
                                    <button
                                        onClick={addProbe}
                                        className="w-full bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20"
                                    >
                                        <Plus size={16} />
                                        {editingIndex !== null ? 'Update' : 'Initialize'}
                                    </button>
                                </div>
                            </div>

                            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                                {customProbes.map((probe, idx) => (
                                    <div key={idx} className={cn(
                                        "group bg-card border border-border hover:border-blue-500/30 rounded-2xl p-5 pr-2 flex items-center justify-between transition-all shadow-sm",
                                        probe.enabled === false && "opacity-50"
                                    )}>
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center text-[10px] font-black">
                                                {probe.type.substring(0, 3)}
                                            </div>
                                            <div>
                                                <div className="text-[11px] font-black text-text-primary uppercase tracking-tight">{probe.name}</div>
                                                <div className="text-[10px] text-text-muted font-mono tracking-tighter truncate max-w-[140px] opacity-70">{probe.target}</div>
                                            </div>
                                        </div>
                                        <div className="flex gap-1.5 px-2">
                                            <button
                                                onClick={() => toggleProbeEnabled(idx)}
                                                className={cn(
                                                    "p-2 rounded-xl transition-all",
                                                    probe.enabled ? "text-green-500 hover:bg-green-500/10" : "text-text-muted hover:bg-card-hover"
                                                )}
                                                title="Toggle Probe"
                                            >
                                                <Power size={14} />
                                            </button>
                                            <button
                                                onClick={() => startEditProbe(idx)}
                                                className="p-2 hover:bg-card-hover rounded-xl text-text-muted transition-all"
                                                title="Edit Probe"
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                            <button
                                                onClick={() => deleteProbe(idx)}
                                                className="p-2 hover:bg-red-600/10 rounded-xl text-text-muted hover:text-red-500 transition-all"
                                                title="Remove Probe"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'distribution' && (
                    <div className="bg-card border border-border rounded-2xl p-8 shadow-sm space-y-8">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-600/10 rounded-lg text-blue-600 dark:text-blue-400 font-bold">
                                    <Sliders size={20} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-black text-text-primary tracking-tight">Traffic Distribution</h2>
                                    <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mt-1 opacity-70">Adjust weights by category or individual app</p>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleExportApps}
                                    className="px-4 py-2 bg-card-secondary hover:bg-card-hover border border-border rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2"
                                >
                                    <Download size={14} />
                                    Export
                                </button>
                                <input
                                    type="file"
                                    id="import-apps"
                                    className="hidden"
                                    accept=".json,.txt"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                            const reader = new FileReader();
                                            reader.onload = (ev) => handleImportApps(ev.target?.result as string);
                                            reader.readAsText(file);
                                        }
                                    }}
                                />
                                <button
                                    onClick={() => document.getElementById('import-apps')?.click()}
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 shadow-lg shadow-blue-900/20"
                                >
                                    <Upload size={14} />
                                    Import
                                </button>
                            </div>
                        </div>

                        <div className="max-w-7xl mx-auto space-y-4">
                            {categories.map(category => {
                                const categoryWeight = category.apps.reduce((s, a) => s + a.weight, 0);
                                const categoryPercent = Math.round((categoryWeight / GLOBAL_TOTAL) * 100);
                                return (
                                    <div key={category.name} className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
                                        <div className="bg-card-secondary/30 p-5 flex items-center justify-between border-b border-border">
                                            <div className="flex items-center gap-3 text-[11px] font-black text-text-primary uppercase tracking-widest">
                                                <Database size={14} className="text-blue-600" />
                                                {category.name}
                                            </div>
                                            <div className="flex items-center gap-6">
                                                <span className="text-xs font-black text-blue-600 dark:text-blue-400">{categoryPercent}%</span>
                                                <input
                                                    type="range"
                                                    min="1" max="100"
                                                    className="w-32 accent-blue-600 h-1 bg-card-secondary border border-border rounded-lg"
                                                    value={categoryPercent}
                                                    onChange={(e) => handleCategoryPercentageChange(category.name, parseInt(e.target.value))}
                                                />
                                            </div>
                                        </div>
                                        <div className="p-6 grid gap-4 grid-cols-1 lg:grid-cols-2">
                                            {category.apps.slice(0, 4).map(app => {
                                                const appPercent = categoryWeight > 0 ? Math.round((app.weight / categoryWeight) * 100) : 0;
                                                return (
                                                    <div key={app.domain} className="bg-card-secondary/20 border border-border rounded-xl p-4 space-y-3">
                                                        <div className="flex justify-between items-center">
                                                            <span className="text-[10px] font-black uppercase text-text-primary truncate max-w-[150px]">{app.domain}</span>
                                                            <span className="text-[10px] font-black text-blue-600">{appPercent}%</span>
                                                        </div>
                                                        <input
                                                            type="range"
                                                            min="0" max="100"
                                                            value={appPercent}
                                                            onChange={(e) => handleAppPercentageChange(category.name, app.domain, parseInt(e.target.value))}
                                                            className="w-full accent-blue-600 h-1 bg-card border border-border rounded-lg"
                                                        />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {activeTab === 'maintenance' && (
                    <div className="bg-card border border-border rounded-2xl p-8 shadow-sm space-y-8">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-600/10 rounded-lg text-blue-600 dark:text-blue-400">
                                <RefreshCw size={24} className={upgrading ? "animate-spin" : ""} />
                            </div>
                            <div>
                                <h2 className="text-lg font-black text-text-primary tracking-tight">System Maintenance</h2>
                                <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mt-0.5 opacity-70">Update system logic and engine</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <div className="flex justify-between items-center p-4 bg-card-secondary/50 rounded-xl border border-border">
                                    <span className="text-[10px] text-text-muted font-black uppercase tracking-widest">Current Version</span>
                                    <span className="text-sm font-mono text-blue-600 font-bold">{status?.current}</span>
                                </div>
                                <div className="flex justify-between items-center p-4 bg-card-secondary/50 rounded-xl border border-border">
                                    <span className="text-[10px] text-text-muted font-black uppercase tracking-widest">Latest Stable</span>
                                    <span className="text-sm font-mono text-green-600 font-bold">{status?.latest}</span>
                                </div>
                            </div>

                            <div className="bg-blue-600/5 border border-blue-500/20 rounded-2xl p-6 flex flex-col justify-between gap-4">
                                <p className="text-[11px] font-bold text-text-primary leading-relaxed">
                                    {status?.updateAvailable
                                        ? `A newer version (v${status.latest}) is available on GitHub and ready to pull.`
                                        : "Your system is currently running the latest stable release of the Stigix platform."}
                                </p>
                                <button
                                    onClick={handleUpgrade}
                                    disabled={upgrading || !status?.updateAvailable}
                                    className={cn(
                                        "w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all",
                                        (upgrading || !status?.updateAvailable)
                                            ? "bg-card-secondary text-text-muted border border-border cursor-not-allowed"
                                            : "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/40"
                                    )}
                                >
                                    {upgrading ? <RefreshCw className="animate-spin" size={14} /> : <Download size={14} />}
                                    {upgrading ? 'Upgrading...' : 'Update To Latest'}
                                </button>
                            </div>
                        </div>

                        {upgrading && upgradeStatus && (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-blue-600">Upgrade Monitor</span>
                                    <span className="text-[10px] font-mono opacity-50">{upgradeStatus.logs.length} events logged</span>
                                </div>
                                <div className="bg-black/20 rounded-2xl border border-border p-4 h-64 overflow-y-auto font-mono text-[10px] leading-relaxed scrollbar-thin scrollbar-thumb-border">
                                    {upgradeStatus.logs.map((log, i) => (
                                        <div key={i} className="mb-1 opacity-80">{log}</div>
                                    ))}
                                    <div className="animate-pulse inline-block w-1.5 h-3 bg-blue-600 ml-1" />
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'power' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-card border border-border rounded-2xl p-8 shadow-sm space-y-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-amber-600/10 rounded-lg text-amber-600 font-bold">
                                    <Terminal size={24} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-black text-text-primary tracking-tight">Service Restart</h2>
                                    <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mt-0.5 opacity-70">Soft reload of internal components</p>
                                </div>
                            </div>
                            <p className="text-xs text-text-muted font-bold italic opacity-60">Memory cleanup and internal state reset. Fast completion.</p>
                            <button
                                onClick={() => handleRestart('restart')}
                                disabled={upgrading}
                                className="w-full py-4 bg-card-secondary hover:bg-card-hover border border-border rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm"
                            >
                                <RefreshCw size={16} className="inline mr-2" />
                                Restart Containers
                            </button>
                        </div>

                        <div className="bg-card border border-border rounded-2xl p-8 shadow-sm space-y-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-red-600/10 rounded-lg text-red-600 font-bold">
                                    <Cpu size={24} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-black text-text-primary tracking-tight">System Redeploy</h2>
                                    <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mt-0.5 opacity-70">Full stack container recreation</p>
                                </div>
                            </div>
                            <p className="text-xs text-text-muted font-bold italic opacity-60">Applies docker-compose and environment changes. Temporary downtime.</p>
                            <button
                                onClick={() => handleRestart('redeploy')}
                                disabled={upgrading}
                                className="w-full py-4 bg-red-600/10 hover:bg-red-600/20 border border-red-500/30 text-red-600 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm"
                            >
                                <Power size={16} className="inline mr-2" />
                                Redepoy Stack
                            </button>
                        </div>
                    </div>
                )}

                {activeTab === 'backup' && (
                    <div className="bg-card border border-border rounded-2xl p-8 shadow-sm space-y-8">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-green-600/10 rounded-lg text-green-600 font-bold">
                                <Database size={24} />
                            </div>
                            <div>
                                <h2 className="text-lg font-black text-text-primary tracking-tight">Configuration Backup</h2>
                                <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mt-0.5 opacity-70">Import/Export system state and settings</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-4">
                                <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-text-primary">Export Engine State</h3>
                                <p className="text-xs text-text-muted font-bold opacity-60">Download a secure JSON bundle containing all your rules and account data.</p>
                                <button
                                    onClick={async () => {
                                        try {
                                            const res = await fetch('/api/admin/config/export', { headers: { 'Authorization': `Bearer ${token}` } });
                                            if (res.ok) {
                                                const data = await res.json();
                                                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                                                const url = window.URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.href = url;
                                                a.download = `stigix-backup-${new Date().toISOString().split('T')[0]}.json`;
                                                a.click();
                                            }
                                        } catch (e) { alert('Export failed'); }
                                    }}
                                    className="px-6 py-3 bg-card-secondary hover:bg-card-hover border border-border rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2"
                                >
                                    <Download size={16} />
                                    Download Bundle
                                </button>
                            </div>

                            <div className="space-y-4">
                                <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-text-primary">Restore State</h3>
                                <p className="text-xs text-text-muted font-bold opacity-60">Upload a previously exported bundle to overwrite the current system configuration.</p>
                                <div className="flex gap-2">
                                    <input
                                        type="file"
                                        id="restore-upload"
                                        className="hidden"
                                        accept=".json"
                                        onChange={async (e) => {
                                            const file = e.target.files?.[0];
                                            if (!file || !confirm('OVERWRITE SYSTEM STATE? This action cannot be undone.')) return;
                                            const reader = new FileReader();
                                            reader.onload = async (ev) => {
                                                try {
                                                    const bundle = JSON.parse(ev.target?.result as string);
                                                    const res = await fetch('/api/admin/config/import', {
                                                        method: 'POST',
                                                        headers: authHeaders,
                                                        body: JSON.stringify({ bundle })
                                                    });
                                                    if (res.ok) {
                                                        showSuccess('Restore success! Reloading...');
                                                        setTimeout(() => window.location.reload(), 2000);
                                                    }
                                                } catch (err) { alert('Invalid file'); }
                                            };
                                            reader.readAsText(file);
                                        }}
                                    />
                                    <button
                                        onClick={() => document.getElementById('restore-upload')?.click()}
                                        className="px-6 py-3 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/20 text-blue-600 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2"
                                    >
                                        <Upload size={16} />
                                        Restore Bundle
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
