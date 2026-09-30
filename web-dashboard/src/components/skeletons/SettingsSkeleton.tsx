import React from 'react';
import { Settings as SettingsIcon } from 'lucide-react';

export const SettingsSkeleton: React.FC = () => {
    return (
        <div className="space-y-6 max-w-7xl mx-auto pb-12 animate-in fade-in duration-300">
            {/* Header */}
            <div className="bg-card border border-border rounded-2xl p-4 flex items-center justify-between shimmer">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-blue-600/10 rounded-xl border border-blue-500/20 text-blue-500">
                        <SettingsIcon size={24} />
                    </div>
                    <div className="space-y-1.5">
                        <div className="w-32 h-4 bg-card-secondary rounded" />
                        <div className="w-48 h-3 bg-card-secondary/60 rounded" />
                    </div>
                </div>
                <div className="w-24 h-8 bg-card-secondary rounded-xl" />
            </div>

            {/* Subtabs Bar */}
            <div className="flex gap-2 overflow-x-auto pb-1">
                {[1, 2, 3, 4, 5, 6].map(i => (
                    <div key={i} className="w-28 h-9 bg-card rounded-xl border border-border shrink-0 shimmer" />
                ))}
            </div>

            {/* Config Panels */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[1, 2].map(i => (
                    <div key={i} className="bg-card border border-border rounded-2xl p-6 space-y-4 shimmer">
                        <div className="w-36 h-4 bg-card-secondary rounded border-b border-border/50 pb-3 w-full" />
                        <div className="space-y-3 pt-2">
                            {[1, 2, 3].map(j => (
                                <div key={j} className="space-y-1.5">
                                    <div className="w-24 h-3 bg-card-secondary rounded" />
                                    <div className="h-10 bg-card-secondary/30 rounded-xl border border-border/40" />
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default SettingsSkeleton;
