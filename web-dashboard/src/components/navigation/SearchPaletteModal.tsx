import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    Search,
    X,
    ChevronRight,
    CornerDownLeft,
    UserPlus,
    Bot,
    Sun,
    Moon,
    Star
} from 'lucide-react';
import { STIGIX_NAVIGATION_DOMAINS } from '../../config/navigationConfig';
import type { NavItemConfig } from '../../config/navigationConfig';
import { cn } from '../../lib/utils';
import { loadSavedFavorites, FAVORITES_STORAGE_KEY } from './SidebarRail';

export interface SearchPaletteModalProps {
    isOpen: boolean;
    onClose: () => void;
    onNavigate: (viewId: string, subTab?: string) => void;
    isLeader: boolean;
    features: {
        xfr_enabled?: boolean;
        pcap_enabled?: boolean;
        copilot_enabled?: boolean;
        snapshots_enabled?: boolean;
    };
    onOpenMagicJoin?: () => void;
    onToggleCopilot?: () => void;
    theme?: 'dark' | 'light';
    onToggleTheme?: () => void;
}

interface PaletteItem {
    id: string;
    subTab?: string;
    itemKey: string;
    label: string;
    domainId: string;
    domainLabel: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    description?: string;
    group?: string;
    keywords?: string[];
    action?: () => void;
    badge?: string;
    badgeColor?: string;
}

export const SearchPaletteModal: React.FC<SearchPaletteModalProps> = ({
    isOpen,
    onClose,
    onNavigate,
    isLeader,
    features,
    onOpenMagicJoin,
    onToggleCopilot,
    theme,
    onToggleTheme
}) => {
    const [query, setQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [favorites, setFavorites] = useState<string[]>(() => loadSavedFavorites());
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            setFavorites(loadSavedFavorites());
        }
    }, [isOpen]);

    const toggleFavorite = (e: React.MouseEvent, itemKey: string) => {
        e.stopPropagation();
        setFavorites((prev) => {
            const next = prev.includes(itemKey)
                ? prev.filter((k) => k !== itemKey)
                : [...prev, itemKey];
            try {
                localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next));
                window.dispatchEvent(new CustomEvent('stigix-favorites-updated', { detail: next }));
            } catch {
                // ignore storage errors
            }
            return next;
        });
    };

    // Build the master searchable items index
    const allItems = useMemo<PaletteItem[]>(() => {
        const items: PaletteItem[] = [];

        STIGIX_NAVIGATION_DOMAINS.forEach((domain) => {
            domain.items.forEach((item: NavItemConfig) => {
                // Check feature flags & leader permissions
                if (item.leaderOnly && !isLeader) return;
                if (item.featureFlag === 'xfr_enabled' && !features.xfr_enabled) return;
                if (item.featureFlag === 'pcap_enabled' && !features.pcap_enabled) return;
                if (item.featureFlag === 'copilot_enabled' && !features.copilot_enabled) return;
                if (item.featureFlag === 'snapshots_enabled' && !features.snapshots_enabled) return;

                items.push({
                    id: item.id,
                    subTab: item.subTab,
                    itemKey: item.subTab ? `${item.id}:${item.subTab}` : item.id,
                    label: item.label,
                    domainId: domain.id,
                    domainLabel: domain.label,
                    icon: item.icon,
                    description: item.description,
                    group: item.group,
                    keywords: item.keywords,
                    badge: item.id === 'home' ? '⇧H' : undefined
                });
            });
        });

        // Quick System Actions
        if (isLeader && onOpenMagicJoin) {
            items.push({
                id: 'action-magic-join',
                itemKey: 'action-magic-join',
                label: 'Magic Join — Add Remote Node',
                domainId: 'actions',
                domainLabel: 'Quick Action',
                icon: UserPlus,
                description: 'Generate zero-touch onboarding token for Linux VM or bare-metal edge',
                keywords: ['magic join', 'onboard', 'node', 'token', 'curl', 'install', 'peer'],
                action: onOpenMagicJoin,
                badge: 'Leader',
                badgeColor: 'bg-purple-500/10 text-purple-500 border-purple-500/20'
            });
        }

        if (features.copilot_enabled && onToggleCopilot) {
            items.push({
                id: 'action-copilot',
                itemKey: 'action-copilot',
                label: 'Stigix AI Copilot Assistant',
                domainId: 'actions',
                domainLabel: 'Quick Action',
                icon: Bot,
                description: 'Open AI Assistant for real-time network diagnosis & root cause analysis',
                keywords: ['copilot', 'ai', 'assistant', 'chat', 'claude', 'diagnose', 'bot'],
                action: onToggleCopilot,
                badge: '⌘J',
                badgeColor: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20'
            });
        }

        if (onToggleTheme) {
            items.push({
                id: 'action-theme',
                itemKey: 'action-theme',
                label: theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
                domainId: 'actions',
                domainLabel: 'Quick Action',
                icon: theme === 'dark' ? Sun : Moon,
                description: 'Toggle platform interface color theme',
                keywords: ['theme', 'dark', 'light', 'mode', 'color', 'appearance'],
                action: onToggleTheme
            });
        }

        return items;
    }, [isLeader, features, onOpenMagicJoin, onToggleCopilot, onToggleTheme, theme]);

    // Filter items based on category and search query
    const filteredItems = useMemo(() => {
        const cleanQuery = query.trim().toLowerCase();

        const matches = allItems.filter((item) => {
            // Category filter
            if (selectedCategory !== 'all' && item.domainId !== selectedCategory) {
                return false;
            }

            if (!cleanQuery) return true;

            // Match query against label, domain, description, group, and keywords
            const labelMatch = item.label.toLowerCase().includes(cleanQuery);
            const domainMatch = item.domainLabel.toLowerCase().includes(cleanQuery);
            const descMatch = item.description?.toLowerCase().includes(cleanQuery);
            const groupMatch = item.group?.toLowerCase().includes(cleanQuery);
            const keywordMatch = item.keywords?.some(k => k.toLowerCase().includes(cleanQuery));

            return labelMatch || domainMatch || descMatch || groupMatch || keywordMatch;
        });

        if (!cleanQuery) {
            return [...matches].sort((a, b) => {
                const aFav = favorites.includes(a.itemKey) ? 0 : 1;
                const bFav = favorites.includes(b.itemKey) ? 0 : 1;
                return aFav - bFav;
            });
        }

        return matches;
    }, [allItems, selectedCategory, query, favorites]);

    // Reset selection index when filter changes
    useEffect(() => {
        setSelectedIndex(0);
    }, [query, selectedCategory]);

    // Auto-focus input when opened
    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setSelectedCategory('all');
            setSelectedIndex(0);
            setTimeout(() => {
                inputRef.current?.focus();
            }, 50);
        }
    }, [isOpen]);

    // Keyboard navigation within the modal
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex((prev) => (prev < filteredItems.length - 1 ? prev + 1 : 0));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredItems.length - 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const activeItem = filteredItems[selectedIndex];
            if (activeItem) {
                executeItem(activeItem);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    };

    // Scroll active item into view
    useEffect(() => {
        if (listRef.current) {
            const activeElem = listRef.current.children[selectedIndex] as HTMLElement;
            if (activeElem) {
                activeElem.scrollIntoView({ block: 'nearest' });
            }
        }
    }, [selectedIndex]);

    const executeItem = (item: PaletteItem) => {
        onClose();
        if (item.action) {
            item.action();
        } else {
            onNavigate(item.id, item.subTab);
        }
    };

    if (!isOpen) return null;

    const categories = [
        { id: 'all', label: 'All' },
        { id: 'validate', label: 'Validate' },
        { id: 'generate', label: 'Generate' },
        { id: 'network', label: 'Network' },
        { id: 'observe', label: 'Observe' },
        { id: 'settings', label: 'Settings' }
    ];

    const getDomainBadgeStyle = (domainId: string) => {
        switch (domainId) {
            case 'validate':
                return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20';
            case 'generate':
                return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
            case 'network':
                return 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20';
            case 'observe':
                return 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20';
            case 'settings':
                return 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20';
            case 'actions':
                return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
            default:
                return 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20';
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-20 px-4 animate-in fade-in duration-150 antialiased"
            onClick={onClose}
        >
            <div
                className="w-full max-w-2xl bg-white dark:bg-[#0b1020] border border-slate-200 dark:border-[#1e293b] rounded-2xl shadow-[0_25px_60px_-15px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-150"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={handleKeyDown}
            >
                {/* Search Bar Input */}
                <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-200 dark:border-[#1e293b] bg-slate-50/50 dark:bg-[#080d1a]/50">
                    <Search size={20} className="text-blue-500 shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search menus, features, tools (e.g. security, xfr, vyos, eicar)..."
                        className="flex-1 bg-transparent border-none outline-none text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-text-muted/60 font-medium"
                    />
                    {query && (
                        <button
                            onClick={() => {
                                setQuery('');
                                inputRef.current?.focus();
                            }}
                            className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors"
                        >
                            <X size={15} />
                        </button>
                    )}
                    <kbd className="hidden sm:inline-flex items-center px-2 py-0.5 text-[10px] font-mono font-bold bg-slate-100 dark:bg-[#161f36] text-slate-500 dark:text-text-muted rounded border border-slate-300 dark:border-[#1e293b]">
                        ESC
                    </kbd>
                </div>

                {/* Category Pills */}
                <div className="flex items-center gap-1.5 px-4 py-2 border-b border-slate-100 dark:border-[#1e293b]/70 overflow-x-auto scrollbar-none bg-white dark:bg-[#0b1020]">
                    {categories.map((cat) => (
                        <button
                            key={cat.id}
                            onClick={() => setSelectedCategory(cat.id)}
                            className={cn(
                                "px-2.5 py-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer",
                                selectedCategory === cat.id
                                    ? "bg-blue-600 text-white shadow-sm shadow-blue-500/20"
                                    : "text-slate-500 dark:text-text-muted hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#161f36]"
                            )}
                        >
                            {cat.label}
                        </button>
                    ))}
                </div>

                {/* Results List */}
                <div
                    ref={listRef}
                    className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-[#1e293b]"
                >
                    {filteredItems.length === 0 ? (
                        <div className="py-12 text-center text-slate-400 dark:text-text-muted space-y-2">
                            <Search size={32} className="mx-auto opacity-30" />
                            <p className="text-sm font-semibold">No menu items found for &ldquo;{query}&rdquo;</p>
                            <p className="text-xs opacity-70">Try searching for keywords like &ldquo;dem&rdquo;, &ldquo;xfr&rdquo;, &ldquo;threat&rdquo;, &ldquo;vyos&rdquo;, or &ldquo;maintenance&rdquo;.</p>
                        </div>
                    ) : (
                        filteredItems.map((item, index) => {
                            const isSelected = index === selectedIndex;
                            const isFav = favorites.includes(item.itemKey);
                            const Icon = item.icon;

                            return (
                                <div
                                    key={`${item.id}-${item.subTab || 'root'}-${index}`}
                                    onClick={() => executeItem(item)}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                    className={cn(
                                        "group w-full text-left p-2.5 rounded-xl flex items-center justify-between gap-3 transition-all duration-100 cursor-pointer border",
                                        isSelected
                                            ? "bg-blue-50 dark:bg-blue-600/15 border-blue-200 dark:border-blue-500/40 text-blue-900 dark:text-white shadow-sm"
                                            : "bg-transparent border-transparent hover:bg-slate-100/70 dark:hover:bg-[#161f36]/60 text-slate-700 dark:text-text-secondary"
                                    )}
                                >
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <div className={cn(
                                            "p-2 rounded-xl transition-colors shrink-0",
                                            isSelected
                                                ? "bg-blue-600 text-white shadow-md shadow-blue-500/30"
                                                : "bg-slate-100 dark:bg-[#161f36] text-slate-500 dark:text-text-muted"
                                        )}>
                                            <Icon size={16} />
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className={cn(
                                                    "text-xs font-bold truncate",
                                                    isSelected ? "text-blue-700 dark:text-blue-300 font-extrabold" : "text-slate-900 dark:text-white"
                                                )}>
                                                    {item.label}
                                                </span>
                                                {item.group && (
                                                    <span className="text-[10px] text-slate-400 dark:text-text-muted/60 font-semibold hidden md:inline">
                                                        • {item.group}
                                                    </span>
                                                )}
                                            </div>

                                            {item.description && (
                                                <p className="text-[11px] text-slate-500 dark:text-text-muted/70 truncate mt-0.5 font-medium">
                                                    {item.description}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Domain / Action Badge & Favorite Toggle */}
                                    <div className="flex items-center gap-2 shrink-0">
                                        {!item.action && (
                                            <button
                                                type="button"
                                                onClick={(e) => toggleFavorite(e, item.itemKey)}
                                                title={isFav ? 'Unpin from sidebar rail' : 'Pin shortcut to sidebar rail'}
                                                className={cn(
                                                    "p-1 rounded-md transition-all cursor-pointer",
                                                    isFav
                                                        ? "text-amber-500 dark:text-amber-400 opacity-100 hover:bg-amber-500/10"
                                                        : "text-slate-400 dark:text-text-muted/40 opacity-0 group-hover:opacity-100 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-slate-200/60 dark:hover:bg-[#1e293b]"
                                                )}
                                            >
                                                <Star size={13} className={cn(isFav && "fill-amber-400 text-amber-400")} />
                                            </button>
                                        )}

                                        <span className={cn(
                                            "text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border",
                                            item.badgeColor || getDomainBadgeStyle(item.domainId)
                                        )}>
                                            {item.badge || item.domainLabel}
                                        </span>

                                        {isSelected ? (
                                            <div className="flex items-center gap-1 text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-500/20 px-1.5 py-0.5 rounded">
                                                <span>Go</span>
                                                <CornerDownLeft size={10} />
                                            </div>
                                        ) : (
                                            <ChevronRight size={14} className="text-slate-300 dark:text-text-muted/30" />
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Footer keyboard navigation tips */}
                <div className="px-4 py-2.5 bg-slate-50 dark:bg-[#080d1a] border-t border-slate-200 dark:border-[#1e293b] flex items-center justify-between text-[11px] text-slate-400 dark:text-text-muted">
                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 font-mono text-[9px] bg-slate-200 dark:bg-[#161f36] text-slate-700 dark:text-slate-300 rounded">↑</kbd>
                            <kbd className="px-1.5 py-0.5 font-mono text-[9px] bg-slate-200 dark:bg-[#161f36] text-slate-700 dark:text-slate-300 rounded">↓</kbd>
                            <span>navigate</span>
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 font-mono text-[9px] bg-slate-200 dark:bg-[#161f36] text-slate-700 dark:text-slate-300 rounded">↵</kbd>
                            <span>select</span>
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 font-mono text-[9px] bg-slate-200 dark:bg-[#161f36] text-slate-700 dark:text-slate-300 rounded">esc</kbd>
                            <span>close</span>
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 font-mono text-[9px] bg-slate-200 dark:bg-[#161f36] text-slate-700 dark:text-slate-300 rounded">⇧H</kbd>
                            <span>home</span>
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 font-mono text-[9px] bg-slate-200 dark:bg-[#161f36] text-slate-700 dark:text-slate-300 rounded">?</kbd>
                            <span>shortcuts</span>
                        </span>
                    </div>

                    <span className="font-semibold text-[10px] text-blue-600 dark:text-blue-400">
                        {filteredItems.length} {filteredItems.length === 1 ? 'item' : 'items'}
                    </span>
                </div>
            </div>
        </div>
    );
};
