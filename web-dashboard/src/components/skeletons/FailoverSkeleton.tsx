import React from 'react';
import { Activity } from 'lucide-react';

export const FailoverSkeleton: React.FC = () => {
    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Top Control Bar */}
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm flex flex-col md:flex-row justify-between gap-6 shimmer">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-blue-600/10 rounded-xl border border-blue-500/20 text-blue-500">
                        <Activity size={24} />
                    </div>
                    <div className="space-y-2">
                        <div className="w-44 h-5 bg-card-secondary rounded" />
                        <div className="w-72 h-3 bg-card-secondary/60 rounded" />
                    </div>
                </div>
                <div className="flex gap-2">
                    <div className="w-28 h-9 bg-card-secondary rounded-xl" />
                    <div className="w-32 h-9 bg-card-secondary rounded-xl" />
                </div>
            </div>

            {/* Target Selection & Live Stream */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="bg-card border border-border rounded-2xl p-5 space-y-3 shimmer">
                    <div className="w-32 h-4 bg-card-secondary rounded" />
                    <div className="space-y-2">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-12 bg-card-secondary/30 rounded-xl border border-border/40" />
                        ))}
                    </div>
                </div>
                <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-5 space-y-3 shimmer">
                    <div className="flex justify-between">
                        <div className="w-36 h-4 bg-card-secondary rounded" />
                        <div className="w-20 h-4 bg-card-secondary rounded" />
                    </div>
                    <div className="h-32 bg-card-secondary/20 rounded-xl border border-border/30" />
                </div>
            </div>

            {/* History Table */}
            <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-3 shimmer">
                <div className="w-40 h-4 bg-card-secondary rounded" />
                <div className="space-y-2">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-12 bg-card-secondary/30 rounded-xl border border-border/30" />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default FailoverSkeleton;
