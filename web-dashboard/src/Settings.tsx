import React, { useState, useEffect } from 'react';
import {
    RefreshCw, Download, AlertCircle, CheckCircle, Shield, Globe, Lock, Terminal,
    Network, Sliders, ChevronDown, ChevronRight, Server, CheckCircle2, Upload, Power,
    Settings as SettingsIcon, Database, Activity, Cpu, Plus, Edit2, Trash2, MapPin, Zap, Info, XCircle, ShieldAlert
} from 'lucide-react';
import { clsx } from 'clsx';
import { Favicon } from './components/Favicon';
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
    type: 'HTTP' | 'HTTPS' | 'TCP' | 'PING' | 'DNS' | 'UDP' | 'CLOUD';
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

// ─── Targets Registry ────────────────────────────────────────────────────────
type TargetCapability = {
    voice: boolean;
    convergence: boolean;
    xfr: boolean;
    security: boolean;
    connectivity: boolean;
};

type TargetDefinition = {
    id: string;
    name: string;
    host: string;
    enabled: boolean;
    capabilities: TargetCapability;
    ports?: {
        voice?: number;
        convergence?: number;
        iperf?: number;
        http?: number;
        xfr?: number;
    };
    source?: 'managed' | 'synthesized';
    meta?: {
        registry?: boolean;
        location?: any;
        ip_public?: string;
        last_seen?: string;
        [key: string]: any;
    };
};

const EMPTY_TARGET_CAPS: TargetCapability = {
    voice: true, convergence: true, xfr: true, security: true, connectivity: true,
};

const EMPTY_TARGET: Omit<TargetDefinition, 'id' | 'source'> = {
    name: '',
    host: '',
    enabled: true,
    capabilities: { ...EMPTY_TARGET_CAPS },
};
// ─────────────────────────────────────────────────────────────────────────────

const BetaBadge = ({ className }: { className?: string }) => (
    <span className={cn(
        "px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-amber-500/20 text-amber-400 border border-amber-500/30",
        className
    )}>
        Beta
    </span>
);

export default function Settings({ token }: { token: string }) {
    const [activeTab, setActiveTab] = useState<'probes' | 'distribution' | 'maintenance' | 'system' | 'targets' | 'convergence' | 'registry' | 'targetService' | 'mcp' | 'strata'>('distribution');

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

    // System Info State
    const [systemInfo, setSystemInfo] = useState<any>(null);

    // Targets State
    const [targets, setTargets] = useState<TargetDefinition[]>([]);
    const [newTarget, setNewTarget] = useState<Omit<TargetDefinition, 'id' | 'source'>>(EMPTY_TARGET);
    const [targetError, setTargetError] = useState<string | null>(null);
    const [editingTargetId, setEditingTargetId] = useState<string | null>(null);
    const [showTargetPorts, setShowTargetPorts] = useState(false);
    const [registryStatus, setRegistryStatus] = useState<any>(null);
    const [staticLeaderUrl, setStaticLeaderUrl] = useState<string>('');
    const [isTestingConnectivity, setIsTestingConnectivity] = useState(false);
    const [connectivityResult, setConnectivityResult] = useState<{ success?: boolean; error?: string } | null>(null);

    const authHeaders = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    const [cloudScenarios, setCloudScenarios] = useState<any[]>([]);
    const [cloudConfig, setCloudConfig] = useState<{ baseUrl: string; hasKey: boolean; scenarioCount: number } | null>(null);
    // Convergence State
    const [convergenceThresholds, setConvergenceThresholds] = useState({ good: 1, degraded: 5, critical: 10 });
    const [mcpStatus, setMcpStatus] = useState<{ online: boolean; status?: string; transport?: string; url?: string; error?: string } | null>(null);
    const [slsConfig, setSlsConfig] = useState<any>(null);

    const showSuccess = (msg: string) => {
        setSuccessMsg(msg);
        setTimeout(() => setSuccessMsg(null), 3000);
    };

    // Data Fetching
    useEffect(() => {
        setLoading(true);
        // Core Config data - Must load for initial page state
        Promise.all([
            fetch('/api/config/apps', { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()),
            fetch('/api/config/interfaces', { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()),
            fetch('/api/connectivity/custom', { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()),
        ]).then(([catsData, ifaceData, probesData]) => {
            setCategories(catsData.map((c: any) => ({ ...c, expanded: true })));
            setInterfaces(ifaceData);
            setCustomProbes(probesData || []);

            // Fetch Cloud Scenarios
            fetch('/api/target/scenarios', { headers: authHeaders })
                .then(r => r.json())
                .then(data => {
                    // Filter out EICAR for performance probes as requested
                    const filtered = (data || []).filter((s: any) => s.id !== 'security-eicar');
                    setCloudScenarios(filtered);
                })
                .catch(() => { });

            // Fetch Cloud Config
            fetch('/api/target/config', { headers: authHeaders })
                .then(r => r.json())
                .then(setCloudConfig)
                .catch(() => { });

            // Fetch ALL detected interfaces (secondary)
            fetch('/api/config/interfaces?all=true', { headers: { 'Authorization': `Bearer ${token}` } })
                .then(r => r.json())
                .then(setAvailableInterfaces)
                .catch(() => { });

            setLoading(false);
        }).catch(() => setLoading(false));

        // Targets
        fetch('/api/targets', { headers: authHeaders })
            .then(r => r.json())
            .then(data => setTargets(Array.isArray(data) ? data : []))
            .catch(() => { });

        // System/Maintenance data - Decoupled to avoid blocking initial load
        const fetchMaintenanceStatus = () => {
            fetch('/api/admin/maintenance/version', { headers: { 'Authorization': `Bearer ${token}` } })
                .then(r => r.json())
                .then(maintenanceData => {
                    setStatus(maintenanceData);
                })
                .catch(() => { });

            fetch('/api/admin/maintenance/status', { headers: { 'Authorization': `Bearer ${token}` } })
                .then(r => r.json())
                .then(upgradeData => {
                    setUpgradeStatus(upgradeData);
                    if (upgradeData.inProgress) setUpgrading(true);
                })
                .catch(() => { });
        };
        fetchMaintenanceStatus();

        // Fetch System Info
        const fetchSystemInfo = () => {
            fetch('/api/admin/system/info', { headers: { 'Authorization': `Bearer ${token}` } })
                .then(r => r.json())
                .then(newInfo => {
                    setSystemInfo((prev: any) => {
                        const now = Date.now();
                        if (prev && prev.network && newInfo.network && prev.timestamp) {
                            const timeDiff = (now - prev.timestamp) / 1000;
                            if (timeDiff > 0) {
                                const rxSpeed = ((newInfo.network.rx - prev.network.rx) * 8) / 1000000 / timeDiff;
                                const txSpeed = ((newInfo.network.tx - prev.network.tx) * 8) / 1000000 / timeDiff;
                                return { ...newInfo, networkSpeed: { rx: Math.max(0, rxSpeed), tx: Math.max(0, txSpeed) }, timestamp: now };
                            }
                        }
                        return { ...newInfo, networkSpeed: { rx: 0, tx: 0 }, timestamp: now };
                    });
                })
                .catch(() => { });
        };
        fetchSystemInfo();
        const sysInfoInterval = setInterval(fetchSystemInfo, 5000);

        // Fetch Convergence Thresholds
        fetch('/api/config/convergence', { headers: { 'Authorization': `Bearer ${token}` } })
            .then(r => r.json())
            .then(data => {
                if (data && typeof data === 'object' && 'good' in data) {
                    setConvergenceThresholds(data);
                }
            })
            .catch(() => { });

        // Fetch Registry Status
        const fetchRegistryStatus = () => {
            fetch('/api/registry/status', { headers: authHeaders })
                .then(r => r.json())
                .then(setRegistryStatus)
                .catch(e => console.error("Failed to fetch registry status", e));
        };
        fetchRegistryStatus();

        // Fetch SLS Config
        fetch('/api/security/config', { headers: authHeaders })
            .then(r => r.json())
            .then(data => {
                if (data && data.sls_config) {
                    setSlsConfig(data.sls_config);
                } else {
                    setSlsConfig({}); // Fix hang if sls_config is missing
                }
            })
            .catch(() => { 
                setSlsConfig({}); // Fix hang on error
            });

        const fetchMcpStatus = () => {
            fetch('/api/admin/system/mcp-status', { headers: authHeaders })
                .then(r => r.json())
                .then(setMcpStatus)
                .catch(e => console.error("Failed to fetch MCP status", e));
        };
        fetchMcpStatus();
        const mcpInterval = setInterval(fetchMcpStatus, 15000);

        return () => {
            clearInterval(sysInfoInterval);
            clearInterval(mcpInterval);
        };

    }, [token]);

    // Polling for upgrade status and registry status
    useEffect(() => {
        const fetchMaintenanceStatus = async () => {
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
        };

        const fetchRegistryStatus = async () => {
            try {
                const res = await fetch('/api/registry/status', { headers: authHeaders });
                const data = await res.json();
                if (res.ok) {
                    setRegistryStatus(data);
                }
            } catch (e) {
                console.error('Failed to fetch registry status');
            }
        };

        fetchMaintenanceStatus();
        fetchRegistryStatus();
        const interval = setInterval(() => {
            fetchMaintenanceStatus();
            fetchRegistryStatus();
        }, 30000);
        return () => clearInterval(interval);
    }, [token]);

    useEffect(() => {
        if (registryStatus?.static_leader_url && !staticLeaderUrl) {
            setStaticLeaderUrl(registryStatus.static_leader_url);
        }
    }, [registryStatus?.static_leader_url]);

    const previewControllerUrl = (input: string) => {
        if (!input) return '';
        let val = input.trim();
        if (!val.startsWith('http')) val = `http://${val}`;
        try {
            const url = new URL(val);
            const hostPart = val.split('://')[1] || '';
            const portPart = hostPart.split('/')[0] || '';
            if (!portPart.includes(':') && url.port === '') url.port = '8080';
            if (url.pathname === '/' || url.pathname === '') url.pathname = '/api/registry';
            else if (!url.pathname.includes('/api/registry')) {
                url.pathname = url.pathname.replace(/\/$/, '') + '/api/registry';
            }
            return url.toString().replace(/\/$/, '');
        } catch (e) {
            return val;
        }
    };

    const handleTestConnectivity = async () => {
        if (!staticLeaderUrl) return;
        setIsTestingConnectivity(true);
        setConnectivityResult(null);
        try {
            const res = await fetch('/api/registry/test-connectivity', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ url: staticLeaderUrl })
            });
            const data = await res.json();
            if (res.ok && data.status === 'ok') {
                setConnectivityResult({ success: true });
            } else {
                setConnectivityResult({ success: false, error: data.error || 'Connection failed' });
            }
        } catch (e) {
            setConnectivityResult({ success: false, error: String(e) });
        } finally {
            setIsTestingConnectivity(false);
        }
    };

    const handleSaveStaticLeader = async (url: string | null) => {
        setSaving(true);
        try {
            const res = await fetch('/api/registry/static-leader', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ url })
            });
            if (res.ok) {
                showSuccess(url ? "Static Leader configured!" : "Reverted to auto-discovery");
                // Refresh status
                const sres = await fetch('/api/registry/status', { headers: authHeaders });
                const sdata = await sres.json();
                setRegistryStatus(sdata);
            } else {
                setErrorMsg("Failed to save static leader");
            }
        } catch (e) {
            setErrorMsg(String(e));
        } finally {
            setSaving(false);
        }
    };

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
                let errMsg = `HTTP ${res.status}`;
                try { const b = await res.json(); errMsg = b.error || b.detail || errMsg; } catch { }
                throw new Error(errMsg);
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

    const saveConvergenceThresholds = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/config/convergence', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(convergenceThresholds)
            });
            if (res.ok) {
                showSuccess('Convergence thresholds saved');
            } else {
                setErrorMsg('Failed to save thresholds');
            }
        } catch (e) {
            setErrorMsg('Network error');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="p-8 text-center text-text-muted animate-pulse font-bold tracking-widest text-xs">Loading Settings...</div>;

    // ─── Target CRUD Handlers ────────────────────────────────────────────────
    const fetchTargets = () => fetch('/api/targets', { headers: authHeaders })
        .then(r => r.json()).then(d => setTargets(Array.isArray(d) ? d : []));

    const saveTarget = async () => {
        setTargetError(null);
        if (!newTarget.name.trim() || !newTarget.host.trim()) {
            setTargetError('Name and host (IP or FQDN) are required');
            return;
        }
        try {
            let res;
            if (editingTargetId) {
                res = await fetch(`/api/targets/${editingTargetId}`, {
                    method: 'PUT', headers: authHeaders, body: JSON.stringify(newTarget)
                });
            } else {
                res = await fetch('/api/targets', {
                    method: 'POST', headers: authHeaders, body: JSON.stringify(newTarget)
                });
            }
            if (!res.ok) {
                let errMsg = `HTTP ${res.status}`;
                try { const body = await res.json(); errMsg = body.error || body.detail || errMsg; } catch { }
                throw new Error(errMsg);
            }
            showSuccess(editingTargetId ? 'Target updated' : 'Target added');
            setNewTarget({ ...EMPTY_TARGET, capabilities: { ...EMPTY_TARGET_CAPS } });
            setEditingTargetId(null);
            setShowTargetPorts(false);
            fetchTargets();
        } catch (e: any) { setTargetError(e.message); }
    };

    const startEditTarget = (t: TargetDefinition) => {
        setEditingTargetId(t.id);
        setNewTarget({ name: t.name, host: t.host, enabled: t.enabled, capabilities: { ...t.capabilities }, ports: t.ports ? { ...t.ports } : undefined });
        setTargetError(null);
    };

    const cancelEditTarget = () => {
        setEditingTargetId(null);
        setNewTarget({ ...EMPTY_TARGET, capabilities: { ...EMPTY_TARGET_CAPS } });
        setTargetError(null);
    };

    const deleteTarget = async (id: string) => {
        if (!confirm('Delete this target?')) return;
        const res = await fetch(`/api/targets/${id}`, { method: 'DELETE', headers: authHeaders });
        if (res.ok) { showSuccess('Target deleted'); fetchTargets(); }
    };

    const toggleTargetEnabled = async (t: TargetDefinition) => {
        await fetch(`/api/targets/${t.id}`, {
            method: 'PUT', headers: authHeaders, body: JSON.stringify({ ...t, enabled: !t.enabled })
        });
        fetchTargets();
    };

    const CAP_LABELS: { key: keyof TargetCapability; label: string; color: string }[] = [
        { key: 'voice', label: 'Voice', color: 'blue' },
        { key: 'convergence', label: 'Convergence', color: 'purple' },
        { key: 'xfr', label: 'XFR', color: 'cyan' },
        { key: 'security', label: 'Security', color: 'red' },
        { key: 'connectivity', label: 'Connectivity', color: 'green' },
    ];
    // ─────────────────────────────────────────────────────────────────────────


    const tabs = [
        { id: 'distribution', label: 'Traffic Distribution' },
        { id: 'probes', label: 'Synthetic Probes' },
        { id: 'convergence', label: 'Convergence' },
        { id: 'system', label: 'System Info' },
        { id: 'maintenance', label: 'System Maintenance', beta: true },
        { id: 'targets', label: 'Targets' },
        { id: 'registry', label: 'Target Controller', beta: true },
        { id: 'mcp', label: 'MCP Server', beta: true },
        { id: 'strata', label: 'Strata Logging', beta: true },
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
                                <span className="text-[10px] text-text-muted font-bold tracking-widest opacity-60">Control Center • {status?.current || 'v1.2.1-patch.112'}</span>
                            </div>
                            <div className="flex items-center gap-4 mt-1">
                                {tabs.map((tab) => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id as any)}
                                        className={cn(
                                            "text-xs font-bold tracking-wider transition-colors pt-1 flex items-center gap-1.5",
                                            activeTab === tab.id
                                                ? "text-purple-500 border-b-2 border-purple-500 pb-1"
                                                : "text-text-muted hover:text-text-secondary"
                                        )}
                                    >
                                        {tab.label}
                                        {tab.beta && <BetaBadge />}
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
                    <span className="text-[10px] font-black tracking-[0.15em]">{successMsg}</span>
                </div>
            )}
            {errorMsg && (
                <div className="fixed top-24 right-8 bg-red-600/10 border border-red-500/20 text-red-600 dark:text-red-400 px-6 py-3.5 rounded-2xl flex items-center gap-3 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-4 z-50">
                    <AlertCircle size={18} />
                    <span className="text-[10px] font-black tracking-[0.15em]">{errorMsg}</span>
                </div>
            )}

            {/* Active Tab Content */}
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* Interfaces removed as standalone tab */}

                {activeTab === 'convergence' && (
                    <div className="bg-card border border-border rounded-2xl p-8 shadow-sm space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-purple-600/10 rounded-lg text-purple-600 dark:text-purple-400 font-bold">
                                <Zap size={20} />
                            </div>
                            <div>
                                <h2 className="text-lg font-black text-text-primary tracking-tight">Convergence Thresholds</h2>
                                <p className="text-[10px] font-bold text-text-muted tracking-widest mt-1 opacity-70">Define failover performance criteria</p>
                            </div>
                        </div>

                        <div className="max-w-2xl space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {[
                                    { key: 'good', label: 'Good Threshold', color: 'text-green-500', icon: CheckCircle2 },
                                    { key: 'degraded', label: 'Degraded Threshold', color: 'text-orange-500', icon: AlertCircle },
                                    { key: 'critical', label: 'Critical Threshold', color: 'text-red-500', icon: Shield },
                                ].map(({ key, label, color, icon: Icon }) => (
                                    <div key={key} className="space-y-2">
                                        <div className="flex items-center gap-2 pl-1">
                                            <Icon size={12} className={color} />
                                            <label className="text-[9px] font-black text-text-muted uppercase tracking-widest">{label}</label>
                                        </div>
                                        <div className="relative group">
                                            <input
                                                type="number"
                                                min="1"
                                                max="100"
                                                value={(convergenceThresholds as any)[key]}
                                                onChange={e => {
                                                    const val = Math.max(1, Math.min(100, parseInt(e.target.value) || 1));
                                                    setConvergenceThresholds(prev => ({ ...prev, [key]: val }));
                                                }}
                                                className="w-full bg-card-secondary border border-border text-text-primary rounded-xl px-4 py-3 text-sm font-black outline-none focus:ring-1 focus:ring-purple-500 transition-all shadow-inner"
                                            />
                                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-text-muted opacity-40">SEC</span>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="p-4 bg-purple-600/5 border border-purple-500/20 rounded-xl space-y-3">
                                <div className="flex items-center gap-2 text-purple-500 dark:text-purple-400">
                                    <Info size={14} />
                                    <span className="text-[10px] font-black uppercase tracking-widest">Threshold Logic</span>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2 text-[10px]">
                                        <div className="w-2 h-2 rounded-full bg-green-500" />
                                        <span className="font-bold text-text-secondary">Good:</span>
                                        <span className="text-text-muted">Max blackout is less than <span className="text-text-primary font-black">{convergenceThresholds.good}s</span></span>
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px]">
                                        <div className="w-2 h-2 rounded-full bg-yellow-500" />
                                        <span className="font-bold text-text-secondary">Degraded:</span>
                                        <span className="text-text-muted">Max blackout is between <span className="text-text-primary font-black">{convergenceThresholds.good}s</span> and <span className="text-text-primary font-black">{convergenceThresholds.degraded}s</span></span>
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px]">
                                        <div className="w-2 h-2 rounded-full bg-orange-500" />
                                        <span className="font-bold text-text-secondary">Bad:</span>
                                        <span className="text-text-muted">Max blackout is between <span className="text-text-primary font-black">{convergenceThresholds.degraded}s</span> and <span className="text-text-primary font-black">{convergenceThresholds.critical}s</span></span>
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px]">
                                        <div className="w-2 h-2 rounded-full bg-red-500" />
                                        <span className="font-bold text-text-secondary">Critical:</span>
                                        <span className="text-text-muted">Max blackout exceeds <span className="text-text-primary font-black">{convergenceThresholds.critical}s</span></span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end pt-4">
                                <button
                                    onClick={saveConvergenceThresholds}
                                    disabled={saving}
                                    className="px-8 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-[10px] font-black tracking-[0.2em] transition-all flex items-center gap-2 shadow-lg shadow-purple-900/40 disabled:opacity-50"
                                >
                                    {saving ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                    {saving ? 'SAVING...' : 'SAVE CONVERGENCE CONFIG'}
                                </button>
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
                                    <div className="flex items-center gap-2 mt-1">
                                        <p className="text-[10px] font-bold text-text-muted tracking-widest opacity-70">Custom telemetry for real-time monitoring</p>
                                        {cloudConfig?.baseUrl && (
                                            <>
                                                <span className="text-[8px] text-text-muted opacity-30">•</span>
                                                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-blue-600/5 border border-blue-500/10 rounded-full">
                                                    <Globe size={10} className="text-blue-500/70" />
                                                    <span className="text-[9px] font-black text-blue-500/70 tracking-tight uppercase">Cloud:</span>
                                                    <code className="text-[9px] font-bold text-blue-400/80 tracking-tighter truncate max-w-[200px]">{cloudConfig.baseUrl}</code>
                                                    {cloudConfig.hasKey && <span title="Signed with Shared Key"><Lock size={8} className="text-amber-500/50" /></span>}
                                                </div>
                                            </>
                                        )}
                                    </div>
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

                        <div className="max-w-5xl mx-auto space-y-8">
                            <div className="grid grid-cols-1 md:grid-cols-5 gap-6 bg-card-secondary/30 p-6 rounded-2xl border border-border shadow-inner">
                                <div className="space-y-2">
                                    <label className="text-[9px] font-black text-text-muted tracking-[0.2em] ml-1">Probe Name</label>
                                    <input
                                        type="text"
                                        placeholder="HQ-GATEWAY"
                                        className="w-full bg-card border border-border text-text-primary rounded-xl px-4 py-2.5 outline-none focus:ring-1 focus:ring-blue-500 text-[11px] font-black tracking-widest shadow-sm"
                                        value={newProbe.name}
                                        onChange={e => setNewProbe({ ...newProbe, name: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[9px] font-black text-text-muted tracking-[0.2em] ml-1">Protocol</label>
                                    <select
                                        className="w-full bg-card border border-border text-text-primary rounded-xl px-4 py-2.5 outline-none focus:ring-1 focus:ring-blue-500 text-[11px] font-black tracking-widest shadow-sm"
                                        value={newProbe.type}
                                        onChange={e => setNewProbe({ ...newProbe, type: e.target.value as any, timeout: e.target.value === 'PING' ? 2000 : 5000 })}
                                    >
                                        <option value="HTTP">HTTP</option>
                                        <option value="HTTPS">HTTPS</option>
                                        <option value="PING">ICMP</option>
                                        <option value="TCP">TCP</option>
                                        <option value="DNS">DNS</option>
                                        <option value="UDP">UDP</option>
                                        <option value="CLOUD">Stigix Cloud</option>
                                    </select>
                                </div>
                                <div className="md:col-span-2 space-y-2">
                                    <label className="text-[9px] font-black text-text-muted tracking-[0.2em] ml-1">
                                        {newProbe.type === 'CLOUD' ? 'Cloud scenario' : 'Target Uri / Ip'}
                                    </label>
                                    {newProbe.type === 'CLOUD' ? (
                                        <div className="space-y-3">
                                            <div className="relative">
                                                <select
                                                    className="w-full bg-card border border-border text-text-primary rounded-xl pl-10 pr-4 py-2.5 outline-none focus:ring-1 focus:ring-blue-500 text-[11px] font-black tracking-widest shadow-sm appearance-none"
                                                    value={newProbe.target}
                                                    onChange={e => {
                                                        const scenario = cloudScenarios.find(s => s.id === e.target.value);
                                                        setNewProbe({
                                                            ...newProbe,
                                                            target: e.target.value,
                                                            name: newProbe.name || scenario?.label || ''
                                                        });
                                                    }}
                                                >
                                                    <option value="">Select Scenario...</option>
                                                    {cloudScenarios.map(s => (
                                                        <option key={s.id} value={s.id}>{s.label}</option>
                                                    ))}
                                                </select>
                                                <Globe size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted opacity-50" />
                                                <ChevronDown size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                                            </div>
                                            {newProbe.target && (
                                                <div className="px-1 flex gap-2 items-start animate-in fade-in slide-in-from-top-1 duration-300">
                                                    <Info size={12} className="text-blue-500 mt-0.5 shrink-0" />
                                                    <p className="text-[10px] font-medium text-text-muted leading-relaxed italic">
                                                        {cloudScenarios.find(s => s.id === newProbe.target)?.description || 'No description available for this scenario.'}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <input
                                            type="text"
                                            placeholder={newProbe.type === 'DNS' ? '8.8.8.8' : 'google.com'}
                                            className="w-full bg-card border border-border text-text-primary rounded-xl px-4 py-2.5 outline-none focus:ring-1 focus:ring-blue-500 text-[11px] font-black tracking-widest shadow-sm"
                                            value={newProbe.target}
                                            onChange={e => setNewProbe({ ...newProbe, target: e.target.value })}
                                        />
                                    )}
                                </div>
                                <div className="space-y-2 flex flex-col justify-start pt-5">
                                    <button
                                        onClick={addProbe}
                                        className="w-full bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-xl text-[10px] font-black tracking-[0.2em] transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20"
                                    >
                                        <Plus size={16} />
                                        {editingIndex !== null ? 'Update' : 'Add Probe'}
                                    </button>
                                </div>
                            </div>

                            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-2">
                                {customProbes.map((probe, idx) => (
                                    <div key={idx} className={cn(
                                        "group bg-card border border-border hover:border-blue-500/30 rounded-2xl p-5 pr-2 flex items-center justify-between transition-all shadow-sm",
                                        probe.enabled === false && "opacity-50"
                                    )}>
                                        <div className="flex items-center gap-4">
                                            <div className={cn(
                                                "w-10 h-10 rounded-xl flex items-center justify-center text-[10px] font-black",
                                                probe.type === 'CLOUD'
                                                    ? "bg-purple-600/10 text-purple-600 dark:text-purple-400"
                                                    : "bg-blue-600/10 text-blue-600 dark:text-blue-400"
                                            )}>
                                                {probe.type === 'CLOUD' ? <Globe size={18} /> : probe.type.substring(0, 3)}
                                            </div>
                                            <div>
                                                <div className="text-[11px] font-black text-text-primary tracking-tight">{probe.name}</div>
                                                <div className="text-[10px] text-text-muted font-mono tracking-tighter truncate max-w-[140px] opacity-70">
                                                    {probe.type === 'CLOUD'
                                                        ? (() => {
                                                            const scenario = cloudScenarios.find(s => s.id === probe.target);
                                                            if (scenario?.signedUrl) {
                                                                // Display URL without protocol and key for cleanliness
                                                                return scenario.signedUrl.replace(/^https?:\/\//, '').split('?')[0];
                                                            }
                                                            return probe.target;
                                                        })()
                                                        : probe.target
                                                    }
                                                </div>
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
                                    <p className="text-[10px] font-bold text-text-muted tracking-widest mt-1 opacity-70">Adjust weights by category or individual app</p>
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
                                            <div className="flex items-center gap-3 text-[11px] font-black text-text-primary tracking-widest">
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
                                                        <div className="flex justify-between items-center bg-card mb-2 -mx-4 -mt-4 p-3 border-b border-border/50 rounded-t-xl">
                                                            <div className="flex items-center gap-2 truncate">
                                                                <Favicon domain={app.domain} size={14} />
                                                                <span className="text-[10px] font-black text-text-primary truncate">{app.domain}</span>
                                                            </div>
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
                            <div className="p-2 bg-blue-600/10 rounded-lg text-blue-600 dark:text-blue-400 font-bold">
                                <RefreshCw size={24} className={upgrading ? "animate-spin" : ""} />
                            </div>
                            <div>
                                <h2 className="text-lg font-black text-text-primary tracking-tight">System Maintenance</h2>
                                <p className="text-[10px] font-bold text-text-muted tracking-widest mt-0.5 opacity-70">Update system logic and engine</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <div className="flex justify-between items-center p-4 bg-card-secondary/50 rounded-xl border border-border">
                                    <span className="text-[10px] text-text-muted font-black tracking-widest">Current Version</span>
                                    <span className="text-sm font-mono text-blue-600 font-bold">{status?.current}</span>
                                </div>
                                <div className="flex justify-between items-center p-4 bg-card-secondary/50 rounded-xl border border-border">
                                    <span className="text-[10px] text-text-muted font-black tracking-widest">Latest Stable</span>
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
                                        "w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-black tracking-[0.2em] transition-all",
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
                                    <span className="text-[10px] font-black tracking-widest text-blue-600">Upgrade Monitor</span>
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

                        <div className="pt-8 border-t border-border/50">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="bg-card border border-border rounded-2xl p-8 shadow-sm space-y-6">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-amber-600/10 rounded-lg text-amber-600 font-bold">
                                            <Terminal size={24} />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-black text-text-primary tracking-tight">Service Restart</h2>
                                            <p className="text-[10px] font-bold text-text-muted tracking-widest mt-0.5 opacity-70">Soft reload of internal components</p>
                                        </div>
                                    </div>
                                    <p className="text-xs text-text-muted font-bold italic opacity-60">Memory cleanup and internal state reset. Fast completion.</p>
                                    <button
                                        onClick={() => handleRestart('restart')}
                                        disabled={upgrading}
                                        className="w-full py-4 bg-card-secondary hover:bg-card-hover border border-border rounded-xl text-[10px] font-black tracking-widest transition-all shadow-sm"
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
                                            <p className="text-[10px] font-bold text-text-muted tracking-widest mt-0.5 opacity-70">Full stack container recreation</p>
                                        </div>
                                    </div>
                                    <p className="text-xs text-text-muted font-bold italic opacity-60">Applies docker-compose and environment changes. Temporary downtime.</p>
                                    <button
                                        onClick={() => handleRestart('redeploy')}
                                        disabled={upgrading}
                                        className="w-full py-4 bg-red-600/10 hover:bg-red-600/20 border border-red-500/30 text-red-600 rounded-xl text-[10px] font-black tracking-widest transition-all shadow-sm"
                                    >
                                        <Power size={16} className="inline mr-2" />
                                        Redepoy Stack
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="pt-8 border-t border-border/50">
                            <div className="flex items-center gap-3 mb-8">
                                <div className="p-2 bg-green-600/10 rounded-lg text-green-600 font-bold">
                                    <Database size={24} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-black text-text-primary tracking-tight">Configuration Backup</h2>
                                    <p className="text-[10px] font-bold text-text-muted tracking-widest mt-0.5 opacity-70">Import/Export system state and settings</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-4">
                                    <h3 className="text-[11px] font-black tracking-[0.2em] text-text-primary">Export Engine State</h3>
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
                                        className="px-6 py-3 bg-card-secondary hover:bg-card-hover border border-border rounded-xl text-[10px] font-black tracking-widest transition-all flex items-center gap-2"
                                    >
                                        <Download size={16} />
                                        Download Bundle
                                    </button>
                                </div>

                                <div className="space-y-4">
                                    <h3 className="text-[11px] font-black tracking-[0.2em] text-text-primary">Restore State</h3>
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
                                            className="px-6 py-3 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/20 text-blue-600 rounded-xl text-[10px] font-black tracking-widest transition-all flex items-center gap-2"
                                        >
                                            <Upload size={16} />
                                            Restore Bundle
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'system' && (
                    <div className="bg-card border border-border rounded-2xl p-8 shadow-sm space-y-12 animate-in fade-in duration-500">
                        {/* Network Interfaces (Moved from its own tab) */}
                        <div className="space-y-8">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-purple-600/10 rounded-lg text-purple-600 dark:text-purple-400 font-bold">
                                    <Network size={20} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-black text-text-primary tracking-tight">Network Interfaces</h2>
                                    <p className="text-[10px] font-bold text-text-muted tracking-widest mt-1 opacity-70">Physical interfaces for traffic egress</p>
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
                                        className="bg-purple-600 hover:bg-purple-500 text-white px-8 py-3 rounded-xl text-[10px] font-black tracking-[0.2em] transition-all flex items-center gap-2 shadow-lg shadow-purple-900/20"
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
                                                    "px-4 py-2 rounded-xl text-[10px] font-black border transition-all flex items-center gap-3 tracking-widest shadow-sm",
                                                    isSelected
                                                        ? "bg-purple-600/10 border-purple-500/30 text-purple-600 dark:text-purple-400"
                                                        : "bg-card-secondary/30 border-border text-text-muted hover:border-text-muted/30"
                                                )}
                                            >
                                                <div className={cn("w-1.5 h-1.5 rounded-full", isSelected ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-text-muted/30")} />
                                                <span>{iface}</span>
                                                {isSelected && systemInfo?.interfaceIps?.[iface] && (
                                                    <span className="opacity-60 font-mono text-[9px]">{systemInfo.interfaceIps[iface]}</span>
                                                )}
                                                {isSelected && <CheckCircle2 size={12} />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <div className="pt-8 border-t border-border/50">
                            <div className="flex items-center gap-3 mb-8">
                                <div className="p-2 bg-purple-600/10 rounded-lg text-purple-600 dark:text-purple-400 font-bold">
                                    <Server size={24} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-black text-text-primary tracking-tight">System Information</h2>
                                    <p className="text-[10px] font-bold text-text-muted tracking-widest mt-0.5 opacity-70">Hardware metrics and execution context</p>
                                </div>
                            </div>

                            {!systemInfo ? (
                                <div className="text-center text-text-muted text-xs font-bold tracking-widest animate-pulse py-12">Gathering system metrics...</div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* Execution Context */}
                                    <div className="bg-card-secondary/30 border border-border rounded-2xl p-6 space-y-4 shadow-sm flex flex-col justify-center items-center h-48">
                                        <div className="text-[10px] font-black text-text-muted uppercase tracking-[0.2em] mb-2">Execution Context</div>
                                        <div className={cn(
                                            "px-6 py-3 rounded-2xl text-sm font-black tracking-widest uppercase border border-border shadow-inner flex items-center gap-3 transition-colors duration-500",
                                            systemInfo.mode === 'Host Mode' ? "bg-amber-500/10 text-amber-500 border-amber-500/30" : "bg-blue-600/10 text-blue-500 border-blue-500/30"
                                        )}>
                                            <Server size={18} />
                                            {systemInfo.mode}
                                        </div>
                                        <div className="text-center text-[10px] text-text-muted mt-2 px-8 leading-relaxed font-bold opacity-60">
                                            {systemInfo.mode === 'Host Mode'
                                                ? 'Containers share the host networking namespace directly. High throughput natively.'
                                                : 'Containers are isolated on an internal bridge network. Standard Docker environment.'}
                                        </div>
                                    </div>

                                    {/* Network I/O */}
                                    <div className="bg-card-secondary/30 border border-border rounded-2xl p-6 space-y-6 shadow-sm flex flex-col justify-center h-48">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-green-500/10 text-green-500 flex items-center justify-center">
                                                <Network size={16} />
                                            </div>
                                            <div className="text-[11px] font-black text-text-primary tracking-widest uppercase">Network I/O</div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4 h-full">
                                            <div className="bg-card p-4 rounded-xl border border-border flex flex-col justify-center">
                                                <div className="text-[9px] font-black text-text-muted tracking-widest uppercase mb-1 flex items-center gap-1.5"><Download size={10} className="text-green-500" /> Received</div>
                                                <div className="font-mono text-lg font-black text-text-primary">{(systemInfo.networkSpeed?.rx || 0).toFixed(2)} <span className="text-[10px] text-text-muted">Mb/s</span></div>
                                            </div>
                                            <div className="bg-card p-4 rounded-xl border border-border flex flex-col justify-center">
                                                <div className="text-[9px] font-black text-text-muted tracking-widest uppercase mb-1 flex items-center gap-1.5"><Upload size={10} className="text-blue-500" /> Transmitted</div>
                                                <div className="font-mono text-lg font-black text-text-primary">{(systemInfo.networkSpeed?.tx || 0).toFixed(2)} <span className="text-[10px] text-text-muted">Mb/s</span></div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Memory */}
                                    <div className="bg-card border border-border rounded-2xl p-6 space-y-6 shadow-sm md:col-span-2">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
                                                    <Cpu size={16} />
                                                </div>
                                                <div className="text-[11px] font-black text-text-primary tracking-widest uppercase">System Memory (RAM)</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-mono text-sm font-black text-indigo-400">
                                                    {((systemInfo.memory?.used || 0) / 1024 / 1024 / 1024).toFixed(1)} GB / {((systemInfo.memory?.total || 0) / 1024 / 1024 / 1024).toFixed(1)} GB
                                                </div>
                                            </div>
                                        </div>
                                        <div className="h-3 w-full bg-card-secondary rounded-full overflow-hidden border border-border">
                                            <div
                                                className="h-full bg-indigo-500 transition-all duration-1000 shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                                                style={{ width: `${Math.min(100, ((systemInfo.memory?.used || 0) / (systemInfo.memory?.total || 1)) * 100)}%` }}
                                            />
                                        </div>
                                    </div>

                                    {/* Disk */}
                                    <div className="bg-card border border-border rounded-2xl p-6 space-y-6 shadow-sm md:col-span-2">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-pink-500/10 text-pink-500 flex items-center justify-center">
                                                    <Database size={16} />
                                                </div>
                                                <div className="text-[11px] font-black text-text-primary tracking-widest uppercase">Host Disk Space</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-mono text-sm font-black text-pink-400">
                                                    {((systemInfo.disk?.used || 0) / 1024 / 1024 / 1024).toFixed(1)} GB / {((systemInfo.disk?.total || 0) / 1024 / 1024 / 1024).toFixed(1)} GB
                                                </div>
                                            </div>
                                        </div>
                                        <div className="h-3 w-full bg-card-secondary rounded-full overflow-hidden border border-border">
                                            <div
                                                className="h-full bg-pink-500 transition-all duration-1000 shadow-[0_0_10px_rgba(236,72,153,0.5)]"
                                                style={{ width: `${systemInfo.disk?.usagePercent || 0}%` }}
                                            />
                                        </div>
                                        <div className="flex justify-between text-[9px] font-black tracking-widest text-text-muted uppercase">
                                            <span>Used: {systemInfo.disk?.usagePercent || 0}%</span>
                                            <span>Free: {((systemInfo.disk?.free || 0) / 1024 / 1024 / 1024).toFixed(1)} GB</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* ─── Registry Tab ────────────────────────────────────────────── */}
            {activeTab === 'registry' && (
                <div className="bg-card border border-border rounded-2xl p-8 shadow-sm space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-purple-600/10 rounded-lg text-purple-500">
                                <Database size={20} />
                            </div>
                            <div>
                                <h2 className="text-lg font-black text-text-primary tracking-tight">Target Controller Dashboard</h2>
                                <p className="text-[10px] font-bold text-text-muted tracking-widest mt-1 opacity-70">Monitor peer-to-peer discovery and controller state</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={cn(
                                "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border shadow-sm",
                                registryStatus?.mode === 'leader'
                                    ? "bg-purple-600/10 text-purple-500 border-purple-500/30"
                                    : "bg-blue-600/10 text-blue-500 border-blue-500/30"
                            )}>
                                Role: {registryStatus?.mode?.toUpperCase() || 'PEER'}
                            </span>
                            {registryStatus?.is_registered && (
                                <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-green-500/10 text-green-500 border border-green-500/30 shadow-sm flex items-center gap-1.5">
                                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                    Cloudflare Online
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Overview Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="bg-card-secondary/30 border border-border rounded-2xl p-5 space-y-2 group hover:border-purple-500/30 transition-all">
                            <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">Discovered Peers</div>
                            <div className="text-2xl font-black text-text-primary group-hover:text-purple-500 transition-colors uppercase">{registryStatus?.peer_count || 0}</div>
                            <div className="text-[8px] font-bold text-text-muted leading-tight opacity-60">Nodes currently known to this instance</div>
                        </div>
                        <div className="bg-card-secondary/30 border border-border rounded-2xl p-5 space-y-2 group hover:border-blue-500/30 transition-all">
                            <div className="text-[10px] font-black text-text-muted uppercase tracking-widest">Detected Local IP</div>
                            <div className="text-xl font-black text-text-primary font-mono group-hover:text-blue-500 transition-colors uppercase">{registryStatus?.detected_ip || 'N/A'}</div>
                            <div className="text-[8px] font-bold text-text-muted leading-tight opacity-60">Local address reported to controller</div>
                        </div>
                        <div className="bg-card-secondary/30 border border-border rounded-2xl p-5 space-y-2 group hover:border-emerald-500/30 transition-all">
                            <div className="text-[9px] font-black text-text-muted uppercase tracking-widest">PoC ID</div>
                            <div className="text-lg font-black text-text-primary group-hover:text-emerald-500 transition-colors">{registryStatus?.poc_id || 'unconfigured'}</div>
                            <div className="text-[8px] font-bold text-text-muted leading-tight opacity-60">Prisma SD-WAN TSG Context</div>
                        </div>
                        <div className="bg-card-secondary/30 border border-border rounded-2xl p-5 space-y-2 group hover:border-amber-500/30 transition-all">
                            <div className="text-[10px] font-black text-text-muted uppercase tracking-widest">Controller Sync</div>
                            <div className="text-sm font-black text-text-primary truncate font-mono opacity-80 group-hover:text-amber-500 transition-colors uppercase">{registryStatus?.registry_url ? new URL(registryStatus.registry_url).hostname : 'N/A'}</div>
                            <div className="text-[8px] font-bold text-text-muted leading-tight opacity-60">Current active discovery endpoint</div>
                        </div>
                    </div>

                    {/* Static Leader / Controller Configuration (Manual Override) */}
                    <div className="bg-card-secondary/20 border-2 border-dashed border-border rounded-2xl p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="p-1.5 bg-blue-500/10 rounded text-blue-500">
                                    <SettingsIcon size={16} />
                                </div>
                                <h3 className="text-xs font-black text-text-primary uppercase tracking-wider">Static Controller Configuration</h3>
                            </div>
                            <div className="flex items-center gap-2">
                                {registryStatus?.is_static_leader && (
                                    <span className="px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center gap-1 shadow-sm animate-pulse">
                                        <div className="w-1 h-1 rounded-full bg-blue-400" />
                                        Static Override Active
                                    </span>
                                )}
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                            <div className="md:col-span-8 space-y-2">
                                <label className="text-[10px] font-extrabold text-text-muted uppercase tracking-widest pl-1">Manual Controller IP / FQDN / URL</label>
                                <div className="relative group">
                                    <input
                                        type="text"
                                        placeholder="e.g. 192.168.1.50 or stigix.local"
                                        value={staticLeaderUrl}
                                        onChange={(e) => setStaticLeaderUrl(e.target.value)}
                                        className="w-full bg-card hover:bg-card-hover border border-border focus:border-blue-500/50 rounded-xl px-4 py-2.5 text-xs font-mono transition-all pr-24"
                                    />
                                    {connectivityResult && (
                                        <div className={`absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest border ${
                                            connectivityResult.success 
                                                ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" 
                                                : "bg-red-500/10 text-red-500 border-red-500/20"
                                        }`}>
                                            {connectivityResult.success ? (
                                                <><CheckCircle size={10} /> Online</>
                                            ) : (
                                                <><XCircle size={10} /> {connectivityResult.error || "Failed"}</>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="flex flex-col gap-1 pl-1">
                                    <p className="text-[9px] text-text-muted italic opacity-60">Configure a static IP or FQDN to reach the leader directly and bypass Cloudflare discovery.</p>
                                    {staticLeaderUrl && (
                                        <div className="flex items-center gap-1.5 mt-1">
                                            <span className="text-[8px] font-black uppercase text-blue-500/60 tracking-widest">Resulting URL:</span>
                                            <span className="text-[9px] font-mono text-text-secondary opacity-80 bg-blue-500/5 px-1.5 py-0.5 rounded border border-blue-500/10">
                                                {previewControllerUrl(staticLeaderUrl)}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="md:col-span-4 flex gap-2">
                                <button
                                    onClick={handleTestConnectivity}
                                    disabled={isTestingConnectivity || !staticLeaderUrl}
                                    className="flex-1 bg-card hover:bg-card-hover border border-border rounded-xl px-4 py-2.5 text-[10px] font-black uppercase tracking-widest transition-all hover:border-blue-500/30 disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {isTestingConnectivity ? <RefreshCw className="animate-spin" size={12} /> : <Zap size={12} className="text-blue-500" />}
                                    Test
                                </button>
                                <button
                                    onClick={() => handleSaveStaticLeader(staticLeaderUrl)}
                                    disabled={saving || !staticLeaderUrl}
                                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded-xl px-4 py-2.5 text-[10px] font-black uppercase tracking-widest transition-all shadow-[0_0_20px_rgba(37,99,235,0.2)] disabled:opacity-50"
                                >
                                    Save
                                </button>
                                {registryStatus?.is_static_leader && (
                                    <button
                                        onClick={() => {
                                            setStaticLeaderUrl('');
                                            handleSaveStaticLeader(null);
                                        }}
                                        className="p-2.5 bg-card hover:bg-red-500/10 border border-border hover:border-red-500/30 rounded-xl text-text-muted hover:text-red-500 transition-all"
                                        title="Reset to Auto-Discovery"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {registryStatus?.mode === 'leader' && (
                            <div className="mt-4 p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-xl flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-500">
                                        <Globe size={18} />
                                    </div>
                                    <div>
                                        <div className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Local Controller Access</div>
                                        <p className="text-[11px] font-bold text-text-secondary">Peers can manually reach this node at: <span className="font-mono text-emerald-400">http://{registryStatus?.detected_ip}:8080</span></p>
                                    </div>
                                </div>
                                <Activity size={24} className="text-emerald-500 opacity-20" />
                            </div>
                        )}
                    </div>

                    {/* Details and Local Instances */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Registry Details */}
                        <div className="lg:col-span-1 space-y-6">
                            <div className="bg-card p-6 border border-border rounded-2xl space-y-5 shadow-sm">
                                <h3 className="text-[11px] font-black text-text-muted tracking-[0.2em] uppercase">Configuration State</h3>

                                <div className="space-y-4">
                                    <div className="space-y-1.5">
                                        <div className="text-[10px] font-black text-text-muted tracking-widest uppercase">Bootstrap URL (Cloudflare)</div>
                                        <div className="p-2.5 bg-card-secondary/50 border border-border rounded-xl font-mono text-[11px] text-text-secondary truncate">
                                            {registryStatus?.remote_url || 'N/A'}
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <div className="text-[10px] font-black text-text-muted tracking-widest uppercase">Active Registry</div>
                                        <div className="p-2.5 bg-card-secondary/50 border border-border rounded-xl font-mono text-[11px] text-text-primary truncate flex items-center gap-2">
                                            {registryStatus?.registry_url === registryStatus?.remote_url ? (
                                                <Globe size={12} className="text-blue-500" />
                                            ) : (
                                                <Server size={12} className="text-purple-500" />
                                            )}
                                            {registryStatus?.registry_url || 'N/A'}
                                        </div>
                                    </div>

                                    <div className="space-y-1.5 col-span-2">
                                        <div className="text-[10px] font-black text-text-muted tracking-widest uppercase">Auto-Detection Identity</div>
                                        <div className="p-3 bg-card-secondary/50 border border-border rounded-xl space-y-2">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[11px] font-bold text-text-muted">Site Role:</span>
                                                <span className={`text-[11px] font-black tracking-tight ${registryStatus?.detected_role === 'HUB' ? 'text-purple-500' : 'text-blue-500'}`}>
                                                    {registryStatus?.detected_role || 'UNKNOWN'}
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-[11px] font-bold text-text-muted">Branch Gateway:</span>
                                                <span className="text-[11px] font-black text-text-primary px-1.5 py-0.5 rounded bg-card">{registryStatus?.is_bg ? 'YES' : 'NO'}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-[11px] font-bold text-text-muted">Election Mode:</span>
                                                <span className="text-[11px] font-black text-emerald-500 uppercase">{registryStatus?.current_mode || 'MANUAL'}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <div className="text-[10px] font-black text-text-muted tracking-widest uppercase">PoC Registry Key</div>
                                        <div className="p-2.5 bg-card-secondary/50 border border-border rounded-xl font-mono text-[11px] text-text-muted flex items-center justify-between">
                                            <div className="flex gap-1">
                                                {registryStatus?.poc_key ? '••••••••••••••••' : 'None'}
                                            </div>
                                            <Lock size={12} className="opacity-40" />
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-4 border-t border-border/50">
                                    <div className="p-4 bg-purple-600/5 border border-purple-500/10 rounded-xl space-y-2">
                                        <div className="flex items-center gap-2 text-purple-500">
                                            <Info size={16} />
                                            <span className="text-[10px] font-black uppercase tracking-widest">Hybrid Mode Info</span>
                                        </div>
                                        <p className="text-[10px] text-text-muted leading-relaxed font-bold opacity-80">
                                            {registryStatus?.mode === 'leader'
                                                ? "This node is the Leader. It handles registration for all local peers and periodically syncs to Cloudflare for global discovery."
                                                : registryStatus?.registry_url === registryStatus?.remote_url
                                                    ? "Node is in Peer Fallback mode. No local leader was found; communicating directly with Cloudflare (Write Quota Warning)."
                                                    : "This node is a Peer. It finds the Leader via Cloudflare once, then communicates locally to save Worker resources."}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Local Instance Table (Leader Only) or Peer View */}
                        <div className="lg:col-span-2">
                            <div className="bg-card border border-border rounded-2xl h-full flex flex-col shadow-sm">
                                <div className="p-6 border-b border-border/50 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-emerald-600/10 rounded-lg text-emerald-500">
                                            <Activity size={18} />
                                        </div>
                                        <h3 className="text-sm font-black text-text-primary tracking-tight">
                                            {registryStatus?.mode === 'leader' ? 'Locally Registered Instances' : 'Visible Peers'}
                                        </h3>
                                    </div>
                                    <button
                                        onClick={() => window.location.reload()}
                                        className="p-2 hover:bg-card-hover rounded-xl text-text-muted transition-all"
                                        title="Refresh"
                                    >
                                        <RefreshCw size={14} />
                                    </button>
                                </div>

                                <div className="flex-1 overflow-auto p-4">
                                    {registryStatus?.mode === 'leader' ? (
                                        <table className="w-full text-left">
                                            <thead>
                                                <tr className="border-b border-border/50">
                                                    <th className="pb-3 px-4 text-[9px] font-black text-text-muted uppercase tracking-[0.2em]">Instance ID</th>
                                                    <th className="pb-3 px-4 text-[9px] font-black text-text-muted uppercase tracking-[0.2em]">Private IP</th>
                                                    <th className="pb-3 px-4 text-[9px] font-black text-text-muted uppercase tracking-[0.2em]">Capabilities</th>
                                                    <th className="pb-3 px-4 text-[9px] font-black text-text-muted uppercase tracking-[0.2em]">Last Seen</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {registryStatus?.local_instances?.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={4} className="py-12 text-center text-text-muted text-[10px] font-bold tracking-widest opacity-50">
                                                            No peers have registered with this leader yet.
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    registryStatus?.local_instances?.map((inst: any) => (
                                                        <tr key={inst.instance_id} className="group hover:bg-card-hover transition-colors">
                                                            <td className="py-4 px-4">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-7 h-7 rounded-lg bg-purple-600/10 text-purple-500 flex items-center justify-center shrink-0">
                                                                        <Server size={14} />
                                                                    </div>
                                                                    <span className="text-[11px] font-black text-text-primary tracking-tight">{inst.instance_id}</span>
                                                                </div>
                                                            </td>
                                                            <td className="py-4 px-4 font-mono text-[10px] text-text-secondary">{inst.ip_private}</td>
                                                            <td className="py-4 px-4">
                                                                <div className="flex gap-1">
                                                                    {inst.capabilities?.voice && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" title="Voice" />}
                                                                    {inst.capabilities?.xfr && <div className="w-1.5 h-1.5 rounded-full bg-cyan-500" title="XFR" />}
                                                                    {inst.capabilities?.convergence && <div className="w-1.5 h-1.5 rounded-full bg-purple-500" title="Convergence" />}
                                                                    {inst.capabilities?.security && <div className="w-1.5 h-1.5 rounded-full bg-red-500" title="Security" />}
                                                                </div>
                                                            </td>
                                                            <td className="py-4 px-4 text-[10px] text-text-muted font-bold whitespace-nowrap">
                                                                {new Date(inst.last_seen).toLocaleTimeString()}
                                                            </td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    ) : (
                                        <div className="h-full flex flex-col items-center justify-center space-y-8 py-10">
                                            <div className="relative">
                                                <div className="absolute inset-0 bg-blue-500/20 blur-3xl rounded-full animate-pulse" />
                                                <Server size={64} className="text-blue-500 relative" />
                                                <div className="absolute -top-2 -right-2 p-1 bg-green-500 rounded-full border-4 border-card shadow-lg">
                                                    <Activity size={16} className="text-white" />
                                                </div>
                                            </div>

                                            <div className="text-center space-y-5 max-w-sm">
                                                <div className="space-y-1">
                                                    <p className="text-[12px] font-black text-text-muted uppercase tracking-[0.3em]">Active Local Leader</p>
                                                    <h4 className="text-2xl font-black text-text-primary tracking-tight">
                                                        {registryStatus?.leader_info?.id || 'Leader Found'}
                                                    </h4>
                                                </div>

                                                <div className="p-4 bg-card-secondary/50 border border-border rounded-2xl space-y-3">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[9px] font-black text-text-muted uppercase">Leader IP</span>
                                                        <span className="font-mono text-xs font-bold text-blue-500">{registryStatus?.leader_info?.ip || 'Connecting...'}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[9px] font-black text-text-muted uppercase">Sync Status</span>
                                                        <span className="text-[9px] font-black text-green-500 uppercase flex items-center gap-1.5">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                                            Connected
                                                        </span>
                                                    </div>
                                                </div>

                                                <p className="text-[10px] text-text-muted font-bold leading-relaxed opacity-60">
                                                    This node is discovery-delegated. Peers discovered via the leader are automatically synchronized in your <span className="text-emerald-500">Targets</span> dashboard.
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'targets' && (
                <div className="bg-card border border-border rounded-2xl p-8 shadow-sm space-y-8">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-600/10 rounded-lg text-emerald-600 dark:text-emerald-400">
                            <MapPin size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-text-primary tracking-tight">Targets Repository</h2>
                            <p className="text-[10px] font-bold text-text-muted tracking-widest mt-1 opacity-70">Shared sdwan-voice-echo / stigix sites — reused across Speedtest, Voice, Security &amp; Failover</p>
                        </div>
                    </div>

                    {/* ── Add / Edit Form ── */}
                    <div className="bg-card-secondary/30 border border-border rounded-2xl p-6 space-y-5 shadow-inner">
                        <h3 className="text-[10px] font-black text-text-muted tracking-[0.2em] uppercase">
                            {editingTargetId ? '✏️ Edit Target' : '➕ New Target'}
                        </h3>
                        {targetError && (
                            <div className="flex items-center gap-2 text-red-500 text-[10px] font-bold bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2">
                                <AlertCircle size={12} />{targetError}
                            </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className="text-[9px] font-black text-text-muted tracking-[0.2em]">Site Name</label>
                                <input
                                    type="text"
                                    placeholder="DC1, Branch-Paris…"
                                    value={newTarget.name}
                                    onChange={e => setNewTarget({ ...newTarget, name: e.target.value })}
                                    className="w-full bg-card border border-border text-text-primary rounded-xl px-4 py-2.5 outline-none focus:ring-1 focus:ring-emerald-500 text-[11px] font-black tracking-wider shadow-sm"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[9px] font-black text-text-muted tracking-[0.2em]">IP Address or FQDN</label>
                                <input
                                    type="text"
                                    placeholder="192.168.1.100 or mysite.example.com"
                                    value={newTarget.host}
                                    onChange={e => setNewTarget({ ...newTarget, host: e.target.value })}
                                    className="w-full bg-card border border-border text-text-primary rounded-xl px-4 py-2.5 outline-none focus:ring-1 focus:ring-emerald-500 text-[11px] font-black font-mono tracking-wider shadow-sm"
                                />
                            </div>
                        </div>

                        {/* Capability Toggles */}
                        <div className="space-y-1.5">
                            <label className="text-[9px] font-black text-text-muted tracking-[0.2em]">Capabilities</label>
                            <div className="flex flex-wrap gap-2">
                                {CAP_LABELS.map(({ key, label, color }) => (
                                    <button
                                        key={key}
                                        onClick={() => setNewTarget(t => ({ ...t, capabilities: { ...t.capabilities, [key]: !t.capabilities[key] } }))}
                                        className={cn(
                                            "px-3 py-1.5 rounded-lg text-[10px] font-black border transition-all",
                                            newTarget.capabilities[key]
                                                ? `bg-${color}-600/10 text-${color}-500 border-${color}-500/30`
                                                : "bg-card text-text-muted border-border hover:border-text-muted"
                                        )}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Port Overrides (collapsed) */}
                        <div>
                            <button
                                onClick={() => setShowTargetPorts(p => !p)}
                                className="text-[9px] font-black text-text-muted tracking-widest flex items-center gap-1.5 hover:text-text-primary transition-colors"
                            >
                                {showTargetPorts ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                PORT OVERRIDES (OPTIONAL)
                            </button>
                            {showTargetPorts && (
                                <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-3">
                                    {[
                                        { key: 'voice', label: 'Voice', placeholder: '6100' },
                                        { key: 'convergence', label: 'Conv.', placeholder: '6200' },
                                        { key: 'iperf', label: 'Iperf', placeholder: '5201' },
                                        { key: 'http', label: 'HTTP', placeholder: '8082' },
                                        { key: 'xfr', label: 'XFR', placeholder: '5201' },
                                    ].map(({ key, label, placeholder }) => (
                                        <div key={key} className="space-y-1">
                                            <label className="text-[9px] font-black text-text-muted">{label}</label>
                                            <input
                                                type="number"
                                                placeholder={placeholder}
                                                value={(newTarget.ports as any)?.[key] ?? ''}
                                                onChange={e => setNewTarget(t => ({
                                                    ...t,
                                                    ports: { ...t.ports, [key]: e.target.value ? parseInt(e.target.value) : undefined }
                                                }))}
                                                className="w-full bg-card border border-border text-text-primary rounded-lg px-3 py-2 text-[10px] font-mono outline-none focus:ring-1 focus:ring-emerald-500"
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="flex gap-2 justify-end">
                            {editingTargetId && (
                                <button onClick={cancelEditTarget} className="px-4 py-2 text-text-muted hover:text-text-primary text-[10px] font-black tracking-widest transition-colors">
                                    Cancel
                                </button>
                            )}
                            <button
                                onClick={saveTarget}
                                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[10px] font-black tracking-[0.2em] transition-all flex items-center gap-2 shadow-lg shadow-emerald-900/20"
                            >
                                <Plus size={14} />
                                {editingTargetId ? 'Update Target' : 'Add Target'}
                            </button>
                        </div>
                    </div>

                    {/* ── Targets List ── */}
                    <div className="space-y-3">
                        {targets.length === 0 && (
                            <div className="text-center text-text-muted text-[10px] font-bold tracking-widest py-12 border border-dashed border-border rounded-2xl opacity-50">
                                No targets defined yet. Add one above.
                            </div>
                        )}
                        {targets.map(t => (
                            <div
                                key={t.id}
                                className={cn(
                                    "group bg-card border border-border hover:border-emerald-500/30 rounded-2xl p-5 flex items-center justify-between transition-all shadow-sm",
                                    !t.enabled && "opacity-50"
                                )}
                            >
                                <div className="flex items-center gap-4 min-w-0">
                                    <div className="w-10 h-10 rounded-xl bg-emerald-600/10 text-emerald-500 flex items-center justify-center shrink-0">
                                        <MapPin size={18} />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[11px] font-black text-text-primary tracking-tight">{t.name}</span>
                                            {t.meta?.local_config && (
                                                <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-amber-500/20 text-amber-400 border border-amber-500/30" title="This target is saved in a local component configuration file">
                                                    Static
                                                </span>
                                            )}
                                            {t.meta?.registry && (
                                                <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-blue-500/10 text-blue-500 border border-blue-500/30 flex items-center gap-1 shadow-sm" title="Discovered automatically via the Target Controller and cached in-memory">
                                                    <Zap size={8} className="animate-pulse" /> Learned
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-[10px] text-text-muted font-mono tracking-tighter opacity-70">{t.host}</div>
                                        <div className="flex flex-wrap gap-1 mt-1.5">
                                            {CAP_LABELS.filter(c => t.capabilities[c.key]).map(({ key, label, color }) => (
                                                <span key={key} className={`px-1.5 py-0.5 rounded text-[8px] font-black tracking-widest bg-${color}-500/10 text-${color}-500 border border-${color}-500/20`}>
                                                    {label}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-1.5 px-2 shrink-0">
                                        <>
                                            <button
                                                onClick={() => toggleTargetEnabled(t)}
                                                className={cn(
                                                    "p-2 rounded-xl transition-all",
                                                    t.enabled ? "text-green-500 hover:bg-green-500/10" : "text-text-muted hover:bg-card-hover"
                                                )}
                                                title="Toggle"
                                            >
                                                <Power size={14} />
                                            </button>
                                            <button
                                                onClick={() => startEditTarget(t)}
                                                className="p-2 hover:bg-card-hover rounded-xl text-text-muted transition-all"
                                                title="Edit"
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                            <button
                                                onClick={() => deleteTarget(t.id)}
                                                className="p-2 hover:bg-red-600/10 rounded-xl text-text-muted hover:text-red-500 transition-all"
                                                title="Delete"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                )}

                {activeTab === 'mcp' && (
                    <div className="space-y-6">
                        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                            <div className="flex items-center gap-4 mb-6">
                                <div className="p-3 bg-amber-500/10 rounded-xl">
                                    <Terminal size={24} className="text-amber-500" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-3">
                                        <h2 className="text-lg font-black text-text-primary tracking-tight">Model Context Protocol</h2>
                                        <BetaBadge />
                                    </div>
                                    <p className="text-[10px] font-bold text-text-muted tracking-widest mt-0.5 opacity-70">Natural Language Orchestration Service</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                                <div className="bg-card-secondary/30 border border-border rounded-2xl p-4 flex flex-col items-center justify-center text-center space-y-2">
                                    <div className="text-[8px] font-black text-text-muted uppercase tracking-[0.2em]">Service Status</div>
                                    <div className={cn(
                                        "flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black tracking-widest uppercase border",
                                        mcpStatus?.online 
                                            ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" 
                                            : "bg-red-500/10 text-red-500 border-red-500/20"
                                    )}>
                                        <div className={cn("w-2 h-2 rounded-full", mcpStatus?.online ? "bg-emerald-500 animate-pulse" : "bg-red-500")} />
                                        {mcpStatus?.online ? "Online" : "Offline"}
                                    </div>
                                </div>
                                <div className="bg-card-secondary/30 border border-border rounded-2xl p-4 flex flex-col items-center justify-center text-center space-y-2">
                                    <div className="text-[8px] font-black text-text-muted uppercase tracking-[0.2em]">Transport Mode</div>
                                    <div className="text-xs font-black text-text-primary tracking-widest">{mcpStatus?.transport?.toUpperCase() || 'SSE'}</div>
                                </div>
                                <div className="bg-card-secondary/30 border border-border rounded-2xl p-4 flex flex-col items-center justify-center text-center space-y-2">
                                    <div className="text-[8px] font-black text-text-muted uppercase tracking-[0.2em]">Exposed Port</div>
                                    <div className="text-xs font-black text-text-primary tracking-widest">3100</div>
                                </div>
                            </div>

                            <div className="bg-blue-600/5 border border-blue-500/20 rounded-2xl p-6 space-y-4">
                                <div className="flex items-center gap-3 text-blue-500 mb-2">
                                    <Globe size={18} />
                                    <h3 className="text-xs font-black uppercase tracking-widest">Remote Claude Connection</h3>
                                </div>
                                <p className="text-xs text-text-secondary leading-relaxed font-bold opacity-80">
                                    To control this Stigix instance via Claude Desktop on your Mac or PC, add the following to your <code className="bg-blue-500/10 px-1.5 py-0.5 rounded text-blue-400 font-mono">claude_desktop_config.json</code>:
                                </p>
                                <pre className="bg-black/40 border border-white/5 p-4 rounded-xl text-[11px] font-mono text-blue-300 overflow-x-auto shadow-inner">
{`{
  "mcpServers": {
    "stigix-cloud": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/inspector",
        "http://${window.location.hostname}:3100/sse"
      ]
    }
  }
}`}
                                </pre>
                                <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-500">
                                    <AlertCircle size={14} />
                                    <span className="text-[9px] font-black tracking-widest uppercase">Ensure port 3100 is accessible or reachable via SSH tunnel.</span>
                                </div>
                            </div>
                        </div>

                        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                            <h3 className="text-xs font-black uppercase tracking-widest text-text-muted mb-4">Architecture Mesh</h3>
                            <div className="bg-card-secondary/30 border border-border rounded-xl p-4 font-mono text-[10px] text-text-secondary leading-relaxed space-y-1">
                                <div className="flex items-center gap-2 text-emerald-500 font-black">
                                    <CheckCircle size={10} />
                                    <span>[Mesh Ready] Full registry synchronization detected.</span>
                                </div>
                                <div className="pl-4 opacity-70">
                                    • Orchestrator can pilot all learned nodes (managed & synthesized).<br />
                                    • JWT-signed API calls between nodes are automated.<br />
                                    • Discovery refresh every 5 minutes.
                                </div>
                            </div>
                        </div>
                    </div>
                )}

            {/* ─── Strata Logging Tab ─────────────────────────────────────── */}
            {activeTab === 'strata' && (
                <div className="bg-card border border-border rounded-2xl p-8 shadow-sm space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-600/10 rounded-lg text-blue-600 dark:text-blue-400 font-bold">
                            <Database size={24} />
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-text-primary tracking-tight">Strata Logging Service (SLS)</h2>
                            <p className="text-[10px] font-bold text-text-muted tracking-widest mt-0.5 opacity-70">Enrich security test history with Prisma Access diagnostics</p>
                        </div>
                    </div>

                    {!slsConfig ? (
                        <div className="text-center text-text-muted text-xs font-bold tracking-widest animate-pulse py-12">Loading SLS Configuration...</div>
                    ) : (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            <div className="space-y-6">
                                <div className="bg-card-secondary/30 border border-border rounded-2xl p-6 space-y-6">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-blue-600/10 rounded-lg text-blue-500">
                                                <Power size={18} />
                                            </div>
                                            <span className="text-xs font-black text-text-primary uppercase tracking-wider">Service Status</span>
                                        </div>
                                        <button
                                            onClick={() => setSlsConfig({ ...slsConfig, enabled: !slsConfig.enabled })}
                                            className={cn(
                                                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none",
                                                slsConfig.enabled ? "bg-blue-600" : "bg-card-hover"
                                            )}
                                        >
                                            <span className={cn(
                                                "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                                                slsConfig.enabled ? "translate-x-6" : "translate-x-1"
                                            )} />
                                        </button>
                                    </div>

                                    <div className="grid gap-4">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-extrabold text-text-muted uppercase tracking-widest pl-1">Tenant Service Group ID (TSG ID)</label>
                                            <input
                                                type="text"
                                                placeholder="e.g. 777003"
                                                value={slsConfig.tsg_id}
                                                onChange={e => setSlsConfig({ ...slsConfig, tsg_id: e.target.value })}
                                                className="w-full bg-card border border-border rounded-xl px-4 py-3 text-xs font-mono outline-none focus:ring-1 focus:ring-blue-500 transition-all font-black"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-[10px] font-extrabold text-text-muted uppercase tracking-widest pl-1">Client ID</label>
                                            <input
                                                type="text"
                                                placeholder="Enter OAuth2 Client ID"
                                                value={slsConfig.client_id}
                                                onChange={e => setSlsConfig({ ...slsConfig, client_id: e.target.value })}
                                                className="w-full bg-card border border-border rounded-xl px-4 py-3 text-xs font-mono outline-none focus:ring-1 focus:ring-blue-500 transition-all font-black"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-[10px] font-extrabold text-text-muted uppercase tracking-widest pl-1">Client Secret</label>
                                            <div className="relative">
                                                <input
                                                    type="password"
                                                    placeholder="••••••••••••••••"
                                                    value={slsConfig.client_secret || ''}
                                                    onChange={e => setSlsConfig({ ...slsConfig, client_secret: e.target.value })}
                                                    className="w-full bg-card border border-border rounded-xl px-4 py-3 text-xs font-mono outline-none focus:ring-1 focus:ring-blue-500 transition-all pr-10 font-black"
                                                />
                                                <Lock size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted opacity-40" />
                                            </div>
                                        </div>

                                        <div className="flex gap-4">
                                            <div className="flex-1 space-y-2">
                                                <label className="text-[10px] font-extrabold text-text-muted uppercase tracking-widest pl-1">Region</label>
                                                <select
                                                    value={slsConfig.region}
                                                    onChange={e => setSlsConfig({ ...slsConfig, region: e.target.value })}
                                                    className="w-full bg-card border border-border rounded-xl px-4 py-3 text-xs font-black tracking-widest outline-none focus:ring-1 focus:ring-blue-500 transition-all appearance-none"
                                                >
                                                    <option value="prd">Production (PRD)</option>
                                                    <option value="stg">Staging (STG)</option>
                                                </select>
                                            </div>
                                            <div className="flex-1 space-y-2">
                                                <label className="text-[10px] font-extrabold text-text-muted uppercase tracking-widest pl-1">Auto-Enrich</label>
                                                <div 
                                                    onClick={() => setSlsConfig({ ...slsConfig, auto_enrich: !slsConfig.auto_enrich })}
                                                    className={cn(
                                                        "w-full h-[46px] flex items-center justify-between px-4 border rounded-xl cursor-pointer transition-all",
                                                        slsConfig.auto_enrich ? "bg-blue-600/10 border-blue-500/30 text-blue-500 font-black" : "bg-card border-border text-text-muted font-black"
                                                    )}
                                                >
                                                    <span className="text-[10px] uppercase">Enabled</span>
                                                    {slsConfig.auto_enrich && <CheckCircle2 size={14} />}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex gap-4">
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        const res = await fetch('/api/admin/security/defaults', { headers: authHeaders });
                                                        const data = await res.json();
                                                        if (data && data.sls_config) {
                                                            setSlsConfig({
                                                                ...data.sls_config,
                                                                enabled: slsConfig.enabled, // Keep current toggle state
                                                                auto_enrich: slsConfig.auto_enrich // Keep current toggle state
                                                            });
                                                            showSuccess('Credentials synced from system environment');
                                                        }
                                                    } catch (err) { setErrorMsg('Failed to sync defaults'); }
                                                }}
                                                className="flex-1 py-3 bg-card-hover hover:bg-card-secondary/50 text-text-primary rounded-xl text-[10px] font-black tracking-widest transition-all border border-border"
                                            >
                                                <RefreshCw size={14} className="inline mr-2" />
                                                Sync from System
                                            </button>
                                        <button
                                            onClick={async () => {
                                                setSaving(true);
                                                try {
                                                    const res = await fetch('/api/security/config', {
                                                        method: 'POST',
                                                        headers: authHeaders,
                                                        body: JSON.stringify({ sls_config: slsConfig })
                                                    });
                                                    if (res.ok) showSuccess('SLS configuration saved');
                                                    else setErrorMsg('Failed to save SLS config');
                                                } catch (err) { setErrorMsg('Network error'); }
                                                finally { setSaving(false); }
                                            }}
                                            disabled={saving}
                                            className="flex-[2] py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[10px] font-black tracking-[0.2em] transition-all shadow-lg shadow-blue-900/20 disabled:opacity-50"
                                        >
                                            {saving ? <RefreshCw className="animate-spin inline mr-2" size={14} /> : 'Save Configuration'}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="bg-blue-600/5 border border-blue-500/10 rounded-2xl p-6 space-y-4">
                                    <div className="flex items-center gap-2 text-blue-500">
                                        <Info size={18} />
                                        <h3 className="text-xs font-black uppercase tracking-widest">About Strata Logging Integration</h3>
                                    </div>
                                    <p className="text-[11px] font-bold text-text-secondary leading-relaxed">
                                        Strata Logging Service (SLS) provides deep insights into network traffic and security threats processed by Prisma Access and Prisma SD-WAN.
                                    </p>
                                    <ul className="text-[10px] font-bold text-text-muted space-y-2 pl-4">
                                        <li className="list-disc">Automatically queries traffic logs after each security test.</li>
                                        <li className="list-disc">Identifies specific security rules and profiles applied to the flow.</li>
                                        <li className="list-disc">Provides detailed reasons for blocked or allowed traffic (e.g. App-ID, Threat ID).</li>
                                        <li className="list-disc">Enriches the Telemetry Diagnostic view in the Security dashboard.</li>
                                    </ul>
                                    <div className="pt-2">
                                        <p className="text-[9px] text-text-muted italic opacity-60 font-black">
                                            Requires an OAuth2 Client with <code className="bg-card px-1 rounded">logging_service:read</code> scope.
                                        </p>
                                    </div>
                                </div>

                                <div className="bg-card-secondary/20 border border-border rounded-2xl p-6 flex items-center justify-between">
                                    <div className="flex items-center gap-3 font-black">
                                        <Shield size={24} className="text-blue-500" />
                                        <div>
                                            <div className="text-[10px] text-text-primary uppercase tracking-widest">Global Security Context</div>
                                            <p className="text-[11px] text-text-muted">Managed by TSG: <span className="font-mono text-text-secondary">{slsConfig.tsg_id || 'unconfigured'}</span></p>
                                        </div>
                                    </div>
                                    <ShieldAlert size={24} className="opacity-10" />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
            </div>
        );
    }

