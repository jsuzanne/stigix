import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Search, X } from 'lucide-react';

export interface StigixSelectOption {
    value: string | number;
    label: string;
    sublabel?: string;
    badge?: string;
    badgeClassName?: string;
    icon?: React.ReactNode;
    isActive?: boolean;
}

export interface StigixSelectGroup {
    label: string;
    options: StigixSelectOption[];
}

interface StigixSelectProps {
    value: string | number;
    onChange: (value: string) => void;
    options?: StigixSelectOption[];
    groups?: StigixSelectGroup[];
    disabled?: boolean;
    placeholder?: string;
    className?: string;
    triggerClassName?: string;
    menuMinWidth?: number;
    minMenuWidth?: number;
    size?: 'xs' | 'sm' | 'md';
    triggerIcon?: React.ReactNode;
    accent?: 'cyan' | 'purple' | 'indigo' | 'emerald' | 'blue';
    uppercaseTrigger?: boolean;
    searchable?: boolean;
    searchPlaceholder?: string;
    showActiveToggle?: boolean;
}

export function StigixSelect({
    value,
    onChange,
    options = [],
    groups,
    disabled = false,
    placeholder = 'Select...',
    className = '',
    triggerClassName = '',
    menuMinWidth,
    minMenuWidth,
    size = 'sm',
    triggerIcon,
    accent = 'purple',
    uppercaseTrigger = false,
    searchable = false,
    searchPlaceholder = 'Filter options...',
    showActiveToggle = false,
}: StigixSelectProps) {
    const effectiveMinWidth = minMenuWidth ?? menuMinWidth ?? 200;
    const [open, setOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeOnly, setActiveOnly] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const [coords, setCoords] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);

    const allOptions: StigixSelectOption[] = groups
        ? groups.flatMap(g => g.options)
        : options;

    const selectedOption = allOptions.find(o => String(o.value) === String(value));

    // Check if there are active items (via isActive prop or 🟢 in label)
    const activeCount = allOptions.filter(o => o.isActive || o.label.includes('🟢')).length;
    const canShowActiveToggle = showActiveToggle || activeCount > 0;

    // Filter options based on search query and activeOnly toggle
    const query = searchQuery.trim().toLowerCase();
    const filterOption = (opt: StigixSelectOption) => {
        if (activeOnly && !opt.isActive && !opt.label.includes('🟢')) {
            return false;
        }
        if (!query) return true;
        const matchLabel = opt.label.toLowerCase().includes(query);
        const matchSublabel = opt.sublabel?.toLowerCase().includes(query);
        const matchBadge = opt.badge?.toLowerCase().includes(query);
        const matchValue = String(opt.value).toLowerCase().includes(query);
        return matchLabel || matchSublabel || matchBadge || matchValue;
    };

    const filteredOptions = options.filter(filterOption);
    const filteredGroups = groups
        ? groups.map(g => ({
            ...g,
            options: g.options.filter(filterOption)
        })).filter(g => g.options.length > 0)
        : null;

    const allFilteredOptions: StigixSelectOption[] = filteredGroups
        ? filteredGroups.flatMap(g => g.options)
        : filteredOptions;

    const computeCoords = () => {
        if (!triggerRef.current) return null;
        const rect = triggerRef.current.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const spaceBelow = viewportHeight - rect.bottom;
        const estimatedHeight = Math.min(380, allOptions.length * 36 + (groups ? groups.length * 28 : 16) + (searchable ? 52 : 0));
        const openUpward = spaceBelow < estimatedHeight && rect.top > spaceBelow;
        const width = Math.max(rect.width, effectiveMinWidth);
        const left = Math.min(rect.left, Math.max(8, viewportWidth - width - 12));

        return openUpward
            ? { bottom: viewportHeight - rect.top + 6, left, width }
            : { top: rect.bottom + 6, left, width };
    };

    const updatePosition = () => {
        const next = computeCoords();
        if (next) setCoords(next);
    };

    const handleToggle = () => {
        if (disabled) return;
        if (open) {
            setOpen(false);
        } else {
            const next = computeCoords();
            if (next) setCoords(next);
            setOpen(true);
        }
    };

    useLayoutEffect(() => {
        if (open) {
            updatePosition();
        }
    }, [open, value, allOptions.length, searchQuery, activeOnly]);

    // Focus search input when menu opens, reset filter when closed
    useEffect(() => {
        if (!open) {
            setSearchQuery('');
            setActiveOnly(false);
        } else if (searchable) {
            const timer = setTimeout(() => {
                searchInputRef.current?.focus();
            }, 40);
            return () => clearTimeout(timer);
        }
    }, [open, searchable]);

    useEffect(() => {
        if (!open) return;
        const handleOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            if (
                triggerRef.current && !triggerRef.current.contains(target) &&
                menuRef.current && !menuRef.current.contains(target)
            ) {
                setOpen(false);
            }
        };
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setOpen(false);
                triggerRef.current?.focus();
            } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && allFilteredOptions.length > 0) {
                e.preventDefault();
                const curIdx = allFilteredOptions.findIndex(o => String(o.value) === String(value));
                const nextIdx = e.key === 'ArrowDown'
                    ? (curIdx + 1) % allFilteredOptions.length
                    : (curIdx - 1 + allFilteredOptions.length) % allFilteredOptions.length;
                const nextOpt = allFilteredOptions[nextIdx];
                if (nextOpt) {
                    onChange(String(nextOpt.value));
                }
            } else if (e.key === 'Enter' && allFilteredOptions.length > 0 && searchQuery) {
                // Select first matching option if enter pressed while searching
                const cur = allFilteredOptions.find(o => String(o.value) === String(value));
                if (!cur && allFilteredOptions[0]) {
                    onChange(String(allFilteredOptions[0].value));
                    setOpen(false);
                    triggerRef.current?.focus();
                } else if (cur) {
                    setOpen(false);
                    triggerRef.current?.focus();
                }
            }
        };
        const handleScrollOrResize = (e: Event) => {
            if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
                return;
            }
            updatePosition();
        };

        document.addEventListener('mousedown', handleOutside);
        document.addEventListener('keydown', handleKey);
        window.addEventListener('scroll', handleScrollOrResize, true);
        window.addEventListener('resize', handleScrollOrResize);
        return () => {
            document.removeEventListener('mousedown', handleOutside);
            document.removeEventListener('keydown', handleKey);
            window.removeEventListener('scroll', handleScrollOrResize, true);
            window.removeEventListener('resize', handleScrollOrResize);
        };
    }, [open]);

    const accentBorderOpen =
        accent === 'cyan' ? 'border-cyan-500 ring-2 ring-cyan-500/15' :
        accent === 'emerald' ? 'border-emerald-500 ring-2 ring-emerald-500/15' :
        accent === 'indigo' ? 'border-indigo-500 ring-2 ring-indigo-500/15' :
        accent === 'blue' ? 'border-blue-500 ring-2 ring-blue-500/15' :
        'border-purple-500 ring-2 ring-purple-500/15';

    const accentHover =
        accent === 'cyan' ? 'hover:border-cyan-500/40' :
        accent === 'emerald' ? 'hover:border-emerald-500/40' :
        accent === 'indigo' ? 'hover:border-indigo-500/40' :
        accent === 'blue' ? 'hover:border-blue-500/40' :
        'hover:border-purple-500/40';

    const accentSelectedRow =
        accent === 'cyan' ? 'bg-cyan-500/15 text-text-primary border-cyan-500/30' :
        accent === 'emerald' ? 'bg-emerald-500/15 text-text-primary border-emerald-500/30' :
        accent === 'indigo' ? 'bg-indigo-500/15 text-text-primary border-indigo-500/30' :
        accent === 'blue' ? 'bg-blue-500/15 text-text-primary border-blue-500/30' :
        'bg-purple-500/15 text-text-primary border-purple-500/30';

    const accentCheckText =
        accent === 'cyan' ? 'text-cyan-400' :
        accent === 'emerald' ? 'text-emerald-400' :
        accent === 'indigo' ? 'text-indigo-400' :
        accent === 'blue' ? 'text-blue-400' :
        'text-purple-400';

    const renderOptionRow = (opt: StigixSelectOption) => {
        const isSelected = String(opt.value) === String(value);
        return (
            <button
                key={String(opt.value)}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                    onChange(String(opt.value));
                    setOpen(false);
                }}
                className={`w-full px-2.5 py-1.5 text-left rounded-xl flex items-center justify-between gap-2 transition-all cursor-pointer border ${
                    isSelected
                        ? `${accentSelectedRow} font-bold`
                        : 'hover:bg-card-secondary text-text-secondary border-transparent'
                }`}
            >
                <div className="flex items-center gap-2 min-w-0">
                    {opt.icon && <span className="shrink-0 flex items-center">{opt.icon}</span>}
                    <div className="min-w-0">
                        <div className={`text-xs text-text-primary truncate ${uppercaseTrigger ? 'font-black uppercase tracking-tight text-[11px]' : 'font-semibold'}`}>
                            {opt.label}
                        </div>
                        {opt.sublabel && (
                            <div className="text-[10px] font-mono text-text-muted truncate">
                                {opt.sublabel}
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    {opt.badge && (
                        <span className={opt.badgeClassName || 'px-1.5 py-0.5 rounded-md bg-card-secondary border border-border text-[10px] font-mono text-text-muted'}>
                            {opt.badge}
                        </span>
                    )}
                    {isSelected && <Check size={12} className={`${accentCheckText} shrink-0`} />}
                </div>
            </button>
        );
    };

    const sizePadding =
        size === 'xs' ? 'px-2.5 py-1 text-xs rounded-lg' :
        size === 'md' ? 'px-3.5 py-2.5 text-xs rounded-xl' :
        'px-2.5 py-1.5 text-xs rounded-lg';

    return (
        <div className={`relative ${className}`}>
            <button
                ref={triggerRef}
                type="button"
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={handleToggle}
                className={`w-full bg-card border ${sizePadding} text-text-primary flex items-center justify-between gap-2 transition-colors cursor-pointer disabled:opacity-50 ${
                    open ? accentBorderOpen : `border-border ${accentHover}`
                } ${triggerClassName}`}
            >
                <div className="flex items-center gap-2 min-w-0">
                    {(selectedOption?.icon || triggerIcon) && (
                        <span className="shrink-0 flex items-center">{selectedOption?.icon || triggerIcon}</span>
                    )}
                    <span className={`truncate ${uppercaseTrigger ? 'text-[11px] font-black uppercase tracking-tight' : 'font-medium'}`}>
                        {selectedOption ? selectedOption.label : placeholder}
                    </span>
                    {selectedOption?.badge && (
                        <span className={selectedOption.badgeClassName || 'px-1.5 py-0.5 rounded bg-card-secondary border border-border text-[10px] font-mono text-text-muted truncate'}>
                            {selectedOption.badge}
                        </span>
                    )}
                </div>
                <ChevronDown
                    size={13}
                    className={`text-text-muted shrink-0 transition-transform ${open ? `rotate-180 ${accentCheckText}` : ''}`}
                />
            </button>

            {open && coords && createPortal(
                <div
                    ref={menuRef}
                    role="listbox"
                    style={{
                        position: 'fixed',
                        top: coords.top,
                        bottom: coords.bottom,
                        left: coords.left,
                        width: coords.width,
                    }}
                    className="bg-card border border-border rounded-2xl shadow-2xl z-[300] overflow-hidden flex flex-col max-h-96 animate-in fade-in zoom-in-95 duration-150"
                >
                    {searchable && (
                        <div className="p-2 border-b border-border/60 bg-card/95 backdrop-blur-sm shrink-0 space-y-1.5">
                            <div className="relative flex items-center">
                                <Search size={12} className="absolute left-2.5 text-text-muted pointer-events-none" />
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    placeholder={searchPlaceholder}
                                    className="w-full pl-7 pr-7 py-1.5 bg-card-secondary border border-border/80 focus:border-cyan-500 rounded-xl text-xs text-text-primary placeholder:text-text-muted/60 outline-none transition-colors"
                                    onClick={e => e.stopPropagation()}
                                    onKeyDown={e => {
                                        if (e.key === 'Escape') {
                                            setOpen(false);
                                            triggerRef.current?.focus();
                                        }
                                    }}
                                />
                                {searchQuery && (
                                    <button
                                        type="button"
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-2 text-text-muted hover:text-text-primary p-0.5 rounded cursor-pointer"
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </div>

                            {canShowActiveToggle && (
                                <div className="flex items-center gap-1.5 pt-0.5">
                                    <button
                                        type="button"
                                        onClick={() => setActiveOnly(false)}
                                        className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-colors cursor-pointer ${
                                            !activeOnly
                                                ? 'bg-card-secondary text-text-primary border border-border font-bold'
                                                : 'text-text-muted hover:text-text-primary'
                                        }`}
                                    >
                                        All ({allOptions.length})
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setActiveOnly(true)}
                                        className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-colors flex items-center gap-1 cursor-pointer ${
                                            activeOnly
                                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold'
                                                : 'text-text-muted hover:text-emerald-400'
                                        }`}
                                    >
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                        <span>Active ({activeCount})</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="p-1.5 space-y-1.5 overflow-y-auto flex-1">
                        {filteredGroups ? (
                            filteredGroups.length > 0 ? (
                                filteredGroups.map((group, gIdx) => (
                                    <div
                                        key={group.label}
                                        className={gIdx > 0 ? 'pt-1.5 border-t border-border/60 space-y-0.5' : 'space-y-0.5'}
                                    >
                                        <div className="px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-text-muted opacity-70 flex items-center justify-between">
                                            <span>{group.label}</span>
                                            <span className="text-[8px] font-mono opacity-60 font-normal">
                                                {group.options.length}
                                            </span>
                                        </div>
                                        {group.options.map(renderOptionRow)}
                                    </div>
                                ))
                            ) : (
                                <div className="py-6 text-center text-xs text-text-muted font-medium">
                                    No options match {searchQuery ? `"${searchQuery}"` : 'current filter'}
                                </div>
                            )
                        ) : (
                            filteredOptions.length > 0 ? (
                                <div className="space-y-0.5">
                                    {filteredOptions.map(renderOptionRow)}
                                </div>
                            ) : (
                                <div className="py-6 text-center text-xs text-text-muted font-medium">
                                    No options match {searchQuery ? `"${searchQuery}"` : 'current filter'}
                                </div>
                            )
                        )}
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
