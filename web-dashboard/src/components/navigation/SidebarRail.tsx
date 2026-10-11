import React, { useState, useEffect, useRef } from 'react';
import type { NavDomainConfig } from '../../config/navigationConfig';
import { STIGIX_NAVIGATION_DOMAINS } from '../../config/navigationConfig';
import { cn } from '../../lib/utils';
import { Bot, User, Sun, Moon, UserPlus, Key, LogOut } from 'lucide-react';
import { SidebarFlyout } from './SidebarFlyout';

interface SidebarRailProps {
    activeView: string;
    activeSubTab?: string | null;
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
    username?: string | null;
    theme?: 'dark' | 'light';
    onToggleTheme?: () => void;
    onAddUser?: () => void;
    onChangePassword?: () => void;
    onLogout?: () => void;
}

export const SidebarRail: React.FC<SidebarRailProps> = ({
    activeView,
    activeSubTab,
    onNavigate,
    isLeader,
    features,
    activeTasks = {},
    copilotDrawerOpen,
    onToggleCopilot,
    username = 'admin',
    theme = 'dark',
    onToggleTheme,
    onAddUser,
    onChangePassword,
    onLogout
}) => {
    const currentUsername = username || 'admin';
    const [activeDomain, setActiveDomain] = useState<NavDomainConfig | null>(null);
    const [isPinned, setIsPinned] = useState(false);
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const hoverTimeoutRef = useRef<any>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Cancel pending close
    const cancelCloseTimer = () => {
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
            hoverTimeoutRef.current = null;
        }
    };

    // Schedule close with generous grace period (450ms)
    const scheduleCloseTimer = () => {
        if (isPinned) return; // Do not close on mouse-out if pinned by click
        cancelCloseTimer();
        hoverTimeoutRef.current = setTimeout(() => {
            setActiveDomain(null);
        }, 450);
    };

    const handleMouseEnterDomain = (domain: NavDomainConfig) => {
        cancelCloseTimer();
        if (domain.items.length === 1) {
            if (!isPinned) {
                setActiveDomain(null);
            }
            return;
        }
        if (!isPinned) {
            setActiveDomain(domain);
        }
    };

    const handleDomainClick = (domain: NavDomainConfig) => {
        cancelCloseTimer();
        if (domain.items.length === 1) {
            onNavigate(domain.items[0].id, domain.items[0].subTab);
            setActiveDomain(null);
            setIsPinned(false);
            return;
        }

        if (activeDomain?.id === domain.id && isPinned) {
            setActiveDomain(null);
            setIsPinned(false);
        } else {
            setActiveDomain(domain);
            setIsPinned(true);
        }
    };

    // Close on click outside rail, flyout & user menu
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setActiveDomain(null);
                setIsPinned(false);
                setIsUserMenuOpen(false);
            }
        };

        document.addEventListener('pointerdown', handleClickOutside);
        return () => {
            document.removeEventListener('pointerdown', handleClickOutside);
            cancelCloseTimer();
        };
    }, []);

    const isFlyoutOpen = Boolean(activeDomain);

    return (
        <div ref={containerRef} className="relative z-40">
            {/* 56px SCM Left Rail */}
            <aside
                onMouseEnter={cancelCloseTimer}
                onMouseLeave={scheduleCloseTimer}
                className={cn(
                    "fixed top-0 left-0 bottom-0 w-14 z-40 select-none",
                    "bg-white dark:bg-[#070b14] border-r border-slate-200 dark:border-[#1e293b] shadow-xl",
                    "flex flex-col items-center py-3.5 gap-2",
                    "antialiased [text-rendering:optimizeLegibility]",
                    "transition-colors duration-200"
                )}
            >
                {/* Brand Stigix Glowing Icon */}
                <button
                    onClick={() => {
                        onNavigate('home');
                        setActiveDomain(null);
                        setIsPinned(false);
                    }}
                    title="Stigix Home (⌘H)"
                    className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/25 border border-white/20 hover:scale-105 active:scale-95 transition-all group mb-2 cursor-pointer"
                >
                    <span className="font-black text-base tracking-tighter text-white group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]">
                        S
                    </span>
                </button>

                <div className="w-6 h-[1px] bg-slate-200 dark:bg-[#1e293b]/70 my-1" />

                {/* Primary Functional Domains (SCM Navigation) */}
                <div className="flex-1 w-full flex flex-col items-center gap-2">
                    {STIGIX_NAVIGATION_DOMAINS.map((domain) => {
                        const Icon = domain.icon;

                        const isDomainActive = domain.items.some(
                            item => item.id === activeView || (domain.id === 'home' && (activeView === 'home'))
                        );

                        const isDomainOpen = activeDomain?.id === domain.id;

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
                                        isDomainOpen
                                            ? "bg-blue-600/15 dark:bg-blue-600/25 text-blue-600 dark:text-blue-400 border border-blue-400 dark:border-blue-500/50 shadow-md shadow-blue-500/20"
                                            : isDomainActive
                                                ? "bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/40 shadow-sm"
                                                : "text-slate-500 dark:text-text-muted hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#161f36]/80"
                                    )}
                                >
                                    <Icon size={18} className="transition-transform group-hover/rail:scale-110" />

                                    {/* Active Left Pill Indicator */}
                                    {isDomainActive && (
                                        <div className="absolute -left-[9px] top-2 bottom-2 w-1 bg-blue-600 dark:bg-blue-500 rounded-r-full shadow-[0_0_10px_rgba(59,130,246,0.8)]" />
                                    )}

                                    {/* Running Background Task Pulse Dot */}
                                    {hasRunningTask && (
                                        <div className="absolute top-1.5 right-1.5 flex items-center justify-center">
                                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping opacity-75 absolute" />
                                            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
                                        </div>
                                    )}

                                    {/* Right chevron indicator for flyout domains */}
                                    {domain.items.length > 1 && (
                                        <span className={cn(
                                            "absolute right-0.5 top-1/2 -translate-y-1/2 text-[9px] font-black transition-colors",
                                            isDomainOpen ? "text-blue-600 dark:text-blue-400" : "text-slate-300 dark:text-text-muted/40"
                                        )}>
                                            ›
                                        </span>
                                    )}
                                </button>

                                {/* Tooltip when flyout is closed */}
                                {!isFlyoutOpen && (
                                    <div className="absolute left-full ml-2 px-2.5 py-1 bg-slate-900 dark:bg-[#0f172a] text-white text-[11px] font-bold rounded-lg border border-slate-700 dark:border-[#1e293b] shadow-2xl opacity-0 scale-95 pointer-events-none group-hover/rail:opacity-100 group-hover/rail:scale-100 transition-all z-50 whitespace-nowrap">
                                        {domain.label}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="w-6 h-[1px] bg-slate-200 dark:bg-[#1e293b]/70 my-1" />

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
                                    : "text-slate-500 dark:text-text-muted hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-[#161f36]/80"
                            )}
                        >
                            <Bot size={18} className="group-hover:rotate-12 transition-transform" />
                            <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        </button>
                    )}

                    {/* User Profile Avatar Button */}
                    <button
                        onClick={() => setIsUserMenuOpen(prev => !prev)}
                        title={`Logged in as ${username}`}
                        className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150 cursor-pointer relative",
                            isUserMenuOpen
                                ? "bg-blue-600 text-white shadow-md shadow-blue-500/30"
                                : "bg-slate-100 dark:bg-[#161f36] text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 border border-slate-200 dark:border-[#1e293b]"
                        )}
                    >
                        <User size={18} />
                    </button>
                </div>
            </aside>

            {/* User Profile Popover Menu */}
            {isUserMenuOpen && (
                <div className="fixed left-16 bottom-3 w-60 z-50 bg-white dark:bg-[#0b1020] border border-slate-200 dark:border-[#1e293b] rounded-2xl shadow-2xl p-2.5 antialiased animate-in fade-in slide-in-from-left-2 duration-150 text-slate-800 dark:text-text-primary">
                    {/* User Info Header */}
                    <div className="px-3 py-2 border-b border-slate-100 dark:border-[#1e293b]/70 flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-xs">
                            {currentUsername.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="font-bold text-xs truncate text-slate-900 dark:text-white">
                                {currentUsername}
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-text-muted">
                                {currentUsername === 'admin' ? 'Administrator' : 'Operator'}
                            </div>
                        </div>
                    </div>

                    <div className="py-1.5 space-y-0.5">
                        {/* Theme Toggle */}
                        {onToggleTheme && (
                            <button
                                onClick={() => {
                                    onToggleTheme();
                                    setIsUserMenuOpen(false);
                                }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#161f36] transition-colors cursor-pointer"
                            >
                                {theme === 'dark' ? <Sun size={15} className="text-yellow-400" /> : <Moon size={15} className="text-slate-600" />}
                                <span>{theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}</span>
                            </button>
                        )}

                        {/* Add User (Admin only) */}
                        {username === 'admin' && onAddUser && (
                            <button
                                onClick={() => {
                                    onAddUser();
                                    setIsUserMenuOpen(false);
                                }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#161f36] transition-colors cursor-pointer"
                            >
                                <UserPlus size={15} className="text-emerald-500" />
                                <span>Add New User</span>
                            </button>
                        )}

                        {/* Change Password */}
                        {onChangePassword && (
                            <button
                                onClick={() => {
                                    onChangePassword();
                                    setIsUserMenuOpen(false);
                                }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#161f36] transition-colors cursor-pointer"
                            >
                                <Key size={15} className="text-blue-500" />
                                <span>Change Password</span>
                            </button>
                        )}

                        <div className="my-1 border-t border-slate-100 dark:border-[#1e293b]/70" />

                        {/* Logout */}
                        {onLogout && (
                            <button
                                onClick={() => {
                                    onLogout();
                                    setIsUserMenuOpen(false);
                                }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors cursor-pointer"
                            >
                                <LogOut size={15} />
                                <span>Sign Out</span>
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* SCM Floating Flyout Panel */}
            <SidebarFlyout
                domain={activeDomain}
                activeView={activeView}
                activeSubTab={activeSubTab}
                isOpen={isFlyoutOpen}
                isPinned={isPinned}
                onMouseEnter={cancelCloseTimer}
                onMouseLeave={scheduleCloseTimer}
                onClose={() => {
                    setActiveDomain(null);
                    setIsPinned(false);
                }}
                onNavigate={(viewId, subTab) => {
                    onNavigate(viewId, subTab);
                    setActiveDomain(null);
                    setIsPinned(false);
                }}
                isLeader={isLeader}
                features={features}
                activeTasks={activeTasks}
            />
        </div>
    );
};
