import React from 'react';
import { Gauge, TrendingUp, BarChart3, AlertCircle } from 'lucide-react';

export const DEMSkeleton: React.FC = () => {
    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header Analytics Skeleton */}
            <div className="flex flex-col gap-4">
                {/* 1. Combined Top Panel */}
                <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden flex flex-col xl:flex-row">
                    
                    {/* Left: Global Experience Gauge */}
                    <div className="flex flex-col border-b xl:border-b-0 xl:border-r border-border bg-card-secondary/10 w-full xl:w-[275px] shrink-0">
                        <div className="flex items-center justify-center px-6 py-3 border-b border-border bg-card-secondary/40 h-[49px]">
                            <div className="text-[10px] font-black text-text-muted uppercase tracking-widest flex items-center gap-2 opacity-50">
                                <Gauge size={14} className="text-blue-500" /> Global Experience
                            </div>
                        </div>
                        <div className="flex-1 p-5 flex flex-col items-center justify-center text-center">
                            {/* Round Gauge Shimmer */}
                            <div className="relative w-28 h-28 flex items-center justify-center">
                                <div className="w-24 h-24 rounded-full border-4 border-card-secondary bg-card-secondary/40 shimmer flex items-center justify-center" />
                            </div>
                            <div className="w-28 h-3 bg-card-secondary rounded shimmer mt-3" />
                        </div>
                    </div>

                    {/* Middle: Trend Chart Skeleton */}
                    <div className="flex-1 flex flex-col min-w-0 border-b xl:border-b-0 xl:border-r border-border">
                        <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card-secondary/40 h-[49px]">
                            <div className="text-[10px] font-black text-text-muted uppercase tracking-widest flex items-center gap-2 opacity-50">
                                <TrendingUp size={14} className="text-indigo-500" /> Score Trend
                            </div>
                            <div className="flex gap-1">
                                {[1, 2, 3, 4, 5].map(i => (
                                    <div key={i} className="w-8 h-5 bg-card-secondary rounded shimmer" />
                                ))}
                            </div>
                        </div>
                        <div className="flex-1 p-6 flex flex-col justify-end min-h-[160px]">
                            <div className="w-full h-24 bg-card-secondary/30 rounded-xl shimmer relative overflow-hidden flex items-end px-4 pb-2 gap-2">
                                <div className="w-full h-1/2 bg-indigo-500/10 rounded-t" />
                            </div>
                        </div>
                    </div>

                    {/* Right: Unstable & Down Probes Skeleton */}
                    <div className="w-full xl:w-[320px] shrink-0 flex flex-col bg-card-secondary/10">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card-secondary/40 h-[49px]">
                            <div className="text-[10px] font-black text-text-muted uppercase tracking-widest flex items-center gap-2 opacity-50">
                                <AlertCircle size={14} className="text-orange-500" /> Unstable & Down Probes
                            </div>
                        </div>
                        <div className="p-3 space-y-2">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="p-2.5 rounded-xl border border-border bg-card-secondary/30 shimmer space-y-2">
                                    <div className="flex justify-between items-center">
                                        <div className="w-20 h-3 bg-card-secondary rounded" />
                                        <div className="w-12 h-3 bg-card-secondary rounded" />
                                    </div>
                                    <div className="w-32 h-2 bg-card-secondary/60 rounded" />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 2. Performance Trends by Type Skeleton (5 Mini Cards) */}
                <div className="bg-card-secondary/30 border border-border p-5 rounded-2xl shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2 text-text-muted text-xs font-bold opacity-60">
                            <BarChart3 size={16} /> Performance Trends by Type
                        </div>
                        <div className="w-24 h-4 bg-card-secondary rounded shimmer" />
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                        {[1, 2, 3, 4, 5].map(i => (
                            <div key={i} className="bg-card border border-border rounded-xl p-3.5 space-y-2.5 shimmer">
                                <div className="flex justify-between items-center">
                                    <div className="w-14 h-3 bg-card-secondary rounded" />
                                    <div className="w-8 h-3 bg-card-secondary rounded" />
                                </div>
                                <div className="h-10 bg-card-secondary/30 rounded" />
                            </div>
                        ))}
                    </div>
                </div>

                {/* 3. Probes Catalog Table Skeleton */}
                <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4">
                    <div className="flex justify-between items-center">
                        <div className="w-36 h-5 bg-card-secondary rounded shimmer" />
                        <div className="flex gap-2">
                            <div className="w-48 h-8 bg-card-secondary rounded-xl shimmer" />
                            <div className="w-24 h-8 bg-card-secondary rounded-xl shimmer" />
                        </div>
                    </div>
                    <div className="space-y-2">
                        {[1, 2, 3, 4, 5].map(i => (
                            <div key={i} className="h-12 bg-card-secondary/20 rounded-xl border border-border/50 shimmer flex items-center px-4 justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-4 h-4 rounded bg-card-secondary" />
                                    <div className="w-32 h-3.5 bg-card-secondary rounded" />
                                </div>
                                <div className="flex gap-4">
                                    <div className="w-16 h-3 bg-card-secondary rounded" />
                                    <div className="w-20 h-3 bg-card-secondary rounded" />
                                    <div className="w-12 h-3 bg-card-secondary rounded" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DEMSkeleton;
