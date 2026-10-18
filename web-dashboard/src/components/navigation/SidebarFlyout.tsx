import React, { useRef } from 'react';
import type { NavDomainConfig, NavItemConfig } from '../../config/navigationConfig';
import { cn } from '../../lib/utils';
import { ChevronRight, Star } from 'lucide-react';

export function getNavItemKey(item: { id: string; subTab?: string }): string {
    return item.subTab ? `${item.id}:${item.subTab}` : item.id;
}

interface SidebarFlyoutProps {
    domain: NavDomainConfig | null;
    activeView: string;
    activeSubTab?: string | null;
    isOpen: boolean;
    isPinned?: boolean;
    onClose: () => void;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    onNavigate: (viewId: string, subTab?: string) => void;
    isLeader: boolean;
    features: {
        xfr_enabled?: boolean;
        pcap_enabled?: boolean;
        copilot_enabled?: boolean;
        snapshots_enabled?: boolean;
    };
    activeTasks?: Record<string, boolean>;
    favorites?: string[];
    onToggleFavorite?: (itemKey: string) => void;
}

export const SidebarFlyout: React.FC<SidebarFlyoutProps> = ({
    domain,
    activeView,
    activeSubTab,
    isOpen,
    isPinned,
    onClose,
    onMouseEnter,
    onMouseLeave,
    onNavigate,
    isLeader,
    features,
    activeTasks = {},
    favorites = [],
    onToggleFavorite
}) => {
    const flyoutRef = useRef<HTMLDivElement>(null);

    if (!isOpen || !domain) return null;

    // Filter items based on leaderOnly and feature flags
    const visibleItems = domain.items.filter((item: NavItemConfig) => {
        if (item.leaderOnly && !isLeader) return false;
        if (item.featureFlag === 'xfr_enabled' && !features.xfr_enabled) return false;
        if (item.featureFlag === 'pcap_enabled' && !features.pcap_enabled) return false;
        if (item.featureFlag === 'copilot_enabled' && !features.copilot_enabled) return false;
        if (item.featureFlag === 'snapshots_enabled' && !features.snapshots_enabled) return false;
        return true;
    });

    // Group items if any item has a group defined
    let lastGroup: string | undefined = undefined;

    return (
        <div
            ref={flyoutRef}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            className={cn(
                "fixed left-14 top-0 bottom-0 w-96 z-50",
                // Crisp solid background for native 4K / Retina display clarity (no backdrop-filter blur artifacts)
                "bg-white dark:bg-[#0b1020]",
                "border-r border-slate-200 dark:border-[#1e293b]",
                "shadow-[20px_0_40px_rgba(0,0,0,0.12)] dark:shadow-[20px_0_50px_rgba(0,0,0,0.6)]",
                "flex flex-col py-5 px-3.5 text-slate-800 dark:text-text-primary",
                "animate-in fade-in duration-100",
                "antialiased [text-rendering:optimizeLegibility]",
                // Safe hover bridge to avoid dead zones between rail and flyout
                "before:content-[''] before:absolute before:-left-3 before:top-0 before:bottom-0 before:w-3"
            )}
        >
            {/* Header */}
            <div className="px-2.5 pb-4 mb-2 border-b border-slate-200 dark:border-[#1e293b]/70 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 shadow-inner">
                        <domain.icon size={18} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-sm font-black text-slate-900 dark:text-white tracking-wide uppercase">
                                {domain.label}
                            </h2>
                            {isPinned && (
                                <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                                    Pinned
                                </span>
                            )}
                        </div>
                        {domain.subtitle && (
                            <p className="text-[11px] text-slate-500 dark:text-text-muted/80 line-clamp-2 mt-0.5 font-medium leading-snug">
                                {domain.subtitle}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Items List */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-[#1e293b]">
                {visibleItems.map((item) => {
                    // Check if item is active (matching id and subTab if defined)
                    const isItemActive = item.subTab
                        ? (activeView === item.id && activeSubTab === item.subTab)
                        : (activeView === item.id);

                    const isRunning = item.runningKey ? activeTasks[item.runningKey] : false;
                    const Icon = item.icon;
                    const itemKey = getNavItemKey(item);
                    const isFavorite = favorites.includes(itemKey);

                    const renderGroupHeader = item.group && item.group !== lastGroup;
                    if (item.group) lastGroup = item.group;

                    return (
                        <React.Fragment key={`${item.id}-${item.subTab || 'default'}`}>
                            {renderGroupHeader && (
                                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-text-muted/60 px-2.5 pt-3 pb-1">
                                    {item.group}
                                </div>
                            )}

                            <div
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onNavigate(item.id, item.subTab);
                                    onClose();
                                }}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        onNavigate(item.id, item.subTab);
                                        onClose();
                                    }
                                }}
                                className={cn(
                                    "w-full text-left p-2.5 rounded-xl flex items-start gap-3 transition-all duration-150 group relative cursor-pointer border",
                                    isItemActive
                                        ? "bg-blue-50 dark:bg-blue-600/15 border-blue-200 dark:border-blue-500/30 text-blue-900 dark:text-white shadow-sm shadow-blue-500/10"
                                        : "bg-transparent hover:bg-slate-100 dark:hover:bg-card-secondary/70 border-transparent hover:border-slate-200 dark:hover:border-[#1e293b]/60 text-slate-700 dark:text-text-secondary hover:text-slate-900 dark:hover:text-white"
                                )}
                            >
                                <div className={cn(
                                    "p-1.5 rounded-lg mt-0.5 transition-colors relative flex-shrink-0",
                                    isItemActive
                                        ? "bg-blue-600 dark:bg-blue-500 text-white shadow-md shadow-blue-500/30"
                                        : "bg-slate-100 dark:bg-[#161f36] text-slate-500 dark:text-text-muted group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:bg-blue-50 dark:group-hover:bg-blue-500/10"
                                )}>
                                    <Icon size={15} />
                                    {isRunning && (
                                        <span
                                            title="Service actively running"
                                            className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white dark:border-[#0b1020] shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-pulse"
                                        />
                                    )}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-1">
                                        <span className={cn(
                                            "text-xs font-bold tracking-tight truncate",
                                            isItemActive
                                                ? "text-blue-700 dark:text-blue-300 font-black"
                                                : "group-hover:text-slate-900 dark:group-hover:text-white"
                                        )}>
                                            {item.label}
                                        </span>

                                        {item.leaderOnly && (
                                            <span className="text-[9px] font-black uppercase text-purple-600 dark:text-purple-400 px-1.5 py-0.2 rounded bg-purple-500/10 border border-purple-500/20">
                                                Leader
                                            </span>
                                        )}
                                    </div>

                                    {item.description && (
                                        <p className="text-[10px] text-slate-500 dark:text-text-muted/70 line-clamp-2 mt-0.5 leading-snug">
                                            {item.description}
                                        </p>
                                    )}
                                </div>

                                <div className="flex items-center gap-1 mt-0.5 shrink-0">
                                    {onToggleFavorite && (
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onToggleFavorite(itemKey);
                                            }}
                                            title={isFavorite ? "Unpin from sidebar favorites" : "Pin to sidebar favorites"}
                                            className={cn(
                                                "p-1 rounded-lg transition-all cursor-pointer",
                                                isFavorite
                                                    ? "opacity-100 text-amber-400 hover:bg-amber-500/15"
                                                    : "opacity-0 group-hover:opacity-100 text-slate-400 dark:text-text-muted/50 hover:text-amber-400 hover:bg-amber-500/10"
                                            )}
                                        >
                                            <Star size={13} className={cn(isFavorite && "fill-amber-400")} />
                                        </button>
                                    )}
                                    <ChevronRight size={13} className={cn(
                                        "text-slate-400 dark:text-text-muted/40 transition-transform opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5",
                                        isItemActive && "opacity-100 text-blue-600 dark:text-blue-400"
                                    )} />
                                </div>
                            </div>
                        </React.Fragment>
                    );
                })}
            </div>

            {/* Footer Tip */}
            <div className="pt-3 mt-2 border-t border-slate-200 dark:border-[#1e293b]/70 px-2 text-[10px] text-slate-400 dark:text-text-muted/60 flex items-center justify-between">
                <span className="flex items-center gap-1">
                    <Star size={10} className="text-amber-400 fill-amber-400" />
                    <span>Click ★ to pin shortcuts to rail</span>
                </span>
                <span className="font-mono">v3.0.0</span>
            </div>
        </div>
    );
};
