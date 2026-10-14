import React, { useState, useEffect, useCallback } from 'react';
import {
    Radio, Play, Square, Plus, Edit2, Trash2, RefreshCw,
    CheckCircle2, AlertTriangle, XCircle, ShieldCheck, Activity,
    Server, ArrowRight, Network, Info, Zap, Clock, Layers, ShieldAlert
} from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import type {
    CustomMulticastApplicationConfig,
    MulticastAddressingMode,
    MulticastExpectationMode,
    MulticastRateMode,
    MulticastClusterStatus,
    MulticastNodePreflightResult,
    MulticastHealthVerdict,
} from '../../../custom-tcp-apps/types';
import { MicroSparkline } from './MicroSparkline';
import { usePeerContext } from '../../PeerContext';

interface MulticastOverlayTabProps {
    token: string | null;
    localSiteName?: string;
}

const VERDICT_STYLES: Record<MulticastHealthVerdict, { badge: string; text: string; label: string }> = {
    HEALTHY: {
        badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        text: 'text-emerald-400',
        label: 'HEALTHY',
    },
    DEGRADED: {
        badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
        text: 'text-amber-400',
        label: 'DEGRADED',
    },
    FAILED: {
        badge: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
        text: 'text-rose-400',
        label: 'FAILED',
    },
    NO_TRAFFIC: {
        badge: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
        text: 'text-slate-400',
        label: 'NO TRAFFIC',
    },
};

function formatBitsPerSec(kbps: number): string {
    if (!kbps || kbps <= 0) return '0 kbps';
    if (kbps >= 1000) return `${(kbps / 1000).toFixed(2)} Mbps`;
    return `${kbps.toFixed(1)} kbps`;
}

function formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export const MulticastOverlayTab: React.FC<MulticastOverlayTabProps> = ({ token, localSiteName }) => {
    const { gFetch } = usePeerContext();
    const [profiles, setProfiles] = useState<CustomMulticastApplicationConfig[]>([]);
    const [selectedAppId, setSelectedAppId] = useState<string>('');
    const [clusterStatus, setClusterStatus] = useState<MulticastClusterStatus | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [actionBusy, setActionBusy] = useState<boolean>(false);
    const [knownNodes, setKnownNodes] = useState<string[]>([]);

    // Pre-Flight Modal State
    const [preflightOpen, setPreflightOpen] = useState<boolean>(false);
    const [preflightBusy, setPreflightBusy] = useState<boolean>(false);
    const [preflightData, setPreflightData] = useState<{
        appId: string;
        timestamp: number;
        allPassed: boolean;
        nodes: Record<string, MulticastNodePreflightResult>;
    } | null>(null);

    // Editor Modal State
    const [editorOpen, setEditorOpen] = useState<boolean>(false);
    const [editingProfile, setEditingProfile] = useState<CustomMulticastApplicationConfig | null>(null);

    // Form fields
    const [formId, setFormId] = useState('');
    const [formName, setFormName] = useState('');
    const [formDesc, setFormDesc] = useState('');
    const [formMode, setFormMode] = useState<MulticastAddressingMode>('asm');
    const [formGroup, setFormGroup] = useState('239.10.10.1');
    const [formPort, setFormPort] = useState(5000);
    const [formSsmSource, setFormSsmSource] = useState('');
    const [formSenderNode, setFormSenderNode] = useState('');
    const [formSenderIfaceIp, setFormSenderIfaceIp] = useState('auto');
    const [formRateMode, setFormRateMode] = useState<MulticastRateMode>('cbr');
    const [formKbps, setFormKbps] = useState(1000);
    const [formBurstPackets, setFormBurstPackets] = useState(30);
    const [formBurstIntervalMs, setFormBurstIntervalMs] = useState(100);
    const [formPayloadBytes, setFormPayloadBytes] = useState(1316);
    const [formTtl, setFormTtl] = useState(64);
    const [formDscp, setFormDscp] = useState('CS5');
    const [formDurationSec, setFormDurationSec] = useState(0);
    const [formMaxLossPct, setFormMaxLossPct] = useState(0.1);
    const [formDegradedLossPct, setFormDegradedLossPct] = useState(2.0);
    const [formMaxGapMs, setFormMaxGapMs] = useState(3000);
    const [formReceivers, setFormReceivers] = useState<
        { node: string; expect: MulticastExpectationMode; interfaceIp?: string; enabled: boolean }[]
    >([]);
    const [newReceiverNode, setNewReceiverNode] = useState('');
    const [newReceiverExpect, setNewReceiverExpect] = useState<MulticastExpectationMode>('traffic');

    const headers = useCallback(
        () => ({
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        }),
        [token]
    );

    const fetchProfiles = useCallback(async () => {
        try {
            const res = await gFetch('/api/custom-tcp-apps/multicast', { headers: headers() });
            if (!res.ok) return;
            const data = await res.json();
            const list: CustomMulticastApplicationConfig[] = data.multicastApplications || [];
            setProfiles(list);
            if (list.length > 0 && (!selectedAppId || !list.some((p) => p.id === selectedAppId))) {
                setSelectedAppId(list[0].id);
            }
        } catch (e) {
            console.error('[MulticastOverlayTab] Failed to fetch profiles:', e);
        } finally {
            setLoading(false);
        }
    }, [gFetch, headers, selectedAppId]);

    const fetchKnownNodes = useCallback(async () => {
        try {
            const res = await gFetch('/api/fabric/peers', { headers: headers() });
            if (!res.ok) return;
            const data = await res.json();
            const nodes = new Set<string>();
            if (localSiteName) nodes.add(localSiteName);
            if (Array.isArray(data.peers)) {
                for (const p of data.peers) {
                    const name = p.id || p.site_name || p.name;
                    if (name) nodes.add(name);
                }
            }
            setKnownNodes(Array.from(nodes));
        } catch {
            if (localSiteName) setKnownNodes([localSiteName]);
        }
    }, [gFetch, headers, localSiteName]);

    const fetchClusterStats = useCallback(
        async (appId: string) => {
            if (!appId) return;
            try {
                const res = await gFetch(`/api/custom-tcp-apps/multicast/${encodeURIComponent(appId)}/stats`, {
                    headers: headers(),
                });
                if (!res.ok) return;
                const data = await res.json();
                if (data.status) {
                    setClusterStatus(data.status);
                }
            } catch (e) {
                // Silent during polling
            }
        },
        [gFetch, headers]
    );

    useEffect(() => {
        fetchProfiles();
        fetchKnownNodes();
    }, [fetchProfiles, fetchKnownNodes]);

    useEffect(() => {
        if (!selectedAppId) {
            setClusterStatus(null);
            return;
        }
        fetchClusterStats(selectedAppId);
        const timer = setInterval(() => {
            fetchClusterStats(selectedAppId);
        }, 1500);
        return () => clearInterval(timer);
    }, [selectedAppId, fetchClusterStats]);

    const selectedProfile = profiles.find((p) => p.id === selectedAppId) || null;

    // ─── Stream Orchestration Actions ─────────────────────────────────────────

    const handleStartStream = async () => {
        if (!selectedProfile) return;
        setActionBusy(true);
        try {
            const res = await gFetch(`/api/custom-tcp-apps/multicast/${encodeURIComponent(selectedProfile.id)}/start`, {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({}),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to start multicast stream');
            }
            setClusterStatus(data.status);
            toast.success(`Multicast stream "${selectedProfile.name}" started (${selectedProfile.group}:${selectedProfile.port})`);
        } catch (e: any) {
            toast.error(e.message || 'Failed to start stream');
        } finally {
            setActionBusy(false);
        }
    };

    const handleStopStream = async () => {
        if (!selectedProfile) return;
        setActionBusy(true);
        try {
            const res = await gFetch(`/api/custom-tcp-apps/multicast/${encodeURIComponent(selectedProfile.id)}/stop`, {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({}),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to stop multicast stream');
            }
            setClusterStatus(data.status);
            toast.success(`Multicast stream "${selectedProfile.name}" stopped`);
        } catch (e: any) {
            toast.error(e.message || 'Failed to stop stream');
        } finally {
            setActionBusy(false);
        }
    };

    const handleToggleReceiver = async (nodeId: string, action: 'join' | 'leave', expect?: MulticastExpectationMode) => {
        if (!selectedProfile) return;
        try {
            const res = await gFetch(
                `/api/custom-tcp-apps/multicast/${encodeURIComponent(selectedProfile.id)}/receiver/${encodeURIComponent(nodeId)}/toggle`,
                {
                    method: 'POST',
                    headers: headers(),
                    body: JSON.stringify({ action, expect }),
                }
            );
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || `Failed to ${action} receiver ${nodeId}`);
            }
            if (data.status) setClusterStatus(data.status);
            toast.success(`${nodeId}: IGMP ${action.toUpperCase()} executed`);
        } catch (e: any) {
            toast.error(e.message || `Failed to ${action} receiver ${nodeId}`);
        }
    };

    const handleRunPreflight = async () => {
        if (!selectedProfile) return;
        setPreflightOpen(true);
        setPreflightBusy(true);
        try {
            const res = await gFetch(`/api/custom-tcp-apps/multicast/${encodeURIComponent(selectedProfile.id)}/preflight`, {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({}),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Pre-flight check failed');
            }
            setPreflightData(data);
        } catch (e: any) {
            toast.error(e.message || 'Pre-flight check failed');
        } finally {
            setPreflightBusy(false);
        }
    };

    // ─── Create / Edit / Delete Profile ───────────────────────────────────────

    const openNewProfileModal = () => {
        setEditingProfile(null);
        const defaultSender = localSiteName || knownNodes[0] || 'DC1';
        const defaultRx = knownNodes.filter((n) => n !== defaultSender);
        setFormId(`mc-${Math.random().toString(36).substring(2, 7)}`);
        setFormName('SD-WAN Overlay Multicast Feed');
        setFormDesc('Real UDP/IGMP multicast stream validation across Prisma SD-WAN overlay');
        setFormMode('asm');
        setFormGroup('239.10.10.1');
        setFormPort(5000);
        setFormSsmSource('');
        setFormSenderNode(defaultSender);
        setFormSenderIfaceIp('auto');
        setFormRateMode('cbr');
        setFormKbps(1000);
        setFormBurstPackets(30);
        setFormBurstIntervalMs(100);
        setFormPayloadBytes(1316);
        setFormTtl(64);
        setFormDscp('CS5');
        setFormDurationSec(0);
        setFormMaxLossPct(0.1);
        setFormDegradedLossPct(2.0);
        setFormMaxGapMs(3000);
        setFormReceivers(
            defaultRx.length > 0
                ? defaultRx.map((n) => ({ node: n, expect: 'traffic', interfaceIp: 'auto', enabled: true }))
                : [{ node: defaultSender, expect: 'traffic', interfaceIp: 'auto', enabled: true }]
        );
        setEditorOpen(true);
    };

    const openEditProfileModal = (profile: CustomMulticastApplicationConfig) => {
        setEditingProfile(profile);
        setFormId(profile.id);
        setFormName(profile.name);
        setFormDesc(profile.description || '');
        setFormMode(profile.mode);
        setFormGroup(profile.group);
        setFormPort(profile.port);
        setFormSsmSource(profile.ssmSource || '');
        setFormSenderNode(profile.senderNode);
        setFormSenderIfaceIp(profile.senderInterfaceIp || 'auto');
        setFormRateMode(profile.rate?.mode || 'cbr');
        setFormKbps(profile.rate?.kbps || 1000);
        setFormBurstPackets(profile.rate?.burstPackets || 30);
        setFormBurstIntervalMs(profile.rate?.burstIntervalMs || 100);
        setFormPayloadBytes(profile.payloadBytes || 1316);
        setFormTtl(profile.ttl || 64);
        setFormDscp(profile.dscp || 'CS5');
        setFormDurationSec(profile.durationSec || 0);
        setFormMaxLossPct(profile.thresholds?.maxLossPct ?? 0.1);
        setFormDegradedLossPct(profile.thresholds?.degradedLossPct ?? 2.0);
        setFormMaxGapMs(profile.thresholds?.maxGapMs ?? 3000);
        setFormReceivers(profile.receivers ? [...profile.receivers] : []);
        setEditorOpen(true);
    };

    const handleSaveProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        if (formReceivers.length === 0) {
            toast.error('Please add at least one receiver node');
            return;
        }
        const payload: CustomMulticastApplicationConfig = {
            id: formId.trim(),
            name: formName.trim(),
            description: formDesc.trim(),
            enabled: true,
            group: formGroup.trim(),
            port: Number(formPort),
            mode: formMode,
            ssmSource: formMode === 'ssm' ? formSsmSource.trim() : undefined,
            senderNode: formSenderNode.trim(),
            senderInterfaceIp: formSenderIfaceIp.trim() || 'auto',
            receivers: formReceivers,
            rate: {
                mode: formRateMode,
                kbps: Number(formKbps),
                burstPackets: formRateMode === 'burst' ? Number(formBurstPackets) : undefined,
                burstIntervalMs: formRateMode === 'burst' ? Number(formBurstIntervalMs) : undefined,
            },
            payloadBytes: Number(formPayloadBytes),
            ttl: Number(formTtl),
            dscp: formDscp,
            durationSec: Number(formDurationSec),
            thresholds: {
                maxLossPct: Number(formMaxLossPct),
                degradedLossPct: Number(formDegradedLossPct),
                maxGapMs: Number(formMaxGapMs),
            },
        };

        try {
            const url = editingProfile
                ? `/api/custom-tcp-apps/multicast/${encodeURIComponent(editingProfile.id)}`
                : '/api/custom-tcp-apps/multicast';
            const method = editingProfile ? 'PUT' : 'POST';
            const res = await gFetch(url, {
                method,
                headers: headers(),
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                const detail = Array.isArray(data.errors)
                    ? data.errors.map((err: any) => `${err.field}: ${err.message}`).join(', ')
                    : data.error || 'Failed to save multicast profile';
                throw new Error(detail);
            }
            toast.success(editingProfile ? 'Multicast profile updated' : 'Multicast profile created');
            setEditorOpen(false);
            await fetchProfiles();
            setSelectedAppId(payload.id);
        } catch (err: any) {
            toast.error(err.message || 'Validation error');
        }
    };

    const handleDeleteProfile = async () => {
        if (!selectedProfile) return;
        if (!window.confirm(`Delete multicast profile "${selectedProfile.name}"?`)) return;
        try {
            const res = await gFetch(`/api/custom-tcp-apps/multicast/${encodeURIComponent(selectedProfile.id)}`, {
                method: 'DELETE',
                headers: headers(),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to delete profile');
            }
            toast.success(`Deleted "${selectedProfile.name}"`);
            setSelectedAppId('');
            fetchProfiles();
        } catch (err: any) {
            toast.error(err.message || 'Failed to delete profile');
        }
    };

    const addReceiverToForm = () => {
        const node = newReceiverNode.trim();
        if (!node) return;
        if (formReceivers.some((r) => r.node.toLowerCase() === node.toLowerCase())) {
            toast.error(`Receiver "${node}" is already in the list`);
            return;
        }
        setFormReceivers([...formReceivers, { node, expect: newReceiverExpect, interfaceIp: 'auto', enabled: true }]);
        setNewReceiverNode('');
    };

    if (loading) {
        return (
            <div className="bg-card border border-border rounded-xl p-10 text-center text-text-muted">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-400" />
                Loading SD-WAN Multicast Overlay profiles...
            </div>
        );
    }

    const isRunning = Boolean(clusterStatus?.active || clusterStatus?.sender?.active);
    const overallVerdict: MulticastHealthVerdict = clusterStatus?.overallVerdict || 'NO_TRAFFIC';
    const verdictStyle = VERDICT_STYLES[overallVerdict] || VERDICT_STYLES.NO_TRAFFIC;

    return (
        <div className="space-y-5">
            {/* Top Control Bar */}
            <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/25 flex items-center justify-center text-purple-400">
                            <Radio className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="text-[10px] font-bold uppercase tracking-wider text-purple-400">
                                IGMPv2/v3 &bull; PIM-SM / SSM Engine
                            </div>
                            <h3 className="text-sm font-bold text-text-primary">SD-WAN Overlay Multicast Validation</h3>
                        </div>
                    </div>

                    {/* Profile Selector */}
                    <div className="flex items-center gap-2 ml-0 lg:ml-4">
                        <select
                            aria-label="Select Multicast Profile"
                            value={selectedAppId}
                            onChange={(e) => setSelectedAppId(e.target.value)}
                            className="bg-background border border-border rounded-lg px-3 py-2 text-xs font-bold text-text-primary focus:outline-none focus:border-purple-500"
                        >
                            {profiles.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name} ({p.mode.toUpperCase()} {p.group}:{p.port})
                                </option>
                            ))}
                        </select>

                        {selectedProfile && (
                            <>
                                <button
                                    onClick={() => openEditProfileModal(selectedProfile)}
                                    className="p-2 rounded-lg bg-background hover:bg-card-hover border border-border text-text-muted hover:text-text-primary transition-colors"
                                    title="Edit Multicast Profile"
                                >
                                    <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    onClick={handleDeleteProfile}
                                    className="p-2 rounded-lg bg-background hover:bg-rose-500/10 border border-border hover:border-rose-500/30 text-text-muted hover:text-rose-400 transition-colors"
                                    title="Delete Multicast Profile"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </>
                        )}

                        <button
                            onClick={openNewProfileModal}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600/15 hover:bg-purple-600/25 text-purple-300 border border-purple-500/30 text-xs font-bold transition-all"
                        >
                            <Plus className="w-3.5 h-3.5" /> New Profile
                        </button>
                    </div>
                </div>

                {/* Action Buttons */}
                {selectedProfile && (
                    <div className="flex flex-wrap items-center gap-2.5">
                        <div className={cn('px-2.5 py-1 rounded-md border text-[11px] font-black tracking-wider', verdictStyle.badge)}>
                            OVERALL: {verdictStyle.label}
                        </div>

                        <button
                            onClick={handleRunPreflight}
                            disabled={preflightBusy}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-background hover:bg-card-hover border border-border text-text-primary text-xs font-bold transition-all"
                        >
                            <ShieldCheck className="w-4 h-4 text-cyan-400" />
                            Pre-Flight Check
                        </button>

                        {!isRunning ? (
                            <button
                                onClick={handleStartStream}
                                disabled={actionBusy}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold shadow-sm transition-all"
                            >
                                <Play className="w-3.5 h-3.5 fill-current" />
                                Start Multicast Stream
                            </button>
                        ) : (
                            <button
                                onClick={handleStopStream}
                                disabled={actionBusy}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold shadow-sm transition-all"
                            >
                                <Square className="w-3.5 h-3.5 fill-current" />
                                Stop Stream
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Diagnostic Hints Banner when issues or zero-replication detected */}
            {clusterStatus && clusterStatus.diagnostics && clusterStatus.diagnostics.length > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div className="space-y-1 text-xs">
                        <div className="font-bold text-amber-300 uppercase tracking-wider text-[10px]">
                            SD-WAN Multicast Replication &amp; Policy Diagnostics
                        </div>
                        <ul className="list-disc list-inside text-text-secondary space-y-0.5">
                            {clusterStatus.diagnostics.map((d, idx) => (
                                <li key={idx} className="font-mono text-[11px]">
                                    {d}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}

            {/* Main 1-to-N Architecture Overview Card */}
            {selectedProfile && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    {/* Left: Multicast Source (Sender) Card */}
                    <div className="lg:col-span-4 bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col justify-between space-y-4">
                        <div>
                            <div className="flex items-center justify-between border-b border-border/60 pb-2.5 mb-3">
                                <div className="flex items-center gap-2">
                                    <Server className="w-4 h-4 text-blue-400" />
                                    <span className="text-xs font-bold uppercase tracking-wider text-text-primary">
                                        Multicast Source (Sender)
                                    </span>
                                </div>
                                <span
                                    className={cn(
                                        'px-2 py-0.5 rounded text-[10px] font-bold uppercase border',
                                        clusterStatus?.sender?.active
                                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                            : 'bg-slate-500/15 text-slate-400 border-slate-500/30'
                                    )}
                                >
                                    {clusterStatus?.sender?.active ? 'TX ACTIVE' : 'IDLE'}
                                </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2.5 text-xs">
                                <div className="bg-background/60 border border-border/60 rounded-lg p-2.5">
                                    <div className="text-[10px] text-text-muted uppercase">Source Node</div>
                                    <div className="font-bold text-text-primary mt-0.5 flex items-center gap-1.5">
                                        <span>{selectedProfile.senderNode}</span>
                                        {clusterStatus?.sender?.interfaceName && (
                                            <span className="text-[10px] font-mono text-blue-400">
                                                ({clusterStatus.sender.interfaceName})
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[10px] font-mono text-text-muted">
                                        IP: {clusterStatus?.sender?.interfaceIp || selectedProfile.senderInterfaceIp || 'auto'}
                                    </div>
                                </div>

                                <div className="bg-background/60 border border-border/60 rounded-lg p-2.5">
                                    <div className="text-[10px] text-text-muted uppercase">Group &amp; Mode</div>
                                    <div className="font-mono font-bold text-purple-400 mt-0.5">
                                        {selectedProfile.group}:{selectedProfile.port}
                                    </div>
                                    <div className="text-[10px] text-text-muted">
                                        {selectedProfile.mode.toUpperCase()}
                                        {selectedProfile.mode === 'ssm' && selectedProfile.ssmSource
                                            ? ` (S=${selectedProfile.ssmSource})`
                                            : ' (*,G Any-Source)'}
                                    </div>
                                </div>

                                <div className="bg-background/60 border border-border/60 rounded-lg p-2.5">
                                    <div className="text-[10px] text-text-muted uppercase">TX Bitrate / Target</div>
                                    <div className="font-mono font-bold text-emerald-400 mt-0.5">
                                        {formatBitsPerSec(clusterStatus?.sender?.txBitrateKbps || 0)}
                                    </div>
                                    <div className="text-[10px] text-text-muted">
                                        Target: {formatBitsPerSec(selectedProfile.rate.kbps)} ({selectedProfile.rate.mode.toUpperCase()})
                                    </div>
                                </div>

                                <div className="bg-background/60 border border-border/60 rounded-lg p-2.5">
                                    <div className="text-[10px] text-text-muted uppercase">Packet Rate &amp; Frame</div>
                                    <div className="font-mono font-bold text-text-primary mt-0.5">
                                        {clusterStatus?.sender?.txPps ?? 0} pps
                                    </div>
                                    <div className="text-[10px] text-text-muted">
                                        {selectedProfile.payloadBytes}B &bull; TTL {selectedProfile.ttl} &bull; DSCP {selectedProfile.dscp}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="border-t border-border/60 pt-2.5 flex items-center justify-between text-[11px] text-text-muted font-mono">
                            <span>
                                Sent: <strong className="text-text-primary">{clusterStatus?.sender?.packetsSent ?? 0}</strong> pkts (
                                {formatBytes(clusterStatus?.sender?.bytesSent ?? 0)})
                            </span>
                            <span>
                                Run #{clusterStatus?.sender?.runId ?? 0} &bull; {clusterStatus?.sender?.uptimeSec ?? 0}s
                            </span>
                        </div>
                    </div>

                    {/* Right: 1-to-N Replication Summary & SLA Thresholds */}
                    <div className="lg:col-span-8 bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col justify-between">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5 mb-3">
                            <div className="flex items-center gap-2">
                                <Network className="w-4 h-4 text-purple-400" />
                                <span className="text-xs font-bold uppercase tracking-wider text-text-primary">
                                    1 &rarr; {selectedProfile.receivers.length} Overlay Replication Tree ({selectedProfile.mode.toUpperCase()})
                                </span>
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-text-muted font-mono">
                                <span>
                                    SLA Healthy Loss: &le;{selectedProfile.thresholds?.maxLossPct ?? 0.1}%
                                </span>
                                <span>&bull;</span>
                                <span>
                                    Degraded: &le;{selectedProfile.thresholds?.degradedLossPct ?? 2.0}%
                                </span>
                                <span>&bull;</span>
                                <span>
                                    Max Gap: &le;{selectedProfile.thresholds?.maxGapMs ?? 3000}ms
                                </span>
                            </div>
                        </div>

                        {/* Visual Fan-Out Flow */}
                        <div className="flex flex-col md:flex-row items-center justify-between gap-4 py-2">
                            <div className="px-3.5 py-2.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-center min-w-[140px]">
                                <div className="text-[10px] font-bold uppercase text-blue-400">Source DR</div>
                                <div className="text-sm font-black text-text-primary">{selectedProfile.senderNode}</div>
                                <div className="text-[10px] font-mono text-text-muted mt-0.5">
                                    TTL={selectedProfile.ttl} &bull; {selectedProfile.dscp}
                                </div>
                            </div>

                            <div className="flex flex-col items-center text-purple-400">
                                <div className="text-[10px] font-mono uppercase tracking-wider">
                                    PIM-SM / IGMP ({selectedProfile.group})
                                </div>
                                <ArrowRight className="w-5 h-5 my-0.5" />
                                <div className="text-[10px] font-mono text-text-muted">24B STGX Seq Header</div>
                            </div>

                            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 w-full">
                                {(clusterStatus?.receivers || selectedProfile.receivers).map((r: any) => {
                                    const verdict: MulticastHealthVerdict = r.verdict || 'NO_TRAFFIC';
                                    const vStyle = VERDICT_STYLES[verdict] || VERDICT_STYLES.NO_TRAFFIC;
                                    const joined = r.joined ?? false;
                                    return (
                                        <div
                                            key={r.node}
                                            className="p-2.5 rounded-lg bg-background/70 border border-border flex items-center justify-between gap-2"
                                        >
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-xs font-bold text-text-primary truncate">{r.node}</span>
                                                    <span
                                                        className={cn(
                                                            'text-[9px] px-1.5 py-0.2 rounded font-bold border',
                                                            r.expect === 'none'
                                                                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                                                : 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                                                        )}
                                                    >
                                                        {r.expect === 'none' ? 'LEAK TEST' : 'RX'}
                                                    </span>
                                                </div>
                                                <div className="text-[10px] font-mono text-text-muted mt-0.5">
                                                    {joined ? `${formatBitsPerSec(r.rxBitrateKbps || 0)} • Loss ${(r.lossPct || 0).toFixed(2)}%` : 'IGMP Pruned / Left'}
                                                </div>
                                            </div>
                                            <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-black border shrink-0', vStyle.badge)}>
                                                {vStyle.label}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="border-t border-border/60 pt-2.5 mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-muted">
                            <span>
                                Tip: Toggle individual branch receivers below with <strong>IGMP Join / Leave</strong> while the stream is active to validate <strong>Late-Join (S4)</strong> and <strong>IGMP Prune (S8)</strong>.
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* Live Receiver Matrix Table */}
            {selectedProfile && (
                <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                    <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Activity className="w-4 h-4 text-emerald-400" />
                            <h4 className="text-xs font-bold uppercase tracking-wider text-text-primary">
                                Live Multicast Receiver Telemetry Matrix
                            </h4>
                        </div>
                        <span className="text-[11px] text-text-muted font-mono">
                            RFC 3550 Jitter &bull; 4096-Packet Bitmask Sequence Tracker
                        </span>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-border bg-background/50 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                                    <th className="py-2.5 px-3">Receiver Node</th>
                                    <th className="py-2.5 px-3">IGMP State</th>
                                    <th className="py-2.5 px-3">Policy Mode</th>
                                    <th className="py-2.5 px-3">RX Bitrate &amp; Trend</th>
                                    <th className="py-2.5 px-3">Packets (RX / Exp)</th>
                                    <th className="py-2.5 px-3">Loss %</th>
                                    <th className="py-2.5 px-3">Dup / Reorder</th>
                                    <th className="py-2.5 px-3">Jitter / Max Gap</th>
                                    <th className="py-2.5 px-3">Join Latency</th>
                                    <th className="py-2.5 px-3">Verdict</th>
                                    <th className="py-2.5 px-3 text-right">IGMP Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60 text-xs">
                                {(clusterStatus?.receivers || []).map((r) => {
                                    const vStyle = VERDICT_STYLES[r.verdict] || VERDICT_STYLES.NO_TRAFFIC;
                                    const kbpsHistory = (r.history || []).map((h) => h.kbps);
                                    return (
                                        <tr key={r.node} className="hover:bg-card-hover/40 transition-colors">
                                            <td className="py-3 px-3 font-bold text-text-primary">
                                                <div>{r.node}</div>
                                                <div className="text-[10px] font-mono text-text-muted">
                                                    {r.interfaceName || 'auto'} ({r.interfaceIp || '0.0.0.0'})
                                                </div>
                                            </td>
                                            <td className="py-3 px-3">
                                                <span
                                                    className={cn(
                                                        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border',
                                                        r.joined
                                                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                                            : 'bg-slate-500/15 text-slate-400 border-slate-500/30'
                                                    )}
                                                >
                                                    {r.joined ? 'JOINED' : 'LEFT'}
                                                </span>
                                                <div className="text-[10px] font-mono text-text-muted mt-0.5">
                                                    {r.igmpVersion || 'IGMPv2/v3'}
                                                </div>
                                            </td>
                                            <td className="py-3 px-3">
                                                <span
                                                    className={cn(
                                                        'px-2 py-0.5 rounded text-[10px] font-bold border',
                                                        r.expect === 'none'
                                                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                                            : 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                                                    )}
                                                >
                                                    {r.expect === 'none' ? 'EXPECT_NONE (Deny)' : 'EXPECT_TRAFFIC'}
                                                </span>
                                            </td>
                                            <td className="py-3 px-3 font-mono">
                                                <div className="flex items-center gap-2">
                                                    <div>
                                                        <div className="font-bold text-text-primary">
                                                            {formatBitsPerSec(r.rxBitrateKbps)}
                                                        </div>
                                                        <div className="text-[10px] text-text-muted">{r.rxPps} pps</div>
                                                    </div>
                                                    {kbpsHistory.length > 1 && (
                                                        <MicroSparkline samples={kbpsHistory} strokeColor="#a855f7" width={56} height={20} />
                                                    )}
                                                </div>
                                            </td>
                                            <td className="py-3 px-3 font-mono">
                                                <div className="text-text-primary font-bold">
                                                    {r.packetsReceived.toLocaleString()} / {r.packetsExpected.toLocaleString()}
                                                </div>
                                                <div className="text-[10px] text-text-muted">
                                                    Seq: {r.firstSeq ?? '-'} &rarr; {r.highestSeq ?? '-'}
                                                </div>
                                            </td>
                                            <td className="py-3 px-3 font-mono">
                                                <div
                                                    className={cn(
                                                        'font-bold',
                                                        r.lossPct > 2
                                                            ? 'text-rose-400'
                                                            : r.lossPct > 0.1
                                                            ? 'text-amber-400'
                                                            : 'text-emerald-400'
                                                    )}
                                                >
                                                    {r.lossPct.toFixed(2)}%
                                                </div>
                                                <div className="text-[10px] text-text-muted">{r.packetsLost} lost</div>
                                            </td>
                                            <td className="py-3 px-3 font-mono text-[11px]">
                                                <div>Dup: {r.duplicatePackets}</div>
                                                <div className="text-text-muted">Reord: {r.reorderedPackets}</div>
                                            </td>
                                            <td className="py-3 px-3 font-mono">
                                                <div className="text-text-primary">{r.jitterMs.toFixed(2)} ms</div>
                                                <div className="text-[10px] text-text-muted">Gap: {r.maxGapMs} ms</div>
                                            </td>
                                            <td className="py-3 px-3 font-mono">
                                                {r.joinLatencyMs !== null && r.joinLatencyMs !== undefined ? (
                                                    <span className="text-cyan-400 font-bold">{r.joinLatencyMs} ms</span>
                                                ) : (
                                                    <span className="text-text-muted">&mdash;</span>
                                                )}
                                            </td>
                                            <td className="py-3 px-3">
                                                <span className={cn('px-2 py-0.5 rounded text-[10px] font-black border', vStyle.badge)}>
                                                    {vStyle.label}
                                                </span>
                                                <div className="text-[10px] text-text-muted mt-0.5 max-w-[190px] truncate" title={r.verdictReason}>
                                                    {r.verdictReason}
                                                </div>
                                            </td>
                                            <td className="py-3 px-3 text-right">
                                                {r.joined ? (
                                                    <button
                                                        onClick={() => handleToggleReceiver(r.node, 'leave', r.expect)}
                                                        className="px-2.5 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-[11px] font-bold transition-colors"
                                                        title="Send IGMP Leave (Prune branch from multicast tree)"
                                                    >
                                                        IGMP Leave
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleToggleReceiver(r.node, 'join', r.expect)}
                                                        className="px-2.5 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-[11px] font-bold transition-colors"
                                                        title="Send IGMP Membership Report (Late-Join multicast tree)"
                                                    >
                                                        IGMP Join
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Pre-Flight Check Modal */}
            {preflightOpen && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-card border border-border rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
                        <div className="p-4 border-b border-border flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="w-5 h-5 text-cyan-400" />
                                <h3 className="text-sm font-bold text-text-primary">
                                    Multicast Overlay Pre-Flight Check ({selectedProfile?.name})
                                </h3>
                            </div>
                            <button
                                onClick={() => setPreflightOpen(false)}
                                className="text-text-muted hover:text-text-primary text-xs font-bold px-2 py-1"
                            >
                                ESC / Close
                            </button>
                        </div>

                        <div className="p-5 overflow-y-auto space-y-4">
                            {preflightBusy ? (
                                <div className="py-12 text-center text-text-muted">
                                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-cyan-400" />
                                    Inspecting LAN interfaces, IGMP versions, rp_filter, and UDP port availability across nodes...
                                </div>
                            ) : preflightData ? (
                                <>
                                    <div
                                        className={cn(
                                            'p-3 rounded-xl border text-xs font-bold flex items-center justify-between',
                                            preflightData.allPassed
                                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                                : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                                        )}
                                    >
                                        <span>
                                            {preflightData.allPassed
                                                ? 'All participating nodes passed OS & network multicast pre-flight checks.'
                                                : 'One or more nodes reported warnings or failures. Review hints below before starting stream.'}
                                        </span>
                                    </div>

                                    <div className="space-y-3">
                                        {Object.values(preflightData.nodes).map((nodeRes) => (
                                            <div key={nodeRes.node} className="bg-background border border-border rounded-xl p-3.5 space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs font-black text-text-primary">{nodeRes.node}</span>
                                                        <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30 font-bold uppercase">
                                                            {nodeRes.role}
                                                        </span>
                                                        <span className="text-[11px] font-mono text-text-muted">
                                                            {nodeRes.interfaceName} ({nodeRes.interfaceIp}) &bull; {nodeRes.igmpVersion}
                                                        </span>
                                                    </div>
                                                    <span
                                                        className={cn(
                                                            'px-2 py-0.5 rounded text-[10px] font-black uppercase border',
                                                            nodeRes.status === 'pass'
                                                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                                                : nodeRes.status === 'warn'
                                                                ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                                                : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                                                        )}
                                                    >
                                                        {nodeRes.status.toUpperCase()}
                                                    </span>
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 text-[11px]">
                                                    {nodeRes.checks.map((c, i) => (
                                                        <div key={i} className="flex items-center gap-1.5 text-text-secondary">
                                                            {c.status === 'pass' ? (
                                                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                                            ) : c.status === 'warn' ? (
                                                                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                                            ) : (
                                                                <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                                                            )}
                                                            <span className="font-semibold">{c.name}:</span>
                                                            <span className="font-mono text-text-muted truncate" title={c.detail}>
                                                                {c.detail}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>

                                                {nodeRes.hints.length > 0 && (
                                                    <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 font-mono">
                                                        {nodeRes.hints.map((h, i) => (
                                                            <div key={i}>&bull; {h}</div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </>
                            ) : null}
                        </div>
                    </div>
                </div>
            )}

            {/* Create / Edit Multicast Profile Modal */}
            {editorOpen && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-card border border-border rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
                        <div className="p-4 border-b border-border flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Radio className="w-5 h-5 text-purple-400" />
                                <h3 className="text-sm font-bold text-text-primary">
                                    {editingProfile ? `Edit Multicast Profile: ${editingProfile.name}` : 'Create Multicast Overlay Profile'}
                                </h3>
                            </div>
                            <button
                                onClick={() => setEditorOpen(false)}
                                className="text-text-muted hover:text-text-primary text-xs font-bold px-2 py-1"
                            >
                                Cancel
                            </button>
                        </div>

                        <form onSubmit={handleSaveProfile} className="p-5 overflow-y-auto space-y-4 text-xs">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[10px] font-bold uppercase text-text-muted mb-1">Profile ID</label>
                                    <input
                                        type="text"
                                        required
                                        disabled={Boolean(editingProfile)}
                                        value={formId}
                                        onChange={(e) => setFormId(e.target.value)}
                                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text-primary font-mono disabled:opacity-50"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold uppercase text-text-muted mb-1">Profile Name</label>
                                    <input
                                        type="text"
                                        required
                                        value={formName}
                                        onChange={(e) => setFormName(e.target.value)}
                                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text-primary"
                                    />
                                </div>
                            </div>

                            {/* Multicast Group, Port, Mode */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-[10px] font-bold uppercase text-text-muted mb-1">
                                        Addressing Mode
                                    </label>
                                    <select
                                        value={formMode}
                                        onChange={(e) => {
                                            const m = e.target.value as MulticastAddressingMode;
                                            setFormMode(m);
                                            if (m === 'ssm' && formGroup.startsWith('239.')) {
                                                setFormGroup('232.10.10.1');
                                            } else if (m === 'asm' && formGroup.startsWith('232.')) {
                                                setFormGroup('239.10.10.1');
                                            }
                                        }}
                                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text-primary font-bold"
                                    >
                                        <option value="asm">ASM (*,G — 239.0.0.0/8)</option>
                                        <option value="ssm">SSM (S,G — 232.0.0.0/8)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold uppercase text-text-muted mb-1">
                                        Multicast Group IP
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={formGroup}
                                        onChange={(e) => setFormGroup(e.target.value)}
                                        placeholder={formMode === 'ssm' ? '232.10.10.1' : '239.10.10.1'}
                                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text-primary font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold uppercase text-text-muted mb-1">UDP Port</label>
                                    <input
                                        type="number"
                                        required
                                        min={1024}
                                        max={65535}
                                        value={formPort}
                                        onChange={(e) => setFormPort(Number(e.target.value))}
                                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text-primary font-mono"
                                    />
                                </div>
                            </div>

                            {formMode === 'ssm' && (
                                <div>
                                    <label className="block text-[10px] font-bold uppercase text-purple-400 mb-1">
                                        SSM Source Unicast IPv4 (IGMPv3 INCLUDE Source)
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="e.g. 172.16.110.2 (Sender LAN IP)"
                                        value={formSsmSource}
                                        onChange={(e) => setFormSsmSource(e.target.value)}
                                        className="w-full bg-background border border-purple-500/40 rounded-lg px-3 py-2 text-text-primary font-mono"
                                    />
                                </div>
                            )}

                            {/* Sender & Rate Configuration */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-[10px] font-bold uppercase text-text-muted mb-1">
                                        Sender Node (Source DR)
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        list="known-mc-nodes"
                                        value={formSenderNode}
                                        onChange={(e) => setFormSenderNode(e.target.value)}
                                        placeholder="e.g. DC1 or BR1"
                                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text-primary font-bold"
                                    />
                                    <datalist id="known-mc-nodes">
                                        {knownNodes.map((n) => (
                                            <option key={n} value={n} />
                                        ))}
                                    </datalist>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold uppercase text-text-muted mb-1">
                                        Rate Mode &amp; Bitrate (kbps)
                                    </label>
                                    <div className="flex gap-1.5">
                                        <select
                                            value={formRateMode}
                                            onChange={(e) => setFormRateMode(e.target.value as MulticastRateMode)}
                                            className="bg-background border border-border rounded-lg px-2 py-2 text-text-primary font-bold"
                                        >
                                            <option value="cbr">CBR</option>
                                            <option value="burst">Burst</option>
                                        </select>
                                        <input
                                            type="number"
                                            min={16}
                                            max={50000}
                                            value={formKbps}
                                            onChange={(e) => setFormKbps(Number(e.target.value))}
                                            className="w-full bg-background border border-border rounded-lg px-2.5 py-2 text-text-primary font-mono"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold uppercase text-text-muted mb-1">
                                        Payload / TTL / DSCP
                                    </label>
                                    <div className="grid grid-cols-3 gap-1">
                                        <input
                                            type="number"
                                            min={64}
                                            max={1400}
                                            value={formPayloadBytes}
                                            onChange={(e) => setFormPayloadBytes(Number(e.target.value))}
                                            title="UDP Payload Bytes (1316 = 7 MPEG-TS packets)"
                                            className="bg-background border border-border rounded-lg px-2 py-2 text-text-primary font-mono"
                                        />
                                        <input
                                            type="number"
                                            min={1}
                                            max={255}
                                            value={formTtl}
                                            onChange={(e) => setFormTtl(Number(e.target.value))}
                                            title="IP Multicast TTL (Must be >1 to cross router hops)"
                                            className="bg-background border border-border rounded-lg px-2 py-2 text-text-primary font-mono"
                                        />
                                        <select
                                            value={formDscp}
                                            onChange={(e) => setFormDscp(e.target.value)}
                                            title="DSCP Marking"
                                            className="bg-background border border-border rounded-lg px-1.5 py-2 text-text-primary font-mono"
                                        >
                                            <option value="CS5">CS5</option>
                                            <option value="EF">EF</option>
                                            <option value="AF41">AF41</option>
                                            <option value="BE">BE</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Receivers List */}
                            <div className="border border-border rounded-xl p-3.5 space-y-3 bg-background/40">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-text-primary">
                                        Participating Receiver Nodes (1 &rarr; N Replication Tree)
                                    </span>
                                    <span className="text-[10px] text-text-muted">
                                        Use EXPECT_NONE to test Multicast Policy / Zone Deny (S7)
                                    </span>
                                </div>

                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        list="known-mc-nodes"
                                        placeholder="Branch node name (e.g. BR1, BR2, BR8)"
                                        value={newReceiverNode}
                                        onChange={(e) => setNewReceiverNode(e.target.value)}
                                        className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-text-primary"
                                    />
                                    <select
                                        value={newReceiverExpect}
                                        onChange={(e) => setNewReceiverExpect(e.target.value as MulticastExpectationMode)}
                                        className="bg-background border border-border rounded-lg px-2.5 py-1.5 text-text-primary font-bold"
                                    >
                                        <option value="traffic">EXPECT_TRAFFIC (Normal)</option>
                                        <option value="none">EXPECT_NONE (Policy Leak Test)</option>
                                    </select>
                                    <button
                                        type="button"
                                        onClick={addReceiverToForm}
                                        className="px-3 py-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 font-bold"
                                    >
                                        + Add Receiver
                                    </button>
                                </div>

                                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                                    {formReceivers.map((r, idx) => (
                                        <div
                                            key={r.node}
                                            className="flex items-center justify-between bg-card border border-border rounded-lg px-3 py-1.5"
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold text-text-primary">{r.node}</span>
                                                <select
                                                    value={r.expect}
                                                    onChange={(e) => {
                                                        const next = [...formReceivers];
                                                        next[idx] = { ...r, expect: e.target.value as MulticastExpectationMode };
                                                        setFormReceivers(next);
                                                    }}
                                                    className="bg-background border border-border rounded px-2 py-0.5 text-[10px] font-bold text-text-secondary"
                                                >
                                                    <option value="traffic">EXPECT_TRAFFIC</option>
                                                    <option value="none">EXPECT_NONE (Deny Test)</option>
                                                </select>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setFormReceivers(formReceivers.filter((_, i) => i !== idx))}
                                                className="text-rose-400 hover:text-rose-300 text-[11px] font-bold"
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                                <button
                                    type="button"
                                    onClick={() => setEditorOpen(false)}
                                    className="px-4 py-2 rounded-lg bg-background border border-border text-text-muted hover:text-text-primary font-bold"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold shadow-sm"
                                >
                                    {editingProfile ? 'Save Changes' : 'Create Profile'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
