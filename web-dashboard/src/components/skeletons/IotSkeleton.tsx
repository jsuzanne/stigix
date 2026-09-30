import React from 'react';
import { Cpu } from 'lucide-react';

export const IotSkeleton: React.FC = () => {
    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header */}
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm flex flex-col md:flex-row justify-between gap-6 shimmer">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-blue-600/10 rounded-xl border border-blue-500/20 text-blue-500">
                        <Cpu size={24} />
                    </div>
                    <div className="space-y-2">
                        <div className="w-40 h-5 bg-card-secondary rounded" />
                        <div className="w-64 h-3 bg-card-secondary/60 rounded" />
                    </div>
                </div>
                <div className="flex gap-2">
                    <div className="w-24 h-9 bg-card-secondary rounded-xl" />
                    <div className="w-28 h-9 bg-card-secondary rounded-xl" />
                </div>
            </div>

            {/* Device Grid Skeleton */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map(i => (
                    <div key={i} className="bg-card border border-border rounded-3xl p-6 space-y-4 shadow-sm shimmer">
                        <div className="flex justify-between items-start">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-card-secondary" />
                                <div className="space-y-1.5">
                                    <div className="w-24 h-4 bg-card-secondary rounded" />
                                    <div className="w-16 h-2.5 bg-card-secondary/60 rounded" />
                                </div>
                            </div>
                            <div className="w-12 h-5 bg-card-secondary rounded-full" />
                        </div>
                        <div className="space-y-2 pt-2 border-t border-border/40">
                            <div className="w-full h-3 bg-card-secondary/50 rounded" />
                            <div className="w-3/4 h-3 bg-card-secondary/50 rounded" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default IotSkeleton;
