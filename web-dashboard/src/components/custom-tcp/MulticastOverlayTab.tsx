import React, { useState, useEffect, useCallback } from 'react';
import {
    Radio, Play, Square, Plus, Edit2, Trash2, RefreshCw,
    CheckCircle2, AlertTriangle, XCircle, ShieldCheck, Activity,
    Server, ArrowRight, Network, Sparkles, RotateCcw, CloudUpload,
    Download, Upload, Sliders, FileJson
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
    MulticastPayloadFormat,
    MulticastApplicationPreset,
} from '../../../custom-tcp-apps/types';
import { MicroSparkline } from './MicroSparkline';
import { usePeerContext } from '../../PeerContext';

interface MulticastOverlayTabProps {
    token: string | null;
    localSiteName?: string;
    isStandalone?: boolean;
}

const FALLBACK_PRESETS: MulticastApplicationPreset[] = [
    {
        id: 'iptv-ceo-townhall',
        name: 'Enterprise IPTV — CEO Townhall HD',
        shortLabel: '📺 IPTV Townhall HD',
        badge: 'RTP + MPEG-TS (PT=33)',
        description: 'MPEG-2 TS over RTP (RFC 3550 PT=33, 7x188B = 1316B) recognized by Palo Alto NGFW / Prisma SD-WAN as standard RTP/MPEG-TS video broadcast.',
        appIdHint: 'rtp / mpeg-ts',
        mode: 'asm',
        group: '239.1.1.100',
        port: 5004,
        rate: { mode: 'cbr', kbps: 2500 },
        payloadBytes: 1316,
        payloadFormat: 'rtp-mpegts',
        ttl: 32,
        dscp: 'AF41',
        thresholds: {
            maxLossPct: 0.1,
            degradedLossPct: 1.0,
            maxJitterMs: 15,
            maxGapMs: 1500,
            maxDuplicates: 5,
        },
    },
    {
        id: 'market-data-itch',
        name: 'Financial Market Data — Trading Tick Feed',
        shortLabel: '📈 Market Data ITCH',
        badge: 'SSM 232/8 Micro-Burst',
        description: 'Source-Specific Multicast (SSM 232/8) micro-burst UDP tick feed for sub-second convergence and zero-reorder SLA validation.',
        appIdHint: 'STX_MC_MARKET_DATA',
        mode: 'ssm',
        group: '232.10.20.30',
        port: 15500,
        rate: { mode: 'burst', kbps: 512, burstPackets: 20, burstIntervalMs: 50 },
        payloadBytes: 256,
        payloadFormat: 'raw-stgx',
        ttl: 32,
        dscp: 'CS5',
        thresholds: {
            maxLossPct: 0.01,
            degradedLossPct: 0.25,
            maxJitterMs: 3,
            maxGapMs: 500,
            maxDuplicates: 0,
        },
    },
    {
        id: 'voip-emergency-paging',
        name: 'Push-to-Talk / VoIP Emergency Paging',
        shortLabel: '🎙️ VoIP Paging (G.711)',
        badge: 'RTP G.711 PCMU (PT=0)',
        description: 'G.711 PCMU RTP v2 (PT=0, 50 pps) real-time audio paging across all branch sites with Expedited Forwarding (EF) QoS.',
        appIdHint: 'rtp-base (G.711)',
        mode: 'asm',
        group: '239.255.0.1',
        port: 5004,
        rate: { mode: 'cbr', kbps: 80 },
        payloadBytes: 200,
        payloadFormat: 'rtp-g711',
        ttl: 32,
        dscp: 'EF',
        thresholds: {
            maxLossPct: 0.5,
            degradedLossPct: 2.0,
            maxJitterMs: 20,
            maxGapMs: 800,
            maxDuplicates: 2,
        },
    },
    {
        id: 'cctv-surveillance',
        name: 'IP Video Surveillance — Branch Camera Matrix',
        shortLabel: '📹 CCTV Camera Matrix',
        badge: 'RTP + MPEG-TS (4 Mbps)',
        description: 'Continuous H.264/MPEG-TS over RTP multicast stream for multi-viewer security monitoring across SD-WAN regions.',
        appIdHint: 'rtp / mpeg-ts',
        mode: 'asm',
        group: '239.10.50.10',
        port: 5004,
        rate: { mode: 'cbr', kbps: 4000 },
        payloadBytes: 1316,
        payloadFormat: 'rtp-mpegts',
        ttl: 32,
        dscp: 'AF41',
        thresholds: {
            maxLossPct: 0.2,
            degradedLossPct: 1.5,
            maxJitterMs: 25,
            maxGapMs: 2000,
            maxDuplicates: 10,
        },
    },
    {
        id: 'sap-session-directory',
        name: 'Control Plane Keepalive / SAP Session Directory',
        shortLabel: '🧭 SAP / Control Heartbeat',
        badge: 'Low-Rate Keepalive',
        description: 'Low-bitrate periodic multicast heartbeat to monitor long-term PIM/IGMP state retention without saturating WAN links.',
        appIdHint: 'sap / udp-9875',
        mode: 'asm',
        group: '239.255.255.250',
        port: 9875,
        rate: { mode: 'cbr', kbps: 16 },
        payloadBytes: 200,
        payloadFormat: 'raw-stgx',
        ttl: 32,
        dscp: 'CS2',
        thresholds: {
            maxLossPct: 0.5,
            degradedLossPct: 3.0,
            maxJitterMs: 50,
            maxGapMs: 5000,
            maxDuplicates: 5,
        },
    },
];

const PAYLOAD_FORMAT_LABELS: Record<MulticastPayloadFormat, { short: string; full: string }> = {
    'rtp-mpegts': {
        short: 'RTP + MPEG-TS (0x47)',
        full: 'RFC 3550 RTP v2 (PT=33) + MPEG-TS 0x47 Sync (App-ID: rtp / mpeg-ts)',
    },
    'rtp-g711': {
        short: 'RTP v2 G.711 PCMU',
        full: 'RFC 3550 RTP v2 (PT=0) PCMU Audio (App-ID: rtp-base)',
    },
    'raw-stgx': {
        short: 'Raw STGX UDP (24B)',
        full: 'Raw STGX 24-Byte Sequence Header (Ultra-low overhead UDP)',
    },
};

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

export const MulticastOverlayTab: React.FC<MulticastOverlayTabProps> = ({
    token,
    localSiteName,
    isStandalone = false,
}) => {
    const { peers } = usePeerContext();
    const [profiles, setProfiles] = useState<CustomMulticastApplicationConfig[]>([]);
    const [presets, setPresets] = useState<MulticastApplicationPreset[]>(FALLBACK_PRESETS);
    const [selectedAppId, setSelectedAppId] = useState<string>('');
    const [clusterStatus, setClusterStatus] = useState<MulticastClusterStatus | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [actionBusy, setActionBusy] = useState<boolean>(false);
    const [resetBusy, setResetBusy] = useState<boolean>(false);
    const [knownNodes, setKnownNodes] = useState<string[]>([]);
    const [knownTargets, setKnownTargets] = useState<{ name: string; host: string; isSelf?: boolean }[]>([]);

    // Pre-Flight Modal State
    const [preflightOpen, setPreflightOpen] = useState<boolean>(false);
    const [preflightBusy, setPreflightBusy] = useState<boolean>(false);
    const [preflightData, setPreflightData] = useState<{
        appId: string;
        timestamp: number;
        allPassed: boolean;
        nodes: Record<string, MulticastNodePreflightResult>;
    } | null>(null);

    // Presets Gallery Modal State
    const [presetsModalOpen, setPresetsModalOpen] = useState<boolean>(false);

    // Prisma SD-WAN Push Modal State
    const [prismaModalOpen, setPrismaModalOpen] = useState<boolean>(false);
    const [prismaSyncBusy, setPrismaSyncBusy] = useState<boolean>(false);
    const [prismaSyncResult, setPrismaSyncResult] = useState<any | null>(null);

    // Import / Export Modal State
    const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
    const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
    const [importJsonText, setImportJsonText] = useState<string>('');
    const [importBusy, setImportBusy] = useState<boolean>(false);

    // Editor Modal State
    const [editorOpen, setEditorOpen] = useState<boolean>(false);
    const [editingProfile, setEditingProfile] = useState<CustomMulticastApplicationConfig | null>(null);

    // Form fields
    const [formId, setFormId] = useState('');
    const [formName, setFormName] = useState('');
    const [formDesc, setFormDesc] = useState('');
    const [formPresetId, setFormPresetId] = useState<string | undefined>(undefined);
    const [formPayloadFormat, setFormPayloadFormat] = useState<MulticastPayloadFormat>('rtp-mpegts');
    const [formMode, setFormMode] = useState<MulticastAddressingMode>('asm');
    const [formGroup, setFormGroup] = useState('239.10.10.1');
    const [formPort, setFormPort] = useState(5004);
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
    const [formMaxJitterMs, setFormMaxJitterMs] = useState(20);
    const [formMaxDuplicates, setFormMaxDuplicates] = useState(5);
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

    const resolveTargetHost = useCallback(
        (nodeName: string): string => {
            if (!nodeName) return 'auto';
            const needle = nodeName.trim().toLowerCase();
            const match = knownTargets.find(
                (t) =>
                    t.name.toLowerCase() === needle ||
                    t.host.toLowerCase() === needle ||
                    t.name.toLowerCase().startsWith(needle + '-') ||
                    needle.startsWith(t.name.toLowerCase() + '-')
            );
            return match?.host || 'auto';
        },
        [knownTargets]
    );

    const fetchProfiles = useCallback(async () => {
        try {
            const res = await fetch('/api/custom-tcp-apps/multicast', { headers: headers() });
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
    }, [headers, selectedAppId]);

    const fetchPresets = useCallback(async () => {
        try {
            const res = await fetch('/api/custom-tcp-apps/multicast/presets', { headers: headers() });
            if (!res.ok) return;
            const data = await res.json();
            if (Array.isArray(data.presets) && data.presets.length > 0) {
                setPresets(data.presets);
            }
        } catch {
            // Keep FALLBACK_PRESETS
        }
    }, [headers]);

    const fetchKnownNodes = useCallback(async () => {
        const targetMap = new Map<string, { name: string; host: string; isSelf?: boolean }>();

        try {
            const res = await fetch('/api/targets', { headers: headers() });
            if (res.ok) {
                const list = await res.json();
                if (Array.isArray(list)) {
                    for (const t of list) {
                        const name = (t.name || t.id || '').trim();
                        const host = (t.host || '').trim();
                        if (name) {
                            targetMap.set(name.toLowerCase(), {
                                name,
                                host: host || 'auto',
                                isSelf: Boolean(t.meta?.isSelf),
                            });
                        }
                    }
                }
            }
        } catch {
            // Fallback to PeerContext below
        }

        if (Array.isArray(peers)) {
            for (const p of peers) {
                const name = (p.site || p.meta?.site || p.instance_id || '').trim();
                const host = (p.ip_private || '').trim();
                if (name && !targetMap.has(name.toLowerCase())) {
                    targetMap.set(name.toLowerCase(), {
                        name,
                        host: host || 'auto',
                        isSelf: Boolean(p.is_leader),
                    });
                }
            }
        }

        if (localSiteName && !targetMap.has(localSiteName.toLowerCase())) {
            targetMap.set(localSiteName.toLowerCase(), {
                name: localSiteName,
                host: 'auto',
                isSelf: true,
            });
        }

        const targetsList = Array.from(targetMap.values());
        setKnownTargets(targetsList);
        setKnownNodes(targetsList.map((t) => t.name));
    }, [headers, localSiteName, peers]);

    const fetchClusterStats = useCallback(
        async (appId: string) => {
            if (!appId) return;
            try {
                const res = await fetch(`/api/custom-tcp-apps/multicast/${encodeURIComponent(appId)}/stats`, {
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
        [headers]
    );

    useEffect(() => {
        fetchProfiles();
        fetchPresets();
        fetchKnownNodes();
    }, [fetchProfiles, fetchPresets, fetchKnownNodes]);

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
            const res = await fetch(`/api/custom-tcp-apps/multicast/${encodeURIComponent(selectedProfile.id)}/start`, {
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
            const res = await fetch(`/api/custom-tcp-apps/multicast/${encodeURIComponent(selectedProfile.id)}/stop`, {
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

    const handleResetCounters = async (nodeId?: string) => {
        if (!selectedProfile) return;
        setResetBusy(true);
        try {
            const res = await fetch(
                `/api/custom-tcp-apps/multicast/${encodeURIComponent(selectedProfile.id)}/reset-counters`,
                {
                    method: 'POST',
                    headers: headers(),
                    body: JSON.stringify(nodeId ? { nodeId } : {}),
                }
            );
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to reset counters');
            }
            if (data.status) setClusterStatus(data.status);
            toast.success(
                nodeId
                    ? `Receiver counters reset on ${nodeId}`
                    : `All receiver SLA counters reset for "${selectedProfile.name}"`
            );
        } catch (e: any) {
            toast.error(e.message || 'Failed to reset counters');
        } finally {
            setResetBusy(false);
        }
    };

    const handleToggleReceiver = async (nodeId: string, action: 'join' | 'leave', expect?: MulticastExpectationMode) => {
        if (!selectedProfile) return;
        try {
            const res = await fetch(
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
            const res = await fetch(`/api/custom-tcp-apps/multicast/${encodeURIComponent(selectedProfile.id)}/preflight`, {
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

    // ─── Presets Application & Quick Creation ─────────────────────────────────

    const applyPresetToForm = (preset: MulticastApplicationPreset) => {
        setFormPresetId(preset.id);
        if (!editingProfile) {
            setFormId(preset.id);
        }
        setFormName(preset.name);
        setFormDesc(preset.description);
        setFormMode(preset.mode);
        setFormGroup(preset.group);
        setFormPort(preset.port);
        setFormPayloadFormat(preset.payloadFormat);
        setFormRateMode(preset.rate.mode);
        setFormKbps(preset.rate.kbps);
        if (preset.rate.burstPackets) setFormBurstPackets(preset.rate.burstPackets);
        if (preset.rate.burstIntervalMs) setFormBurstIntervalMs(preset.rate.burstIntervalMs);
        setFormPayloadBytes(preset.payloadBytes);
        setFormTtl(preset.ttl);
        setFormDscp(preset.dscp);
        setFormMaxLossPct(preset.thresholds.maxLossPct);
        setFormDegradedLossPct(preset.thresholds.degradedLossPct);
        setFormMaxJitterMs(preset.thresholds.maxJitterMs ?? 20);
        setFormMaxDuplicates(preset.thresholds.maxDuplicates ?? 5);
        setFormMaxGapMs(preset.thresholds.maxGapMs);
        if (preset.mode === 'ssm') {
            const senderIp =
                formSenderIfaceIp && formSenderIfaceIp !== 'auto'
                    ? formSenderIfaceIp
                    : resolveTargetHost(formSenderNode);
            if (senderIp && senderIp !== 'auto') {
                setFormSsmSource(senderIp);
            } else if (!formSsmSource) {
                setFormSsmSource('172.16.110.2');
            }
        }
        toast.success(`Loaded preset "${preset.name}"`);
    };

    const handleQuickCreateFromPreset = async (preset: MulticastApplicationPreset) => {
        const defaultSender = selectedProfile?.senderNode || localSiteName || knownNodes[0] || 'DC1';
        const senderIp = resolveTargetHost(defaultSender);
        const existingReceivers =
            selectedProfile && selectedProfile.receivers.length > 0
                ? selectedProfile.receivers
                : knownNodes
                      .filter((n) => n !== defaultSender)
                      .map((n) => ({
                          node: n,
                          expect: 'traffic' as MulticastExpectationMode,
                          interfaceIp: resolveTargetHost(n),
                          enabled: true,
                      }));
        const effectiveReceivers =
            existingReceivers.length > 0
                ? existingReceivers
                : [
                      {
                          node: defaultSender,
                          expect: 'traffic' as MulticastExpectationMode,
                          interfaceIp: senderIp,
                          enabled: true,
                      },
                  ];

        const existingWithSameId = profiles.some((p) => p.id === preset.id);
        const targetId = existingWithSameId
            ? `${preset.id}-${Math.random().toString(36).substring(2, 5)}`
            : preset.id;

        const payload: CustomMulticastApplicationConfig = {
            id: targetId,
            name: preset.name,
            description: preset.description,
            enabled: true,
            presetId: preset.id,
            payloadFormat: preset.payloadFormat,
            group: preset.group,
            port: preset.port,
            mode: preset.mode,
            ssmSource:
                preset.mode === 'ssm'
                    ? senderIp && senderIp !== 'auto'
                        ? senderIp
                        : '172.16.110.2'
                    : undefined,
            senderNode: defaultSender,
            senderInterfaceIp: senderIp || 'auto',
            receivers: effectiveReceivers,
            rate: { ...preset.rate },
            payloadBytes: preset.payloadBytes,
            ttl: preset.ttl,
            dscp: preset.dscp,
            durationSec: 0,
            thresholds: { ...preset.thresholds },
        };

        try {
            const res = await fetch('/api/custom-tcp-apps/multicast', {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to create preset profile');
            }
            toast.success(`Created multicast profile "${preset.name}"`);
            setPresetsModalOpen(false);
            await fetchProfiles();
            setSelectedAppId(payload.id);
        } catch (err: any) {
            toast.error(err.message || 'Failed to create preset profile');
        }
    };

    // ─── Prisma SD-WAN Custom App Sync ────────────────────────────────────────

    const handleSyncToPrisma = async (syncAll: boolean) => {
        if (!syncAll && !selectedProfile) return;
        setPrismaSyncBusy(true);
        setPrismaSyncResult(null);
        try {
            const url = syncAll
                ? '/api/custom-tcp-apps/prisma/sync-all-multicast'
                : `/api/custom-tcp-apps/prisma/sync-multicast/${encodeURIComponent(selectedProfile!.id)}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({}),
            });
            const data = await res.json();
            setPrismaSyncResult(data);
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to push multicast Custom App to Prisma SD-WAN');
            }
            toast.success(
                syncAll
                    ? `Synced ${data.synced || profiles.length} Multicast Custom Apps to Prisma SD-WAN`
                    : `Pushed ${data.prisma_app_name || `STX_MC_${selectedProfile!.name}`} (${selectedProfile!.group}/32:${selectedProfile!.port}) to Prisma SD-WAN`
            );
        } catch (err: any) {
            toast.error(err.message || 'Prisma SD-WAN sync failed');
        } finally {
            setPrismaSyncBusy(false);
        }
    };

    // ─── JSON Export & Import ─────────────────────────────────────────────────

    const handleExportProfiles = async (singleId?: string) => {
        try {
            const query = singleId ? `?id=${encodeURIComponent(singleId)}` : '';
            const res = await fetch(`/api/custom-tcp-apps/multicast/export${query}`, {
                headers: headers(),
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `Export failed (${res.status})`);
            }
            const bundle = await res.json();
            const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = singleId
                ? `stigix-multicast-${singleId}.json`
                : `stigix-multicast-profiles-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast.success(
                singleId
                    ? `Exported profile "${singleId}"`
                    : `Exported ${profiles.length} multicast profile(s)`
            );
        } catch (err: any) {
            toast.error(err.message || 'Failed to export multicast configuration');
        }
    };

    const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            if (typeof ev.target?.result === 'string') {
                setImportJsonText(ev.target.result);
            }
        };
        reader.readAsText(file);
    };

    const handleImportSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!importJsonText.trim()) {
            toast.error('Please paste or select a JSON file to import');
            return;
        }
        setImportBusy(true);
        try {
            const parsed = JSON.parse(importJsonText);
            const res = await fetch('/api/custom-tcp-apps/multicast/import', {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({
                    mode: importMode,
                    multicastApplications: Array.isArray(parsed)
                        ? parsed
                        : parsed.multicastApplications || [],
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                const detail = Array.isArray(data.errors)
                    ? data.errors.map((err: any) => `${err.id}: ${err.errors?.join(', ')}`).join(' | ')
                    : data.error || 'Import failed';
                throw new Error(detail);
            }
            toast.success(
                `Imported ${data.importedCount} multicast profile(s) (${importMode.toUpperCase()} mode)`
            );
            setImportModalOpen(false);
            setImportJsonText('');
            await fetchProfiles();
        } catch (err: any) {
            toast.error(err.message || 'Invalid JSON payload');
        } finally {
            setImportBusy(false);
        }
    };

    // ─── Create / Edit / Delete Profile ───────────────────────────────────────

    const openNewProfileModal = () => {
        fetchKnownNodes();
        setEditingProfile(null);
        const defaultSender = localSiteName || knownNodes[0] || 'DC1';
        const defaultRx = knownNodes.filter((n) => n !== defaultSender);
        setFormId(`mc-${Math.random().toString(36).substring(2, 7)}`);
        setFormName('Enterprise IPTV — CEO Townhall HD');
        setFormDesc('Real UDP/IGMP multicast stream validation across Prisma SD-WAN overlay');
        setFormPresetId('iptv-ceo-townhall');
        setFormPayloadFormat('rtp-mpegts');
        setFormMode('asm');
        setFormGroup('239.1.1.100');
        setFormPort(5004);
        setFormSsmSource('');
        setFormSenderNode(defaultSender);
        setFormSenderIfaceIp(resolveTargetHost(defaultSender));
        setFormRateMode('cbr');
        setFormKbps(2500);
        setFormBurstPackets(30);
        setFormBurstIntervalMs(100);
        setFormPayloadBytes(1316);
        setFormTtl(32);
        setFormDscp('AF41');
        setFormDurationSec(0);
        setFormMaxLossPct(0.1);
        setFormDegradedLossPct(1.0);
        setFormMaxJitterMs(15);
        setFormMaxDuplicates(5);
        setFormMaxGapMs(1500);
        setFormReceivers(
            defaultRx.length > 0
                ? defaultRx.map((n) => ({
                      node: n,
                      expect: 'traffic',
                      interfaceIp: resolveTargetHost(n),
                      enabled: true,
                  }))
                : [
                      {
                          node: defaultSender,
                          expect: 'traffic',
                          interfaceIp: resolveTargetHost(defaultSender),
                          enabled: true,
                      },
                  ]
        );
        setNewReceiverNode('');
        setEditorOpen(true);
    };

    const openEditProfileModal = (profile: CustomMulticastApplicationConfig) => {
        fetchKnownNodes();
        setEditingProfile(profile);
        setFormId(profile.id);
        setFormName(profile.name);
        setFormDesc(profile.description || '');
        setFormPresetId(profile.presetId);
        setFormPayloadFormat(profile.payloadFormat || 'raw-stgx');
        setFormMode(profile.mode);
        setFormGroup(profile.group);
        setFormPort(profile.port);
        setFormSsmSource(profile.ssmSource || '');
        setFormSenderNode(profile.senderNode);
        setFormSenderIfaceIp(
            profile.senderInterfaceIp && profile.senderInterfaceIp !== 'auto'
                ? profile.senderInterfaceIp
                : resolveTargetHost(profile.senderNode)
        );
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
        setFormMaxJitterMs(profile.thresholds?.maxJitterMs ?? 20);
        setFormMaxDuplicates(profile.thresholds?.maxDuplicates ?? 5);
        setFormMaxGapMs(profile.thresholds?.maxGapMs ?? 3000);
        setFormReceivers(
            profile.receivers
                ? profile.receivers.map((r) => ({
                      ...r,
                      interfaceIp:
                          r.interfaceIp && r.interfaceIp !== 'auto' ? r.interfaceIp : resolveTargetHost(r.node),
                  }))
                : []
        );
        setNewReceiverNode('');
        setEditorOpen(true);
    };

    const handleSaveProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        let effectiveReceivers = formReceivers.map((r) => ({
            ...r,
            interfaceIp: r.interfaceIp && r.interfaceIp !== 'auto' ? r.interfaceIp : resolveTargetHost(r.node),
        }));
        const pendingRx = newReceiverNode.trim();
        if (pendingRx && !effectiveReceivers.some((r) => r.node.toLowerCase() === pendingRx.toLowerCase())) {
            effectiveReceivers.push({
                node: pendingRx,
                expect: newReceiverExpect,
                interfaceIp: resolveTargetHost(pendingRx),
                enabled: true,
            });
            setFormReceivers(effectiveReceivers);
            setNewReceiverNode('');
        }
        if (effectiveReceivers.length === 0) {
            toast.error('Please add at least one receiver node (e.g. BR5)');
            return;
        }
        const resolvedSenderIp =
            formSenderIfaceIp && formSenderIfaceIp !== 'auto'
                ? formSenderIfaceIp.trim()
                : resolveTargetHost(formSenderNode);
        const payload: CustomMulticastApplicationConfig = {
            id: formId.trim(),
            name: formName.trim(),
            description: formDesc.trim(),
            enabled: true,
            presetId: formPresetId,
            payloadFormat: formPayloadFormat,
            group: formGroup.trim(),
            port: Number(formPort),
            mode: formMode,
            ssmSource: formMode === 'ssm' ? formSsmSource.trim() : undefined,
            senderNode: formSenderNode.trim(),
            senderInterfaceIp: resolvedSenderIp || 'auto',
            receivers: effectiveReceivers,
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
                maxJitterMs: Number(formMaxJitterMs),
                maxDuplicates: Number(formMaxDuplicates),
                maxGapMs: Number(formMaxGapMs),
            },
        };

        try {
            const url = editingProfile
                ? `/api/custom-tcp-apps/multicast/${encodeURIComponent(editingProfile.id)}`
                : '/api/custom-tcp-apps/multicast';
            const method = editingProfile ? 'PUT' : 'POST';
            const res = await fetch(url, {
                method: method,
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
            const res = await fetch(`/api/custom-tcp-apps/multicast/${encodeURIComponent(selectedProfile.id)}`, {
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

    const addReceiverToForm = (nodeOverride?: string) => {
        const node = (typeof nodeOverride === 'string' ? nodeOverride : newReceiverNode).trim();
        if (!node) return;
        if (formReceivers.some((r) => r.node.toLowerCase() === node.toLowerCase())) {
            toast.error(`Receiver "${node}" is already in the list`);
            return;
        }
        const hostIp = resolveTargetHost(node);
        setFormReceivers([
            ...formReceivers,
            { node, expect: newReceiverExpect, interfaceIp: hostIp, enabled: true },
        ]);
        if (typeof nodeOverride !== 'string') {
            setNewReceiverNode('');
        }
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
            {/* Standalone View Header when opened directly from Generate -> Multicast Traffic */}
            {isStandalone && (
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-1">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-md bg-purple-500/15 border border-purple-500/30 text-purple-300 text-[10px] font-black uppercase tracking-wider">
                                SD-WAN Overlay Validation
                            </span>
                            {isRunning && (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-black uppercase">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    LIVE STREAMING
                                </span>
                            )}
                        </div>
                        <h1 className="text-xl font-black text-text-primary mt-1">
                            Multicast Traffic Generator &amp; SLA Telemetry
                        </h1>
                        <p className="text-xs text-text-muted mt-0.5">
                            Generate realistic 1-to-N UDP Multicast streams (RTP/MPEG-TS, ITCH Market Data, G.711 VoIP Paging) and audit IGMPv2/v3 &amp; PIM-SM/SSM replication across SD-WAN branches.
                        </p>
                    </div>
                </div>
            )}

            {/* Top Control Bar */}
            <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2.5">
                    <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/25 flex items-center justify-center text-purple-400">
                            <Radio className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="text-[10px] font-bold uppercase tracking-wider text-purple-400">
                                IGMPv2/v3 &bull; PIM-SM / SSM Engine
                            </div>
                            <h3 className="text-sm font-bold text-text-primary">Multicast Stream Profiles</h3>
                        </div>
                    </div>

                    {/* Profile Selector */}
                    <div className="flex flex-wrap items-center gap-2 ml-0 lg:ml-3">
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
                                    title="Edit Multicast Profile & SLA Thresholds"
                                >
                                    <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    onClick={() => handleExportProfiles(selectedProfile.id)}
                                    className="p-2 rounded-lg bg-background hover:bg-card-hover border border-border text-text-muted hover:text-text-primary transition-colors"
                                    title={`Export Profile "${selectedProfile.name}" to JSON`}
                                >
                                    <Download className="w-3.5 h-3.5" />
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

                        <button
                            onClick={() => setPresetsModalOpen(true)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold transition-all"
                            title="Load 1-Click Industry Multicast Profile Preset"
                        >
                            <Sparkles className="w-3.5 h-3.5" /> Presets
                        </button>

                        <button
                            onClick={() => setPrismaModalOpen(true)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-bold transition-all"
                            title="Push Multicast Profile(s) to Prisma SD-WAN Custom Apps (STX_MC_*)"
                        >
                            <CloudUpload className="w-3.5 h-3.5" /> Push to Prisma
                        </button>

                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => handleExportProfiles()}
                                className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-background hover:bg-card-hover border border-border text-text-secondary hover:text-text-primary text-xs font-bold transition-colors"
                                title="Export All Multicast Profiles to JSON"
                            >
                                <Download className="w-3.5 h-3.5" /> Export
                            </button>
                            <button
                                onClick={() => setImportModalOpen(true)}
                                className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-background hover:bg-card-hover border border-border text-text-secondary hover:text-text-primary text-xs font-bold transition-colors"
                                title="Import Multicast Profiles from JSON"
                            >
                                <Upload className="w-3.5 h-3.5" /> Import
                            </button>
                        </div>
                    </div>
                </div>

                {/* Action Buttons */}
                {selectedProfile && (
                    <div className="flex flex-wrap items-center gap-2">
                        <div className={cn('px-2.5 py-1 rounded-md border text-[11px] font-black tracking-wider', verdictStyle.badge)}>
                            OVERALL: {verdictStyle.label}
                        </div>

                        <button
                            onClick={() => handleResetCounters()}
                            disabled={resetBusy}
                            className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-background hover:bg-card-hover border border-border text-text-secondary hover:text-text-primary text-xs font-bold transition-all"
                            title="Reset sequence & loss counters across all receivers without stopping the stream"
                        >
                            <RotateCcw className={cn('w-3.5 h-3.5 text-purple-400', resetBusy && 'animate-spin')} />
                            Reset Counters
                        </button>

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
                                <div className="flex items-center gap-1.5">
                                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30">
                                        {PAYLOAD_FORMAT_LABELS[selectedProfile.payloadFormat || 'raw-stgx']?.short || 'STGX'}
                                    </span>
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
                            <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-text-muted font-mono">
                                <span>
                                    Loss Healthy: &le;{selectedProfile.thresholds?.maxLossPct ?? 0.1}%
                                </span>
                                <span>&bull;</span>
                                <span>
                                    Degraded: &le;{selectedProfile.thresholds?.degradedLossPct ?? 2.0}%
                                </span>
                                <span>&bull;</span>
                                <span>
                                    Jitter: &le;{selectedProfile.thresholds?.maxJitterMs ?? 30}ms
                                </span>
                                <span>&bull;</span>
                                <span>
                                    Dup Tol: &le;{selectedProfile.thresholds?.maxDuplicates ?? 5}
                                </span>
                                <span>&bull;</span>
                                <span>
                                    Gap: &le;{selectedProfile.thresholds?.maxGapMs ?? 3000}ms
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
                                <div className="text-[10px] font-mono text-text-muted">
                                    {PAYLOAD_FORMAT_LABELS[selectedProfile.payloadFormat || 'raw-stgx']?.short || 'Raw STGX'} + Seq Trailer
                                </div>
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
                                                        r.lossPct > (selectedProfile.thresholds?.degradedLossPct ?? 2.0)
                                                            ? 'text-rose-400'
                                                            : r.lossPct > (selectedProfile.thresholds?.maxLossPct ?? 0.1)
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
                                                <div
                                                    className={cn(
                                                        'font-bold',
                                                        r.jitterMs > (selectedProfile.thresholds?.maxJitterMs ?? 30)
                                                            ? 'text-amber-400'
                                                            : 'text-text-primary'
                                                    )}
                                                >
                                                    {r.jitterMs.toFixed(2)} ms
                                                </div>
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
                                                <div className="flex items-center justify-end gap-1.5">
                                                    <button
                                                        onClick={() => handleResetCounters(r.node)}
                                                        className="p-1.5 rounded bg-background hover:bg-card-hover border border-border text-text-muted hover:text-purple-300 transition-colors"
                                                        title={`Reset counters on ${r.node}`}
                                                    >
                                                        <RotateCcw className="w-3 h-3" />
                                                    </button>
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
                                                </div>
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
                    <div className="bg-card border border-border rounded-2xl max-w-3xl w-full max-h-[92vh] overflow-hidden flex flex-col shadow-2xl">
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
                            {/* 1-Click Industry Presets Bar */}
                            <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
                                        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                                        1-Click Industry Profile Presets (Auto-fills Group, Port, L7 Header &amp; SLA Thresholds)
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {presets.map((preset) => (
                                        <button
                                            key={preset.id}
                                            type="button"
                                            onClick={() => applyPresetToForm(preset)}
                                            className="px-2.5 py-1.5 rounded-lg bg-background hover:bg-purple-600/20 border border-border hover:border-purple-500/40 text-text-primary hover:text-purple-200 text-[11px] font-bold transition-all flex items-center gap-1.5"
                                            title={`${preset.description} (${preset.appIdHint})`}
                                        >
                                            <span>{preset.shortLabel}</span>
                                            <span className="font-mono text-[10px] text-purple-400">
                                                ({preset.group}:{preset.port})
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>

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

                            {/* Multicast Group, Port, Mode, L7 Framing */}
                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
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
                                        className="w-full bg-background border border-border rounded-lg px-2.5 py-2 text-text-primary font-bold"
                                    >
                                        <option value="asm">ASM (*,G — 239/8)</option>
                                        <option value="ssm">SSM (S,G — 232/8)</option>
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
                                <div>
                                    <label className="block text-[10px] font-bold uppercase text-purple-400 mb-1">
                                        L7 App-ID Framing
                                    </label>
                                    <select
                                        value={formPayloadFormat}
                                        onChange={(e) => setFormPayloadFormat(e.target.value as MulticastPayloadFormat)}
                                        className="w-full bg-background border border-purple-500/40 rounded-lg px-2.5 py-2 text-text-primary font-bold"
                                        title="Embeds authentic RTP/MPEG-TS or RTP/G.711 headers ahead of the Stigix sequence trailer for NGFW App-ID & Wireshark"
                                    >
                                        <option value="raw-stgx">Raw STGX (24B Header)</option>
                                        <option value="rtp-mpegts">RTP + MPEG-TS (PT=33 Video)</option>
                                        <option value="rtp-g711">RTP + G.711 PCMU (PT=0 Audio)</option>
                                    </select>
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
                                    {knownTargets.length > 0 ? (
                                        <select
                                            value={formSenderNode}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                setFormSenderNode(val);
                                                const resolvedIp = resolveTargetHost(val);
                                                setFormSenderIfaceIp(resolvedIp);
                                                if (formMode === 'ssm' && resolvedIp !== 'auto') {
                                                    setFormSsmSource(resolvedIp);
                                                }
                                            }}
                                            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text-primary font-bold"
                                        >
                                            {!knownTargets.some(
                                                (t) => t.name.toLowerCase() === formSenderNode.toLowerCase()
                                            ) &&
                                                formSenderNode && (
                                                    <option value={formSenderNode}>
                                                        {formSenderNode} ({formSenderIfaceIp || 'auto'})
                                                    </option>
                                                )}
                                            {knownTargets.map((t) => (
                                                <option key={t.name} value={t.name}>
                                                    {t.name} ({t.host !== 'auto' ? t.host : 'auto-detect'})
                                                    {t.isSelf ? ' — Local' : ''}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input
                                            type="text"
                                            required
                                            list="known-mc-nodes"
                                            value={formSenderNode}
                                            onChange={(e) => {
                                                setFormSenderNode(e.target.value);
                                                setFormSenderIfaceIp(resolveTargetHost(e.target.value));
                                            }}
                                            placeholder="e.g. DC1 or BR1"
                                            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text-primary font-bold"
                                        />
                                    )}
                                    <div className="mt-1 text-[10px] font-mono text-cyan-400">
                                        Source LAN IP:{' '}
                                        {formSenderIfaceIp && formSenderIfaceIp !== 'auto'
                                            ? formSenderIfaceIp
                                            : resolveTargetHost(formSenderNode)}
                                    </div>
                                    <datalist id="known-mc-nodes">
                                        {knownTargets.map((t) => (
                                            <option
                                                key={t.name}
                                                value={t.name}
                                                label={t.host !== 'auto' ? `${t.name} (${t.host})` : t.name}
                                            />
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
                                    {formRateMode === 'burst' && (
                                        <div className="grid grid-cols-2 gap-1 mt-1.5">
                                            <input
                                                type="number"
                                                min={2}
                                                max={500}
                                                value={formBurstPackets}
                                                onChange={(e) => setFormBurstPackets(Number(e.target.value))}
                                                title="Packets per Burst"
                                                placeholder="Burst pkts"
                                                className="bg-background border border-border rounded px-1.5 py-1 text-[10px] font-mono text-text-primary"
                                            />
                                            <input
                                                type="number"
                                                min={10}
                                                max={60000}
                                                value={formBurstIntervalMs}
                                                onChange={(e) => setFormBurstIntervalMs(Number(e.target.value))}
                                                title="Burst Interval (ms)"
                                                placeholder="Interval ms"
                                                className="bg-background border border-border rounded px-1.5 py-1 text-[10px] font-mono text-text-primary"
                                            />
                                        </div>
                                    )}
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
                                            title="UDP Payload Bytes (1328 = RTP + 7 MPEG-TS packets)"
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
                                            <option value="EF">EF</option>
                                            <option value="AF41">AF41</option>
                                            <option value="CS5">CS5</option>
                                            <option value="CS4">CS4</option>
                                            <option value="CS2">CS2</option>
                                            <option value="BE">BE</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Granular SLA Health Thresholds Section */}
                            <div className="border border-border rounded-xl p-3.5 space-y-2.5 bg-background/40">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                                        <Sliders className="w-3.5 h-3.5" />
                                        SLA Health Verdict Thresholds (Per-Profile Tuning)
                                    </span>
                                    <span className="text-[10px] text-text-muted">
                                        Defines HEALTHY vs DEGRADED vs BROKEN_TREE verdicts
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                                    <div>
                                        <label className="block text-[10px] font-bold text-text-muted mb-1">
                                            Healthy Loss &le; (%)
                                        </label>
                                        <input
                                            type="number"
                                            step="any"
                                            min={0}
                                            max={50}
                                            value={formMaxLossPct}
                                            onChange={(e) => setFormMaxLossPct(Number(e.target.value))}
                                            className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-emerald-400 font-mono font-bold"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-text-muted mb-1">
                                            Degraded Loss &le; (%)
                                        </label>
                                        <input
                                            type="number"
                                            step="any"
                                            min={0}
                                            max={100}
                                            value={formDegradedLossPct}
                                            onChange={(e) => setFormDegradedLossPct(Number(e.target.value))}
                                            className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-amber-400 font-mono font-bold"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-text-muted mb-1">
                                            Max Jitter &le; (ms)
                                        </label>
                                        <input
                                            type="number"
                                            step="any"
                                            min={0}
                                            max={500}
                                            value={formMaxJitterMs}
                                            onChange={(e) => setFormMaxJitterMs(Number(e.target.value))}
                                            className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-text-primary font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-text-muted mb-1">
                                            Tolerated Dups (#)
                                        </label>
                                        <input
                                            type="number"
                                            step="1"
                                            min={0}
                                            max={1000}
                                            value={formMaxDuplicates}
                                            onChange={(e) => setFormMaxDuplicates(Number(e.target.value))}
                                            title="Number of duplicate packets tolerated during PIM RP-to-SPT switchover before flagging DUPLICATION"
                                            className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-text-primary font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-text-muted mb-1">
                                            Blackhole Gap (ms)
                                        </label>
                                        <input
                                            type="number"
                                            step="any"
                                            min={100}
                                            max={60000}
                                            value={formMaxGapMs}
                                            onChange={(e) => setFormMaxGapMs(Number(e.target.value))}
                                            className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-rose-400 font-mono"
                                        />
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

                                {/* 1-Click Discovered Stigix Targets */}
                                {knownTargets.length > 0 && (
                                    <div className="space-y-1.5">
                                        <div className="text-[10px] font-semibold text-text-muted">
                                            Known Stigix Targets (click to add as Receiver with its LAN IP):
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {knownTargets.map((t) => {
                                                const alreadyAdded = formReceivers.some(
                                                    (r) => r.node.toLowerCase() === t.name.toLowerCase()
                                                );
                                                const isSender =
                                                    formSenderNode.trim().toLowerCase() === t.name.toLowerCase();
                                                return (
                                                    <button
                                                        key={t.name}
                                                        type="button"
                                                        disabled={alreadyAdded}
                                                        onClick={() => addReceiverToForm(t.name)}
                                                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all flex items-center gap-1.5 ${
                                                            alreadyAdded
                                                                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 cursor-default'
                                                                : isSender
                                                                  ? 'bg-card/60 hover:bg-purple-600/20 border-border text-text-muted hover:text-purple-300'
                                                                  : 'bg-purple-600/15 hover:bg-purple-600/30 border-purple-500/30 text-purple-300'
                                                        }`}
                                                        title={
                                                            alreadyAdded
                                                                ? `${t.name} is already in the Receivers list`
                                                                : `Click to add ${t.name} (LAN IP: ${t.host}) as a Receiver`
                                                        }
                                                    >
                                                        <span>{alreadyAdded ? '✓' : '+'}</span>
                                                        <span>{t.name}</span>
                                                        <span className="font-mono text-[10px] opacity-80">
                                                            ({t.host})
                                                        </span>
                                                        {isSender && (
                                                            <span className="text-[9px] uppercase px-1 rounded bg-blue-500/20 text-blue-300">
                                                                Sender
                                                            </span>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                <div className="flex gap-2">
                                    {knownTargets.length > 0 ? (
                                        <select
                                            value={newReceiverNode}
                                            onChange={(e) => setNewReceiverNode(e.target.value)}
                                            className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-text-primary font-bold"
                                        >
                                            <option value="">
                                                -- Select a Stigix Target to add as Receiver --
                                            </option>
                                            {knownTargets.map((t) => {
                                                const alreadyAdded = formReceivers.some(
                                                    (r) => r.node.toLowerCase() === t.name.toLowerCase()
                                                );
                                                return (
                                                    <option key={t.name} value={t.name} disabled={alreadyAdded}>
                                                        {t.name} — LAN IP: {t.host}
                                                        {alreadyAdded ? ' (Already added)' : ''}
                                                    </option>
                                                );
                                            })}
                                        </select>
                                    ) : (
                                        <input
                                            type="text"
                                            list="known-mc-nodes"
                                            placeholder="Branch node name (e.g. BR1, BR2, BR5, BR8)"
                                            value={newReceiverNode}
                                            onChange={(e) => setNewReceiverNode(e.target.value)}
                                            className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-text-primary"
                                        />
                                    )}
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
                                        onClick={() => addReceiverToForm()}
                                        className="px-3 py-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 font-bold"
                                    >
                                        + Add Receiver
                                    </button>
                                </div>

                                <div className="space-y-1.5 max-h-44 overflow-y-auto">
                                    {formReceivers.map((r, idx) => {
                                        const resolvedIp =
                                            r.interfaceIp && r.interfaceIp !== 'auto'
                                                ? r.interfaceIp
                                                : resolveTargetHost(r.node);
                                        return (
                                            <div
                                                key={r.node}
                                                className="flex items-center justify-between bg-card border border-border rounded-lg px-3 py-1.5"
                                            >
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-bold text-text-primary">{r.node}</span>
                                                    <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 font-mono text-[10px]">
                                                        LAN IP: {resolvedIp}
                                                    </span>
                                                    <select
                                                        value={r.expect}
                                                        onChange={(e) => {
                                                            const next = [...formReceivers];
                                                            next[idx] = {
                                                                ...r,
                                                                expect: e.target.value as MulticastExpectationMode,
                                                            };
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
                                                    onClick={() =>
                                                        setFormReceivers(formReceivers.filter((_, i) => i !== idx))
                                                    }
                                                    className="text-rose-400 hover:text-rose-300 text-[11px] font-bold"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        );
                                    })}
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

            {/* 1-Click Industry Presets Catalog Modal */}
            {presetsModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-card border border-border rounded-2xl max-w-3xl w-full max-h-[88vh] overflow-hidden flex flex-col shadow-2xl">
                        <div className="p-4 border-b border-border flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-amber-400" />
                                <div>
                                    <h3 className="text-sm font-bold text-text-primary">
                                        Industry Multicast Application Presets
                                    </h3>
                                    <p className="text-[11px] text-text-muted">
                                        Pre-engineered multicast profiles with authentic L7 RTP/MPEG-TS or RTP/G.711 framing for customer PoCs
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setPresetsModalOpen(false)}
                                className="text-text-muted hover:text-text-primary text-xs font-bold px-2 py-1"
                            >
                                ESC / Close
                            </button>
                        </div>

                        <div className="p-5 overflow-y-auto space-y-3">
                            {presets.map((p) => (
                                <div
                                    key={p.id}
                                    className="bg-background border border-border hover:border-purple-500/40 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all"
                                >
                                    <div className="space-y-1.5">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-bold">
                                                {p.badge}
                                            </span>
                                            <span className="text-xs font-black text-text-primary">{p.name}</span>
                                            <span className="px-2 py-0.5 rounded bg-purple-500/15 border border-purple-500/30 text-purple-300 font-mono text-[10px] font-bold">
                                                {p.mode.toUpperCase()} {p.group}:{p.port}
                                            </span>
                                            <span className="px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 font-mono text-[10px] font-bold">
                                                DSCP {p.dscp} &bull; TTL {p.ttl}
                                            </span>
                                            <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-[10px] font-bold">
                                                {PAYLOAD_FORMAT_LABELS[p.payloadFormat]?.short || p.payloadFormat}
                                            </span>
                                        </div>
                                        <p className="text-xs text-text-secondary">{p.description}</p>
                                        <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-text-muted">
                                            <span>Rate: {formatBitsPerSec(p.rate.kbps)} ({p.rate.mode.toUpperCase()})</span>
                                            <span>&bull;</span>
                                            <span>Payload: {p.payloadBytes}B</span>
                                            <span>&bull;</span>
                                            <span>SLA Loss &le;{p.thresholds.maxLossPct}% / Jitter &le;{p.thresholds.maxJitterMs}ms</span>
                                            <span>&bull;</span>
                                            <span className="text-amber-300">App-ID: {p.appIdHint}</span>
                                        </div>
                                    </div>
                                    <div className="flex sm:flex-col gap-2 shrink-0">
                                        <button
                                            onClick={() => handleQuickCreateFromPreset(p)}
                                            className="px-3.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-sm transition-all whitespace-nowrap"
                                        >
                                            + Load Preset Now
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Push to Prisma SD-WAN Custom Apps Modal */}
            {prismaModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-card border border-border rounded-2xl max-w-xl w-full overflow-hidden flex flex-col shadow-2xl">
                        <div className="p-4 border-b border-border flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <CloudUpload className="w-5 h-5 text-cyan-400" />
                                <h3 className="text-sm font-bold text-text-primary">
                                    Push Multicast Profile to Prisma SD-WAN Custom Apps
                                </h3>
                            </div>
                            <button
                                onClick={() => setPrismaModalOpen(false)}
                                className="text-text-muted hover:text-text-primary text-xs font-bold px-2 py-1"
                            >
                                Close
                            </button>
                        </div>

                        <div className="p-5 space-y-4 text-xs">
                            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-3.5 text-text-secondary space-y-1.5">
                                <div className="font-bold text-cyan-300 uppercase tracking-wider text-[10px]">
                                    How Prisma SD-WAN Multicast App-ID Matching Works
                                </div>
                                <p>
                                    Multiple multicast streams often share standard UDP ports (such as <code className="text-cyan-300">UDP/5004</code> for RTP). Stigix provisions each Custom Application with <code className="text-cyan-300">protocol: udp</code>, <code className="text-cyan-300">port</code>, AND <code className="text-cyan-300">server_prefixes: [&quot;&lt;multicast_group&gt;/32&quot;]</code> so the ION Flow Browser uniquely identifies every multicast channel (<code className="text-cyan-300">STX_MC_*</code>).
                                </p>
                            </div>

                            {selectedProfile && (
                                <div className="bg-background border border-border rounded-xl p-3.5 flex items-center justify-between">
                                    <div>
                                        <div className="text-[10px] text-text-muted uppercase font-bold">Selected Profile</div>
                                        <div className="text-xs font-bold text-text-primary mt-0.5">
                                            {selectedProfile.name}
                                        </div>
                                        <div className="text-[11px] font-mono text-purple-400">
                                            UDP {selectedProfile.group}/32 : {selectedProfile.port} &bull; DSCP {selectedProfile.dscp}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleSyncToPrisma(false)}
                                        disabled={prismaSyncBusy}
                                        className="px-3.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold transition-all"
                                    >
                                        {prismaSyncBusy ? 'Syncing...' : 'Push Selected Profile'}
                                    </button>
                                </div>
                            )}

                            <div className="bg-background border border-border rounded-xl p-3.5 flex items-center justify-between">
                                <div>
                                    <div className="text-[10px] text-text-muted uppercase font-bold">Entire Multicast Catalog</div>
                                    <div className="text-xs font-bold text-text-primary mt-0.5">
                                        Sync All {profiles.length} Multicast Profiles
                                    </div>
                                    <div className="text-[11px] text-text-muted">
                                        Creates/updates <code className="font-mono">STX_MC_*</code> definitions on Prisma SD-WAN Controller
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleSyncToPrisma(true)}
                                    disabled={prismaSyncBusy}
                                    className="px-3.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold transition-all"
                                >
                                    {prismaSyncBusy ? 'Syncing...' : `Push All (${profiles.length})`}
                                </button>
                            </div>

                            {prismaSyncResult && (
                                <div className="bg-background border border-border rounded-xl p-3 font-mono text-[11px] text-emerald-300 max-h-48 overflow-y-auto whitespace-pre-wrap">
                                    {typeof prismaSyncResult === 'string'
                                        ? prismaSyncResult
                                        : JSON.stringify(prismaSyncResult, null, 2)}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Import Multicast Profiles JSON Modal */}
            {importModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-card border border-border rounded-2xl max-w-xl w-full overflow-hidden flex flex-col shadow-2xl">
                        <div className="p-4 border-b border-border flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <FileJson className="w-5 h-5 text-purple-400" />
                                <h3 className="text-sm font-bold text-text-primary">
                                    Import Multicast Overlay Configuration (JSON)
                                </h3>
                            </div>
                            <button
                                onClick={() => setImportModalOpen(false)}
                                className="text-text-muted hover:text-text-primary text-xs font-bold px-2 py-1"
                            >
                                Cancel
                            </button>
                        </div>

                        <div className="p-5 space-y-4 text-xs">
                            <div className="flex items-center justify-between gap-3">
                                <label className="px-3.5 py-2 rounded-lg bg-purple-600/15 hover:bg-purple-600/25 border border-purple-500/30 text-purple-300 font-bold cursor-pointer transition-all">
                                    Choose .json File
                                    <input
                                        type="file"
                                        accept=".json,application/json"
                                        onChange={handleImportFileChange}
                                        className="hidden"
                                    />
                                </label>

                                <div className="flex items-center gap-2">
                                    <span className="text-text-muted font-bold">Import Mode:</span>
                                    <select
                                        value={importMode}
                                        onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')}
                                        className="bg-background border border-border rounded-lg px-2.5 py-1.5 text-text-primary font-bold"
                                    >
                                        <option value="merge">Merge (Add / Update by ID)</option>
                                        <option value="replace">Replace All Profiles</option>
                                    </select>
                                </div>
                            </div>

                            <textarea
                                rows={8}
                                value={importJsonText}
                                onChange={(e) => setImportJsonText(e.target.value)}
                                placeholder='Paste exported Stigix Multicast JSON bundle here ({"kind": "stigix-multicast-profiles", "applications": [...]})'
                                className="w-full bg-background border border-border rounded-xl p-3 font-mono text-[11px] text-text-primary focus:outline-none focus:border-purple-500"
                            />

                            <div className="flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setImportModalOpen(false)}
                                    className="px-4 py-2 rounded-lg bg-background border border-border text-text-muted hover:text-text-primary font-bold"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    disabled={importBusy || !importJsonText.trim()}
                                    onClick={handleImportSubmit}
                                    className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold shadow-sm"
                                >
                                    {importBusy ? 'Importing & Syncing Peers...' : 'Import & Sync to Fleet'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

