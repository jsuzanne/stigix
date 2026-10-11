import React, { useRef } from 'react';
import type { NavDomainConfig, NavItemConfig } from '../../config/navigationConfig';
import { cn } from '../../lib/utils';
import { ChevronRight } from 'lucide-react';

interface SidebarFlyoutProps {
    domain: NavDomainConfig | null;
    activeView: string;
    isOpen: boolean;
    onClose: () => void;
    onNavigate: (viewId: string, subTab?: string) => void;
    isLeader: boolean;
    features: {
        xfr_enabled?: boolean;
        pcap_enabled?: boolean;
        copilot_enabled?: boolean;
    };
    activeTasks?: Record<string, boolean>;
}

export const SidebarFlyout: React.FC<SidebarFlyoutProps> = ({
    domain,
    activeView,
    isOpen,
    onClose,
    onNavigate,
    isLeader,
    features,
    activeTasks = {}
}) => {
    const flyoutRef = useRef<HTMLDivElement>(null);

    if (!isOpen || !domain) return null;

    // Filter items based on leaderOnly and feature flags
    const visibleItems = domain.items.filter(item => {
        if (item.leaderOnly && !isLeader) return false;
        if (item.featureFlag === 'xfr_enabled' && !features.xfr_enabled) return false;
        if (item.featureFlag === 'pcap_enabled' && !features.pcap_enabled) return false;
        if (item.featureFlag === 'copilot_enabled' && !features.copilot_enabled) return false;
        return true;
    });

    // Group items if any item has a group defined
    let lastGroup: string | undefined = undefined;

    return (
        <div
            ref={flyoutRef}
            onMouseLeave={onClose}
            className={cn(
                "fixed left-14 top-0 bottom-0 w-80 z-50",
                "bg-[#0a0f1d]/95 backdrop-blur-2xl border-r border-[#1e293b]/80 shadow-[25px_0_50px_rgba(0,0,0,0.6)]",
                "flex flex-col py-5 px-3.5 text-text-primary",
                "animate-in fade-in slide-in-from-left-4 duration-200"
            )}
        >
            {/* Header */}
            <div className="px-2.5 pb-4 mb-2 border-b border-[#1e293b]/70">
                <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 shadow-inner">
                        <domain.icon size={18} />
                    </div>
                    <div>
                        <h2 className="text-sm font-black text-white tracking-wide uppercase">
                            {domain.label}
                        </h2>
                        {domain.subtitle && (
                            <p className="text-[11px] text-text-muted/80 line-clamp-1 mt-0.5 font-medium">
                                {domain.subtitle}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Items List */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin scrollbar-thumb-[#1e293b]">
                {visibleItems.map((item) => {
                    const isItemActive = activeView === item.id;
                    const isRunning = item.runningKey ? activeTasks[item.runningKey] : false;
                    const Icon = item.icon;

                    const renderGroupHeader = item.group && item.group !== lastGroup;
                    if (item.group) lastGroup = item.group;

                    return (
                        <React.Fragment key={`${item.id}-${item.subTab || 'default'}`}>
                            {renderGroupHeader && (
                                <div className="text-[10px] font-black uppercase tracking-wider text-text-muted/60 px-2.5 pt-3 pb-1">
                                    {item.group}
                                </div>
                            )}

                            <button
                                onClick={() => {
                                    onNavigate(item.id, item.subTab);
                                    onClose();
                                }}
                                className={cn(
                                    "w-full text-left p-2.5 rounded-xl flex items-start gap-3 transition-all duration-150 group relative cursor-pointer border",
                                    isItemActive
                                        ? "bg-blue-600/15 border-blue-500/30 text-white shadow-sm shadow-blue-500/10"
                                        : "bg-transparent hover:bg-card-secondary/70 border-transparent hover:border-[#1e293b]/60 text-text-secondary hover:text-white"
                                )}
                            >
                                <div className={cn(
                                    "p-1.5 rounded-lg mt-0.5 transition-colors",
                                    isItemActive
                                        ? "bg-blue-500 text-white shadow-md shadow-blue-500/30"
                                        : "bg-[#161f36] text-text-muted group-hover:text-blue-400 group-hover:bg-blue-500/10"
                                )}>
                                    <Icon size={15} />
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-1">
                                        <span className={cn(
                                            "text-xs font-bold tracking-tight truncate",
                                            isItemActive ? "text-blue-300 font-black" : "group-hover:text-white"
                                        )}>
                                            {item.label}
                                        </span>

                                        {isRunning && (
                                            <span className="flex items-center gap-1 text-[9px] font-black uppercase text-emerald-400 px-1.5 py-0.2 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                                Active
                                            </span>
                                        )}
                                        {item.leaderOnly && (
                                            <span className="text-[9px] font-black uppercase text-purple-400 px-1.5 py-0.2 rounded bg-purple-500/10 border border-purple-500/20">
                                                Leader
                                            </span>
                                        )}
                                    </div>

                                    {item.description && (
                                        <p className="text-[10px] text-text-muted/70 line-clamp-1 mt-0.5 leading-tight">
                                            {item.description}
                                        </p>
                                    )}
                                </div>

                                <ChevronRight size={13} className={cn(
                                    "text-text-muted/40 transition-transform mt-1 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5",
                                    isItemActive && "opacity-100 text-blue-400"
                                )} />
                            </button>
                        </React.Fragment>
                    );
                })}
            </div>

            {/* Footer Tip */}
            <div className="pt-3 mt-2 border-t border-[#1e293b]/70 px-2 text-[10px] text-text-muted/60 flex items-center justify-between">
                <span>Stigix Platform</span>
                <span className="font-mono">v3.0.0-dev</span>
            </div>
        </div>
    );
};
