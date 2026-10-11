import React, { useState } from 'react';
import type { NavDomainConfig } from '../../config/navigationConfig';
import { STIGIX_NAVIGATION_DOMAINS } from '../../config/navigationConfig';
import { cn } from '../../lib/utils';
import { Bot } from 'lucide-react';
import { SidebarFlyout } from './SidebarFlyout';

interface SidebarRailProps {
    activeView: string;
    onNavigate: (viewId: string, subTab?: string) => void;
    isLeader: boolean;
    features: {
        xfr_enabled?: boolean;
        pcap_enabled?: boolean;
        copilot_enabled?: boolean;
    };
    activeTasks?: Record<string, boolean>;
    copilotDrawerOpen?: boolean;
    onToggleCopilot?: () => void;
}

export const SidebarRail: React.FC<SidebarRailProps> = ({
    activeView,
    onNavigate,
    isLeader,
    features,
    activeTasks = {},
    copilotDrawerOpen,
    onToggleCopilot
}) => {
    const [hoveredDomain, setHoveredDomain] = useState<NavDomainConfig | null>(null);
    const [isFlyoutOpen, setIsFlyoutOpen] = useState(false);
    const hoverTimeoutRef = React.useRef<any>(null);

    const handleMouseEnterDomain = (domain: NavDomainConfig) => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        // Single item domain (like 'Home') navigates directly or shows small tooltip
        if (domain.items.length === 1) {
            setIsFlyoutOpen(false);
            setHoveredDomain(null);
            return;
        }
        setHoveredDomain(domain);
        setIsFlyoutOpen(true);
    };

    const handleMouseLeaveRail = () => {
        hoverTimeoutRef.current = setTimeout(() => {
            setIsFlyoutOpen(false);
            setHoveredDomain(null);
        }, 300);
    };

    const handleDomainClick = (domain: NavDomainConfig) => {
        if (domain.items.length === 1) {
            onNavigate(domain.items[0].id, domain.items[0].subTab);
            setIsFlyoutOpen(false);
            setHoveredDomain(null);
        } else {
            setHoveredDomain(domain);
            setIsFlyoutOpen(prev => !prev);
        }
    };

    return (
        <>
            <aside
                onMouseLeave={handleMouseLeaveRail}
                className={cn(
                    "fixed top-0 left-0 bottom-0 w-14 z-40 select-none",
                    "bg-[#070b14] border-r border-[#1e293b]/80 shadow-2xl",
                    "flex flex-col items-center py-3.5 gap-2",
                    "transition-all duration-200"
                )}
            >
                {/* Brand Stigix Glowing Icon */}
                <button
                    onClick={() => onNavigate('home')}
                    title="Stigix Home (⌘H)"
                    className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/25 border border-white/20 hover:scale-105 active:scale-95 transition-all group mb-2 cursor-pointer"
                >
                    <span className="font-black text-base tracking-tighter text-white group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]">
                        S
                    </span>
                </button>

                <div className="w-6 h-[1px] bg-[#1e293b]/70 my-1" />

                {/* Primary Functional Domains (SCM Navigation) */}
                <div className="flex-1 w-full flex flex-col items-center gap-2">
                    {STIGIX_NAVIGATION_DOMAINS.map((domain) => {
                        const Icon = domain.icon;

                        // Check if domain is active based on activeView
                        const isDomainActive = domain.items.some(
                            item => item.id === activeView || (domain.id === 'home' && (activeView === 'home'))
                        );

                        // Check if any child item has a background active job
                        const hasRunningTask = domain.items.some(
                            item => item.runningKey && activeTasks[item.runningKey]
                        );

                        return (
                            <div key={domain.id} className="relative group/rail flex items-center justify-center">
                                <button
                                    onClick={() => handleDomainClick(domain)}
                                    onMouseEnter={() => handleMouseEnterDomain(domain)}
                                    className={cn(
                                        "w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150 relative cursor-pointer",
                                        isDomainActive
                                            ? "bg-blue-600/20 text-blue-400 border border-blue-500/40 shadow-md shadow-blue-500/20"
                                            : "text-text-muted hover:text-white hover:bg-[#161f36]/80"
                                    )}
                                >
                                    <Icon size={18} className="transition-transform group-hover/rail:scale-110" />

                                    {/* Active Left Pill Indicator */}
                                    {isDomainActive && (
                                        <div className="absolute -left-[9px] top-2 bottom-2 w-1 bg-blue-500 rounded-r-full shadow-[0_0_10px_rgba(59,130,246,0.8)]" />
                                    )}

                                    {/* Running Background Task Pulse Dot */}
                                    {hasRunningTask && (
                                        <div className="absolute top-1.5 right-1.5 flex items-center justify-center">
                                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping opacity-75 absolute" />
                                            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
                                        </div>
                                    )}

                                    {/* Right chevron indicator for flyout domains */}
                                    {domain.items.length > 1 && (
                                        <span className="absolute right-0.5 top-1/2 -translate-y-1/2 text-[9px] text-text-muted/40 font-black">
                                            ›
                                        </span>
                                    )}
                                </button>

                                {/* Tooltip when flyout is closed */}
                                {!isFlyoutOpen && (
                                    <div className="absolute left-full ml-2 px-2.5 py-1 bg-[#0f172a] text-white text-[11px] font-bold rounded-lg border border-[#1e293b] shadow-2xl opacity-0 scale-95 pointer-events-none group-hover/rail:opacity-100 group-hover/rail:scale-100 transition-all z-50 whitespace-nowrap">
                                        {domain.label}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="w-6 h-[1px] bg-[#1e293b]/70 my-1" />

                {/* Bottom Global Utilities */}
                <div className="flex flex-col items-center gap-2">
                    {/* Quick Copilot Drawer Trigger */}
                    {features.copilot_enabled && (
                        <button
                            onClick={onToggleCopilot}
                            title="Stigix AI Copilot Assistant (⌘J)"
                            className={cn(
                                "w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150 relative cursor-pointer group",
                                copilotDrawerOpen
                                    ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/25"
                                    : "text-text-muted hover:text-indigo-400 hover:bg-[#161f36]/80"
                            )}
                        >
                            <Bot size={18} className="group-hover:rotate-12 transition-transform" />
                            <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        </button>
                    )}
                </div>
            </aside>

            {/* SCM Floating Flyout Panel */}
            <SidebarFlyout
                domain={hoveredDomain}
                activeView={activeView}
                isOpen={isFlyoutOpen}
                onClose={() => setIsFlyoutOpen(false)}
                onNavigate={onNavigate}
                isLeader={isLeader}
                features={features}
                activeTasks={activeTasks}
            />
        </>
    );
};
