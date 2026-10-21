import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
    Camera, 
    GitCompare, 
    History, 
    CheckCircle, 
    AlertTriangle, 
    XCircle, 
    ArrowRight, 
    RefreshCw, 
    Trash2, 
    Network, 
    Activity, 
    ShieldCheck, 
    X,
    TrendingDown,
    TrendingUp,
    FileJson,
    Server,
    Globe,
    PhoneCall,
    Search,
    Sliders,
    Tag,
    Sparkles,
    Download,
    Copy,
    FileText,
    Bot
} from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from './lib/utils';

interface AiModelOption {
    id: string;
    name: string;
    description: string;
    provider?: 'anthropic' | 'deepseek';
}

interface AiConfigState {
    enabled: boolean;
    hasKey: boolean;
    hasAnthropicKey?: boolean;
    hasDeepseekKey?: boolean;
    defaultModel: string;
    models: AiModelOption[];
}

interface AiAnalysisResult {
    analysis: string;
    reasoning?: string;
    model: string;
    provider: string;
    durationMs: number;
    usage?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
    };
}

interface SnapshotMetadata {
    id: string;
    timestamp: number;
    iso_time: string;
    name: string;
    description: string;
    source: string;
    node: {
        hostname: string;
        site_name: string;
        role: string;
        stigix_version: string;
    };
    tunnels_count: number;
    tunnels_up: number;
    dem_probes_count: number;
    dem_healthy_count: number;
    sdwan_site_count?: number;
    sdwan_sites_online?: number;
    voice_avg_mos?: number;
    vyos_impairments_count?: number;
    security_score?: number;
}

interface SecurityCategoryDelta {
    id: string;
    type: 'url' | 'dns' | 'threat' | 'c2' | 'ai';
    name: string;
    statusBefore: string;
    statusAfter: string;
    protectedBefore: boolean;
    protectedAfter: boolean;
    state: 'REGRESSED' | 'IMPROVED' | 'STABLE_PROTECTED' | 'STABLE_EXPOSED' | 'NEW' | 'REMOVED';
}

interface SecurityDelta {
    overallBefore?: number;
    overallAfter?: number;
    overallDelta?: number;
    urlBefore?: number;
    urlAfter?: number;
    urlDelta?: number;
    dnsBefore?: number;
    dnsAfter?: number;
    dnsDelta?: number;
    threatBefore?: number;
    threatAfter?: number;
    threatDelta?: number;
    c2Before?: number;
    c2After?: number;
    c2Delta?: number;
    aiBefore?: number;
    aiAfter?: number;
    aiDelta?: number;
    protectedBefore?: number;
    protectedAfter?: number;
    totalBefore?: number;
    totalAfter?: number;
    categories: SecurityCategoryDelta[];
}

interface TunnelComparison {
    peer_id: string;
    site_name?: string;
    endpoint?: string;
    ip_private?: string;
    baseline_status: string;
    current_status: string;
    status_changed: boolean;
    regression: boolean;
    improvement: boolean;
}

interface DemProbeComparison {
    target_id: string;
    target_label: string;
    target_url?: string;
    probe_type?: string;
    status_before?: string;
    status_after?: string;
    score_before?: number;
    score_after?: number;
    score_delta?: number;
    http_code_before?: number;
    http_code_after?: number;
    baseline_latency_ms: number;
    current_latency_ms: number;
    latency_delta_ms: number;
    latency_delta_percent: number;
    baseline_loss_percent: number;
    current_loss_percent: number;
    loss_delta_percent: number;
    baseline_jitter_ms: number;
    current_jitter_ms: number;
    jitter_delta_ms: number;
    status_regression: boolean;
    status_improvement: boolean;
}

interface SdwanDeviceDelta {
    deviceId: string;
    deviceName: string;
    model?: string;
    softwareVersion?: string;
    connectedBefore: boolean;
    connectedAfter: boolean;
    wanUpBefore?: number;
    wanUpAfter?: number;
    wanTotal?: number;
    serviceLinksUpBefore?: number;
    serviceLinksUpAfter?: number;
    serviceLinksTotal?: number;
    wanIps?: string[];
    lanIps?: string[];
    stateChange: 'DISCONNECTED' | 'RECONNECTED' | 'DEGRADED_LINKS' | 'IMPROVED_LINKS' | 'STABLE_ONLINE' | 'STABLE_OFFLINE' | 'NEW' | 'REMOVED';
}

interface SdwanSiteDelta {
    siteId: string;
    siteName: string;
    role: string;
    connectedBefore: boolean;
    connectedAfter: boolean;
    stateChange: 'STABLE_ONLINE' | 'STABLE_OFFLINE' | 'DISCONNECTED' | 'RECONNECTED' | 'DEGRADED' | 'IMPROVED' | 'NEW' | 'REMOVED';
    deviceChanges: SdwanDeviceDelta[];
}

interface SdwanUnderlayDelta {
    availableBefore?: boolean;
    availableAfter?: boolean;
    matchedBefore?: number;
    matchedAfter?: number;
    matchedDelta?: number;
    routersBefore?: string[];
    routersAfter?: string[];
    offlineRouters?: string[];
}

interface VoiceTargetDelta {
    target: string;
    codec?: string;
    callsBefore: number;
    callsAfter: number;
    mosBefore?: number;
    mosAfter?: number;
    mosDelta?: number;
    rttBefore?: number;
    rttAfter?: number;
    rttDeltaMs?: number;
    jitterBefore?: number;
    jitterAfter?: number;
    jitterDeltaMs?: number;
    lossBefore?: number;
    lossAfter?: number;
    lossDeltaPct?: number;
    state: 'IMPROVED' | 'REGRESSED' | 'STABLE' | 'NEW' | 'REMOVED';
}

interface VoiceDelta {
    enabledBefore: boolean;
    enabledAfter: boolean;
    sampleCountBefore: number;
    sampleCountAfter: number;
    avgMosBefore?: number;
    avgMosAfter?: number;
    mosDelta?: number;
    minMosBefore?: number;
    minMosAfter?: number;
    avgRttBefore?: number;
    avgRttAfter?: number;
    rttDeltaMs?: number;
    avgJitterBefore?: number;
    avgJitterAfter?: number;
    jitterDeltaMs?: number;
    avgLossBefore?: number;
    avgLossAfter?: number;
    lossDeltaPct?: number;
    targets: VoiceTargetDelta[];
}

interface VyosImpairmentDelta {
    routerId: string;
    routerName: string;
    interfaceName: string;
    description?: string;
    statusBefore: string;
    statusAfter: string;
    latencyBeforeMs: number;
    latencyAfterMs: number;
    latencyDeltaMs: number;
    lossBeforePct: number;
    lossAfterPct: number;
    lossDeltaPct: number;
    changed: boolean;
}

interface VyosDelta {
    routersTotalBefore: number;
    routersTotalAfter: number;
    routersOnlineBefore: number;
    routersOnlineAfter: number;
    impairmentsBefore: number;
    impairmentsAfter: number;
    blackholesBefore: string[];
    blackholesAfter: string[];
    interfaceDeltas: VyosImpairmentDelta[];
}

interface DiffReport {
    baseline_id: string;
    baseline_name: string;
    baseline_timestamp?: string;
    current_id: string;
    current_name: string;
    current_timestamp?: string;
    generated_at: string;
    score: number;
    verdict: 'GO' | 'WARNING' | 'NO_GO';
    tunnels: {
        total_baseline: number;
        total_current: number;
        down_now: number;
        regressed: number;
        improved: number;
        comparisons: TunnelComparison[];
    };
    dem: {
        total_probes: number;
        regressed_probes: number;
        improved_probes: number;
        avg_baseline_latency_ms?: number;
        avg_current_latency_ms?: number;
        average_latency_delta_ms: number;
        average_loss_delta_percent: number;
        probes: DemProbeComparison[];
    };
    sdwan?: {
        total_baseline: number;
        total_current: number;
        online_baseline: number;
        online_current: number;
        sase_links_up_baseline?: number;
        sase_links_up_current?: number;
        sase_links_total?: number;
        sites: SdwanSiteDelta[];
        underlay?: SdwanUnderlayDelta;
    };
    voice?: VoiceDelta | null;
    vyos?: VyosDelta | null;
    security?: SecurityDelta | null;
    critical_regressions: string[];
    improvements: string[];
}

interface ChangeGuardProps {
    token: string;
}

function buildClientDefaultSnapshotName(siteName: string, existingSnapshots: SnapshotMetadata[], suffix?: string): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const datePrefix = `${yyyy}${mm}${dd}`;
    const timePart = `${hh}${min}`;

    const cleanSite = (siteName || 'NODE').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8) || 'NODE';
    const todayCount = existingSnapshots.filter(s => {
        const d = new Date(s.timestamp);
        return d.getFullYear() === yyyy && (d.getMonth() + 1) === Number(mm) && d.getDate() === Number(dd);
    }).length;
    const seq = String(todayCount + 1).padStart(2, '0');
    const base = `${datePrefix}-${timePart}-${cleanSite}-${seq}`;
    return suffix ? `${base}-${suffix}` : base;
}

export default function ChangeGuard({ token }: ChangeGuardProps) {
    const [snapshots, setSnapshots] = useState<SnapshotMetadata[]>([]);
    const [siteName, setSiteName] = useState<string>('NODE');
    const [loading, setLoading] = useState<boolean>(true);
    const [actionLoading, setActionLoading] = useState<boolean>(false);
    
    // Selection for Diff
    const [baselineId, setBaselineId] = useState<string>('');
    const [currentId, setCurrentId] = useState<string>('');
    const [diffReport, setDiffReport] = useState<DiffReport | null>(null);
    const [diffLoading, setDiffLoading] = useState<boolean>(false);

    // DEM table filter & search
    const [demFilter, setDemFilter] = useState<'ALL' | 'CHANGED' | 'DEGRADED' | 'IMPROVED'>('ALL');
    const [demSearch, setDemSearch] = useState<string>('');

    // Modal state for taking snapshot
    const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
    const [newSnapshotName, setNewSnapshotName] = useState<string>('');
    const [newSnapshotDesc, setNewSnapshotDesc] = useState<string>('');

    // Modal state for inspecting JSON
    const [inspectData, setInspectData] = useState<any | null>(null);

    // Optional AI Analysis state (when LLM API key is configured)
    const [aiConfig, setAiConfig] = useState<AiConfigState | null>(null);
    const [selectedAiModel, setSelectedAiModel] = useState<string>('');
    const [aiAnalysis, setAiAnalysis] = useState<AiAnalysisResult | null>(null);
    const [aiAnalyzing, setAiAnalyzing] = useState<boolean>(false);

    const authHeaders = useMemo(() => ({
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    }), [token]);

    const fetchAiConfig = useCallback(async () => {
        try {
            const res = await fetch('/api/copilot/config', { headers: authHeaders });
            if (!res.ok) return;
            const data = await res.json();
            const cfg = data.config || data;
            setAiConfig({
                enabled: Boolean(cfg.enabled),
                hasKey: Boolean(cfg.hasKey),
                hasAnthropicKey: Boolean(cfg.hasAnthropicKey ?? (cfg.maskedKey && cfg.maskedKey.length > 0)),
                hasDeepseekKey: Boolean(cfg.hasDeepseekKey),
                defaultModel: cfg.defaultModel || 'claude-sonnet-4-5-20250929',
                models: Array.isArray(cfg.models) ? cfg.models : []
            });
            setSelectedAiModel(prev => prev || cfg.defaultModel || 'claude-sonnet-4-5-20250929');
        } catch {
            // Non-blocking if Copilot config endpoint is unavailable
        }
    }, [authHeaders]);

    const availableAiModels = useMemo(() => {
        if (!aiConfig?.models?.length) return [];
        const filtered = aiConfig.models.filter(m => {
            if (m.provider === 'anthropic') return aiConfig.hasAnthropicKey;
            if (m.provider === 'deepseek') return aiConfig.hasDeepseekKey;
            return true;
        });
        return filtered.length > 0 ? filtered : aiConfig.models;
    }, [aiConfig]);

    const fetchSnapshots = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/snapshots', { headers: authHeaders });
            if (!res.ok) {
                if (res.status === 403) {
                    toast.error('ChangeGuard is disabled. Enable ENABLE_CHANGE_SNAPSHOTS=true in .env');
                } else {
                    toast.error('Failed to load snapshots');
                }
                return;
            }
            const data = await res.json();
            const list: SnapshotMetadata[] = data.snapshots || [];
            setSnapshots(list);
            if (data.site_name) {
                setSiteName(data.site_name);
            } else if (list[0]?.node?.site_name) {
                setSiteName(list[0].node.site_name);
            }

            // Auto-select latest two if none selected
            if (list.length >= 2) {
                if (!baselineId) setBaselineId(list[1].id);
                if (!currentId) setCurrentId(list[0].id);
            } else if (list.length === 1 && !baselineId) {
                setBaselineId(list[0].id);
            }
        } catch (err: any) {
            console.error('Failed to fetch snapshots:', err);
            toast.error('Network error loading snapshots');
        } finally {
            setLoading(false);
        }
    }, [authHeaders, baselineId, currentId]);

    useEffect(() => {
        fetchSnapshots();
        fetchAiConfig();
    }, [fetchSnapshots, fetchAiConfig]);

    const copyTextToClipboard = async (text: string, successMessage: string) => {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';
                textArea.style.left = '-9999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
            }
            toast.success(successMessage);
        } catch (err) {
            console.error('Clipboard copy failed:', err);
            toast.error('Failed to copy to clipboard');
        }
    };

    const downloadFile = (filename: string, content: string, mimeType: string = 'application/json') => {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const buildDiffLlmMarkdown = (diff: DiffReport): string => {
        const lines: string[] = [];
        lines.push(`# Stigix ChangeGuard — Pre/Post Change Validation Report`);
        lines.push(`> **AI Prompt Instruction (for ChatGPT / Perplexity / Claude):**`);
        lines.push(`> You are a Senior SD-WAN, SASE Security, and Network QoE Architect. Analyze this Stigix ChangeGuard state comparison and provide:`);
        lines.push(`> 1. **Executive Go/No-Go Assessment** & Customer Experience / Security Impact (Security Posture Enforcement, Voice RTP MOS, SaaS DEM Probes, Site Connectivity).`);
        lines.push(`> 2. **Cross-Layer Root-Cause Correlation** between Underlay (VyOS WAN impairments/latency/loss/blackholes), Overlay (Prisma SD-WAN WAN circuits, SASE IPsec Service Links, Stigix Mesh), SASE Security policy enforcement (URL/DNS/Threat/C2/AI), and application/voice QoE.`);
        lines.push(`> 3. **Actionable Recommendations** (Proceed, Investigate, or Rollback).`);
        lines.push(``);
        lines.push(`## 1. Executive Summary`);
        lines.push(`- **Baseline (Before):** \`${diff.baseline_name}\` (${diff.baseline_timestamp || 'N/A'})`);
        lines.push(`- **Target (After):** \`${diff.current_name}\` (${diff.current_timestamp || 'Live'})`);
        lines.push(`- **Deterministic Verdict:** **${diff.verdict}** (Confidence Score: **${diff.score}/100**)`);
        lines.push(`- **Generated At:** ${diff.generated_at}`);
        lines.push(``);

        if (diff.critical_regressions?.length > 0) {
            lines.push(`### 🔴 Regressions Detected (${diff.critical_regressions.length})`);
            diff.critical_regressions.forEach(r => lines.push(`- ${r}`));
            lines.push(``);
        }
        if (diff.improvements?.length > 0) {
            lines.push(`### 🟢 Improvements Detected (${diff.improvements.length})`);
            diff.improvements.forEach(i => lines.push(`- ${i}`));
            lines.push(``);
        }
        if (aiAnalysis?.analysis) {
            lines.push(`### ✨ Stigix In-App AI Analysis (${aiAnalysis.model})`);
            lines.push(aiAnalysis.analysis);
            lines.push(``);
        }

        if (diff.security && (diff.security.overallBefore !== undefined || diff.security.overallAfter !== undefined || (diff.security.categories?.length ?? 0) > 0)) {
            lines.push(`## 2. SASE Security Posture & Policy Enforcement`);
            lines.push(`- **Overall Security Score:** ${diff.security.overallBefore ?? 'N/A'}% -> ${diff.security.overallAfter ?? 'N/A'}% (Δ ${diff.security.overallDelta ?? 0}%)`);
            lines.push(`- **URL Filtering:** ${diff.security.urlBefore ?? '—'}% -> ${diff.security.urlAfter ?? '—'}% | **DNS Security:** ${diff.security.dnsBefore ?? '—'}% -> ${diff.security.dnsAfter ?? '—'}% | **Threat/EICAR:** ${diff.security.threatBefore ?? '—'}% -> ${diff.security.threatAfter ?? '—'}% | **C2 Detection:** ${diff.security.c2Before ?? '—'}% -> ${diff.security.c2After ?? '—'}% | **AI Security:** ${diff.security.aiBefore ?? '—'}% -> ${diff.security.aiAfter ?? '—'}%`);
            if (diff.security.categories?.length > 0) {
                lines.push(`| Pillar | Category / Vector | Baseline Enforcement | Target Enforcement | State |`);
                lines.push(`|---|---|---|---|---|`);
                diff.security.categories.forEach(c => {
                    lines.push(`| ${c.type.toUpperCase()} | ${c.name} | ${c.statusBefore.toUpperCase()} | ${c.statusAfter.toUpperCase()} | ${c.state} |`);
                });
            }
            lines.push(``);
        }

        if (diff.voice && diff.voice.targets?.length > 0) {
            lines.push(`## 3. Voice & RTP Collaboration QoE`);
            lines.push(`- **Global MOS:** ${diff.voice.avgMosBefore?.toFixed(2) ?? 'N/A'} -> ${diff.voice.avgMosAfter?.toFixed(2) ?? 'N/A'} (Δ ${diff.voice.mosDelta ?? 0})`);
            lines.push(`- **Avg RTP RTT:** ${diff.voice.avgRttBefore?.toFixed(1) ?? 0}ms -> ${diff.voice.avgRttAfter?.toFixed(1) ?? 0}ms`);
            lines.push(`- **Avg Packet Loss:** ${diff.voice.avgLossBefore?.toFixed(1) ?? 0}% -> ${diff.voice.avgLossAfter?.toFixed(1) ?? 0}%`);
            lines.push(`| Target | Codec | Baseline MOS | Target MOS | Δ MOS | RTT (Before->After) | Jitter | Loss | Verdict |`);
            lines.push(`|---|---|---|---|---|---|---|---|---|`);
            diff.voice.targets.forEach(vt => {
                lines.push(`| ${vt.target} | ${vt.codec || 'G.711'} | ${vt.mosBefore?.toFixed(2) ?? '—'} | ${vt.mosAfter?.toFixed(2) ?? '—'} | ${vt.mosDelta?.toFixed(2) ?? '0'} | ${vt.rttBefore?.toFixed(1) ?? 0}->${vt.rttAfter?.toFixed(1) ?? 0}ms | ${vt.jitterBefore?.toFixed(1) ?? 0}->${vt.jitterAfter?.toFixed(1) ?? 0}ms | ${vt.lossBefore?.toFixed(1) ?? 0}%->${vt.lossAfter?.toFixed(1) ?? 0}% | ${vt.state} |`);
            });
            lines.push(``);
        }

        if (diff.vyos && diff.vyos.interfaceDeltas?.length > 0) {
            lines.push(`## 4. VyOS Underlay & WAN QoS / Chaos Impairments`);
            lines.push(`- **Routers Online:** ${diff.vyos.routersOnlineBefore}/${diff.vyos.routersTotalBefore} -> ${diff.vyos.routersOnlineAfter}/${diff.vyos.routersTotalAfter}`);
            lines.push(`- **Active Impairments:** ${diff.vyos.impairmentsBefore} -> ${diff.vyos.impairmentsAfter}`);
            lines.push(`- **BGP Blackholes:** ${(diff.vyos.blackholesBefore || []).join(', ') || 'None'} -> ${(diff.vyos.blackholesAfter || []).join(', ') || 'None'}`);
            lines.push(`| Router | Interface | Description | Link State | Latency (Before->After) | Loss (Before->After) | Changed |`);
            lines.push(`|---|---|---|---|---|---|---|`);
            diff.vyos.interfaceDeltas.forEach(i => {
                lines.push(`| ${i.routerName} | ${i.interfaceName} | ${i.description || '—'} | ${i.statusBefore}->${i.statusAfter} | ${i.latencyBeforeMs}ms->${i.latencyAfterMs}ms | ${i.lossBeforePct}%->${i.lossAfterPct}% | ${i.changed ? 'MODIFIED' : 'UNCHANGED'} |`);
            });
            lines.push(``);
        }

        if (diff.sdwan && diff.sdwan.sites?.length > 0) {
            lines.push(`## 5. Prisma SD-WAN & SASE Overlay`);
            lines.push(`- **Sites Online:** ${diff.sdwan.online_baseline}/${diff.sdwan.total_baseline} -> ${diff.sdwan.online_current}/${diff.sdwan.total_current}`);
            lines.push(`- **SASE IPsec Tunnels UP:** ${diff.sdwan.sase_links_up_baseline ?? 0}/${diff.sdwan.sase_links_total ?? 0} -> ${diff.sdwan.sase_links_up_current ?? 0}/${diff.sdwan.sase_links_total ?? 0}`);
            lines.push(`| Site | Role | Status (Before->After) | ION Devices | WAN Circuits | SASE Links | State Change |`);
            lines.push(`|---|---|---|---|---|---|---|`);
            diff.sdwan.sites.forEach(s => {
                const devs = s.deviceChanges.map(d => d.deviceName).join(', ') || '—';
                const wans = s.deviceChanges.map(d => `${d.wanUpBefore ?? 0}/${d.wanTotal ?? 0}->${d.wanUpAfter ?? 0}/${d.wanTotal ?? 0}`).join(', ') || '—';
                const sase = s.deviceChanges.map(d => `${d.serviceLinksUpBefore ?? 0}/${d.serviceLinksTotal ?? 0}->${d.serviceLinksUpAfter ?? 0}/${d.serviceLinksTotal ?? 0}`).join(', ') || '—';
                lines.push(`| ${s.siteName} | ${s.role} | ${s.connectedBefore ? 'ONLINE' : 'OFFLINE'}->${s.connectedAfter ? 'ONLINE' : 'OFFLINE'} | ${devs} | ${wans} | ${sase} | ${s.stateChange} |`);
            });
            lines.push(``);
        }

        if (diff.dem?.probes?.length > 0) {
            lines.push(`## 6. Digital Experience (DEM) App Probes (${diff.dem.total_probes} total, ${diff.dem.regressed_probes} degraded, ${diff.dem.improved_probes} improved)`);
            lines.push(`- **Average Latency:** ${(diff.dem.avg_baseline_latency_ms ?? 0).toFixed(1)}ms -> ${(diff.dem.avg_current_latency_ms ?? 0).toFixed(1)}ms (Δ ${diff.dem.average_latency_delta_ms}ms)`);
            lines.push(`| Probe Target | Type | Score (Before->After) | Baseline Latency | Target Latency | Δ Latency | Δ Loss | Verdict |`);
            lines.push(`|---|---|---|---|---|---|---|---|`);
            diff.dem.probes.forEach(p => {
                const verdict = p.status_regression ? 'DEGRADED' : p.status_improvement ? 'IMPROVED' : 'UNCHANGED';
                lines.push(`| ${p.target_label} | ${p.probe_type || 'PING'} | ${p.score_before ?? '—'}->${p.score_after ?? '—'} | ${p.baseline_latency_ms.toFixed(1)}ms | ${p.current_latency_ms.toFixed(1)}ms | ${p.latency_delta_ms > 0 ? `+${p.latency_delta_ms.toFixed(1)}` : p.latency_delta_ms.toFixed(1)}ms (${p.latency_delta_percent.toFixed(0)}%) | ${p.loss_delta_percent.toFixed(1)}% | ${verdict} |`);
            });
            lines.push(``);
        }

        return lines.join('\n');
    };

    const handleAnalyzeWithAi = async () => {
        if (!diffReport) return;
        try {
            setAiAnalyzing(true);
            const res = await fetch('/api/snapshots/analyze-diff', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    diff: diffReport,
                    model: selectedAiModel || aiConfig?.defaultModel
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(data.error || data.detail || 'AI Analysis failed');
                return;
            }
            setAiAnalysis({
                analysis: data.analysis,
                reasoning: data.reasoning,
                model: data.model,
                provider: data.provider,
                durationMs: data.durationMs,
                usage: data.usage
            });
            toast.success(`AI Analysis generated with ${data.model}`);
        } catch (err: any) {
            console.error('AI analysis error:', err);
            toast.error(`AI analysis error: ${err?.message || 'Network error'}`);
        } finally {
            setAiAnalyzing(false);
        }
    };

    const handleDownloadSnapshot = async (id: string, name: string) => {
        try {
            setActionLoading(true);
            const res = await fetch(`/api/snapshots/${encodeURIComponent(id)}`, { headers: authHeaders });
            if (!res.ok) {
                toast.error('Failed to fetch snapshot for export');
                return;
            }
            const data = await res.json();
            const safeName = (name || id).replace(/[^a-zA-Z0-9_-]+/g, '_');
            downloadFile(`stigix-snapshot-${safeName}.json`, JSON.stringify(data.snapshot, null, 2), 'application/json');
            toast.success(`Exported snapshot "${name}" (.json)`);
        } catch (err) {
            console.error('Export snapshot error:', err);
            toast.error('Failed to export snapshot');
        } finally {
            setActionLoading(false);
        }
    };

    const buildSnapshotLlmPrompt = (snap: any): string => {
        const lines: string[] = [];
        const name = snap.name || snap.metadata?.name || snap.id;
        lines.push(`# Stigix ChangeGuard — Point-in-Time Network State Snapshot`);
        lines.push(`> **AI Prompt Instruction (for ChatGPT / Perplexity / Claude):**`);
        lines.push(`> Analyze the following Stigix SD-WAN / SASE Security / DEM / Voice / VyOS node state snapshot (\`${name}\`) and summarize network health, SASE security policy enforcement scores (URL/DNS/Threat/C2/AI), active WAN impairments, SASE tunnel status, DEM application performance, and Voice MOS quality.`);
        lines.push(``);
        lines.push(`\`\`\`json`);
        lines.push(JSON.stringify(snap, null, 2));
        lines.push(`\`\`\``);
        return lines.join('\n');
    };

    const openCreateModal = () => {
        const defaultName = buildClientDefaultSnapshotName(siteName, snapshots, 'baseline');
        setNewSnapshotName(defaultName);
        setNewSnapshotDesc('');
        setShowCreateModal(true);
    };

    const applyPresetSuffix = (suffix: string) => {
        const baseName = buildClientDefaultSnapshotName(siteName, snapshots, suffix);
        setNewSnapshotName(baseName);
    };

    const handleCreateSnapshot = async (e: React.FormEvent) => {
        e.preventDefault();
        const finalName = newSnapshotName.trim() || buildClientDefaultSnapshotName(siteName, snapshots);

        try {
            setActionLoading(true);
            const res = await fetch('/api/snapshots', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    name: finalName,
                    description: newSnapshotDesc.trim()
                })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                toast.error(errData.error || 'Failed to capture snapshot');
                return;
            }

            const data = await res.json();
            toast.success(`Snapshot "${data.snapshot.metadata.name}" captured!`);
            setShowCreateModal(false);
            setNewSnapshotName('');
            setNewSnapshotDesc('');
            await fetchSnapshots();
        } catch (err) {
            console.error('Error creating snapshot:', err);
            toast.error('Error creating snapshot');
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteSnapshot = async (id: string, name: string) => {
        if (!confirm(`Delete snapshot "${name}"? This action cannot be undone.`)) return;

        try {
            setActionLoading(true);
            const res = await fetch(`/api/snapshots/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: authHeaders
            });

            if (!res.ok) {
                toast.error('Failed to delete snapshot');
                return;
            }

            toast.success(`Snapshot "${name}" deleted`);
            if (baselineId === id) setBaselineId('');
            if (currentId === id) setCurrentId('');
            if (diffReport?.baseline_id === id || diffReport?.current_id === id) {
                setDiffReport(null);
                setAiAnalysis(null);
            }
            await fetchSnapshots();
        } catch (err) {
            console.error('Delete error:', err);
            toast.error('Error deleting snapshot');
        } finally {
            setActionLoading(false);
        }
    };

    const handleRunDiff = async () => {
        if (!baselineId) {
            toast.error('Please select a Baseline snapshot');
            return;
        }

        try {
            setDiffLoading(true);
            setAiAnalysis(null);
            const res = await fetch('/api/snapshots/diff', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    baseline_id: baselineId,
                    current_id: currentId || undefined
                })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                const msg = errData.detail || errData.error || `HTTP ${res.status}: Failed to compute diff`;
                toast.error(msg, { duration: 6000 });
                console.error('[SNAPSHOT_DIFF] Failed:', errData);
                return;
            }

            const data = await res.json();
            setDiffReport(data.diff);
            toast.success(`Diff calculated: Verdict ${data.diff.verdict} (${data.diff.score}/100)`);
        } catch (err: any) {
            console.error('Diff error:', err);
            toast.error(`Error computing diff: ${err?.message || 'Network error'}`);
        } finally {
            setDiffLoading(false);
        }
    };

    const handleInspectSnapshot = async (id: string) => {
        try {
            setActionLoading(true);
            const res = await fetch(`/api/snapshots/${encodeURIComponent(id)}`, { headers: authHeaders });
            if (!res.ok) {
                toast.error('Failed to load snapshot details');
                return;
            }
            const data = await res.json();
            setInspectData(data.snapshot);
        } catch (err) {
            console.error('Inspect error:', err);
            toast.error('Failed to retrieve snapshot JSON');
        } finally {
            setActionLoading(false);
        }
    };

    // Filtered and sorted DEM probes (regressions & improvements first, then by largest |Δ Latency|)
    const filteredDemProbes = useMemo(() => {
        if (!diffReport?.dem?.probes) return [];
        const q = demSearch.trim().toLowerCase();

        return [...diffReport.dem.probes]
            .filter(p => {
                if (q) {
                    const matchLabel = (p.target_label || '').toLowerCase().includes(q);
                    const matchUrl = (p.target_url || '').toLowerCase().includes(q);
                    const matchType = (p.probe_type || '').toLowerCase().includes(q);
                    if (!matchLabel && !matchUrl && !matchType) return false;
                }
                if (demFilter === 'DEGRADED') return p.status_regression;
                if (demFilter === 'IMPROVED') return p.status_improvement;
                if (demFilter === 'CHANGED') {
                    return p.status_regression || p.status_improvement || Math.abs(p.latency_delta_ms) >= 1.5 || Math.abs(p.loss_delta_percent) > 0;
                }
                return true;
            })
            .sort((a, b) => {
                if (a.status_regression !== b.status_regression) return a.status_regression ? -1 : 1;
                if (a.status_improvement !== b.status_improvement) return a.status_improvement ? -1 : 1;
                return Math.abs(b.latency_delta_ms) - Math.abs(a.latency_delta_ms);
            });
    }, [diffReport, demFilter, demSearch]);

    const getMosBadgeColor = (mos?: number) => {
        if (mos === undefined || mos === 0) return 'bg-slate-800 text-slate-400 border-slate-700';
        if (mos >= 4.0) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
        if (mos >= 3.6) return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
        return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
    };

    return (
        <div className="w-full min-h-screen bg-slate-900 text-slate-100 p-6 space-y-6">
            {/* ── Top Header Banner ── */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
                <div className="space-y-1">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg border border-indigo-500/20">
                            <GitCompare className="w-6 h-6" />
                        </div>
                        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                            ChangeGuard
                            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                Customer Experience & State Diff
                            </span>
                        </h1>
                    </div>
                    <p className="text-sm text-slate-400">
                        Pre/post change validation across Voice MOS QoE, SaaS DEM Probes, Prisma SD-WAN Overlay & VyOS Underlay.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={fetchSnapshots}
                        disabled={loading}
                        className="px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition flex items-center gap-1.5"
                    >
                        <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
                        Refresh
                    </button>
                    <button
                        onClick={openCreateModal}
                        className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow-sm transition flex items-center gap-2"
                    >
                        <Camera className="w-4 h-4" />
                        Capture Snapshot
                    </button>
                </div>
            </div>

            {/* ── Section 1: Compare Before / After (Diff Control) ── */}
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 shadow-lg backdrop-blur-sm space-y-5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <GitCompare className="w-5 h-5 text-indigo-400" />
                        <h2 className="text-base font-semibold text-white">Delta Comparator (Before vs. After)</h2>
                    </div>
                    <span className="text-xs text-slate-400">
                        Select a baseline snapshot and compare against another snapshot or live state.
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                    {/* Baseline Selector */}
                    <div className="md:col-span-5 space-y-1.5">
                        <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-400" />
                            Baseline Snapshot (Before)
                        </label>
                        <select
                            value={baselineId}
                            onChange={(e) => setBaselineId(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="">-- Choose Baseline --</option>
                            {snapshots.map(s => (
                                <option key={s.id} value={s.id}>
                                    {s.name} ({s.node?.site_name || 'Node'} — {new Date(s.timestamp).toLocaleTimeString()})
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Arrow Divider */}
                    <div className="hidden md:flex md:col-span-1 justify-center items-center pb-2 text-slate-500">
                        <ArrowRight className="w-5 h-5" />
                    </div>

                    {/* Current / Target Selector */}
                    <div className="md:col-span-4 space-y-1.5">
                        <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-cyan-400" />
                            Target Snapshot (After / Live)
                        </label>
                        <select
                            value={currentId}
                            onChange={(e) => setCurrentId(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="">⚡ Live Node State (Current Real-Time)</option>
                            {snapshots.map(s => (
                                <option key={s.id} value={s.id}>
                                    {s.name} ({s.node?.site_name || 'Node'} — {new Date(s.timestamp).toLocaleTimeString()})
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Compare Button */}
                    <div className="md:col-span-2">
                        <button
                            onClick={handleRunDiff}
                            disabled={!baselineId || diffLoading}
                            className={cn(
                                "w-full py-2 px-4 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-2",
                                !baselineId || diffLoading
                                    ? "bg-slate-700 text-slate-400 cursor-not-allowed"
                                    : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-md hover:shadow-indigo-500/20"
                            )}
                        >
                            <RefreshCw className={cn("w-4 h-4", diffLoading && "animate-spin")} />
                            {diffLoading ? "Analyzing..." : "Compare Delta"}
                        </button>
                    </div>
                </div>

                {/* ── Diff Report Presentation ── */}
                {diffReport && (
                    <div className="pt-4 border-t border-slate-700/60 space-y-5 animate-in fade-in duration-200">
                        {/* Verdict Header Card */}
                        <div className={cn(
                            "p-5 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4",
                            diffReport.verdict === 'GO' && "bg-emerald-950/30 border-emerald-500/30 text-emerald-200",
                            diffReport.verdict === 'WARNING' && "bg-amber-950/30 border-amber-500/30 text-amber-200",
                            diffReport.verdict === 'NO_GO' && "bg-rose-950/30 border-rose-500/30 text-rose-200"
                        )}>
                            <div className="flex items-center gap-3.5">
                                {diffReport.verdict === 'GO' && <CheckCircle className="w-8 h-8 text-emerald-400 shrink-0" />}
                                {diffReport.verdict === 'WARNING' && <AlertTriangle className="w-8 h-8 text-amber-400 shrink-0" />}
                                {diffReport.verdict === 'NO_GO' && <XCircle className="w-8 h-8 text-rose-400 shrink-0" />}

                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xl font-bold tracking-tight">
                                            VERDICT: {diffReport.verdict}
                                        </span>
                                        <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-white/10 uppercase">
                                            Confidence Score: {diffReport.score} / 100
                                        </span>
                                    </div>
                                    <p className="text-xs opacity-90 mt-0.5">
                                        Comparison between <span className="font-semibold underline">{diffReport.baseline_name}</span> and <span className="font-semibold underline">{diffReport.current_name}</span>.
                                    </p>
                                </div>
                            </div>

                            {/* Score Bar */}
                            <div className="w-full md:w-48 bg-black/40 rounded-full h-3 border border-white/10 overflow-hidden">
                                <div 
                                    className={cn(
                                        "h-full transition-all duration-500",
                                        diffReport.score >= 80 ? "bg-emerald-500" : diffReport.score >= 50 ? "bg-amber-500" : "bg-rose-500"
                                    )}
                                    style={{ width: `${Math.max(5, diffReport.score)}%` }}
                                />
                            </div>
                        </div>

                        {/* ── AI Root-Cause Analysis & External LLM Export Toolbar ── */}
                        <div className="bg-slate-900/80 border border-slate-700/80 rounded-xl p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                            {/* Left: On-Demand AI Root-Cause Analysis (if API key configured) */}
                            <div className="flex flex-wrap items-center gap-2.5">
                                <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-300">
                                    <Sparkles className="w-4 h-4 text-indigo-400" />
                                    <span>AI Root-Cause Analysis</span>
                                </div>

                                {aiConfig?.hasKey && availableAiModels.length > 0 ? (
                                    <>
                                        <select
                                            value={selectedAiModel}
                                            onChange={(e) => setSelectedAiModel(e.target.value)}
                                            disabled={aiAnalyzing}
                                            className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                        >
                                            {availableAiModels.map((m) => (
                                                <option key={m.id} value={m.id}>
                                                    {m.name} ({m.provider === 'deepseek' ? 'DeepSeek' : 'Anthropic'})
                                                </option>
                                            ))}
                                        </select>
                                        <button
                                            onClick={handleAnalyzeWithAi}
                                            disabled={aiAnalyzing}
                                            className={cn(
                                                "px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 border",
                                                aiAnalyzing
                                                    ? "bg-indigo-950/50 text-indigo-300 border-indigo-500/30 cursor-wait"
                                                    : "bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500 shadow-sm hover:shadow-indigo-500/20"
                                            )}
                                        >
                                            <Bot className={cn("w-3.5 h-3.5", aiAnalyzing && "animate-pulse")} />
                                            {aiAnalyzing ? "Generating AI Verdict..." : aiAnalysis ? "Re-Analyze with AI" : "Analyze with AI"}
                                        </button>
                                    </>
                                ) : (
                                    <span className="text-[11px] text-slate-400 bg-slate-800/80 border border-slate-700/70 px-2.5 py-1 rounded-md">
                                        No LLM API key configured in AI Settings — use Copy Prompt or Export below for ChatGPT / Perplexity
                                    </span>
                                )}
                            </div>

                            {/* Right: Export Compare for External LLMs (ChatGPT / Perplexity / Claude) */}
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[11px] text-slate-400 font-medium mr-1">
                                    Export Compare:
                                </span>
                                <button
                                    onClick={() => copyTextToClipboard(buildDiffLlmMarkdown(diffReport), "Compare Prompt (Markdown) for ChatGPT / Perplexity")}
                                    title="Copy structured prompt + full ChangeGuard diff report for ChatGPT, Perplexity, or Claude"
                                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-violet-600/20 hover:bg-violet-600/30 text-violet-200 border border-violet-500/30 transition flex items-center gap-1.5"
                                >
                                    <Copy className="w-3.5 h-3.5 text-violet-400" />
                                    Copy Prompt (ChatGPT / Perplexity)
                                </button>
                                <button
                                    onClick={() => {
                                        const safeBase = (diffReport.baseline_name || 'baseline').replace(/[^a-zA-Z0-9_-]/g, '_');
                                        const safeCurr = (diffReport.current_name || 'target').replace(/[^a-zA-Z0-9_-]/g, '_');
                                        downloadFile(
                                            `changeguard-diff-${safeBase}-vs-${safeCurr}.md`,
                                            buildDiffLlmMarkdown(diffReport),
                                            'text/markdown;charset=utf-8'
                                        );
                                        toast.success('Downloaded ChangeGuard Diff (.md)');
                                    }}
                                    title="Download Markdown report with LLM instructions"
                                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1.5"
                                >
                                    <FileText className="w-3.5 h-3.5 text-cyan-400" />
                                    Export .md
                                </button>
                                <button
                                    onClick={() => {
                                        const safeBase = (diffReport.baseline_name || 'baseline').replace(/[^a-zA-Z0-9_-]/g, '_');
                                        const safeCurr = (diffReport.current_name || 'target').replace(/[^a-zA-Z0-9_-]/g, '_');
                                        downloadFile(
                                            `changeguard-diff-${safeBase}-vs-${safeCurr}.json`,
                                            JSON.stringify(diffReport, null, 2),
                                            'application/json;charset=utf-8'
                                        );
                                        toast.success('Downloaded ChangeGuard Diff (.json)');
                                    }}
                                    title="Download raw Diff JSON"
                                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1.5"
                                >
                                    <Download className="w-3.5 h-3.5 text-emerald-400" />
                                    Export .json
                                </button>
                            </div>
                        </div>

                        {/* ── AI Executive Analysis Result Card ── */}
                        {aiAnalysis && (
                            <div className="bg-gradient-to-br from-indigo-950/40 via-slate-900/95 to-violet-950/30 border border-indigo-500/40 rounded-xl p-4 space-y-3 shadow-lg animate-in fade-in duration-200">
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-500/20 pb-2.5">
                                    <div className="flex items-center gap-2">
                                        <Sparkles className="w-4 h-4 text-indigo-400" />
                                        <span className="text-xs font-bold uppercase tracking-wider text-indigo-200">
                                            AI Root-Cause & Rollback Verdict
                                        </span>
                                        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                            {aiAnalysis.provider === 'anthropic' ? 'Anthropic' : 'DeepSeek'} · {aiAnalysis.model}
                                        </span>
                                        {aiAnalysis.durationMs !== undefined && (
                                            <span className="text-[11px] text-slate-400 font-mono">
                                                {(aiAnalysis.durationMs / 1000).toFixed(1)}s
                                                {aiAnalysis.usage?.totalTokens ? ` · ${aiAnalysis.usage.totalTokens} tokens` : ''}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => copyTextToClipboard(aiAnalysis.analysis, "AI Executive Analysis")}
                                            className="px-2 py-1 text-[11px] font-medium bg-slate-800/80 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 flex items-center gap-1"
                                        >
                                            <Copy className="w-3 h-3 text-indigo-400" />
                                            Copy Analysis
                                        </button>
                                        <button
                                            onClick={() => setAiAnalysis(null)}
                                            className="p-1 text-slate-400 hover:text-slate-200 rounded"
                                            title="Dismiss AI analysis"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>

                                {aiAnalysis.reasoning && (
                                    <details className="text-xs bg-slate-950/60 border border-slate-800 rounded-lg p-2.5 text-slate-400">
                                        <summary className="cursor-pointer font-semibold text-slate-300 select-none">
                                            View DeepSeek R1 Chain-of-Thought Reasoning
                                        </summary>
                                        <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-slate-400 leading-relaxed">
                                            {aiAnalysis.reasoning}
                                        </pre>
                                    </details>
                                )}

                                <div className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed font-sans bg-slate-950/40 border border-slate-800/80 rounded-lg p-3.5">
                                    {aiAnalysis.analysis}
                                </div>
                            </div>
                        )}

                        {/* ── Customer-Centric Executive KPI Cards (5 Pillars) ── */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
                            {/* Pillar 1: SASE Security Posture & Policy Enforcement */}
                            <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-3.5 space-y-2">
                                <div className="flex items-center justify-between text-xs text-slate-400">
                                    <span className="font-semibold flex items-center gap-1.5 text-slate-200">
                                        <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                                        Security Posture
                                    </span>
                                    {diffReport.security?.overallAfter !== undefined ? (
                                        <span className={cn(
                                            "px-1.5 py-0.5 rounded text-[10px] font-bold border",
                                            diffReport.security.overallAfter >= 90
                                                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                                : diffReport.security.overallAfter >= 70
                                                    ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                                                    : "bg-rose-500/15 text-rose-400 border-rose-500/30"
                                        )}>
                                            {diffReport.security.overallAfter >= 90 ? 'ENFORCED' : diffReport.security.overallAfter >= 70 ? 'PARTIAL' : 'EXPOSED'}
                                        </span>
                                    ) : (
                                        <span className="text-[10px] text-slate-500 font-mono">NO DATA</span>
                                    )}
                                </div>
                                {diffReport.security && (diffReport.security.overallBefore !== undefined || diffReport.security.overallAfter !== undefined) ? (
                                    <div className="space-y-1">
                                        <div className="text-lg font-bold font-mono text-white flex items-baseline gap-2">
                                            <span>{diffReport.security.overallBefore !== undefined ? `${diffReport.security.overallBefore}%` : '—'}</span>
                                            <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                                            <span className={cn(
                                                (diffReport.security.overallDelta ?? 0) < 0 ? "text-rose-400" : (diffReport.security.overallDelta ?? 0) > 0 ? "text-emerald-400" : "text-indigo-300"
                                            )}>
                                                {diffReport.security.overallAfter !== undefined ? `${diffReport.security.overallAfter}%` : '—'}
                                            </span>
                                            {diffReport.security.overallDelta !== undefined && diffReport.security.overallDelta !== 0 && (
                                                <span className={cn(
                                                    "text-xs",
                                                    diffReport.security.overallDelta < 0 ? "text-rose-400" : "text-emerald-400"
                                                )}>
                                                    ({diffReport.security.overallDelta > 0 ? `+${diffReport.security.overallDelta}%` : `${diffReport.security.overallDelta}%`})
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-[11px] text-slate-400 font-mono flex items-center justify-between">
                                            <span>URL: {diffReport.security.urlAfter ?? '—'}%</span>
                                            <span>DNS: {diffReport.security.dnsAfter ?? '—'}%</span>
                                            <span>EICAR: {diffReport.security.threatAfter ?? '—'}%</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-xs text-slate-500 pt-1">
                                        No security score history recorded yet.
                                    </div>
                                )}
                            </div>

                            {/* Pillar 2: Voice QoE & MOS */}
                            <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-3.5 space-y-2">
                                <div className="flex items-center justify-between text-xs text-slate-400">
                                    <span className="font-semibold flex items-center gap-1.5 text-slate-200">
                                        <PhoneCall className="w-3.5 h-3.5 text-violet-400" />
                                        Voice QoE (MOS)
                                    </span>
                                    {diffReport.voice && diffReport.voice.avgMosAfter ? (
                                        <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold border", getMosBadgeColor(diffReport.voice.avgMosAfter))}>
                                            {diffReport.voice.avgMosAfter >= 4.0 ? 'EXCELLENT' : diffReport.voice.avgMosAfter >= 3.6 ? 'GOOD' : 'DEGRADED'}
                                        </span>
                                    ) : (
                                        <span className="text-[10px] text-slate-500 font-mono">NO CALLS</span>
                                    )}
                                </div>
                                {diffReport.voice && (diffReport.voice.avgMosBefore || diffReport.voice.avgMosAfter) ? (
                                    <div className="space-y-1">
                                        <div className="text-lg font-bold font-mono text-white flex items-baseline gap-2">
                                            <span>{diffReport.voice.avgMosBefore?.toFixed(2) ?? '—'}</span>
                                            <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                                            <span className={cn(
                                                (diffReport.voice.mosDelta ?? 0) <= -0.2 ? "text-rose-400" : (diffReport.voice.mosDelta ?? 0) >= 0.2 ? "text-emerald-400" : "text-white"
                                            )}>
                                                {diffReport.voice.avgMosAfter?.toFixed(2) ?? '—'}
                                            </span>
                                            {diffReport.voice.mosDelta !== undefined && (
                                                <span className={cn(
                                                    "text-xs",
                                                    diffReport.voice.mosDelta < 0 ? "text-rose-400" : diffReport.voice.mosDelta > 0 ? "text-emerald-400" : "text-slate-400"
                                                )}>
                                                    ({diffReport.voice.mosDelta > 0 ? `+${diffReport.voice.mosDelta.toFixed(2)}` : diffReport.voice.mosDelta.toFixed(2)})
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-[11px] text-slate-400 font-mono flex items-center justify-between">
                                            <span>RTT: {diffReport.voice.avgRttBefore?.toFixed(0) ?? 0} → {diffReport.voice.avgRttAfter?.toFixed(0) ?? 0}ms</span>
                                            <span>Loss: {diffReport.voice.avgLossAfter?.toFixed(1) ?? 0}%</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-xs text-slate-500 pt-1">
                                        No recent RTP voice calls recorded in window.
                                    </div>
                                )}
                            </div>

                            {/* Pillar 3: Digital Experience (DEM Probes) */}
                            <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-3.5 space-y-2">
                                <div className="flex items-center justify-between text-xs text-slate-400">
                                    <span className="font-semibold flex items-center gap-1.5 text-slate-200">
                                        <Activity className="w-3.5 h-3.5 text-cyan-400" />
                                        DEM App Latency
                                    </span>
                                    <span className="text-[10px] font-mono text-slate-400">
                                        {diffReport.dem.total_probes} Probes
                                    </span>
                                </div>
                                <div className="text-lg font-bold font-mono text-white flex items-baseline gap-2">
                                    <span>{(diffReport.dem.avg_baseline_latency_ms ?? 0).toFixed(1)}ms</span>
                                    <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                                    <span className={cn(
                                        diffReport.dem.average_latency_delta_ms > 5 ? "text-rose-400" : diffReport.dem.average_latency_delta_ms < -2 ? "text-emerald-400" : "text-cyan-300"
                                    )}>
                                        {(diffReport.dem.avg_current_latency_ms ?? 0).toFixed(1)}ms
                                    </span>
                                </div>
                                <div className="text-[11px] font-mono flex items-center justify-between">
                                    <span className={cn(diffReport.dem.regressed_probes > 0 ? "text-rose-400 font-semibold" : "text-slate-400")}>
                                        {diffReport.dem.regressed_probes} degraded
                                    </span>
                                    <span className={cn(diffReport.dem.improved_probes > 0 ? "text-emerald-400 font-semibold" : "text-slate-400")}>
                                        {diffReport.dem.improved_probes} improved
                                    </span>
                                </div>
                            </div>

                            {/* Pillar 4: SD-WAN Overlay & SASE Service Links */}
                            <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-3.5 space-y-2">
                                <div className="flex items-center justify-between text-xs text-slate-400">
                                    <span className="font-semibold flex items-center gap-1.5 text-slate-200">
                                        <Globe className="w-3.5 h-3.5 text-emerald-400" />
                                        SD-WAN & SASE Overlay
                                    </span>
                                    <span className="text-[10px] font-mono text-emerald-400">
                                        {diffReport.tunnels.total_current - diffReport.tunnels.down_now}/{diffReport.tunnels.total_current} Mesh
                                    </span>
                                </div>
                                <div className="text-lg font-bold font-mono text-white flex items-baseline gap-2">
                                    <span>{diffReport.sdwan?.online_baseline ?? 0}/{diffReport.sdwan?.total_baseline ?? 0}</span>
                                    <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                                    <span className="text-emerald-400">
                                        {diffReport.sdwan?.online_current ?? 0}/{diffReport.sdwan?.total_current ?? 0} Sites
                                    </span>
                                </div>
                                <div className="text-[11px] text-slate-400 font-mono flex items-center justify-between">
                                    <span>
                                        SASE IPsec: {diffReport.sdwan?.sase_links_up_baseline ?? 0} → {diffReport.sdwan?.sase_links_up_current ?? 0}/{diffReport.sdwan?.sase_links_total ?? 0} UP
                                    </span>
                                </div>
                            </div>

                            {/* Pillar 5: VyOS Underlay & WAN QoS Impairments */}
                            <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-3.5 space-y-2">
                                <div className="flex items-center justify-between text-xs text-slate-400">
                                    <span className="font-semibold flex items-center gap-1.5 text-slate-200">
                                        <Sliders className="w-3.5 h-3.5 text-amber-400" />
                                        Underlay & QoS
                                    </span>
                                    <span className="text-[10px] font-mono text-slate-400">
                                        {diffReport.vyos?.routersOnlineAfter ?? 0}/{diffReport.vyos?.routersTotalAfter ?? 0} VyOS
                                    </span>
                                </div>
                                <div className="text-lg font-bold font-mono text-white flex items-baseline gap-2">
                                    <span>{diffReport.vyos?.impairmentsBefore ?? 0}</span>
                                    <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                                    <span className={cn(
                                        (diffReport.vyos?.impairmentsAfter ?? 0) > (diffReport.vyos?.impairmentsBefore ?? 0)
                                            ? "text-amber-400"
                                            : "text-emerald-400"
                                    )}>
                                        {diffReport.vyos?.impairmentsAfter ?? 0} Impairments
                                    </span>
                                </div>
                                <div className="text-[11px] text-slate-400 font-mono">
                                    Blackholes: {diffReport.vyos?.blackholesBefore?.length ?? 0} → {diffReport.vyos?.blackholesAfter?.length ?? 0}
                                </div>
                            </div>
                        </div>

                        {/* Regressions or Improvements list */}
                        {(diffReport.critical_regressions.length > 0 || diffReport.improvements.length > 0) && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {diffReport.critical_regressions.length > 0 && (
                                    <div className="bg-rose-950/20 border border-rose-500/20 rounded-lg p-4 space-y-2">
                                        <div className="text-xs font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                                            <TrendingDown className="w-4 h-4" />
                                            Regressions Detected ({diffReport.critical_regressions.length})
                                        </div>
                                        <ul className="text-xs text-rose-300 space-y-1 pl-4 list-disc">
                                            {diffReport.critical_regressions.map((reg, idx) => (
                                                <li key={idx}>{reg}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {diffReport.improvements.length > 0 && (
                                    <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-lg p-4 space-y-2">
                                        <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                                            <TrendingUp className="w-4 h-4" />
                                            Improvements Detected ({diffReport.improvements.length})
                                        </div>
                                        <ul className="text-xs text-emerald-300 space-y-1 pl-4 list-disc">
                                            {diffReport.improvements.map((imp, idx) => (
                                                <li key={idx}>{imp}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="space-y-4">
                            {/* ── 0. SASE Security Posture & Policy Enforcement Deltas ── */}
                            {diffReport.security && (diffReport.security.overallBefore !== undefined || diffReport.security.overallAfter !== undefined || (diffReport.security.categories?.length ?? 0) > 0) && (
                                <div className="bg-slate-900/80 border border-indigo-500/30 rounded-lg overflow-hidden">
                                    <div className="px-4 py-3 bg-indigo-950/20 border-b border-indigo-500/20 text-xs font-bold text-indigo-200 flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <ShieldCheck className="w-4 h-4 text-indigo-400" />
                                            SASE Security Posture & Policy Enforcement (URL Filtering / DNS Security / Threat & EICAR / C2 / AI Security)
                                        </div>
                                        <div className="flex items-center gap-4 text-[11px] font-normal text-slate-300 font-mono">
                                            <span>
                                                Overall Score: <strong className="text-white">{diffReport.security.overallBefore ?? '—'}% → {diffReport.security.overallAfter ?? '—'}%</strong>
                                                {diffReport.security.overallDelta !== undefined && diffReport.security.overallDelta !== 0 && (
                                                    <span className={cn("ml-1.5 font-bold", diffReport.security.overallDelta < 0 ? "text-rose-400" : "text-emerald-400")}>
                                                        ({diffReport.security.overallDelta > 0 ? `+${diffReport.security.overallDelta}%` : `${diffReport.security.overallDelta}%`})
                                                    </span>
                                                )}
                                            </span>
                                            {(diffReport.security.totalBefore !== undefined || diffReport.security.totalAfter !== undefined) && (
                                                <span>
                                                    Protected Categories: <strong className="text-indigo-300">{diffReport.security.protectedBefore ?? 0}/{diffReport.security.totalBefore ?? 0} → {diffReport.security.protectedAfter ?? 0}/{diffReport.security.totalAfter ?? 0}</strong>
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* 5 Pillar Score Cards */}
                                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 p-3.5 bg-slate-950/40 border-b border-slate-800/70">
                                        {[
                                            { label: 'URL Filtering', before: diffReport.security.urlBefore, after: diffReport.security.urlAfter, delta: diffReport.security.urlDelta },
                                            { label: 'DNS Security', before: diffReport.security.dnsBefore, after: diffReport.security.dnsAfter, delta: diffReport.security.dnsDelta },
                                            { label: 'Threat / EICAR', before: diffReport.security.threatBefore, after: diffReport.security.threatAfter, delta: diffReport.security.threatDelta },
                                            { label: 'C2 Detection', before: diffReport.security.c2Before, after: diffReport.security.c2After, delta: diffReport.security.c2Delta },
                                            { label: 'AI Security', before: diffReport.security.aiBefore, after: diffReport.security.aiAfter, delta: diffReport.security.aiDelta }
                                        ].map(pillar => (
                                            <div key={pillar.label} className="bg-slate-900/90 border border-slate-800 rounded-lg px-3 py-2 space-y-1">
                                                <div className="text-[11px] font-semibold text-slate-400">{pillar.label}</div>
                                                <div className="text-sm font-bold font-mono text-white flex items-baseline gap-1.5">
                                                    <span>{pillar.before !== undefined ? `${pillar.before}%` : '—'}</span>
                                                    <span className="text-slate-500">→</span>
                                                    <span className={cn(
                                                        (pillar.delta ?? 0) < 0 ? "text-rose-400" : (pillar.delta ?? 0) > 0 ? "text-emerald-400" : (pillar.after ?? 100) < 80 ? "text-amber-400" : "text-emerald-400"
                                                    )}>
                                                        {pillar.after !== undefined ? `${pillar.after}%` : '—'}
                                                    </span>
                                                    {pillar.delta !== undefined && pillar.delta !== 0 && (
                                                        <span className={cn("text-[10px]", pillar.delta < 0 ? "text-rose-400" : "text-emerald-400")}>
                                                            ({pillar.delta > 0 ? `+${pillar.delta}%` : `${pillar.delta}%`})
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Category-level policy enforcement table (if category tests were recorded) */}
                                    {diffReport.security.categories && diffReport.security.categories.length > 0 && (
                                        <div className="overflow-x-auto max-h-[340px]">
                                            <table className="w-full text-left text-xs text-slate-300">
                                                <thead className="bg-slate-800/60 text-slate-400 font-semibold border-b border-slate-700/50 sticky top-0">
                                                    <tr>
                                                        <th className="px-4 py-2">Security Pillar</th>
                                                        <th className="px-4 py-2">Category / Threat Vector</th>
                                                        <th className="px-4 py-2">Baseline Verdict</th>
                                                        <th className="px-4 py-2">Target Verdict</th>
                                                        <th className="px-4 py-2">Policy Enforcement Delta</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-800/60 font-mono">
                                                    {diffReport.security.categories.map(cat => (
                                                        <tr key={`${cat.type}:${cat.id}`} className={cn(
                                                            "hover:bg-slate-800/30 transition",
                                                            cat.state === 'REGRESSED' && "bg-rose-950/20 text-rose-200",
                                                            cat.state === 'IMPROVED' && "bg-emerald-950/20 text-emerald-200"
                                                        )}>
                                                            <td className="px-4 py-2">
                                                                <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-[10px] font-bold uppercase">
                                                                    {cat.type}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-2 font-sans font-medium text-slate-200">{cat.name}</td>
                                                            <td className="px-4 py-2">
                                                                <span className={cn(
                                                                    "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                                                                    cat.protectedBefore ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                                                                )}>
                                                                    {cat.statusBefore}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-2">
                                                                <span className={cn(
                                                                    "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                                                                    cat.protectedAfter ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                                                                )}>
                                                                    {cat.statusAfter}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-2 font-sans">
                                                                {cat.state === 'REGRESSED' ? (
                                                                    <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-bold">
                                                                        CRITICAL BYPASS (PROTECTED → EXPOSED)
                                                                    </span>
                                                                ) : cat.state === 'IMPROVED' ? (
                                                                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                                                                        REMEDIATED (EXPOSED → PROTECTED)
                                                                    </span>
                                                                ) : cat.state === 'STABLE_PROTECTED' ? (
                                                                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px]">
                                                                        ENFORCED
                                                                    </span>
                                                                ) : cat.state === 'STABLE_EXPOSED' ? (
                                                                    <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[10px]">
                                                                        ALLOWED / UNBLOCKED
                                                                    </span>
                                                                ) : (
                                                                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">
                                                                        {cat.state}
                                                                    </span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── 1. Voice & RTP Collaboration QoE Deltas ── */}
                            {diffReport.voice && diffReport.voice.targets && diffReport.voice.targets.length > 0 && (
                                <div className="bg-slate-900/80 border border-slate-700/80 rounded-lg overflow-hidden">
                                    <div className="px-4 py-3 bg-slate-800/70 border-b border-slate-700 text-xs font-bold text-slate-200 flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <PhoneCall className="w-4 h-4 text-violet-400" />
                                            Voice & RTP Collaboration QoE (MOS / RTT / Jitter / Loss)
                                        </div>
                                        <div className="flex items-center gap-4 text-[11px] font-normal text-slate-400 font-mono">
                                            <span>Calls Sampled: <strong className="text-slate-200">{diffReport.voice.sampleCountBefore} → {diffReport.voice.sampleCountAfter}</strong></span>
                                            <span>Global MOS: <strong className="text-violet-300">{diffReport.voice.avgMosBefore?.toFixed(2) ?? '—'} → {diffReport.voice.avgMosAfter?.toFixed(2) ?? '—'}</strong></span>
                                        </div>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs text-slate-300">
                                            <thead className="bg-slate-800/40 text-slate-400 font-semibold border-b border-slate-700/50">
                                                <tr>
                                                    <th className="px-4 py-2.5">Voice Target / Server</th>
                                                    <th className="px-4 py-2.5">Codec</th>
                                                    <th className="px-4 py-2.5">Baseline MOS</th>
                                                    <th className="px-4 py-2.5">Target MOS</th>
                                                    <th className="px-4 py-2.5">Δ MOS</th>
                                                    <th className="px-4 py-2.5">RTP RTT (Before → After)</th>
                                                    <th className="px-4 py-2.5">RTP Jitter</th>
                                                    <th className="px-4 py-2.5">Packet Loss</th>
                                                    <th className="px-4 py-2.5">Verdict</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-800/60 font-mono">
                                                {diffReport.voice.targets.map(vt => (
                                                    <tr key={vt.target} className={cn(
                                                        "hover:bg-slate-800/30 transition",
                                                        vt.state === 'REGRESSED' && "bg-rose-950/15 text-rose-200",
                                                        vt.state === 'IMPROVED' && "bg-emerald-950/15 text-emerald-200"
                                                    )}>
                                                        <td className="px-4 py-2.5 font-sans font-semibold text-slate-200">{vt.target}</td>
                                                        <td className="px-4 py-2.5">
                                                            <span className="px-2 py-0.5 rounded bg-violet-500/10 text-violet-300 border border-violet-500/20 text-[10px]">
                                                                {vt.codec || 'G.711'}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-2.5">{vt.mosBefore !== undefined ? vt.mosBefore.toFixed(2) : '—'}</td>
                                                        <td className="px-4 py-2.5 font-bold">{vt.mosAfter !== undefined ? vt.mosAfter.toFixed(2) : '—'}</td>
                                                        <td className={cn(
                                                            "px-4 py-2.5 font-bold",
                                                            (vt.mosDelta ?? 0) < -0.1 ? "text-rose-400" : (vt.mosDelta ?? 0) > 0.1 ? "text-emerald-400" : "text-slate-400"
                                                        )}>
                                                            {vt.mosDelta !== undefined ? (vt.mosDelta > 0 ? `+${vt.mosDelta.toFixed(2)}` : vt.mosDelta.toFixed(2)) : '0.00'}
                                                        </td>
                                                        <td className="px-4 py-2.5">
                                                            {vt.rttBefore?.toFixed(1) ?? '0.0'} ms → {vt.rttAfter?.toFixed(1) ?? '0.0'} ms
                                                            {vt.rttDeltaMs !== undefined && vt.rttDeltaMs !== 0 && (
                                                                <span className={cn("ml-1.5 text-[10px]", vt.rttDeltaMs > 10 ? "text-rose-400" : "text-slate-400")}>
                                                                    ({vt.rttDeltaMs > 0 ? `+${vt.rttDeltaMs.toFixed(1)}` : vt.rttDeltaMs.toFixed(1)} ms)
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-2.5">
                                                            {vt.jitterBefore?.toFixed(1) ?? '0.0'} → {vt.jitterAfter?.toFixed(1) ?? '0.0'} ms
                                                        </td>
                                                        <td className={cn(
                                                            "px-4 py-2.5",
                                                            (vt.lossAfter ?? 0) > (vt.lossBefore ?? 0) ? "text-rose-400 font-bold" : "text-slate-400"
                                                        )}>
                                                            {vt.lossBefore?.toFixed(1) ?? '0'}% → {vt.lossAfter?.toFixed(1) ?? '0'}%
                                                        </td>
                                                        <td className="px-4 py-2.5 font-sans">
                                                            {vt.state === 'REGRESSED' ? (
                                                                <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-bold">DEGRADED</span>
                                                            ) : vt.state === 'IMPROVED' ? (
                                                                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">IMPROVED</span>
                                                            ) : (
                                                                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">STABLE</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* ── 2. VyOS Underlay & WAN QoS / Chaos Impairments ── */}
                            {diffReport.vyos && diffReport.vyos.interfaceDeltas && diffReport.vyos.interfaceDeltas.length > 0 && (
                                <div className="bg-slate-900/80 border border-amber-500/30 rounded-lg overflow-hidden">
                                    <div className="px-4 py-3 bg-amber-950/20 border-b border-amber-500/20 text-xs font-bold text-amber-200 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Sliders className="w-4 h-4 text-amber-400" />
                                            VyOS Underlay & WAN QoS / Impairment Deltas ({diffReport.vyos.interfaceDeltas.length} interfaces with active or changed impairments)
                                        </div>
                                        <span className="text-[11px] font-mono text-amber-300">
                                            Active Impairments: {diffReport.vyos.impairmentsBefore} → {diffReport.vyos.impairmentsAfter}
                                        </span>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs text-slate-300">
                                            <thead className="bg-slate-800/40 text-slate-400 font-semibold border-b border-slate-700/50">
                                                <tr>
                                                    <th className="px-4 py-2.5">VyOS Router</th>
                                                    <th className="px-4 py-2.5">Interface / Circuit</th>
                                                    <th className="px-4 py-2.5">Link State</th>
                                                    <th className="px-4 py-2.5">Injected Latency (Before → After)</th>
                                                    <th className="px-4 py-2.5">Injected Packet Loss (Before → After)</th>
                                                    <th className="px-4 py-2.5">Delta Status</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-800/60 font-mono">
                                                {diffReport.vyos.interfaceDeltas.map((id, idx) => (
                                                    <tr key={`${id.routerId}-${id.interfaceName}-${idx}`} className={cn(
                                                        "hover:bg-slate-800/30 transition",
                                                        id.changed && "bg-amber-950/15"
                                                    )}>
                                                        <td className="px-4 py-2.5 font-sans font-semibold text-slate-200">{id.routerName}</td>
                                                        <td className="px-4 py-2.5">
                                                            <span className="text-slate-200 font-bold">{id.interfaceName}</span>
                                                            {id.description && <span className="ml-2 text-slate-400 font-sans text-[11px]">({id.description})</span>}
                                                        </td>
                                                        <td className="px-4 py-2.5">
                                                            <span className={cn(
                                                                "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase",
                                                                id.statusBefore === 'up' ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                                                            )}>{id.statusBefore}</span>
                                                            <span className="mx-1.5 text-slate-500">→</span>
                                                            <span className={cn(
                                                                "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase",
                                                                id.statusAfter === 'up' ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                                                            )}>{id.statusAfter}</span>
                                                        </td>
                                                        <td className="px-4 py-2.5">
                                                            {id.latencyBeforeMs} ms → <strong className={cn(id.latencyAfterMs > 0 ? "text-amber-400" : "text-slate-300")}>{id.latencyAfterMs} ms</strong>
                                                            {id.latencyDeltaMs !== 0 && (
                                                                <span className={cn("ml-1.5 text-[10px] font-bold", id.latencyDeltaMs > 0 ? "text-rose-400" : "text-emerald-400")}>
                                                                    ({id.latencyDeltaMs > 0 ? `+${id.latencyDeltaMs}` : id.latencyDeltaMs} ms)
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-2.5">
                                                            {id.lossBeforePct}% → <strong className={cn(id.lossAfterPct > 0 ? "text-rose-400" : "text-slate-300")}>{id.lossAfterPct}%</strong>
                                                            {id.lossDeltaPct !== 0 && (
                                                                <span className={cn("ml-1.5 text-[10px] font-bold", id.lossDeltaPct > 0 ? "text-rose-400" : "text-emerald-400")}>
                                                                    ({id.lossDeltaPct > 0 ? `+${id.lossDeltaPct}` : id.lossDeltaPct}%)
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-2.5 font-sans">
                                                            {id.changed ? (
                                                                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold">MODIFIED</span>
                                                            ) : (
                                                                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">ACTIVE IMPAIRMENT</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* ── 3. SD-WAN Overlay (Prisma SD-WAN Sites, ION Devices, WAN Circuits & SASE Links) ── */}
                            {diffReport.sdwan && diffReport.sdwan.sites && diffReport.sdwan.sites.length > 0 && (
                                <div className="bg-slate-900/80 border border-slate-700/80 rounded-lg overflow-hidden">
                                    <div className="px-4 py-3 bg-slate-800/70 border-b border-slate-700 text-xs font-bold text-slate-200 flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <Globe className="w-4 h-4 text-emerald-400" />
                                            SD-WAN Overlay (Prisma SD-WAN Sites, WAN Circuits & SASE IPsec Tunnels) ({diffReport.sdwan.sites.length} sites)
                                        </div>
                                        <div className="flex items-center gap-4 text-[11px] font-normal text-slate-400 font-mono">
                                            <span>Sites Online: <strong className="text-slate-200">{diffReport.sdwan.online_baseline}/{diffReport.sdwan.total_baseline}</strong> → <strong className={cn(diffReport.sdwan.online_current < diffReport.sdwan.online_baseline ? "text-rose-400 font-bold" : "text-emerald-400")}>{diffReport.sdwan.online_current}/{diffReport.sdwan.total_current}</strong></span>
                                            {(diffReport.sdwan.sase_links_total ?? 0) > 0 && (
                                                <span>SASE Tunnels: <strong className="text-cyan-300">{diffReport.sdwan.sase_links_up_baseline}/{diffReport.sdwan.sase_links_total} → {diffReport.sdwan.sase_links_up_current}/{diffReport.sdwan.sase_links_total} UP</strong></span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs text-slate-300">
                                            <thead className="bg-slate-800/40 text-slate-400 font-semibold border-b border-slate-700/50">
                                                <tr>
                                                    <th className="px-4 py-2.5">Site / Role</th>
                                                    <th className="px-4 py-2.5">ION Device(s)</th>
                                                    <th className="px-4 py-2.5">WAN Circuits (Before → After)</th>
                                                    <th className="px-4 py-2.5">SASE Service Links</th>
                                                    <th className="px-4 py-2.5">Site Status</th>
                                                    <th className="px-4 py-2.5">Verdict</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-800/60 font-mono">
                                                {diffReport.sdwan.sites.map(site => {
                                                    const isSiteRegressed = site.stateChange === 'DISCONNECTED' || site.stateChange === 'DEGRADED' || site.deviceChanges.some(d => d.stateChange === 'DISCONNECTED' || d.stateChange === 'DEGRADED_LINKS');
                                                    const isSiteImproved = site.stateChange === 'RECONNECTED' || site.stateChange === 'IMPROVED' || site.deviceChanges.some(d => d.stateChange === 'RECONNECTED' || d.stateChange === 'IMPROVED_LINKS');
                                                    return (
                                                        <tr key={site.siteId || site.siteName} className={cn(
                                                            "hover:bg-slate-800/30 transition",
                                                            isSiteRegressed && "bg-rose-950/20 text-rose-300",
                                                            isSiteImproved && "bg-emerald-950/20 text-emerald-300"
                                                        )}>
                                                            <td className="px-4 py-2.5 font-sans">
                                                                <div className="font-semibold text-slate-200">{site.siteName}</div>
                                                                <span className="text-[10px] text-slate-400 uppercase font-mono">{site.role}</span>
                                                            </td>
                                                            <td className="px-4 py-2.5 font-sans text-xs">
                                                                {site.deviceChanges.length === 0 ? (
                                                                    <span className="text-slate-500 italic">No ION mapped</span>
                                                                ) : (
                                                                    <div className="space-y-1">
                                                                        {site.deviceChanges.map(dev => (
                                                                            <div key={dev.deviceId || dev.deviceName} className="flex items-center gap-2">
                                                                                <Server className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                                                                <span className="font-medium text-slate-200">{dev.deviceName}</span>
                                                                                {dev.model && <span className="text-[10px] text-slate-500">({dev.model})</span>}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-2.5">
                                                                {site.deviceChanges.map(dev => (
                                                                    <div key={dev.deviceId || dev.deviceName}>
                                                                        {dev.wanUpBefore ?? 0}/{dev.wanTotal ?? 0} → <strong className={cn((dev.wanUpAfter ?? 0) < (dev.wanUpBefore ?? 0) ? "text-rose-400" : "text-emerald-400")}>{dev.wanUpAfter ?? 0}/{dev.wanTotal ?? 0} UP</strong>
                                                                    </div>
                                                                ))}
                                                            </td>
                                                            <td className="px-4 py-2.5">
                                                                {site.deviceChanges.map(dev => (
                                                                    <div key={dev.deviceId || dev.deviceName}>
                                                                        {(dev.serviceLinksTotal ?? 0) > 0 ? (
                                                                            <span>
                                                                                {dev.serviceLinksUpBefore ?? 0}/{dev.serviceLinksTotal} → <strong className={cn((dev.serviceLinksUpAfter ?? 0) < (dev.serviceLinksUpBefore ?? 0) ? "text-rose-400" : "text-cyan-300")}>{dev.serviceLinksUpAfter ?? 0}/{dev.serviceLinksTotal} UP</strong>
                                                                            </span>
                                                                        ) : (
                                                                            <span className="text-slate-500">—</span>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </td>
                                                            <td className="px-4 py-2.5">
                                                                <span className={cn(
                                                                    "px-2 py-0.5 rounded text-[10px] font-bold",
                                                                    site.connectedBefore ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                                                                )}>
                                                                    {site.connectedBefore ? 'ONLINE' : 'OFFLINE'}
                                                                </span>
                                                                <span className="mx-1.5 text-slate-500">→</span>
                                                                <span className={cn(
                                                                    "px-2 py-0.5 rounded text-[10px] font-bold",
                                                                    site.connectedAfter ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                                                                )}>
                                                                    {site.connectedAfter ? 'ONLINE' : 'OFFLINE'}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-2.5 font-sans">
                                                                {isSiteRegressed ? (
                                                                    <span className="text-rose-400 font-bold flex items-center gap-1">
                                                                        <XCircle className="w-3.5 h-3.5" /> DEGRADED
                                                                    </span>
                                                                ) : isSiteImproved ? (
                                                                    <span className="text-emerald-400 font-bold flex items-center gap-1">
                                                                        <CheckCircle className="w-3.5 h-3.5" /> RECOVERED
                                                                    </span>
                                                                ) : (
                                                                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">STABLE</span>
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

                            {/* ── 4. Digital Experience (DEM) Path Matrix Deltas ── */}
                            <div className="bg-slate-900/80 border border-slate-700/80 rounded-lg overflow-hidden">
                                <div className="px-4 py-3 bg-slate-800/70 border-b border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-3">
                                    <div className="text-xs font-bold text-slate-200 flex items-center gap-2">
                                        <Activity className="w-4 h-4 text-cyan-400" />
                                        Digital Experience (DEM) Path Matrix Deltas ({filteredDemProbes.length} / {diffReport.dem.total_probes} probes)
                                    </div>

                                    {/* Filter Pills & Search */}
                                    <div className="flex flex-wrap items-center gap-2">
                                        <div className="flex items-center bg-slate-900/90 p-0.5 rounded-lg border border-slate-700 text-[11px]">
                                            {(['ALL', 'CHANGED', 'DEGRADED', 'IMPROVED'] as const).map(f => (
                                                <button
                                                    key={f}
                                                    type="button"
                                                    onClick={() => setDemFilter(f)}
                                                    className={cn(
                                                        "px-2.5 py-1 rounded-md font-medium transition",
                                                        demFilter === f
                                                            ? "bg-indigo-600 text-white"
                                                            : "text-slate-400 hover:text-slate-200"
                                                    )}
                                                >
                                                    {f === 'ALL' && `All (${diffReport.dem.total_probes})`}
                                                    {f === 'CHANGED' && 'Changed'}
                                                    {f === 'DEGRADED' && `Degraded (${diffReport.dem.regressed_probes})`}
                                                    {f === 'IMPROVED' && `Improved (${diffReport.dem.improved_probes})`}
                                                </button>
                                            ))}
                                        </div>

                                        <div className="relative">
                                            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                                            <input
                                                type="text"
                                                value={demSearch}
                                                onChange={(e) => setDemSearch(e.target.value)}
                                                placeholder="Filter probe or target..."
                                                className="bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:ring-1 focus:ring-indigo-500 w-48"
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="overflow-x-auto max-h-[520px]">
                                    <table className="w-full text-left text-xs text-slate-300">
                                        <thead className="bg-slate-800/90 text-slate-400 font-semibold border-b border-slate-700/50 sticky top-0 z-10">
                                            <tr>
                                                <th className="px-4 py-2.5">Probe Target</th>
                                                <th className="px-4 py-2.5">Type</th>
                                                <th className="px-4 py-2.5">Score (Before → After)</th>
                                                <th className="px-4 py-2.5">Baseline Latency</th>
                                                <th className="px-4 py-2.5">Target Latency</th>
                                                <th className="px-4 py-2.5">Δ Latency</th>
                                                <th className="px-4 py-2.5">Δ Packet Loss</th>
                                                <th className="px-4 py-2.5">Δ Jitter</th>
                                                <th className="px-4 py-2.5">Verdict</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800/60 font-mono">
                                            {filteredDemProbes.map(p => (
                                                <tr key={p.target_id} className={cn(
                                                    "hover:bg-slate-800/30 transition",
                                                    p.status_regression && "bg-rose-950/15 text-rose-200",
                                                    p.status_improvement && "bg-emerald-950/15 text-emerald-200"
                                                )}>
                                                    <td className="px-4 py-2 font-sans">
                                                        <div className="font-medium text-slate-200">{p.target_label}</div>
                                                        {p.target_url && (
                                                            <div className="text-[10px] text-slate-500 font-mono truncate max-w-[240px]">{p.target_url}</div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-2">
                                                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700 text-[10px]">
                                                            {p.probe_type || 'PING'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-2">
                                                        {p.score_before !== undefined || p.score_after !== undefined ? (
                                                            <span>
                                                                {p.score_before ?? '—'} → <strong className={cn((p.score_after ?? 100) < 70 ? "text-rose-400" : "text-emerald-400")}>{p.score_after ?? '—'}</strong>
                                                            </span>
                                                        ) : (
                                                            <span className="text-slate-500">{p.status_after || 'PASS'}</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-2">
                                                        {p.baseline_latency_ms > 0 ? `${p.baseline_latency_ms.toFixed(1)} ms` : '—'}
                                                    </td>
                                                    <td className="px-4 py-2 font-semibold text-slate-100">
                                                        {p.current_latency_ms > 0 ? `${p.current_latency_ms.toFixed(1)} ms` : '—'}
                                                    </td>
                                                    <td className={cn(
                                                        "px-4 py-2 font-bold",
                                                        p.latency_delta_ms > 5 ? "text-rose-400" : p.latency_delta_ms < -2 ? "text-emerald-400" : "text-slate-300"
                                                    )}>
                                                        {p.latency_delta_ms > 0 ? `+${p.latency_delta_ms.toFixed(1)}` : p.latency_delta_ms.toFixed(1)} ms
                                                        <span className="text-[10px] ml-1 opacity-70">({p.latency_delta_percent > 0 ? `+${p.latency_delta_percent.toFixed(0)}` : p.latency_delta_percent.toFixed(0)}%)</span>
                                                    </td>
                                                    <td className={cn(
                                                        "px-4 py-2",
                                                        p.loss_delta_percent > 0 ? "text-rose-400 font-bold" : p.loss_delta_percent < 0 ? "text-emerald-400 font-bold" : "text-slate-400"
                                                    )}>
                                                        {p.loss_delta_percent > 0 ? `+${p.loss_delta_percent.toFixed(1)}%` : p.loss_delta_percent < 0 ? `${p.loss_delta_percent.toFixed(1)}%` : '0%'}
                                                    </td>
                                                    <td className="px-4 py-2 text-slate-400">
                                                        {p.jitter_delta_ms > 0 ? `+${p.jitter_delta_ms.toFixed(1)}` : p.jitter_delta_ms.toFixed(1)} ms
                                                    </td>
                                                    <td className="px-4 py-2 font-sans">
                                                        {p.status_regression ? (
                                                            <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-bold">DEGRADED</span>
                                                        ) : p.status_improvement ? (
                                                            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">IMPROVED</span>
                                                        ) : (
                                                            <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">UNCHANGED</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* ── 5. Stigix Mesh Peer Tunnels Table ── */}
                            {diffReport.tunnels.comparisons.length > 0 && (
                                <div className="bg-slate-900/80 border border-slate-700/80 rounded-lg overflow-hidden">
                                    <div className="px-4 py-3 bg-slate-800/70 border-b border-slate-700 text-xs font-bold text-slate-200 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Network className="w-4 h-4 text-indigo-400" />
                                            Stigix Mesh Peer Tunnels ({diffReport.tunnels.comparisons.length} peers)
                                        </div>
                                        <div className="text-[11px] font-normal text-slate-400">
                                            Mesh Connectivity: <strong className="text-slate-200">{diffReport.tunnels.comparisons.filter(t => t.current_status?.toUpperCase() === 'UP').length}/{diffReport.tunnels.total_current} UP</strong>
                                        </div>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs text-slate-300">
                                            <thead className="bg-slate-800/40 text-slate-400 font-semibold border-b border-slate-700/50">
                                                <tr>
                                                    <th className="px-4 py-2.5">Peer Site / ID</th>
                                                    <th className="px-4 py-2.5">Endpoint / Private IP</th>
                                                    <th className="px-4 py-2.5">Baseline Status</th>
                                                    <th className="px-4 py-2.5">Target Status</th>
                                                    <th className="px-4 py-2.5">Delta</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-800/60 font-mono">
                                                {diffReport.tunnels.comparisons.map(t => (
                                                    <tr key={t.peer_id} className={cn(
                                                        "hover:bg-slate-800/30 transition",
                                                        t.regression && "bg-rose-950/20 text-rose-300"
                                                    )}>
                                                        <td className="px-4 py-2 font-sans">
                                                            <div className="font-medium text-slate-200">{t.site_name || t.peer_id}</div>
                                                            <div className="text-[10px] text-slate-500 font-mono">{t.peer_id}</div>
                                                        </td>
                                                        <td className="px-4 py-2 text-slate-400 text-[11px]">
                                                            {t.endpoint || t.ip_private || '—'}
                                                        </td>
                                                        <td className="px-4 py-2">
                                                            <span className={cn(
                                                                "px-2 py-0.5 rounded text-[10px] font-bold",
                                                                t.baseline_status?.toUpperCase() === 'UP' ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                                                            )}>
                                                                {t.baseline_status?.toUpperCase() || 'UNKNOWN'}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-2">
                                                            <span className={cn(
                                                                "px-2 py-0.5 rounded text-[10px] font-bold",
                                                                t.current_status?.toUpperCase() === 'UP' ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                                                            )}>
                                                                {t.current_status?.toUpperCase() || 'UNKNOWN'}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-2 font-sans">
                                                            {t.regression ? (
                                                                <span className="text-rose-400 font-bold flex items-center gap-1">
                                                                    <XCircle className="w-3.5 h-3.5" /> CRITICAL: Mesh Peer went DOWN
                                                                </span>
                                                            ) : t.improvement ? (
                                                                <span className="text-emerald-400 font-bold flex items-center gap-1">
                                                                    <CheckCircle className="w-3.5 h-3.5" /> RECOVERED: Mesh Peer came UP
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-500">Unchanged</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* VyOS Underlay Health Regressions */}
                            {diffReport.sdwan?.underlay && (diffReport.sdwan.underlay.offlineRouters?.length || 0) > 0 && (
                                <div className="bg-rose-950/20 border border-rose-500/30 rounded-lg p-4 space-y-2">
                                    <div className="text-xs font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                                        <AlertTriangle className="w-4 h-4" />
                                        VyOS Underlay Regressions Detected
                                    </div>
                                    <p className="text-xs text-rose-200">
                                        Unreachable Underlay Router(s): <strong className="font-mono text-rose-300">{diffReport.sdwan.underlay.offlineRouters?.join(', ')}</strong>
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* ── Section 2: Snapshot Repository & Timeline ── */}
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 shadow-lg backdrop-blur-sm space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <History className="w-5 h-5 text-indigo-400" />
                        <h2 className="text-base font-semibold text-white">Snapshot Catalog</h2>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 font-medium">
                            {snapshots.length} stored
                        </span>
                    </div>
                    <span className="text-xs text-slate-400">
                        Automatic rolling retention (up to 50 snapshots).
                    </span>
                </div>

                {loading ? (
                    <div className="py-12 text-center text-slate-400 text-sm flex flex-col items-center gap-2">
                        <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
                        Loading state snapshots...
                    </div>
                ) : snapshots.length === 0 ? (
                    <div className="py-12 text-center border border-dashed border-slate-700 rounded-xl space-y-3">
                        <ShieldCheck className="w-10 h-10 text-slate-500 mx-auto" />
                        <div className="text-sm font-medium text-slate-300">No snapshots recorded yet</div>
                        <p className="text-xs text-slate-500 max-w-md mx-auto">
                            Capture a baseline snapshot before making SD-WAN routing, QoS, or tunnel changes to enable automated GO/NO-GO validation.
                        </p>
                        <button
                            onClick={openCreateModal}
                            className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg inline-flex items-center gap-1.5"
                        >
                            <Camera className="w-3.5 h-3.5" />
                            Capture First Baseline
                        </button>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs text-slate-300">
                            <thead className="bg-slate-900/60 text-slate-400 uppercase text-[11px] border-b border-slate-700">
                                <tr>
                                    <th className="px-4 py-3">Snapshot Name</th>
                                    <th className="px-4 py-3">Site / Node</th>
                                    <th className="px-4 py-3">Timestamp</th>
                                    <th className="px-4 py-3">SD-WAN & Mesh</th>
                                    <th className="px-4 py-3">DEM Probes</th>
                                    <th className="px-4 py-3">Voice MOS</th>
                                    <th className="px-4 py-3">Security</th>
                                    <th className="px-4 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {snapshots.map((s) => (
                                    <tr key={s.id} className="hover:bg-slate-800/40 transition">
                                        <td className="px-4 py-3">
                                            <div className="font-semibold text-slate-100">{s.name}</div>
                                            {s.description && (
                                                <div className="text-[11px] text-slate-400 mt-0.5">{s.description}</div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-slate-300">{s.node?.site_name || 'Node'}</div>
                                            <div className="text-[10px] text-slate-500 font-mono">{s.node?.hostname}</div>
                                        </td>
                                        <td className="px-4 py-3 text-slate-400 font-mono text-[11px]">
                                            {new Date(s.timestamp).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 space-x-1.5">
                                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                                {s.tunnels_up} / {s.tunnels_count} Mesh
                                            </span>
                                            {(s.sdwan_site_count ?? 0) > 0 && (
                                                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                                                    {s.sdwan_sites_online}/{s.sdwan_site_count} Sites
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                {s.dem_healthy_count} / {s.dem_probes_count} Healthy
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 font-mono">
                                            {s.voice_avg_mos ? (
                                                <span className={cn("px-2 py-0.5 rounded text-[11px] font-bold border", getMosBadgeColor(s.voice_avg_mos))}>
                                                    {s.voice_avg_mos.toFixed(2)} MOS
                                                </span>
                                            ) : (
                                                <span className="text-slate-500 text-[11px]">—</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 font-mono">
                                            {s.security_score !== undefined && s.security_score !== null ? (
                                                <span className={cn(
                                                    "px-2 py-0.5 rounded text-[11px] font-bold border",
                                                    s.security_score >= 85
                                                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                                        : s.security_score >= 60
                                                        ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                                                        : "bg-rose-500/10 text-rose-400 border-rose-500/30"
                                                )}>
                                                    {s.security_score}%
                                                </span>
                                            ) : (
                                                <span className="text-slate-500 text-[11px]">—</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => {
                                                        setBaselineId(s.id);
                                                        toast.success(`Set "${s.name}" as Baseline`);
                                                    }}
                                                    title="Use as Baseline for diff"
                                                    className={cn(
                                                        "px-2 py-1 text-[11px] rounded border transition",
                                                        baselineId === s.id
                                                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-semibold"
                                                            : "bg-slate-800 hover:bg-slate-700 text-indigo-300 border-slate-700"
                                                    )}
                                                >
                                                    Baseline
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setCurrentId(s.id);
                                                        toast.success(`Set "${s.name}" as Target`);
                                                    }}
                                                    title="Use as Target for diff"
                                                    className={cn(
                                                        "px-2 py-1 text-[11px] rounded border transition",
                                                        currentId === s.id
                                                            ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 font-semibold"
                                                            : "bg-slate-800 hover:bg-slate-700 text-cyan-300 border-slate-700"
                                                    )}
                                                >
                                                    Target
                                                </button>
                                                <button
                                                    onClick={() => handleInspectSnapshot(s.id)}
                                                    title="Inspect Snapshot & Copy for AI"
                                                    className="p-1.5 text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700"
                                                >
                                                    <FileJson className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={() => handleDownloadSnapshot(s.id, s.name)}
                                                    title="Download Snapshot (.json)"
                                                    className="p-1.5 text-emerald-400 hover:text-emerald-300 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700"
                                                >
                                                    <Download className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteSnapshot(s.id, s.name)}
                                                    title="Delete snapshot"
                                                    className="p-1.5 text-rose-400 hover:text-rose-300 bg-rose-950/20 hover:bg-rose-900/30 rounded border border-rose-500/30"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ── Modal: Capture Snapshot ── */}
            {showCreateModal && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                            <h3 className="text-base font-semibold text-white flex items-center gap-2">
                                <Camera className="w-4 h-4 text-indigo-400" />
                                Capture State Snapshot
                            </h3>
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="text-slate-400 hover:text-slate-200"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <form onSubmit={handleCreateSnapshot} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                                    <span>Snapshot Name <span className="text-rose-400">*</span></span>
                                    <span className="text-[10px] font-normal text-slate-400 font-mono">Auto-formatted (YYYYMMDD-HHMM-SITE-SEQ)</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. 20261021-1135-BR8-01-baseline"
                                    value={newSnapshotName}
                                    onChange={(e) => setNewSnapshotName(e.target.value)}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 placeholder-slate-500 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                />
                                {/* Quick Preset Tag Pills */}
                                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                    <span className="text-[10px] text-slate-400 flex items-center gap-1 mr-1">
                                        <Tag className="w-3 h-3 text-indigo-400" /> Quick suffix:
                                    </span>
                                    {['baseline', 'pre-change', 'post-change', 'qos-test', 'failover'].map(tag => (
                                        <button
                                            key={tag}
                                            type="button"
                                            onClick={() => applyPresetSuffix(tag)}
                                            className="px-2 py-0.5 text-[10px] font-mono rounded bg-slate-800 hover:bg-indigo-600/30 text-slate-300 hover:text-indigo-200 border border-slate-700 hover:border-indigo-500/40 transition"
                                        >
                                            -{tag}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-300">
                                    Description / Maintenance Notes
                                </label>
                                <textarea
                                    rows={3}
                                    placeholder="e.g. Taken before injecting 25ms latency on BR8 WAN1 or modifying Prisma SD-WAN path policy"
                                    value={newSnapshotDesc}
                                    onChange={(e) => setNewSnapshotDesc(e.target.value)}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>

                            <div className="text-[11px] text-slate-400 bg-slate-800/60 p-3 rounded-lg border border-slate-700/60 space-y-1">
                                <span className="font-semibold text-slate-300">What will be captured:</span>
                                <ul className="list-disc pl-4 space-y-0.5 text-slate-400">
                                    <li><strong>Voice & Collaboration QoE</strong>: MOS score, RTP RTT, jitter & packet loss</li>
                                    <li><strong>SASE Security Posture</strong>: URL Filtering, DNS Security, EICAR, C2 & AI Security enforcement scores</li>
                                    <li><strong>DEM App Probes</strong>: Real-time latency, score, HTTP status & loss across all targets</li>
                                    <li><strong>SD-WAN & SASE Overlay</strong>: Prisma SD-WAN sites, ION WAN circuits, SASE IPsec tunnels & Stigix Mesh</li>
                                    <li><strong>VyOS Underlay & Chaos</strong>: Router reachability, link states, active QoS latency/loss & blackholes</li>
                                </ul>
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowCreateModal(false)}
                                    className="px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 rounded-lg border border-slate-700 transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={actionLoading || !newSnapshotName.trim()}
                                    className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition flex items-center gap-2"
                                >
                                    {actionLoading ? "Capturing..." : "Save Snapshot"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── Modal: Inspect JSON ── */}
            {inspectData && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-3xl w-full p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                            <h3 className="text-base font-semibold text-white flex items-center gap-2">
                                <FileJson className="w-4 h-4 text-indigo-400" />
                                Snapshot Raw JSON ({inspectData.name || inspectData.metadata?.name})
                            </h3>
                            <button
                                onClick={() => setInspectData(null)}
                                className="text-slate-400 hover:text-slate-200"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="overflow-y-auto flex-1 bg-black/50 border border-slate-800 rounded-lg p-4 font-mono text-xs text-emerald-400">
                            <pre>{JSON.stringify(inspectData, null, 2)}</pre>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => copyTextToClipboard(buildSnapshotLlmPrompt(inspectData), "Snapshot Prompt for ChatGPT / Perplexity")}
                                    className="px-3 py-2 text-xs font-semibold bg-violet-600/20 hover:bg-violet-600/30 text-violet-200 rounded-lg border border-violet-500/30 flex items-center gap-1.5 transition"
                                >
                                    <Copy className="w-3.5 h-3.5 text-violet-400" />
                                    Copy Prompt (ChatGPT / Perplexity)
                                </button>
                                <button
                                    onClick={() => copyTextToClipboard(JSON.stringify(inspectData, null, 2), "Snapshot Raw JSON")}
                                    className="px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 flex items-center gap-1.5 transition"
                                >
                                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                                    Copy JSON
                                </button>
                                <button
                                    onClick={() => {
                                        const safeName = (inspectData.name || inspectData.metadata?.name || 'snapshot').replace(/[^a-zA-Z0-9_-]/g, '_');
                                        downloadFile(`stigix-snapshot-${safeName}.json`, JSON.stringify(inspectData, null, 2), 'application/json;charset=utf-8');
                                        toast.success('Downloaded Snapshot (.json)');
                                    }}
                                    className="px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded-lg border border-slate-700 flex items-center gap-1.5 transition"
                                >
                                    <Download className="w-3.5 h-3.5 text-emerald-400" />
                                    Download .json
                                </button>
                            </div>
                            <button
                                onClick={() => setInspectData(null)}
                                className="px-4 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700"
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
