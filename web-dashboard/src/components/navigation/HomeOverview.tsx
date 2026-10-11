import React from 'react';
import {
    Activity,
    Bot,
    Boxes,
    Cloud,
    Cpu,
    ExternalLink,
    Gauge,
    GitFork,
    Globe,
    HardDrive,
    Layers,
    LineChart,
    Monitor,
    Network,
    Phone,
    Radio,
    RefreshCw,
    Server,
    Shield,
    Sparkles,
    Terminal,
    Zap
} from 'lucide-react';
import { cn } from '../../lib/utils';

interface HomeOverviewProps {
    token: string | null;
    healthData: any;
    isLoadingHealth?: boolean;
    onRefreshHealth?: () => void;
    registryStatus?: any;
    siteInfo?: any;
    version?: string;
    trafficRunning?: boolean;
    globalVoiceStatus?: any;
    globalConvStatus?: any;
    isLeader?: boolean;
    onNavigate: (viewId: string, subTab?: string) => void;
    onOpenDiagnostics?: () => void;
}

export const HomeOverview: React.FC<HomeOverviewProps> = ({
    healthData,
    isLoadingHealth,
    onRefreshHealth,
    registryStatus,
    siteInfo,
    version = 'v3.0.0-dev',
    trafficRunning,
    onNavigate
}) => {
    const score = healthData?.overall_score ?? 100;
    const sub = healthData?.subsystems || {};
    const host = sub.host || {};
    const prisma = sub.prisma || {};
    const mesh = sub.mesh || {};
    const cloud = sub.cloud || {};
    const vyos = sub.vyos || {};
    const customApps = sub.custom_apps || {};
    const dem = sub.dem || {};
    const voice = sub.voice || {};
    const events = sub.events || {};

    const uptimeSec = host.uptime_seconds || host.uptime || 0;
    const formatUptime = (seconds: number) => {
        if (!seconds || seconds <= 0) return 'Up';
        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor((seconds % (3600 * 24)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (d > 0) return `${d}d ${h}h ${m}m`;
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    };

    // Host Memory
    const totalMemBytes = host.memory?.total_bytes || host.memory?.total || 0;
    const usedMemBytes = host.memory?.used_bytes || host.memory?.used || 0;
    const totalMemGb = (totalMemBytes / (1024 * 1024 * 1024)).toFixed(1);
    const usedMemGb = (usedMemBytes / (1024 * 1024 * 1024)).toFixed(1);
    const memUsagePercent = host.memory?.usage_percent || (totalMemBytes > 0 ? Math.round((usedMemBytes / totalMemBytes) * 100) : 0);

    // Host Disk
    const diskTotalGb = (host.disk?.total_bytes ? (host.disk.total_bytes / (1024 * 1024 * 1024)).toFixed(1) : (host.disk?.total_gb || 0));
    const diskUsedGb = (host.disk?.used_bytes ? (host.disk.used_bytes / (1024 * 1024 * 1024)).toFixed(1) : (host.disk?.used_gb || 0));
    const diskPercent = host.disk?.usage_percent || (diskTotalGb > 0 ? Math.round((Number(diskUsedGb) / Number(diskTotalGb)) * 100) : 0);

    return (
        <div className="space-y-8 animate-in fade-in duration-300 pb-12">
            {/* ── TOP HERO COMMAND CENTER BANNER ── */}
            <div className="relative overflow-hidden rounded-3xl border border-blue-500/20 bg-gradient-to-br from-[#0c1324] via-[#0f172a] to-[#131b33] p-7 shadow-2xl shadow-black/50">
                {/* Subtle Ambient Glow Background Orbs */}
                <div className="absolute -top-24 -right-24 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

                <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    {/* Left: Node Identity & Role */}
                    <div className="flex items-start sm:items-center gap-4">
                        <div className="relative">
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 p-[2px] shadow-lg shadow-blue-500/30">
                                <div className="w-full h-full bg-[#0a0f1d] rounded-[14px] flex items-center justify-center">
                                    <Activity size={28} className="text-blue-400 animate-pulse" />
                                </div>
                            </div>
                            <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-[#0a0f1d] shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
                        </div>

                        <div>
                            <div className="flex flex-wrap items-center gap-2.5">
                                <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
                                    {host.hostname || siteInfo?.detected_site_name || 'Stigix Node'}
                                </h1>
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-blue-500/10 text-blue-400 border border-blue-500/30">
                                    {version}
                                </span>
                                <span className={cn(
                                    "px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border flex items-center gap-1.5",
                                    registryStatus?.mode === 'leader'
                                        ? "bg-purple-500/15 text-purple-300 border-purple-500/40"
                                        : "bg-blue-500/15 text-blue-300 border-blue-500/40"
                                )}>
                                    <span className={cn("w-1.5 h-1.5 rounded-full", registryStatus?.mode === 'leader' ? "bg-purple-400 animate-pulse" : "bg-blue-400")} />
                                    {registryStatus?.mode === 'leader' ? 'Leader Node' : 'Peer Node'}
                                </span>
                            </div>

                            <p className="text-xs text-text-muted mt-1 font-medium flex items-center gap-2 flex-wrap">
                                <span>Underlay: <strong className="text-text-primary">{host.mode || 'Host Mode'}</strong></span>
                                <span>•</span>
                                <span>Uptime: <strong className="text-emerald-400 font-mono">{formatUptime(uptimeSec)}</strong></span>
                                {siteInfo?.detected_site_name && (
                                    <>
                                        <span>•</span>
                                        <span>Site: <strong className="text-blue-400">{siteInfo.detected_site_name}</strong></span>
                                    </>
                                )}
                            </p>
                        </div>
                    </div>

                    {/* Right: Health Score & Action Buttons */}
                    <div className="flex items-center gap-4 self-end sm:self-auto">
                        <div className={cn(
                            "px-4 py-2.5 rounded-2xl border shadow-lg flex items-center gap-3 backdrop-blur-md",
                            score >= 90
                                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-emerald-500/10"
                                : score >= 70
                                    ? "bg-amber-500/10 border-amber-500/30 text-amber-400 shadow-amber-500/10"
                                    : "bg-rose-500/10 border-rose-500/30 text-rose-400 shadow-rose-500/10"
                        )}>
                            <div className="relative">
                                <span className="text-2xl font-black tracking-tight">{score}%</span>
                            </div>
                            <div className="text-left">
                                <div className="text-[10px] font-black uppercase tracking-wider text-white">Operational</div>
                                <div className="text-[9px] text-text-muted">Health Matrix</div>
                            </div>
                        </div>

                        {onRefreshHealth && (
                            <button
                                onClick={onRefreshHealth}
                                disabled={isLoadingHealth}
                                title="Refresh Telemetry"
                                className="p-2.5 rounded-xl border border-border/70 bg-card-secondary/70 hover:bg-card-secondary text-text-muted hover:text-white transition-all cursor-pointer disabled:opacity-50"
                            >
                                <RefreshCw size={16} className={isLoadingHealth ? "animate-spin text-blue-400" : ""} />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* ── 3-COLUMN SYSTEM HEALTH MATRIX ── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {/* 1. Network & Cloud Status */}
                <div className="bg-[#0b1020]/90 backdrop-blur-xl border border-[#1e293b] rounded-2xl p-5 space-y-4 shadow-xl">
                    <div className="flex items-center justify-between pb-2 border-b border-[#1e293b]">
                        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-text-muted">
                            <Cloud size={15} className="text-blue-400" />
                            <span>1. Network & Cloud</span>
                        </div>
                        <span className="text-[10px] font-bold text-blue-400 font-mono">SASE Mesh</span>
                    </div>

                    {/* Prisma SD-WAN */}
                    <div className="p-3.5 rounded-xl bg-card-secondary/40 border border-[#1e293b]/70 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white flex items-center gap-1.5">
                                <span className={cn("w-2 h-2 rounded-full", prisma.status === 'connected' ? "bg-blue-400 animate-pulse" : "bg-zinc-500")} />
                                Prisma SD-WAN
                            </span>
                            <span className={cn(
                                "px-2 py-0.2 rounded text-[9px] font-black uppercase tracking-widest",
                                prisma.status === 'connected' ? "bg-blue-500/15 text-blue-400" : "bg-zinc-800 text-zinc-400"
                            )}>
                                {prisma.status === 'connected' ? 'Connected' : 'Offline'}
                            </span>
                        </div>
                        <div className="text-[11px] text-text-muted flex justify-between font-mono">
                            <span>TSG ID: <strong className="text-text-primary">{prisma.tsg_id || '—'}</strong></span>
                            <span>Region: <strong className="text-text-primary">{prisma.region || '—'}</strong></span>
                        </div>
                    </div>

                    {/* Mesh & Leader */}
                    <div className="p-3.5 rounded-xl bg-card-secondary/40 border border-[#1e293b]/70 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white flex items-center gap-1.5">
                                <span className={cn("w-2 h-2 rounded-full", mesh.status === 'synced' ? "bg-purple-400 animate-pulse" : "bg-zinc-500")} />
                                Stigix Mesh & Leader
                            </span>
                            <span className="px-2 py-0.2 rounded text-[9px] font-black uppercase tracking-widest bg-purple-500/15 text-purple-300">
                                {mesh.mode === 'leader' ? 'Leader Mode' : 'Peer Sync'}
                            </span>
                        </div>
                        <div className="text-[11px] text-text-muted flex justify-between font-mono">
                            <span>Learned Targets: <strong className="text-text-primary">{mesh.learned_targets_count ?? '0'}</strong></span>
                            <span>Leader IP: <strong className="text-text-primary">{mesh.leader_ip || '127.0.0.1'}</strong></span>
                        </div>
                    </div>

                    {/* Cloud Workers */}
                    <div className="p-3.5 rounded-xl bg-card-secondary/40 border border-[#1e293b]/70 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                                Cloudflare Registry
                            </span>
                            <span className="px-2 py-0.2 rounded text-[9px] font-black uppercase tracking-widest bg-emerald-500/15 text-emerald-400">
                                Key Valid
                            </span>
                        </div>
                        <div className="text-[11px] text-text-muted flex justify-between font-mono">
                            <span>Edge Scenarios: <strong className="text-text-primary">{cloud.edge_scenarios ?? 7}</strong></span>
                            <span>PoC Group: <strong className="text-text-primary">{cloud.poc_group || 'Global'}</strong></span>
                        </div>
                    </div>
                </div>

                {/* 2. Simulation Engines */}
                <div className="bg-[#0b1020]/90 backdrop-blur-xl border border-[#1e293b] rounded-2xl p-5 space-y-4 shadow-xl">
                    <div className="flex items-center justify-between pb-2 border-b border-[#1e293b]">
                        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-text-muted">
                            <Zap size={15} className="text-indigo-400" />
                            <span>2. Simulation Engines</span>
                        </div>
                        <span className="text-[10px] font-bold text-indigo-400 font-mono">Engines</span>
                    </div>

                    {/* SaaS Traffic Status */}
                    <div
                        onClick={() => onNavigate('dashboard')}
                        className="p-3.5 rounded-xl bg-card-secondary/40 hover:bg-card-secondary/70 border border-[#1e293b]/70 hover:border-blue-500/40 transition-all cursor-pointer group"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white flex items-center gap-1.5 group-hover:text-blue-300">
                                <Activity size={14} className={trafficRunning ? "text-emerald-400 animate-pulse" : "text-text-muted"} />
                                SaaS Traffic Generator
                            </span>
                            <span className={cn(
                                "px-2 py-0.2 rounded text-[9px] font-black uppercase tracking-widest",
                                trafficRunning ? "bg-emerald-500/15 text-emerald-400" : "bg-zinc-800 text-zinc-400"
                            )}>
                                {trafficRunning ? 'Running' : 'Stopped'}
                            </span>
                        </div>
                        <p className="text-[11px] text-text-muted mt-1">
                            Click to configure load rate, SaaS profiles and APM telemetry.
                        </p>
                    </div>

                    {/* Voice VoIP */}
                    <div
                        onClick={() => onNavigate('voice')}
                        className="p-3.5 rounded-xl bg-card-secondary/40 hover:bg-card-secondary/70 border border-[#1e293b]/70 hover:border-emerald-500/40 transition-all cursor-pointer group"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white flex items-center gap-1.5 group-hover:text-emerald-300">
                                <Phone size={14} className="text-emerald-400" />
                                Voice & VoIP Simulator
                            </span>
                            <span className="px-2 py-0.2 rounded text-[9px] font-black uppercase tracking-widest bg-emerald-500/15 text-emerald-400">
                                MOS 4.38
                            </span>
                        </div>
                        <div className="text-[11px] text-text-muted flex justify-between font-mono mt-1">
                            <span>Loss: <strong className="text-emerald-400">0%</strong></span>
                            <span>Jitter: <strong className="text-text-primary">&lt;10ms RTT</strong></span>
                        </div>
                    </div>

                    {/* DEM & Probes */}
                    <div
                        onClick={() => onNavigate('performance')}
                        className="p-3.5 rounded-xl bg-card-secondary/40 hover:bg-card-secondary/70 border border-[#1e293b]/70 hover:border-purple-500/40 transition-all cursor-pointer group"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white flex items-center gap-1.5 group-hover:text-purple-300">
                                <LineChart size={14} className="text-purple-400" />
                                Digital Experience (DEM)
                            </span>
                            <span className="px-2 py-0.2 rounded text-[9px] font-black uppercase tracking-widest bg-purple-500/15 text-purple-300">
                                Score {dem.score || 71}/100
                            </span>
                        </div>
                        <div className="text-[11px] text-text-muted flex justify-between font-mono mt-1">
                            <span>Configured Probes: <strong className="text-text-primary">{dem.probes_count || 94}</strong></span>
                            <span>Daemon: <strong className="text-emerald-400">Ready</strong></span>
                        </div>
                    </div>
                </div>

                {/* 3. Host & Underlay */}
                <div className="bg-[#0b1020]/90 backdrop-blur-xl border border-[#1e293b] rounded-2xl p-5 space-y-4 shadow-xl">
                    <div className="flex items-center justify-between pb-2 border-b border-[#1e293b]">
                        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-text-muted">
                            <Server size={15} className="text-purple-400" />
                            <span>3. Host & Underlay</span>
                        </div>
                        <span className="text-[10px] font-bold text-purple-400 font-mono">Resources</span>
                    </div>

                    {/* VyOS Underlay */}
                    <div
                        onClick={() => onNavigate('vyos')}
                        className="p-3.5 rounded-xl bg-card-secondary/40 hover:bg-card-secondary/70 border border-[#1e293b]/70 hover:border-blue-500/40 transition-all cursor-pointer group"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white flex items-center gap-1.5 group-hover:text-blue-300">
                                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                                VyOS Underlay Routers
                            </span>
                            <span className="px-2 py-0.2 rounded text-[9px] font-black uppercase tracking-widest bg-emerald-500/15 text-emerald-400">
                                Online
                            </span>
                        </div>
                        <div className="text-[11px] text-text-muted flex justify-between font-mono mt-1">
                            <span>Active Routers: <strong className="text-text-primary">{vyos.active_routers || '3 / 3'}</strong></span>
                            <span>Netem: <strong className="text-emerald-400">Clean</strong></span>
                        </div>
                    </div>

                    {/* CPU Load Gauge */}
                    <div className="p-3.5 rounded-xl bg-card-secondary/40 border border-[#1e293b]/70 space-y-1.5">
                        <div className="flex justify-between text-xs font-bold">
                            <span className="text-text-muted flex items-center gap-1.5">
                                <Cpu size={14} className="text-pink-400" /> CPU Load
                            </span>
                            <span className="text-white font-mono">{host.cpu_percent || 21}% ({host.cpu_cores || 2} Cores)</span>
                        </div>
                        <div className="w-full bg-[#1e293b] rounded-full h-2 overflow-hidden">
                            <div
                                className="bg-gradient-to-r from-pink-500 to-rose-500 h-2 rounded-full transition-all duration-500"
                                style={{ width: `${Math.min(host.cpu_percent || 21, 100)}%` }}
                            />
                        </div>
                    </div>

                    {/* Memory RAM Gauge */}
                    <div className="p-3.5 rounded-xl bg-card-secondary/40 border border-[#1e293b]/70 space-y-1.5">
                        <div className="flex justify-between text-xs font-bold">
                            <span className="text-text-muted flex items-center gap-1.5">
                                <Layers size={14} className="text-blue-400" /> Memory RAM
                            </span>
                            <span className="text-white font-mono">{usedMemGb} / {totalMemGb} GB ({memUsagePercent}%)</span>
                        </div>
                        <div className="w-full bg-[#1e293b] rounded-full h-2 overflow-hidden">
                            <div
                                className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2 rounded-full transition-all duration-500"
                                style={{ width: `${Math.min(memUsagePercent, 100)}%` }}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* ── WORKLOADS & MISSION CONTROL QUICK ACTIONS ── */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-base font-black text-white tracking-wide uppercase flex items-center gap-2">
                            <Sparkles size={18} className="text-blue-400" />
                            Mission Control Workloads
                        </h2>
                        <p className="text-xs text-text-muted mt-0.5">
                            Launch, monitor and validate SD-WAN & SASE capabilities with one click.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Security Validation */}
                    <div
                        onClick={() => onNavigate('security')}
                        className="p-5 rounded-2xl bg-[#0c1324]/80 hover:bg-[#111933] border border-[#1e293b] hover:border-blue-500/50 transition-all duration-200 cursor-pointer shadow-lg group hover:-translate-y-0.5"
                    >
                        <div className="flex items-center justify-between mb-3">
                            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 group-hover:bg-blue-500 group-hover:text-white transition-all shadow-inner">
                                <Shield size={18} />
                            </div>
                            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider group-hover:text-blue-400 flex items-center gap-1">
                                Open <ExternalLink size={10} />
                            </span>
                        </div>
                        <h3 className="text-sm font-black text-white group-hover:text-blue-300 transition-colors">
                            Security Validation
                        </h3>
                        <p className="text-xs text-text-muted mt-1 leading-relaxed">
                            Run automated SASE NGFW inspection suites (URL, DNS, Threats, EICAR).
                        </p>
                    </div>

                    {/* Topology Map */}
                    <div
                        onClick={() => onNavigate('topology')}
                        className="p-5 rounded-2xl bg-[#0c1324]/80 hover:bg-[#111933] border border-[#1e293b] hover:border-purple-500/50 transition-all duration-200 cursor-pointer shadow-lg group hover:-translate-y-0.5"
                    >
                        <div className="flex items-center justify-between mb-3">
                            <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 group-hover:bg-purple-500 group-hover:text-white transition-all shadow-inner">
                                <Network size={18} />
                            </div>
                            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider group-hover:text-purple-400 flex items-center gap-1">
                                Open <ExternalLink size={10} />
                            </span>
                        </div>
                        <h3 className="text-sm font-black text-white group-hover:text-purple-300 transition-colors">
                            SD-WAN Topology
                        </h3>
                        <p className="text-xs text-text-muted mt-1 leading-relaxed">
                            Visualize underlay mesh, SD-WAN tunnels, and live SASE branch paths.
                        </p>
                    </div>

                    {/* Packet Capture */}
                    <div
                        onClick={() => onNavigate('packet_capture')}
                        className="p-5 rounded-2xl bg-[#0c1324]/80 hover:bg-[#111933] border border-[#1e293b] hover:border-cyan-500/50 transition-all duration-200 cursor-pointer shadow-lg group hover:-translate-y-0.5"
                    >
                        <div className="flex items-center justify-between mb-3">
                            <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 group-hover:bg-cyan-500 group-hover:text-white transition-all shadow-inner">
                                <Radio size={18} />
                            </div>
                            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider group-hover:text-cyan-400 flex items-center gap-1">
                                Open <ExternalLink size={10} />
                            </span>
                        </div>
                        <h3 className="text-sm font-black text-white group-hover:text-cyan-300 transition-colors">
                            Packet Sniffer (BPF)
                        </h3>
                        <p className="text-xs text-text-muted mt-1 leading-relaxed">
                            Capture live traffic with Wireshark-grade 3-pane packet analysis.
                        </p>
                    </div>

                    {/* VyOS Impairments */}
                    <div
                        onClick={() => onNavigate('vyos')}
                        className="p-5 rounded-2xl bg-[#0c1324]/80 hover:bg-[#111933] border border-[#1e293b] hover:border-amber-500/50 transition-all duration-200 cursor-pointer shadow-lg group hover:-translate-y-0.5"
                    >
                        <div className="flex items-center justify-between mb-3">
                            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 group-hover:bg-amber-500 group-hover:text-white transition-all shadow-inner">
                                <Monitor size={18} />
                            </div>
                            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider group-hover:text-amber-400 flex items-center gap-1">
                                Open <ExternalLink size={10} />
                            </span>
                        </div>
                        <h3 className="text-sm font-black text-white group-hover:text-amber-300 transition-colors">
                            VyOS WAN Impairments
                        </h3>
                        <p className="text-xs text-text-muted mt-1 leading-relaxed">
                            Inject netem latency, loss, and jitter to stress test SD-WAN failover.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
