import React from 'react';
import { Phone } from 'lucide-react';

export const VoiceSkeleton: React.FC = () => {
    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header Skeleton */}
            <div className="bg-card border border-border rounded-2xl p-8 shadow-sm flex flex-col lg:flex-row justify-between gap-8 shimmer">
                <div className="flex items-center gap-5">
                    <div className="p-5 bg-blue-600/10 rounded-2xl border border-blue-500/20 text-blue-500">
                        <Phone size={30} />
                    </div>
                    <div className="space-y-2">
                        <div className="flex items-center gap-3">
                            <div className="w-40 h-6 bg-card-secondary rounded" />
                            <div className="w-16 h-4 bg-card-secondary rounded-full" />
                        </div>
                        <div className="w-64 h-3 bg-card-secondary/60 rounded" />
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="w-20 h-9 bg-card-secondary rounded-xl" />
                    <div className="w-28 h-9 bg-card-secondary rounded-xl" />
                </div>
            </div>

            {/* Metric Cards (4 Columns) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className="bg-card border border-border rounded-xl p-4 space-y-2 shimmer">
                        <div className="w-20 h-3 bg-card-secondary rounded" />
                        <div className="w-16 h-6 bg-card-secondary rounded" />
                    </div>
                ))}
            </div>

            {/* Target Rows Table */}
            <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-3 shimmer">
                <div className="flex justify-between items-center border-b border-border/50 pb-3">
                    <div className="w-36 h-4 bg-card-secondary rounded" />
                    <div className="w-24 h-4 bg-card-secondary rounded" />
                </div>
                <div className="space-y-2 pt-1">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-12 bg-card-secondary/30 rounded-xl border border-border/30 flex items-center px-4 justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-3.5 h-3.5 rounded-full bg-card-secondary" />
                                <div className="w-36 h-3.5 bg-card-secondary rounded" />
                            </div>
                            <div className="flex gap-4">
                                <div className="w-16 h-3 bg-card-secondary rounded" />
                                <div className="w-20 h-3 bg-card-secondary rounded" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default VoiceSkeleton;
