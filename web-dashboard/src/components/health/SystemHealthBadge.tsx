import React from 'react';
import { Activity, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

interface SystemHealthBadgeProps {
    healthData: any | null;
    isLoading?: boolean;
    onClick: () => void;
}

export const SystemHealthBadge: React.FC<SystemHealthBadgeProps> = ({
    healthData,
    isLoading = false,
    onClick
}) => {
    const score = healthData?.overall_score ?? 100;
    const globalStatus = healthData?.global_status || 'healthy';

    // Alert-Only: silent when healthy, only pop up on degraded or critical status
    if (globalStatus === 'healthy' && score >= 95) {
        return null;
    }

    const getStatusStyle = () => {
        if (globalStatus === 'critical' || score < 70) {
            return {
                bg: 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-500/30',
                dot: 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.7)]',
                label: `${score}% CRITICAL`
            };
        }
        return {
            bg: 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30',
            dot: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.7)]',
            label: `${score}% WARNING`
        };
    };

    const style = getStatusStyle();

    return (
        <button
            onClick={onClick}
            title="System Alert: Click to open Stigix 360° System Health Matrix & Diagnostics"
            className={cn(
                "h-8 px-3 rounded-xl border flex items-center gap-2 transition-all text-xs font-bold shadow-sm cursor-pointer select-none animate-in fade-in zoom-in-95 duration-200",
                style.bg
            )}
        >
            <div className="relative flex items-center justify-center">
                <span className={cn("w-2 h-2 rounded-full", style.dot, "animate-ping opacity-75 absolute inset-0")} />
                <span className={cn("w-2 h-2 rounded-full", style.dot)} />
            </div>
            <span className="font-mono tracking-tight font-black uppercase text-[11px]">
                {style.label}
            </span>
            {isLoading ? (
                <Loader2 size={12} className="animate-spin opacity-70 ml-0.5" />
            ) : (
                <Activity size={13} className="opacity-70 ml-0.5" />
            )}
        </button>
    );
};
