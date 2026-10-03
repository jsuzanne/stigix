import React from 'react';
import { Shield } from 'lucide-react';

export const SecuritySkeleton: React.FC = () => {
    return (
        <div className="space-y-6 max-w-7xl mx-auto pb-12 animate-in fade-in duration-300">
            {/* Header Skeleton */}
            <div className="bg-card border border-border rounded-2xl p-4 flex justify-between items-center shimmer">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-red-600/10 rounded-xl border border-red-500/20 text-red-500">
                        <Shield size={24} />
                    </div>
                    <div className="space-y-2">
                        <div className="w-36 h-4 bg-card-secondary rounded" />
                        <div className="w-56 h-3 bg-card-secondary/60 rounded" />
                    </div>
                </div>
                <div className="w-32 h-8 bg-card-secondary rounded-xl" />
            </div>

            {/* Score Cards (3 Columns) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[1, 2, 3].map(i => (
                    <div key={i} className="bg-card border border-border rounded-2xl p-5 space-y-4 shimmer">
                        <div className="flex justify-between items-center">
                            <div className="w-28 h-4 bg-card-secondary rounded" />
                            <div className="w-10 h-4 bg-card-secondary rounded-full" />
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="w-16 h-16 rounded-full bg-card-secondary/80 border-2 border-border flex items-center justify-center" />
                            <div className="space-y-2 flex-1">
                                <div className="w-full h-3 bg-card-secondary rounded" />
                                <div className="w-2/3 h-3 bg-card-secondary/60 rounded" />
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Category Test Sections */}
            <div className="space-y-4">
                {[1, 2].map(i => (
                    <div key={i} className="bg-card border border-border rounded-2xl p-5 space-y-3 shimmer">
                        <div className="flex justify-between items-center border-b border-border/50 pb-3">
                            <div className="w-40 h-4 bg-card-secondary rounded" />
                            <div className="w-20 h-6 bg-card-secondary rounded-lg" />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                            {[1, 2, 3, 4].map(j => (
                                <div key={j} className="h-10 bg-card-secondary/40 rounded-xl border border-border/40 flex items-center px-4 justify-between">
                                    <div className="w-32 h-3 bg-card-secondary rounded" />
                                    <div className="w-12 h-4 bg-card-secondary rounded-full" />
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default SecuritySkeleton;
