import React from 'react';
import { Shield } from 'lucide-react';

export const VyosSkeleton: React.FC = () => {
    return (
        <div className="space-y-6 pb-20 animate-in fade-in duration-300">
            {/* Header / Nav */}
            <div className="bg-card border border-border p-6 rounded-2xl shadow-sm shimmer flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-purple-600/10 rounded-xl border border-purple-500/20 text-purple-500">
                        <Shield size={24} />
                    </div>
                    <div className="space-y-2">
                        <div className="w-36 h-5 bg-card-secondary rounded" />
                        <div className="w-64 h-3 bg-card-secondary/60 rounded" />
                    </div>
                </div>
                <div className="flex gap-2">
                    <div className="w-28 h-8 bg-card-secondary rounded-xl" />
                    <div className="w-28 h-8 bg-card-secondary rounded-xl" />
                </div>
            </div>

            {/* Metrics Overview Bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className="bg-card border border-border p-4 rounded-xl space-y-2 shimmer">
                        <div className="w-20 h-3 bg-card-secondary rounded" />
                        <div className="w-12 h-6 bg-card-secondary rounded" />
                    </div>
                ))}
            </div>

            {/* Routers / Sequences Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map(i => (
                    <div key={i} className="bg-card border border-border rounded-2xl p-5 space-y-4 shadow-sm shimmer">
                        <div className="flex justify-between items-center border-b border-border/50 pb-3">
                            <div className="space-y-1.5">
                                <div className="w-28 h-4 bg-card-secondary rounded" />
                                <div className="w-20 h-3 bg-card-secondary/60 rounded" />
                            </div>
                            <div className="w-14 h-5 bg-card-secondary rounded-full" />
                        </div>
                        <div className="space-y-2">
                            {[1, 2, 3].map(j => (
                                <div key={j} className="h-9 bg-card-secondary/30 rounded-lg border border-border/30 flex items-center px-3 justify-between">
                                    <div className="w-20 h-3 bg-card-secondary rounded" />
                                    <div className="w-24 h-3 bg-card-secondary/70 rounded" />
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default VyosSkeleton;
