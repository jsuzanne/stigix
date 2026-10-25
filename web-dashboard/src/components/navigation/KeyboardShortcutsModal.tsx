import React from 'react';
import {
    Keyboard,
    X,
    Command,
    Home,
    Network,
    LineChart,
    Gauge,
    Shield,
    Monitor,
    GitFork,
    Radio,
    Activity,
    GitCompare,
    List,
    Phone,
    Cpu,
    Server,
    Settings,
    Bot,
    Search,
    CornerDownLeft,
    Grid
} from 'lucide-react';
import { cn } from '../../lib/utils';

export interface KeyboardShortcutsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onNavigate: (viewId: string, subTab?: string) => void;
    isLeader?: boolean;
    features?: {
        xfr_enabled?: boolean;
        pcap_enabled?: boolean;
        copilot_enabled?: boolean;
        snapshots_enabled?: boolean;
    };
}

interface ShortcutItem {
    keys: string[];
    label: string;
    description: string;
    icon?: React.ComponentType<{ size?: number; className?: string }>;
    action?: () => void;
    viewId?: string;
    badge?: string;
    hidden?: boolean;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
    isOpen,
    onClose,
    onNavigate,
    isLeader = false,
    features = {}
}) => {
    if (!isOpen) return null;

    const navShortcuts: ShortcutItem[] = [
        {
            keys: ['G', 'H'],
            label: 'Home Overview',
            description: 'System health matrix & real-time telemetry',
            icon: Home,
            viewId: 'home'
        },
        {
            keys: ['G', 'T'],
            label: 'Topology Map',
            description: 'SD-WAN tunnels, underlay mesh & SASE circuits',
            icon: Network,
            viewId: 'topology'
        },
        {
            keys: ['G', 'D'],
            label: 'Digital Experience (DEM)',
            description: 'Synthetic path probes & SLA user experience',
            icon: LineChart,
            viewId: 'performance'
        },
        {
            keys: ['G', 'M'],
            label: 'Reachability Matrix',
            description: 'Full-mesh N×N inter-site RTT, packet loss & path asymmetry',
            icon: Grid,
            viewId: 'reachability_matrix'
        },
        {
            keys: ['G', 'B'],
            label: 'Bandwidth Test (Speedtest)',
            description: 'High-speed throughput & latency benchmark',
            icon: Gauge,
            viewId: 'speedtest',
            hidden: !features.xfr_enabled
        },
        {
            keys: ['G', 'S'],
            label: 'Security Validation',
            description: 'URL, DNS, EICAR & malware policy verification',
            icon: Shield,
            viewId: 'security'
        },
        {
            keys: ['G', 'V'],
            label: 'VyOS Router Control',
            description: 'NetEM impairments & WAN link orchestration',
            icon: Monitor,
            viewId: 'vyos'
        },
        {
            keys: ['G', 'F'],
            label: 'Failover Monitoring',
            description: 'Sub-second blackout & path convergence',
            icon: GitFork,
            viewId: 'convergence'
        },
        {
            keys: ['G', 'P'],
            label: 'Packet Capture',
            description: 'Live BPF sniffer & 3-pane packet inspector',
            icon: Radio,
            viewId: 'packet_capture'
        },
        {
            keys: ['G', 'G'],
            label: 'SaaS Traffic Generator',
            description: 'Realistic multi-application enterprise load',
            icon: Activity,
            viewId: 'dashboard'
        },
        {
            keys: ['G', 'C'],
            label: 'ChangeGuard Snapshots',
            description: 'Pre/post migration diffing & overlay audits',
            icon: GitCompare,
            viewId: 'snapshots',
            hidden: !features.snapshots_enabled
        },
        {
            keys: ['G', 'E'],
            label: 'Live Events Stream',
            description: 'Real-time syslog & orchestration audit feed',
            icon: List,
            viewId: 'events'
        },
        {
            keys: ['G', 'O'],
            label: 'Voice Simulation',
            description: 'RTP call emulation & MOS scoring',
            icon: Phone,
            viewId: 'voice'
        },
        {
            keys: ['G', 'I'],
            label: 'IoT Emulation',
            description: 'Physical sensor & attack profile simulation',
            icon: Cpu,
            viewId: 'iot'
        },
        {
            keys: ['G', 'L'],
            label: 'Fleet Mesh Nodes',
            description: 'Cluster peers & remote node administration',
            icon: Server,
            viewId: 'fleet',
            hidden: !isLeader
        },
        {
            keys: ['G', ','],
            label: 'Platform Settings',
            description: 'Configuration, interfaces & cloud integrations',
            icon: Settings,
            viewId: 'settings'
        }
    ].filter(item => !item.hidden);

    const systemShortcuts: ShortcutItem[] = [
        {
            keys: ['⌘', 'K'],
            label: 'Command & View Search',
            description: 'Global search palette across all menus & actions',
            icon: Search
        },
        {
            keys: ['⌘', 'J'],
            label: 'Toggle AI Copilot',
            description: 'Open autonomous Copilot troubleshooting drawer',
            icon: Bot,
            hidden: !features.copilot_enabled
        },
        {
            keys: ['⇧', 'H'],
            label: 'Instant Home View',
            description: 'Single-chord jump directly to System Overview',
            icon: Home
        },
        {
            keys: ['?'],
            label: 'Shortcuts Cheatsheet',
            description: 'Show or hide this keyboard reference modal',
            icon: Keyboard
        },
        {
            keys: ['Esc'],
            label: 'Dismiss / Close',
            description: 'Close open modals, flyouts, drawers or search',
            icon: X
        }
    ].filter(item => !item.hidden);

    const handleSelectView = (viewId?: string) => {
        if (viewId) {
            onNavigate(viewId);
            onClose();
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={onClose}
        >
            <div
                className="w-full max-w-3xl max-h-[85vh] bg-white dark:bg-[#0b1020] rounded-2xl shadow-2xl border border-slate-200 dark:border-[#1e293b] flex flex-col overflow-hidden text-slate-900 dark:text-text-primary animate-in zoom-in-95 duration-150"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-200 dark:border-[#1e293b] flex items-center justify-between bg-slate-50/50 dark:bg-[#0d1428]/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-500/20">
                            <Keyboard size={20} />
                        </div>
                        <div>
                            <h2 className="text-base font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                                Keyboard Shortcuts
                                <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                                    Quick Reference
                                </span>
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-text-muted">
                                Fast sequence navigation and global keyboard accelerators
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-slate-400 hover:text-slate-700 dark:text-text-muted dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-[#161f36] transition-colors cursor-pointer"
                        title="Close (Esc)"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Content body with 2 columns */}
                <div className="p-6 overflow-y-auto space-y-6">
                    {/* Navigation sequences */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-text-muted flex items-center gap-1.5">
                                <Command size={13} className="text-blue-500" />
                                Go-To Menu Navigation
                            </span>
                            <span className="text-[11px] font-mono text-slate-400 dark:text-text-muted/70">
                                Press <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-[#161f36] text-slate-700 dark:text-slate-300 font-bold">G</kbd> then key
                            </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {navShortcuts.map((item, idx) => {
                                const IconComponent = item.icon || CornerDownLeft;
                                return (
                                    <div
                                        key={idx}
                                        onClick={() => handleSelectView(item.viewId)}
                                        className={cn(
                                            "flex items-center justify-between p-2.5 rounded-xl border border-slate-200/80 dark:border-[#1e293b]/70 bg-slate-50/50 dark:bg-[#0e162d]/40 transition-all group",
                                            item.viewId && "hover:bg-blue-50/60 dark:hover:bg-blue-950/30 hover:border-blue-400/50 cursor-pointer"
                                        )}
                                    >
                                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                            <div className="w-7 h-7 rounded-lg bg-slate-200/60 dark:bg-[#161f36] text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors">
                                                <IconComponent size={14} />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
                                                    {item.label}
                                                </div>
                                                <div className="text-[10px] text-slate-400 dark:text-text-muted truncate">
                                                    {item.description}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1 shrink-0">
                                            {item.keys.map((k, kIdx) => (
                                                <React.Fragment key={kIdx}>
                                                    <kbd className="px-1.5 py-0.5 min-w-[20px] text-center font-mono text-[11px] font-bold rounded bg-slate-200 dark:bg-[#161f36] text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-[#223150] shadow-sm">
                                                        {k}
                                                    </kbd>
                                                    {kIdx < item.keys.length - 1 && (
                                                        <span className="text-[10px] text-slate-400 dark:text-text-muted">then</span>
                                                    )}
                                                </React.Fragment>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* System & Global Actions */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-text-muted flex items-center gap-1.5">
                                <Keyboard size={13} className="text-purple-500" />
                                Global Shortcuts & Actions
                            </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {systemShortcuts.map((item, idx) => {
                                const IconComponent = item.icon || CornerDownLeft;
                                return (
                                    <div
                                        key={idx}
                                        className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200/80 dark:border-[#1e293b]/70 bg-slate-50/50 dark:bg-[#0e162d]/40"
                                    >
                                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                            <div className="w-7 h-7 rounded-lg bg-slate-200/60 dark:bg-[#161f36] text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
                                                <IconComponent size={14} />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                                                    {item.label}
                                                </div>
                                                <div className="text-[10px] text-slate-400 dark:text-text-muted truncate">
                                                    {item.description}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1 shrink-0">
                                            {item.keys.map((k, kIdx) => (
                                                <React.Fragment key={kIdx}>
                                                    <kbd className="px-1.5 py-0.5 min-w-[20px] text-center font-mono text-[11px] font-bold rounded bg-slate-200 dark:bg-[#161f36] text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-[#223150] shadow-sm">
                                                        {k}
                                                    </kbd>
                                                    {kIdx < item.keys.length - 1 && (
                                                        <span className="text-[10px] text-slate-400 dark:text-text-muted">+</span>
                                                    )}
                                                </React.Fragment>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-3 bg-slate-50 dark:bg-[#080d1a] border-t border-slate-200 dark:border-[#1e293b] flex items-center justify-between text-xs text-slate-500 dark:text-text-muted">
                    <span className="flex items-center gap-1 text-[11px]">
                        <span>Tip: Single-key shortcuts are automatically ignored when typing in form inputs.</span>
                    </span>
                    <button
                        onClick={onClose}
                        className="px-3 py-1 rounded-lg bg-slate-200 dark:bg-[#161f36] hover:bg-slate-300 dark:hover:bg-[#1e293b] text-slate-700 dark:text-slate-200 font-semibold text-xs transition-colors cursor-pointer"
                    >
                        Got it
                    </button>
                </div>
            </div>
        </div>
    );
};
