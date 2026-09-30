import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Activity } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { clsx, type ClassValue } from 'clsx';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface PageLoaderProps {
    title?: string;
    subtitle?: string;
    icon?: LucideIcon;
    size?: 'sm' | 'md' | 'lg' | 'fullscreen';
    accentColor?: 'blue' | 'purple' | 'emerald' | 'amber' | 'cyan' | 'rose' | 'indigo';
    className?: string;
}

const colorMap = {
    blue: {
        ringOuter: 'border-blue-500/20',
        ringSpinner: 'border-blue-500',
        glow: 'shadow-blue-500/10',
        icon: 'text-blue-500',
        pillBg: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        pulse: 'bg-blue-400',
    },
    purple: {
        ringOuter: 'border-purple-500/20',
        ringSpinner: 'border-purple-500',
        glow: 'shadow-purple-500/10',
        icon: 'text-purple-400',
        pillBg: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
        pulse: 'bg-purple-400',
    },
    emerald: {
        ringOuter: 'border-emerald-500/20',
        ringSpinner: 'border-emerald-500',
        glow: 'shadow-emerald-500/10',
        icon: 'text-emerald-500',
        pillBg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        pulse: 'bg-emerald-400',
    },
    amber: {
        ringOuter: 'border-amber-500/20',
        ringSpinner: 'border-amber-500',
        glow: 'shadow-amber-500/10',
        icon: 'text-amber-500',
        pillBg: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        pulse: 'bg-amber-400',
    },
    cyan: {
        ringOuter: 'border-cyan-500/20',
        ringSpinner: 'border-cyan-500',
        glow: 'shadow-cyan-500/10',
        icon: 'text-cyan-400',
        pillBg: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
        pulse: 'bg-cyan-400',
    },
    rose: {
        ringOuter: 'border-rose-500/20',
        ringSpinner: 'border-rose-500',
        glow: 'shadow-rose-500/10',
        icon: 'text-rose-500',
        pillBg: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
        pulse: 'bg-rose-400',
    },
    indigo: {
        ringOuter: 'border-indigo-500/20',
        ringSpinner: 'border-indigo-500',
        glow: 'shadow-indigo-500/10',
        icon: 'text-indigo-400',
        pillBg: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20',
        pulse: 'bg-indigo-400',
    },
};

export const PageLoader: React.FC<PageLoaderProps> = ({
    title = 'Loading Telemetry...',
    subtitle = 'Synchronizing real-time data across Stigix nodes...',
    icon: Icon = Activity,
    size = 'md',
    accentColor = 'blue',
    className,
}) => {
    const colors = colorMap[accentColor] || colorMap.blue;

    const ringSizes = {
        sm: 'w-14 h-14',
        md: 'w-20 h-20',
        lg: 'w-24 h-24',
        fullscreen: 'w-28 h-28',
    };

    const iconSizes = {
        sm: 20,
        md: 26,
        lg: 32,
        fullscreen: 36,
    };

    const containerHeight = {
        sm: 'py-12',
        md: 'py-24 min-h-[380px]',
        lg: 'py-32 min-h-[500px]',
        fullscreen: 'fixed inset-0 z-50 bg-background/80 backdrop-blur-md',
    };

    return (
        <div
            className={cn(
                'flex flex-col items-center justify-center w-full animate-in fade-in zoom-in-95 duration-300 select-none',
                containerHeight[size],
                className
            )}
        >
            {/* Ambient Backlight Glow */}
            <div className="relative flex items-center justify-center">
                <div
                    className={cn(
                        'absolute rounded-full blur-2xl opacity-20 pointer-events-none transition-all duration-700',
                        ringSizes[size],
                        accentColor === 'blue' && 'bg-blue-500',
                        accentColor === 'purple' && 'bg-purple-500',
                        accentColor === 'emerald' && 'bg-emerald-500',
                        accentColor === 'amber' && 'bg-amber-500',
                        accentColor === 'cyan' && 'bg-cyan-500',
                        accentColor === 'rose' && 'bg-rose-500',
                        accentColor === 'indigo' && 'bg-indigo-500'
                    )}
                />

                {/* Concentric Spinning Rings */}
                <div className={cn('relative', ringSizes[size])}>
                    {/* Outer Static Track */}
                    <div className={cn('absolute inset-0 border-2 rounded-full', colors.ringOuter)} />

                    {/* Primary Animated Spinner */}
                    <div
                        className={cn(
                            'absolute inset-0 border-2 border-t-transparent rounded-full animate-spin',
                            colors.ringSpinner
                        )}
                        style={{ animationDuration: '1.1s' }}
                    />

                    {/* Reverse Counter-Rotating Accent */}
                    <div
                        className={cn(
                            'absolute inset-2 border-2 border-b-transparent border-l-transparent rounded-full animate-spin opacity-40',
                            colors.ringSpinner
                        )}
                        style={{ animationDirection: 'reverse', animationDuration: '2s' }}
                    />

                    {/* Center Icon */}
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Icon size={iconSizes[size]} className={cn(colors.icon, 'animate-pulse')} />
                    </div>
                </div>
            </div>

            {/* Title & Status */}
            {title && (
                <div className="text-center mt-6 space-y-1.5 px-4 max-w-md">
                    <h3 className="text-base font-black text-text-primary tracking-tight uppercase flex items-center justify-center gap-2">
                        {title}
                    </h3>
                    {subtitle && (
                        <p className="text-xs text-text-muted font-medium tracking-wide leading-relaxed animate-pulse">
                            {subtitle}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

export default PageLoader;
