import React from 'react';
import { Globe } from 'lucide-react';

export const FleetSkeleton: React.FC = () => {
    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header & Stats */}
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm flex flex-col md:flex-row justify-between gap-6 shimmer">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-purple-600/10 rounded-xl border border-purple-500/20 text-purple-400">
                        <Globe size={24} />
                    </div>
                    <div className="space-y-2">
                        <div className="w-48 h-5 bg-card-secondary rounded" />
                        <div className="w-64 h-3 bg-card-secondary/60 rounded" />
                    </div>
                </div>
                <div className="flex gap-3">
                    <div className="w-24 h-10 bg-card-secondary rounded-xl" />
                    <div className="w-24 h-10 bg-card-secondary rounded-xl" />
                </div>
            </div>

            {/* Filter Bar */}
            <div className="flex justify-between items-center gap-4">
                <div className="w-64 h-9 bg-card rounded-xl border border-border shimmer" />
                <div className="flex gap-2">
                    <div className="w-24 h-9 bg-card rounded-xl border border-border shimmer" />
                    <div className="w-24 h-9 bg-card rounded-xl border border-border shimmer" />
                </div>
            </div>

            {/* Mesh Nodes Table */}
            <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden shimmer">
                <div className="p-4 border-b border-border/60 flex justify-between">
                    <div className="w-36 h-4 bg-card-secondary rounded" />
                    <div className="w-20 h-4 bg-card-secondary rounded" />
                </div>
                <div className="p-4 space-y-3">
                    {[1, 2, 3, 4, 5].map(i => (
                        <div key={i} className="h-14 bg-card-secondary/20 rounded-xl border border-border/40 flex items-center px-4 justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-3.5 h-3.5 rounded-full bg-card-secondary" />
                                <div className="space-y-1">
                                    <div className="w-28 h-3.5 bg-card-secondary rounded" />
                                    <div className="w-20 h-2.5 bg-card-secondary/60 rounded" />
                                </div>
                            </div>
                            <div className="flex gap-4 items-center">
                                <div className="w-24 h-3 bg-card-secondary rounded" />
                                <div className="w-16 h-3 bg-card-secondary rounded" />
                                <div className="w-16 h-6 bg-card-secondary rounded-lg" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default FleetSkeleton;
