import React from 'react';
import { Grid } from 'lucide-react';

export const MatrixSkeleton: React.FC = () => {
    return (
        <div className="bg-card-secondary/50 border border-border rounded-xl shadow-md overflow-hidden animate-in fade-in duration-300">
            {/* Header */}
            <div className="p-4 border-b border-border bg-card-secondary/80 flex items-center justify-between shimmer">
                <div>
                    <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                        <Grid size={16} className="text-blue-500" />
                        SD-WAN Bidirectional Reachability Grid
                    </h3>
                    <p className="text-xs text-text-muted mt-0.5">
                        Cross-correlating forward egress SLA with return ingress telemetry across nodes...
                    </p>
                </div>
                <div className="w-28 h-6 bg-card-secondary rounded" />
            </div>

            {/* Matrix Table Grid Skeleton */}
            <div className="p-4 space-y-2 shimmer">
                <div className="grid grid-cols-7 gap-2">
                    {[1, 2, 3, 4, 5, 6, 7].map(i => (
                        <div key={i} className="h-10 bg-card-secondary/60 rounded-lg border border-border/40" />
                    ))}
                </div>
                {[1, 2, 3, 4, 5, 6].map(row => (
                    <div key={row} className="grid grid-cols-7 gap-2">
                        {[1, 2, 3, 4, 5, 6, 7].map(col => (
                            <div key={col} className="h-16 bg-card/60 rounded-xl border border-border/50 p-2 space-y-1.5 flex flex-col justify-center">
                                <div className="w-full h-2.5 bg-card-secondary/80 rounded" />
                                <div className="w-3/4 h-2.5 bg-card-secondary/60 rounded" />
                                <div className="w-1/2 h-2 bg-blue-500/20 rounded" />
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default MatrixSkeleton;
