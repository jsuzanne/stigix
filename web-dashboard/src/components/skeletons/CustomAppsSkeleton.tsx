import React from 'react';
import { Layers } from 'lucide-react';

export const CustomAppsSkeleton: React.FC = () => {
    return (
        <div className="p-6 max-w-[1700px] w-full mx-auto space-y-6 animate-in fade-in duration-300">
            {/* Top Node Identity Bar */}
            <div className="bg-card border border-border rounded-2xl p-5 flex justify-between items-center shimmer">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20 text-indigo-400">
                        <Layers size={24} />
                    </div>
                    <div className="space-y-2">
                        <div className="w-44 h-5 bg-card-secondary rounded" />
                        <div className="w-80 h-3 bg-card-secondary/60 rounded" />
                    </div>
                </div>
                <div className="flex gap-2">
                    <div className="w-24 h-9 bg-card-secondary rounded-xl" />
                    <div className="w-24 h-9 bg-card-secondary rounded-xl" />
                </div>
            </div>

            {/* Application Switcher Tab Bar */}
            <div className="bg-card border border-border rounded-2xl p-3.5 flex gap-3 shimmer">
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className="w-36 h-8 bg-card-secondary/70 rounded-xl" />
                ))}
            </div>

            {/* Application Toolbar & Primary Controls */}
            <div className="bg-card border border-border rounded-2xl p-5 space-y-4 shimmer">
                <div className="flex justify-between items-center border-b border-border/50 pb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-card-secondary" />
                        <div className="space-y-1.5">
                            <div className="w-32 h-4 bg-card-secondary rounded" />
                            <div className="w-48 h-3 bg-card-secondary/60 rounded" />
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <div className="w-20 h-8 bg-card-secondary rounded-xl" />
                        <div className="w-24 h-8 bg-card-secondary rounded-xl" />
                    </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-16 bg-card-secondary/30 rounded-xl border border-border/40 p-3 space-y-2">
                            <div className="w-16 h-2.5 bg-card-secondary rounded" />
                            <div className="w-12 h-4 bg-card-secondary rounded" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default CustomAppsSkeleton;
