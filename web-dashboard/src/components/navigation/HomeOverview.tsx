import React from 'react';
import {
    Activity, Server, Cloud, Cpu, Layers,
    Zap, RefreshCw, Phone, LineChart,
    Shield, Network, Globe, Gauge, Boxes
} from 'lucide-react';
import { cn } from '../../lib/utils';

import { usePeerContext } from '../../PeerContext';

interface HomeOverviewProps {
    token?: string;
    healthData: any;
    isLoadingHealth?: boolean;
    onRefreshHealth?: () => void;
    registryStatus?: any;
    siteInfo?: any;
    version?: string;
    trafficRunning?: boolean;
    currentRpm?: number;
    saasAppsCount?: number;
    globalVoiceStatus?: any;
    globalConvStatus?: any;
    isLeader?: boolean;
    publicIp?: string | null;
    publicIpCountry?: string | null;
    publicIpInfo?: any;
    gatewayIp?: string | null;
    localIp?: string | null;
    gatewayInfo?: any;
    speedtestResult?: any;
    onRunSpeedtest?: () => void;
    runningSpeedtest?: boolean;
    updateAvailable?: boolean;
    onNavigate: (viewId: string, subTab?: string) => void;
    onOpenDiagnostics?: () => void;
    onOpenNodeRoleModal?: () => void;
}

export const HomeOverview: React.FC<HomeOverviewProps> = ({
    healthData,
    isLoadingHealth,
    onRefreshHealth,
    registryStatus,
    siteInfo,
    version = 'v3.0.0',
    trafficRunning,
    currentRpm = 0,
    saasAppsCount = 67,
    globalVoiceStatus,
    isLeader,
    publicIp,
    publicIpCountry,
    publicIpInfo,
    gatewayIp,
    localIp,
    gatewayInfo,
    speedtestResult,
    onRunSpeedtest,
    runningSpeedtest,
    updateAvailable,
    onNavigate,
    onOpenNodeRoleModal
}) => {
    const { peers, activePeerId, activePeer } = usePeerContext();
    const isRemote = Boolean(activePeerId);
    const leaderPeer = peers.find(p => p.is_leader);
    const leaderSite = leaderPeer?.site || leaderPeer?.instance_id;

    const sub = healthData?.subsystems || {};
    const host = sub.host || {};
    const prisma = sub.prisma || {};
    const mesh = sub.mesh || {};
    const vyos = sub.vyos || {};
    const dem = sub.dem || {};
    const customAppsSub = sub.custom_apps || {};
    const iotSub = sub.iot || {};
    const securitySub = sub.security || {};

    // Simulation Engines Real-time States
    const voiceSub = sub.voice || {};
    const voiceRunning = Boolean(
        voiceSub.active ??
        (globalVoiceStatus?.control?.enabled ?? Boolean(globalVoiceStatus?.activeCalls > 0 || globalVoiceStatus?.running))
    );
    const voiceMos = (() => {
        const raw = voiceSub.mos_score ?? globalVoiceStatus?.avgMos ?? globalVoiceStatus?.stats?.[0]?.mos_score;
        const num = Number(raw);
        return !isNaN(num) && num > 0 ? num.toFixed(2) : '4.38';
    })();
    const voiceLossVal = (() => {
        // 1. Live Call Stats (array of calls identical to Voice.tsx calculation)
        if (Array.isArray(globalVoiceStatus?.stats) && globalVoiceStatus.stats.length > 0) {
            const fin = globalVoiceStatus.stats.filter((c: any) => c.event === 'end' && (c.loss_pct !== undefined || c.loss_percent !== undefined || c.loss !== undefined));
            if (fin.length > 0) {
                return fin.reduce((a: number, c: any) => a + Number(c.loss_pct ?? c.loss_percent ?? c.loss ?? 0), 0) / fin.length;
            }
        }
        // 2. Subsystem values from health matrix
        if (typeof voiceSub.avg_loss_pct === 'number' && voiceSub.avg_loss_pct > 0) {
            return voiceSub.avg_loss_pct;
        }
        if (typeof globalVoiceStatus?.avg_loss_pct === 'number' && globalVoiceStatus.avg_loss_pct > 0) {
            return globalVoiceStatus.avg_loss_pct;
        }
        if (typeof voiceSub.avg_loss_pct === 'number') {
            return voiceSub.avg_loss_pct;
        }
        return 0;
    })();
    const voiceLoss = `${Number(voiceLossVal).toFixed(1)}%`;
    const voiceJitter = voiceSub.avg_jitter_ms ? `${voiceSub.avg_jitter_ms}ms RTT` : '<10ms RTT';

    const cleanLeaderIp = (() => {
        if (registryStatus?.mode === 'leader' || mesh.mode === 'leader') {
            const selfIp = registryStatus?.detected_ip || localIp || (mesh.leader_ip && mesh.leader_ip !== 'Local Leader' ? mesh.leader_ip : null);
            if (selfIp) {
                return String(selfIp).includes('(Self)') ? String(selfIp) : `${selfIp} (Self)`;
            }
            return 'Local Leader';
        }
        const raw = mesh.leader_ip || registryStatus?.leader_info?.ip || registryStatus?.static_leader_url || (mesh.status === 'connected' ? (leaderSite || 'Connected') : '—');
        if (typeof raw === 'string' && (raw.startsWith('http://') || raw.startsWith('https://'))) {
            try {
                const parsed = new URL(raw);
                return parsed.hostname || parsed.host || raw;
            } catch {
                return raw.replace(/^https?:\/\//, '').split('/')[0].split(':')[0] || raw;
            }
        }
        return raw;
    })();

    const demActive = Boolean(dem.running ?? (dem.status === 'active' && dem.engine_enabled !== false));
    const demScore = dem.score || dem.global_score || 100;
    const demProbes = dem.probes_count || 0;

    const customAppsRunning = Boolean(
        customAppsSub.running || (customAppsSub.active_streams > 0) || (customAppsSub.active_workloads > 0)
    );
    const customAppsCount = Number(customAppsSub.total_apps ?? 0);
    const customAppsFlows = Number(customAppsSub.active_streams ?? customAppsSub.active_sessions ?? 0);

    const iotRunning = Boolean(iotSub.running || (iotSub.running_devices > 0));
    const iotTotalCount = Number(iotSub.total_devices ?? 0);
    const iotActiveCount = Number(iotSub.running_devices ?? 0);

    // Robust Uptime Formatting (handles numeric seconds, string seconds, or pre-formatted strings)
    const uptimeRaw = host.uptime_system
        || host.uptime?.system
        || host.uptime_seconds
        || host.uptime_process
        || (typeof host.uptime === 'number' ? host.uptime : 0);
    const formatUptime = (val: any) => {
        if (!val) return 'Up';
        if (typeof val === 'string' && isNaN(Number(val))) {
            return val;
        }
        const sec = Number(val);
        if (isNaN(sec) || sec <= 0) return 'Up';
        const d = Math.floor(sec / (3600 * 24));
        const h = Math.floor((sec % (3600 * 24)) / 3600);
        const m = Math.floor((sec % 3600) / 60);
        if (d > 0) return `${d}d ${h}h ${m}m`;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m`;
        return `${sec}s`;
    };

    // Host CPU
    const cpuUsage = typeof host.cpu_percent === 'number'
        ? host.cpu_percent
        : (typeof host.cpu_load_percent === 'number'
            ? host.cpu_load_percent
            : (typeof host.cpu === 'number' ? host.cpu : 0));
    const cpuCores = host.cpu_cores || 2;

    // Host Memory
    const totalMemBytes = host.memory?.total_bytes || host.memory?.total || 0;
    const usedMemBytes = host.memory?.used_bytes || host.memory?.used || 0;
    const totalMemGb = (totalMemBytes / (1024 * 1024 * 1024)).toFixed(1);
    const usedMemGb = (usedMemBytes / (1024 * 1024 * 1024)).toFixed(1);
    const memUsagePercent = host.memory?.usage_percent || (totalMemBytes > 0 ? Math.round((usedMemBytes / totalMemBytes) * 100) : 0);

    // Primary Site Name Resolution (Remote Active Peer > Local Site Name > Fleet Leader Site > Hostname)
    const rawSiteName = (activePeerId && (activePeer?.site || activePeer?.instance_id))
        || siteInfo?.detected_site_name
        || siteInfo?.site_name
        || registryStatus?.site_name
        || registryStatus?.site
        || (isLeader ? leaderSite : null)
        || siteInfo?.name
        || host.hostname
        || 'Stigix Node';

    // Normalize: strip generic OS suffix like "-Ubuntu" (e.g. "DC1-Ubuntu" -> "DC1")
    const localSiteName = typeof rawSiteName === 'string' && rawSiteName.includes('-Ubuntu')
        ? rawSiteName.replace(/-Ubuntu$/i, '')
        : rawSiteName;

    return (
        <div className="space-y-8 animate-in fade-in duration-300 pb-12">
            {/* ── TOP HERO COMMAND CENTER BANNER ── */}
            <div className="relative overflow-hidden rounded-3xl border border-slate-200 dark:border-blue-500/20 bg-gradient-to-br from-white via-blue-50/40 to-indigo-50/40 dark:from-[#0c1324] dark:via-[#0f172a] dark:to-[#131b33] p-7 shadow-xl dark:shadow-2xl shadow-slate-200/50 dark:shadow-black/50">
                {/* Ambient Glow Background Orbs */}
                <div className="absolute -top-24 -right-24 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

                <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    {/* Left: Node Identity & Role (Clean, bold typography, no duplicate pulse icon) */}
                    <div className="flex items-start sm:items-center gap-4">
                        <div>
                            <div className="flex flex-wrap items-center gap-2.5">
                                <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                                    {localSiteName}
                                </h1>
                                {isRemote ? (
                                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                                        Remote Peer View
                                    </span>
                                ) : (
                                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/30">
                                        {version}
                                    </span>
                                )}
                                {updateAvailable && (
                                    <button
                                        onClick={() => onNavigate('settings', 'maintenance')}
                                        title="New version available! Click to open Maintenance & Updates"
                                        className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 hover:border-emerald-500/60 transition-all flex items-center gap-1.5 shadow-sm cursor-pointer animate-pulse"
                                    >
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                        Update Available ›
                                    </button>
                                )}
                            </div>

                            <p className="text-xs text-slate-600 dark:text-text-muted mt-1.5 font-medium flex items-center gap-2 flex-wrap">
                                <span>Host: <strong className="text-slate-900 dark:text-text-primary">{isRemote ? (activePeer?.instance_id || host.hostname || 'Remote Host') : (host.hostname || 'Host Mode')}</strong></span>
                                <span>•</span>
                                <span>Uptime: <strong className="text-emerald-600 dark:text-emerald-400 font-mono">{formatUptime(uptimeRaw)}</strong></span>
                                <span>•</span>
                                <span>Underlay: <strong className="text-slate-900 dark:text-text-primary">{host.mode || 'Host Mode'}</strong></span>
                            </p>
                        </div>
                    </div>

                    {/* Right: Cluster Topology & Action Buttons (Leader, Peer, or Standalone Aware) */}
                    <div className="flex items-center gap-3 self-end sm:self-auto">
                        {(() => {
                            const isLeaderMode = registryStatus?.mode === 'leader' || registryStatus?.current_mode === 'leader';
                            const isPeerConnectedMode = !isLeaderMode && Boolean(
                                registryStatus?.is_cluster_enrolled ||
                                registryStatus?.static_leader_url ||
                                mesh.status === 'connected' ||
                                registryStatus?.is_registered
                            );
                            return (
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (!isRemote && onOpenNodeRoleModal) {
                                            onOpenNodeRoleModal();
                                        }
                                    }}
                                    title={isRemote ? "Viewing Remote Node" : "Click to manage Node Mode (Standalone / Peer / Leader)"}
                                    className={cn(
                                        "px-4 py-2 rounded-2xl border shadow-sm flex items-center gap-3 backdrop-blur-md transition-all text-left",
                                        !isRemote && onOpenNodeRoleModal && "cursor-pointer hover:scale-[1.02] active:scale-[0.99]",
                                        isRemote
                                            ? "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400"
                                            : isLeaderMode
                                                ? "bg-purple-500/10 border-purple-500/30 hover:border-purple-500/60 text-purple-600 dark:text-purple-400"
                                                : isPeerConnectedMode
                                                    ? "bg-blue-500/10 border-blue-500/30 hover:border-blue-500/60 text-blue-600 dark:text-blue-400"
                                                    : "bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-500/60 text-emerald-600 dark:text-emerald-400"
                                    )}
                                >
                                    <div className={cn(
                                        "w-2.5 h-2.5 rounded-full",
                                        isRemote
                                            ? "bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.8)]"
                                            : isLeaderMode
                                                ? "bg-purple-500 animate-pulse shadow-[0_0_8px_rgba(168,85,247,0.8)]"
                                                : isPeerConnectedMode
                                                    ? "bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.8)]"
                                                    : "bg-emerald-400"
                                    )} />
                                    <div className="text-left leading-tight">
                                        <div className="text-[11px] font-black uppercase tracking-wider text-slate-900 dark:text-white">
                                            {isRemote
                                                ? 'Remote Node View'
                                                : isLeaderMode
                                                    ? 'Fleet Leader Active'
                                                    : isPeerConnectedMode
                                                        ? 'Mesh Peer Connected'
                                                        : 'Standalone Node'}
                                        </div>
                                        <div className="text-[10px] text-slate-500 dark:text-text-muted font-mono">
                                            {isRemote
                                                ? `Tunnel: ${activePeer?.ip_private || 'Gateway Proxy'}`
                                                : isLeaderMode
                                                    ? `${mesh.peer_count ?? registryStatus?.peer_count ?? 0} Distributed Peers`
                                                    : isPeerConnectedMode
                                                        ? `Leader: ${leaderSite || leaderPeer?.ip_private || mesh.leader_ip || registryStatus?.enrolled_leader_url || 'Cluster Active'}`
                                                        : 'Local Operations (Click to join fleet)'}
                                        </div>
                                    </div>
                                </button>
                            );
                        })()}

                        {onRefreshHealth && (
                            <button
                                onClick={onRefreshHealth}
                                disabled={isLoadingHealth}
                                title="Refresh Health Telemetry"
                                className="p-3 rounded-2xl bg-white dark:bg-[#161f36] border border-slate-200 dark:border-[#1e293b] text-slate-600 dark:text-text-muted hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-400 dark:hover:border-blue-500/40 transition-all shadow-sm cursor-pointer disabled:opacity-50"
                            >
                                <RefreshCw size={17} className={isLoadingHealth ? "animate-spin text-blue-500" : ""} />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* ── 3-COLUMN SYSTEM HEALTH MATRIX ── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
                {/* 1. Network & Cloud Status */}
                <div className="bg-white dark:bg-[#0b1020]/90 border border-slate-200 dark:border-[#1e293b] rounded-2xl p-6 flex flex-col justify-between gap-4 shadow-sm dark:shadow-xl">
                    <div className="flex items-center justify-between pb-2.5 border-b border-slate-100 dark:border-[#1e293b]">
                        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500 dark:text-text-muted">
                            <Cloud size={15} className="text-blue-500 dark:text-blue-400" />
                            <span>1. Network & Cloud</span>
                        </div>
                        <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 font-mono">SASE Mesh</span>
                    </div>

                    <div className="flex-1 flex flex-col justify-between gap-4">
                        {/* Prisma SD-WAN (Interactive Link to Prisma SASE API + Topology summary) */}
                        <div
                            onClick={() => onNavigate('settings', 'prisma-api')}
                            title="Click to configure Prisma SASE API Settings"
                            className="p-4 rounded-xl bg-slate-50 dark:bg-card-secondary/40 hover:bg-slate-100 dark:hover:bg-card-secondary/70 border border-slate-200 dark:border-[#1e293b]/70 hover:border-blue-400 dark:hover:border-blue-500/40 transition-all cursor-pointer group space-y-2.5"
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5 group-hover:text-blue-600 dark:group-hover:text-blue-300 transition-colors">
                                    <span className={cn("w-2 h-2 rounded-full", prisma.status === 'connected' ? "bg-blue-500 dark:bg-blue-400 animate-pulse" : "bg-zinc-400 dark:bg-zinc-500")} />
                                    Prisma SD-WAN
                                </span>
                                <span className={cn(
                                    "px-2 py-0.2 rounded text-[9px] font-black uppercase tracking-widest",
                                    prisma.status === 'connected' ? "bg-blue-500/15 text-blue-600 dark:text-blue-400" : "bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400"
                                )}>
                                    {prisma.status === 'connected' ? 'Connected' : 'Offline'}
                                </span>
                            </div>
                            <div className="text-[11px] text-slate-600 dark:text-text-muted flex justify-between font-mono">
                                <span>TSG ID: <strong className="text-slate-900 dark:text-text-primary">{prisma.tsg_id || '—'}</strong></span>
                                <span>Region: <strong className="text-slate-900 dark:text-text-primary">{prisma.region || '—'}</strong></span>
                            </div>
                            <div className="pt-2 border-t border-slate-200/70 dark:border-[#1e293b]/70 flex items-center justify-between text-[11px] font-mono text-slate-600 dark:text-text-muted">
                                <span>
                                    Topology:{' '}
                                    {prisma.total_sites > 0 || prisma.elements_count > 0 ? (
                                        <strong className="text-blue-600 dark:text-blue-400">
                                            {prisma.dc_count ?? 0} DC · {prisma.branch_count ?? 0} {prisma.branch_count === 1 ? 'Branch' : 'Branches'}
                                            {prisma.elements_count > 0 ? ` (${prisma.elements_count} IONs)` : ''}
                                        </strong>
                                    ) : (
                                        <strong className="text-slate-900 dark:text-text-primary">
                                            {prisma.status === 'connected' ? 'Synced' : 'Not Synced'}
                                        </strong>
                                    )}
                                </span>
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onNavigate('topology');
                                    }}
                                    title="Open SD-WAN Topology Map"
                                    className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/20 transition-colors flex items-center gap-1 cursor-pointer"
                                >
                                    <Network size={10} />
                                    Map ›
                                </button>
                            </div>
                        </div>

                        {/* Mesh & Leader (Interactive Link) */}
                        <div
                            onClick={() => {
                                if (registryStatus?.mode === 'leader' || mesh.mode === 'leader') {
                                    onNavigate('fleet');
                                } else {
                                    onNavigate('settings', 'targets');
                                }
                            }}
                            title={registryStatus?.mode === 'leader' || mesh.mode === 'leader' ? "Click to open Fleet Mesh View" : "Click to view Learned Peers & Stigix Targets"}
                            className="p-4 rounded-xl bg-slate-50 dark:bg-card-secondary/40 border border-slate-200 dark:border-[#1e293b]/70 space-y-2 cursor-pointer hover:border-purple-400/50 hover:bg-purple-500/5 transition-all group"
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5 group-hover:text-purple-600 dark:group-hover:text-purple-300 transition-colors">
                                    <span className={cn("w-2 h-2 rounded-full", (mesh.status === 'synced' || mesh.status === 'leader' || mesh.status === 'connected') ? "bg-purple-500 dark:bg-purple-400 animate-pulse" : "bg-zinc-400 dark:bg-zinc-500")} />
                                    Stigix Mesh & Leader
                                </span>
                                <div className="flex items-center gap-1.5">
                                    {!(registryStatus?.mode === 'leader' || mesh.mode === 'leader') && (
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onNavigate('settings', 'registry');
                                            }}
                                            title="Open Target Controller & Mesh Sync Status"
                                            className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-slate-200/70 hover:bg-purple-500/20 dark:bg-white/5 dark:hover:bg-purple-500/20 text-slate-600 hover:text-purple-600 dark:text-slate-400 dark:hover:text-purple-300 border border-slate-300/60 dark:border-white/10 transition-colors cursor-pointer"
                                        >
                                            Sync ›
                                        </button>
                                    )}
                                    <span className="px-2 py-0.2 rounded text-[9px] font-black uppercase tracking-widest bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/20 flex items-center gap-1">
                                        {registryStatus?.mode === 'leader' || mesh.mode === 'leader' ? 'Fleet Mesh ›' : 'Learned Peers ›'}
                                    </span>
                                </div>
                            </div>
                            <div className="text-[11px] text-slate-600 dark:text-text-muted flex items-center justify-between font-mono gap-2">
                                <span className="whitespace-nowrap shrink-0">Learned Targets: <strong className="text-slate-900 dark:text-text-primary">{mesh.learned_targets_count ?? '0'}</strong></span>
                                <span className="whitespace-nowrap truncate text-right" title={String(cleanLeaderIp)}>Leader IP: <strong className="text-slate-900 dark:text-text-primary">{cleanLeaderIp}</strong></span>
                            </div>
                        </div>

                        {/* Cloudflare Registry */}
                        <div
                            onClick={() => onNavigate('settings', 'cloud')}
                            className="p-4 rounded-xl bg-slate-50 dark:bg-card-secondary/40 hover:bg-slate-100 dark:hover:bg-card-secondary/70 border border-slate-200 dark:border-[#1e293b]/70 hover:border-emerald-400 dark:hover:border-emerald-500/40 transition-all cursor-pointer group space-y-2"
                            title="Click to configure Cloudflare Edge & Master Key in Settings"
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5 group-hover:text-emerald-600 dark:group-hover:text-emerald-300 transition-colors">
                                    <span className={cn("w-2 h-2 rounded-full", registryStatus?.is_registered ? "bg-emerald-500" : "bg-blue-400")} />
                                    Cloudflare Registry
                                </span>
                                <span className={cn(
                                    "px-2 py-0.2 rounded text-[9px] font-black uppercase tracking-widest",
                                    registryStatus?.is_registered ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                                )}>
                                    {registryStatus?.is_registered ? 'Registered' : (registryStatus?.mode === 'standalone' ? 'Standalone' : 'Ready')}
                                </span>
                            </div>
                            <div className="text-[11px] text-slate-600 dark:text-text-muted flex justify-between items-center font-mono gap-2">
                                <span className="truncate">
                                    {registryStatus?.poc_id ? (
                                        <>PoC Group: <strong className="text-slate-900 dark:text-text-primary">#{registryStatus.poc_id}</strong></>
                                    ) : (
                                        <>Autodiscovery: <strong className="text-slate-900 dark:text-text-primary">{registryStatus?.is_registered ? 'Worker Sync' : (registryStatus?.mode === 'leader' ? 'Leader Active' : 'Standalone')}</strong></>
                                    )}
                                </span>
                                <span className="shrink-0 flex items-center gap-1" title={publicIpInfo?.pop ? `Cloudflare Anycast Edge PoP: ${publicIpInfo.pop}${publicIpInfo.city ? ` (${publicIpInfo.city})` : ''}` : 'Cloudflare Anycast Edge Network'}>
                                    Edge PoP:{' '}
                                    {publicIpCountry && publicIpInfo?.pop && (
                                        <span className="text-xs leading-none">
                                            {String.fromCodePoint(...[...publicIpCountry.toUpperCase()].map(c => 0x1F1E6 - 65 + c.charCodeAt(0)))}
                                        </span>
                                    )}
                                    <strong className="text-slate-900 dark:text-text-primary">
                                        {publicIpInfo?.pop
                                            ? (publicIpInfo.city ? `${publicIpInfo.pop} · ${publicIpInfo.city}` : publicIpInfo.pop)
                                            : 'Global'}
                                    </strong>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 2. Simulation Engines */}
                <div className="bg-white dark:bg-[#0b1020]/90 border border-slate-200 dark:border-[#1e293b] rounded-2xl p-6 flex flex-col justify-between gap-3.5 shadow-sm dark:shadow-xl">
                    <div className="flex items-center justify-between pb-2.5 border-b border-slate-100 dark:border-[#1e293b]">
                        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500 dark:text-text-muted">
                            <Zap size={15} className="text-indigo-500 dark:text-indigo-400" />
                            <span>2. Simulation Engines</span>
                        </div>
                        <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 font-mono">Engines</span>
                    </div>

                    <div className="flex-1 flex flex-col justify-between gap-3">
                        {/* SaaS Traffic Status */}
                        <div
                            onClick={() => onNavigate('dashboard')}
                            className="p-3.5 rounded-xl bg-slate-50 dark:bg-card-secondary/40 hover:bg-slate-100 dark:hover:bg-card-secondary/70 border border-slate-200 dark:border-[#1e293b]/70 hover:border-blue-400 dark:hover:border-blue-500/40 transition-all cursor-pointer group"
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5 group-hover:text-blue-600 dark:group-hover:text-blue-300">
                                    <Activity size={14} className={trafficRunning ? "text-emerald-500 dark:text-emerald-400 animate-pulse" : "text-slate-400 dark:text-text-muted"} />
                                    SaaS Traffic Generator
                                </span>
                                <span className={cn(
                                    "px-2 py-0.2 rounded text-[9px] font-black uppercase tracking-widest",
                                    trafficRunning ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400"
                                )}>
                                    {trafficRunning ? 'Running' : 'Stopped'}
                                </span>
                            </div>
                            <div className="text-[11px] text-slate-600 dark:text-text-muted flex justify-between font-mono mt-1">
                                <span>Apps: <strong className="text-slate-900 dark:text-text-primary">{saasAppsCount || 67} Apps</strong></span>
                                <span>Rate: <strong className={trafficRunning ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-slate-900 dark:text-text-primary"}>{trafficRunning ? (currentRpm && currentRpm > 0 ? `${Math.round(currentRpm)} req/min` : 'Active') : '0 req/min'}</strong></span>
                            </div>
                        </div>

                        {/* Voice VoIP */}
                        <div
                            onClick={() => onNavigate('voice')}
                            className="p-3.5 rounded-xl bg-slate-50 dark:bg-card-secondary/40 hover:bg-slate-100 dark:hover:bg-card-secondary/70 border border-slate-200 dark:border-[#1e293b]/70 hover:border-emerald-400 dark:hover:border-emerald-500/40 transition-all cursor-pointer group"
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5 group-hover:text-emerald-600 dark:group-hover:text-emerald-300">
                                    <Phone size={14} className={voiceRunning ? "text-emerald-500 dark:text-emerald-400 animate-pulse" : "text-slate-400 dark:text-text-muted"} />
                                    Voice & VoIP Simulator
                                </span>
                                <span className={cn(
                                    "px-2 py-0.2 rounded text-[9px] font-black uppercase tracking-widest",
                                    voiceRunning ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400"
                                )}>
                                    {voiceRunning ? 'Running' : 'Stopped'}
                                </span>
                            </div>
                            <div className="text-[11px] text-slate-600 dark:text-text-muted flex justify-between font-mono mt-1">
                                <span>MOS: <strong className={voiceRunning ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-text-primary"}>{voiceMos}</strong></span>
                                <span>Loss: <strong className={voiceRunning ? (voiceLossVal > 1 ? "text-amber-500 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400") : "text-slate-900 dark:text-text-primary"}>{voiceLoss}</strong></span>
                                <span>Jitter: <strong className="text-slate-900 dark:text-text-primary">{voiceJitter}</strong></span>
                            </div>
                        </div>

                        {/* DEM & Probes */}
                        <div
                            onClick={() => onNavigate('performance')}
                            className="p-3.5 rounded-xl bg-slate-50 dark:bg-card-secondary/40 hover:bg-slate-100 dark:hover:bg-card-secondary/70 border border-slate-200 dark:border-[#1e293b]/70 hover:border-purple-400 dark:hover:border-purple-500/40 transition-all cursor-pointer group"
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5 group-hover:text-purple-600 dark:group-hover:text-purple-300">
                                    <LineChart size={14} className={demActive ? "text-purple-500 dark:text-purple-400 animate-pulse" : "text-slate-400 dark:text-text-muted"} />
                                    Digital Experience (DEM)
                                </span>
                                <span className={cn(
                                    "px-2 py-0.2 rounded text-[9px] font-black uppercase tracking-widest",
                                    demActive ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400"
                                )}>
                                    {demActive ? 'ON' : 'OFF'}
                                </span>
                            </div>
                            <div className="text-[11px] text-slate-600 dark:text-text-muted flex justify-between font-mono mt-1">
                                <span>Score: <strong className="text-purple-600 dark:text-purple-400">{demScore}/100</strong></span>
                                <span>Probes: <strong className="text-slate-900 dark:text-text-primary">{demProbes} {demActive ? 'Active' : 'Configured'}</strong></span>
                            </div>
                        </div>

                        {/* Security Validation */}
                        {(() => {
                            const secStatus = securitySub.status || 'standby';
                            const secRunning = secStatus === 'running';
                            const secPaused = secStatus === 'paused';
                            const activeSchedules: string[] = Array.isArray(securitySub.active_schedules) ? securitySub.active_schedules : [];
                            const totalTests = Number(securitySub.total_tests_run ?? 0);
                            const blockRate = typeof securitySub.block_rate_pct === 'number' ? securitySub.block_rate_pct : null;
                            return (
                                <div
                                    onClick={() => onNavigate('security')}
                                    title="Click to open Security Testing & SASE Policy Validation"
                                    className="p-3.5 rounded-xl bg-slate-50 dark:bg-card-secondary/40 hover:bg-slate-100 dark:hover:bg-card-secondary/70 border border-slate-200 dark:border-[#1e293b]/70 hover:border-rose-400 dark:hover:border-rose-500/40 transition-all cursor-pointer group"
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5 group-hover:text-rose-600 dark:group-hover:text-rose-300">
                                            <Shield size={14} className={cn(
                                                secRunning ? "text-emerald-500 dark:text-emerald-400 animate-pulse" :
                                                secPaused ? "text-amber-500 dark:text-amber-400" :
                                                "text-rose-500 dark:text-rose-400"
                                            )} />
                                            Security Validation
                                        </span>
                                        <span className={cn(
                                            "px-2 py-0.2 rounded text-[9px] font-black uppercase tracking-widest",
                                            secRunning
                                                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                                : secPaused
                                                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                                    : "bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400"
                                        )}>
                                            {secRunning ? 'Running' : secPaused ? 'Paused' : 'Standby'}
                                        </span>
                                    </div>
                                    <div className="text-[11px] text-slate-600 dark:text-text-muted flex justify-between font-mono mt-1">
                                        <span>
                                            Schedules:{' '}
                                            <strong className={cn(
                                                secRunning ? "text-emerald-600 dark:text-emerald-400" :
                                                secPaused ? "text-amber-600 dark:text-amber-400" :
                                                "text-slate-900 dark:text-text-primary"
                                            )}>
                                                {activeSchedules.length > 0 ? activeSchedules.join(' · ') : '0 Active'}
                                            </strong>
                                        </span>
                                        <span>
                                            {blockRate !== null && totalTests > 0 ? (
                                                <>Blocked: <strong className="text-emerald-600 dark:text-emerald-400">{blockRate}%</strong> <span className="opacity-75">({totalTests})</span></>
                                            ) : (
                                                <>Tests: <strong className="text-slate-900 dark:text-text-primary">{totalTests} Run</strong></>
                                            )}
                                        </span>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* Compact Duo: Custom TCP Apps & IoT Simulation */}
                        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100 dark:border-[#1e293b]/70">
                            {/* Custom TCP Apps */}
                            <div
                                onClick={() => onNavigate('custom_apps')}
                                className={cn(
                                    "p-2.5 rounded-xl bg-slate-50 dark:bg-card-secondary/40 hover:bg-slate-100 dark:hover:bg-card-secondary/70 border border-slate-200 dark:border-[#1e293b]/70 hover:border-amber-400 dark:hover:border-amber-500/40 transition-all cursor-pointer group",
                                    customAppsRunning && "hover:border-emerald-400 dark:hover:border-emerald-500/40"
                                )}
                                title="Click to view Custom TCP/HTTP Applications"
                            >
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-slate-900 dark:text-white flex items-center gap-1.5 group-hover:text-amber-600 dark:group-hover:text-amber-300">
                                        <Boxes size={12} className={cn("text-amber-500 dark:text-amber-400", customAppsRunning && "text-emerald-500 dark:text-emerald-400 animate-pulse")} />
                                        Custom Apps
                                    </span>
                                    <span className={cn(
                                        "px-1.5 py-0.2 rounded text-[8px] font-black uppercase tracking-wider",
                                        customAppsRunning
                                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 animate-pulse"
                                            : (customAppsSub.status === 'listening' || (customAppsSub.active_listeners > 0))
                                                ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                                                : "bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400"
                                    )}>
                                        {customAppsRunning ? 'Running' : (customAppsSub.status === 'listening' || (customAppsSub.active_listeners > 0) ? 'Listening' : (customAppsCount > 0 ? 'Ready' : 'Idle'))}
                                    </span>
                                </div>
                                <div className="text-[10px] text-slate-500 dark:text-text-muted mt-1 font-mono flex justify-between">
                                    <span>{customAppsCount} {customAppsCount > 1 ? 'Apps' : 'App'}</span>
                                    <span className={cn(customAppsFlows > 0 ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-amber-600 dark:text-amber-400")}>
                                        {customAppsFlows} {customAppsFlows > 1 ? 'Flows' : 'Flow'}
                                    </span>
                                </div>
                            </div>

                            {/* IoT Simulation */}
                            <div
                                onClick={() => onNavigate('iot')}
                                className={cn(
                                    "p-2.5 rounded-xl bg-slate-50 dark:bg-card-secondary/40 hover:bg-slate-100 dark:hover:bg-card-secondary/70 border border-slate-200 dark:border-[#1e293b]/70 hover:border-cyan-400 dark:hover:border-cyan-500/40 transition-all cursor-pointer group",
                                    iotRunning && "hover:border-emerald-400 dark:hover:border-emerald-500/40"
                                )}
                                title="Click to view IoT Device Emulation"
                            >
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-slate-900 dark:text-white flex items-center gap-1.5 group-hover:text-cyan-600 dark:group-hover:text-cyan-300">
                                        <Cpu size={12} className={cn("text-cyan-500 dark:text-cyan-400", iotRunning && "text-emerald-500 dark:text-emerald-400 animate-pulse")} />
                                        IoT Fleet
                                    </span>
                                    <span className={cn(
                                        "px-1.5 py-0.2 rounded text-[8px] font-black uppercase tracking-wider",
                                        iotRunning
                                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 animate-pulse"
                                            : (iotTotalCount > 0)
                                                ? "bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400"
                                                : "bg-slate-200 dark:bg-zinc-800 text-slate-500 dark:text-zinc-500"
                                    )}>
                                        {iotRunning ? 'Running' : (iotTotalCount > 0 ? 'Standby' : 'Idle')}
                                    </span>
                                </div>
                                <div className="text-[10px] text-slate-500 dark:text-text-muted mt-1 font-mono flex justify-between">
                                    <span>{iotTotalCount} {iotTotalCount > 1 ? 'Devices' : 'Device'}</span>
                                    <span className={cn(iotActiveCount > 0 ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-cyan-600 dark:text-cyan-400")}>
                                        {iotActiveCount} Active
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 3. Host & Underlay */}
                <div className="bg-white dark:bg-[#0b1020]/90 border border-slate-200 dark:border-[#1e293b] rounded-2xl p-6 flex flex-col justify-between gap-4 shadow-sm dark:shadow-xl">
                    <div className="flex items-center justify-between pb-2.5 border-b border-slate-100 dark:border-[#1e293b]">
                        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500 dark:text-text-muted">
                            <Server size={15} className="text-purple-500 dark:text-purple-400" />
                            <span>3. Host & Underlay</span>
                        </div>
                        <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 font-mono">Resources</span>
                    </div>

                    <div className="flex-1 flex flex-col justify-between gap-4">
                        {/* VyOS Underlay */}
                        <div
                            onClick={() => onNavigate('vyos')}
                            className="p-4 rounded-xl bg-slate-50 dark:bg-card-secondary/40 hover:bg-slate-100 dark:hover:bg-card-secondary/70 border border-slate-200 dark:border-[#1e293b]/70 hover:border-blue-400 dark:hover:border-blue-500/40 transition-all cursor-pointer group"
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5 group-hover:text-blue-600 dark:group-hover:text-blue-300">
                                    <span className={cn("w-2 h-2 rounded-full", (vyos.active_routers > 0 || (vyos.status === 'online' && vyos.active_routers !== 0)) ? "bg-emerald-500" : "bg-zinc-400")} />
                                    VyOS Underlay Routers
                                </span>
                                <span className={cn(
                                    "px-2 py-0.2 rounded text-[9px] font-black uppercase tracking-widest",
                                    (vyos.active_routers > 0 || (vyos.status === 'online' && vyos.active_routers !== 0)) ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400"
                                )}>
                                    {(vyos.active_routers > 0 || (vyos.status === 'online' && vyos.active_routers !== 0)) ? 'Online' : 'Standby'}
                                </span>
                            </div>
                            <div className="text-[11px] text-slate-600 dark:text-text-muted flex justify-between font-mono mt-1.5">
                                <span>Active Routers: <strong className="text-slate-900 dark:text-text-primary">{vyos.active_routers !== undefined ? vyos.active_routers : (host.mode === 'Host Mode' ? '0 (Host Mode)' : '0')}</strong></span>
                                <span>Impairments: <strong className={cn(
                                    (vyos.active_qos_rules && vyos.active_qos_rules > 0)
                                        ? "text-amber-600 dark:text-amber-400 font-bold"
                                        : "text-emerald-600 dark:text-emerald-400"
                                )}>
                                    {(vyos.active_qos_rules && vyos.active_qos_rules > 0) ? `${vyos.active_qos_rules} Injected` : 'None'}
                                </strong></span>
                            </div>
                        </div>

                        {/* CPU Load Gauge (Interactive Link to System Info) */}
                        <div
                            onClick={() => onNavigate('settings', 'system')}
                            title="Click to view detailed System Info in Settings"
                            className="p-4 rounded-xl bg-slate-50 dark:bg-card-secondary/40 hover:bg-slate-100 dark:hover:bg-card-secondary/70 border border-slate-200 dark:border-[#1e293b]/70 hover:border-pink-400 dark:hover:border-pink-500/40 transition-all cursor-pointer group space-y-2"
                        >
                            <div className="flex justify-between text-xs font-bold">
                                <span className="text-slate-600 dark:text-text-muted flex items-center gap-1.5 group-hover:text-pink-600 dark:group-hover:text-pink-300 transition-colors">
                                    <Cpu size={14} className="text-pink-500 dark:text-pink-400" /> CPU Load
                                </span>
                                <span className="text-slate-900 dark:text-white font-mono">{cpuUsage}% ({cpuCores} Cores)</span>
                            </div>
                            <div className="w-full bg-slate-200 dark:bg-[#1e293b] rounded-full h-2 overflow-hidden">
                                <div
                                    className="bg-gradient-to-r from-pink-500 to-rose-500 h-2 rounded-full transition-all duration-500"
                                    style={{ width: `${Math.min(cpuUsage, 100)}%` }}
                                />
                            </div>
                        </div>

                        {/* Memory RAM Gauge (Interactive Link to System Info) */}
                        <div
                            onClick={() => onNavigate('settings', 'system')}
                            title="Click to view detailed System Info in Settings"
                            className="p-4 rounded-xl bg-slate-50 dark:bg-card-secondary/40 hover:bg-slate-100 dark:hover:bg-card-secondary/70 border border-slate-200 dark:border-[#1e293b]/70 hover:border-blue-400 dark:hover:border-blue-500/40 transition-all cursor-pointer group space-y-2"
                        >
                            <div className="flex justify-between text-xs font-bold">
                                <span className="text-slate-600 dark:text-text-muted flex items-center gap-1.5 group-hover:text-blue-600 dark:group-hover:text-blue-300 transition-colors">
                                    <Layers size={14} className="text-blue-500 dark:text-blue-400" /> Memory RAM
                                </span>
                                <span className="text-slate-900 dark:text-white font-mono">{usedMemGb} / {totalMemGb} GB ({memUsagePercent}%)</span>
                            </div>
                            <div className="w-full bg-slate-200 dark:bg-[#1e293b] rounded-full h-2 overflow-hidden">
                                <div
                                    className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2 rounded-full transition-all duration-500"
                                    style={{ width: `${Math.min(memUsagePercent, 100)}%` }}
                                />
                            </div>
                        </div>

                        {/* SD-WAN Dataplane, Gateway Reachability & Management Access */}
                        {(publicIp || gatewayIp || localIp || siteInfo?.local_ip || gatewayInfo) && (() => {
                            const trafficIface = gatewayInfo?.traffic_iface || null;
                            const trafficIp = gatewayInfo?.traffic_ip || localIp || siteInfo?.local_ip || host.ip || '—';
                            const trafficIfaceUp = gatewayInfo?.traffic_iface_up !== false;
                            const gwAddr = gatewayInfo?.gw_ip || gatewayIp || '—';
                            const gwReachable = gatewayInfo ? Boolean(gatewayInfo.gw_reachable) : Boolean(gatewayIp);
                            const gwLatencyMs = gatewayInfo?.gw_latency_ms;
                            const mgmtIface = gatewayInfo?.mgmt_iface || null;
                            const mgmtIp = gatewayInfo?.mgmt_ip || null;
                            const mgmtIfaceUp = gatewayInfo?.mgmt_iface_up !== false;
                            const accessMode = gatewayInfo?.access_mode || 'in_band';
                            const accessLabel = gatewayInfo?.access_label || 'In-Band';
                            const accessHost = gatewayInfo?.access_host || null;
                            const hasDataplaneFault = Boolean(gatewayInfo && (!trafficIfaceUp || (gwAddr !== '—' && !gwReachable)));

                            return (
                                <div className={cn(
                                    "p-3.5 rounded-xl border space-y-2 transition-colors",
                                    hasDataplaneFault
                                        ? "bg-rose-500/5 dark:bg-rose-500/10 border-rose-500/40 dark:border-rose-500/40"
                                        : "bg-slate-50 dark:bg-card-secondary/40 border-slate-200 dark:border-[#1e293b]/70"
                                )}>
                                    {/* Header: Title + GW Reachability Badge + Public IP */}
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5 shrink-0">
                                                <Globe size={14} className={hasDataplaneFault ? "text-rose-500 dark:text-rose-400" : "text-cyan-500 dark:text-cyan-400"} />
                                                SD-WAN Dataplane & WAN
                                            </span>
                                            {gatewayInfo && (
                                                <span
                                                    title={
                                                        !trafficIfaceUp
                                                            ? `Traffic interface ${trafficIface || ''} is DOWN`
                                                            : !gwReachable
                                                            ? `SD-WAN Gateway (${gwAddr}) is UNREACHABLE via ICMP ping`
                                                            : `SD-WAN Gateway (${gwAddr}) is reachable${gwLatencyMs !== null && gwLatencyMs !== undefined ? ` (${gwLatencyMs}ms)` : ''}`
                                                    }
                                                    className={cn(
                                                        "px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider font-mono flex items-center gap-1 shrink-0",
                                                        !trafficIfaceUp || !gwReachable
                                                            ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 animate-pulse"
                                                            : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                                    )}
                                                >
                                                    <span className={cn("w-1.5 h-1.5 rounded-full", (!trafficIfaceUp || !gwReachable) ? "bg-rose-500" : "bg-emerald-500")} />
                                                    {!trafficIfaceUp
                                                        ? 'IFACE DOWN'
                                                        : !gwReachable
                                                        ? 'GW UNREACHABLE'
                                                        : `GW OK${gwLatencyMs !== null && gwLatencyMs !== undefined ? ` · ${gwLatencyMs}ms` : ''}`}
                                                </span>
                                            )}
                                        </div>
                                        {publicIp && (
                                            <span className="text-xs font-mono flex items-center gap-1.5 shrink-0" title={publicIpCountry ? `Egress Public IP (${publicIpCountry})` : 'Egress Public IP'}>
                                                {publicIpCountry && (
                                                    <span className="text-sm leading-none">
                                                        {String.fromCodePoint(...[...publicIpCountry.toUpperCase()].map(c => 0x1F1E6 - 65 + c.charCodeAt(0)))}
                                                    </span>
                                                )}
                                                <strong className="text-slate-900 dark:text-text-primary text-[10px]">{publicIp}</strong>
                                            </span>
                                        )}
                                    </div>

                                    {/* Row 1: Traffic / Default Route Interface & SD-WAN Gateway + Speedtest */}
                                    <div className="text-[11px] text-slate-600 dark:text-text-muted flex justify-between items-center font-mono gap-2">
                                        <span className="flex items-center gap-1 truncate" title={`Default route interface used for traffic generation (${trafficIface || 'default'})`}>
                                            <span>Traffic{trafficIface ? ` (${trafficIface})` : ''}:</span>
                                            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", trafficIfaceUp ? "bg-emerald-500" : "bg-rose-500")} />
                                            <strong className={cn("truncate", trafficIfaceUp ? "text-slate-900 dark:text-text-primary" : "text-rose-600 dark:text-rose-400")}>{trafficIp}</strong>
                                        </span>
                                        <span className="flex items-center gap-1 shrink-0" title={gwReachable ? `SD-WAN Gateway ${gwAddr} reachable` : `SD-WAN Gateway ${gwAddr} unreachable!`}>
                                            <span>GW:</span>
                                            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", gwReachable ? "bg-emerald-500" : "bg-rose-500 animate-ping")} />
                                            <strong className={cn(gwReachable ? "text-slate-900 dark:text-text-primary" : "text-rose-600 dark:text-rose-400 font-black")}>{gwAddr}</strong>
                                        </span>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onRunSpeedtest?.();
                                            }}
                                            disabled={runningSpeedtest}
                                            title="Click to run/re-run Internet Speedtest"
                                            className={cn(
                                                "px-2 py-0.5 rounded text-[10px] font-bold font-mono transition-all flex items-center gap-1 border shadow-xs cursor-pointer active:scale-95 shrink-0",
                                                runningSpeedtest
                                                    ? "bg-blue-500/20 text-blue-500 dark:text-blue-400 border-blue-500/40 animate-pulse cursor-wait"
                                                    : speedtestResult?.download_mbps
                                                        ? "bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-700 dark:text-cyan-300 border-cyan-500/30"
                                                        : "bg-slate-200 hover:bg-slate-300 dark:bg-card-secondary dark:hover:bg-card-hover text-slate-700 dark:text-text-muted hover:text-slate-900 dark:hover:text-white border-slate-300 dark:border-border"
                                            )}
                                        >
                                            <Gauge size={11} className={runningSpeedtest ? "animate-spin text-blue-500" : "text-cyan-500 dark:text-cyan-400"} />
                                            <span>
                                                {runningSpeedtest
                                                    ? "Testing..."
                                                    : speedtestResult?.download_mbps
                                                        ? `${Math.round(speedtestResult.download_mbps)} Mbps`
                                                        : "Speedtest"}
                                            </span>
                                        </button>
                                    </div>

                                    {/* Row 2: Management Interface & Current UI Access Path */}
                                    <div className="pt-1.5 border-t border-slate-200/70 dark:border-[#1e293b]/80 text-[10px] text-slate-500 dark:text-text-muted flex justify-between items-center font-mono gap-2">
                                        {mgmtIp ? (
                                            <>
                                                <span className="flex items-center gap-1 truncate" title={`Dedicated Out-of-Band Management Interface (${mgmtIface || 'mgmt'})`}>
                                                    <span>Mgmt{mgmtIface ? ` (${mgmtIface})` : ''}:</span>
                                                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", mgmtIfaceUp ? "bg-emerald-500" : "bg-amber-500")} />
                                                    <strong className="text-slate-800 dark:text-slate-200">{mgmtIp}</strong>
                                                </span>
                                                <span className="flex items-center gap-1 shrink-0" title={accessHost ? `Connected via ${accessLabel} (${accessHost})` : `Connected via ${accessLabel}`}>
                                                    <span>UI:</span>
                                                    <strong className={cn(
                                                        "px-1.5 py-0.2 rounded text-[9px] font-bold",
                                                        accessMode === 'cloudflare'
                                                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                                            : accessMode === 'out_of_band'
                                                            ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400"
                                                            : accessMode === 'leader_proxy'
                                                            ? "bg-purple-500/15 text-purple-600 dark:text-purple-400"
                                                            : "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
                                                    )}>
                                                        {accessLabel}
                                                    </strong>
                                                </span>
                                            </>
                                        ) : (
                                            <>
                                                <span className="flex items-center gap-1.5 truncate" title={accessHost ? `UI session via ${accessLabel} (${accessHost})` : `UI session via ${accessLabel}`}>
                                                    <span>UI Access:</span>
                                                    <strong className={cn(
                                                        "px-1.5 py-0.2 rounded text-[9px] font-bold",
                                                        accessMode === 'cloudflare'
                                                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                                            : accessMode === 'leader_proxy'
                                                            ? "bg-purple-500/15 text-purple-600 dark:text-purple-400"
                                                            : "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
                                                    )}>
                                                        {accessLabel}
                                                    </strong>
                                                    <span className="text-slate-400 dark:text-slate-500 truncate">
                                                        ({accessMode === 'cloudflare' && accessHost ? accessHost : trafficIp})
                                                    </span>
                                                </span>
                                                <span className="text-[9px] text-slate-400 dark:text-slate-500 shrink-0">Single-NIC</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                </div>
            </div>
        </div>
    );
};
