import React, { useState } from 'react';
import { ShieldAlert, ShieldCheck, BarChart2 } from 'lucide-react';

const formatCategory = (cat: string) =>
    cat.replace(/-/g, ' ')
       .replace(/\b(dns|url|ip|c2|dga|p2p|vpn|ips|edl|nxns|eicar)\b/gi, s => s.toUpperCase())
       .replace(/\b(\w)/g, c => c.toUpperCase());

const PREVIEW_LIMIT = 5;

export const ScoreGapAnalysis = ({ diff, title }: { diff: any, title: string }) => {
    const [expanded, setExpanded] = useState(false);
    const [hasAutoExpanded, setHasAutoExpanded] = useState(false);

    const safeRegressions = diff?.regressions || [];
    const safeImprovements = diff?.improvements || [];
    const scoreDelta = diff?.scoreDelta;

    React.useEffect(() => {
        if (safeRegressions.length > 0 && !expanded && !hasAutoExpanded) {
            setExpanded(true);
            setHasAutoExpanded(true);
        }
    }, [safeRegressions.length, expanded, hasAutoExpanded]);

    if (!diff) return null;
    if (safeRegressions.length === 0 && safeImprovements.length === 0) return null;

    const sortedReg = [...safeRegressions].sort((a: any, b: any) => b.weight - a.weight);
    const sortedImp = [...safeImprovements].sort((a: any, b: any) => b.weight - a.weight);
    const visibleReg = expanded ? sortedReg : sortedReg.slice(0, PREVIEW_LIMIT);
    const visibleImp = expanded ? sortedImp : sortedImp.slice(0, PREVIEW_LIMIT);
    const totalHidden = (sortedReg.length + sortedImp.length) - (visibleReg.length + visibleImp.length);

    return (
        <div className="bg-card-secondary/30 rounded-xl p-4 border border-border mt-4">
            <div 
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setExpanded(!expanded)}
            >
                <h5 className="text-[10px] font-black tracking-widest text-text-muted flex items-center gap-1.5">
                    <BarChart2 size={11} /> BASELINE GAP ANALYSIS ({title})
                </h5>
                <div className="flex items-center gap-1.5">
                    {sortedReg.length > 0 && <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-red-500/10 border border-red-500/20 text-red-500">{sortedReg.length} ↓</span>}
                    {sortedImp.length > 0 && <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-green-500/10 border border-green-500/20 text-green-500">{sortedImp.length} ↑</span>}
                    {scoreDelta !== undefined && scoreDelta !== null && (
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-black border ${
                            scoreDelta < 0 ? 'bg-red-500/10 border-red-500/20 text-red-500' : 'bg-green-500/10 border-green-500/20 text-green-500'
                        }`}>{scoreDelta > 0 ? '+' : ''}{scoreDelta.toFixed(1)}</span>
                    )}
                </div>
            </div>

            {expanded && (
                <div className="mt-4 space-y-4 animate-fade-in">
                    {sortedReg.length > 0 && (
                        <div>
                            <div className="flex items-center gap-1 text-[9px] font-black text-red-500 mb-1.5 tracking-widest">
                                <ShieldAlert size={10} /> POLICY REGRESSIONS
                            </div>
                            <div className="flex flex-col gap-1">
                                {visibleReg.map((r: any, idx: number) => (
                                    <div key={idx} className="flex items-center justify-between text-xs p-2 bg-background rounded-lg border border-red-500/20">
                                        <span className="font-semibold text-text-primary">{formatCategory(r.category)}</span>
                                        <div className="flex items-center gap-1.5 text-[10px] font-black">
                                            <span className="text-[9px] text-text-muted font-bold">w:{r.weight}</span>
                                            <span className="text-green-500 line-through opacity-70">{r.before}</span>
                                            <span className="text-text-muted opacity-40">→</span>
                                            <span className="text-red-500">{r.after}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {sortedImp.length > 0 && (
                        <div>
                            <div className="flex items-center gap-1 text-[9px] font-black text-green-500 mb-1.5 tracking-widest">
                                <ShieldCheck size={10} /> POLICY IMPROVEMENTS
                            </div>
                            <div className="flex flex-col gap-1">
                                {visibleImp.map((r: any, idx: number) => (
                                    <div key={idx} className="flex items-center justify-between text-xs p-2 bg-background rounded-lg border border-green-500/20">
                                        <span className="font-semibold text-text-primary">{formatCategory(r.category)}</span>
                                        <div className="flex items-center gap-1.5 text-[10px] font-black">
                                            <span className="text-[9px] text-text-muted font-bold">w:{r.weight}</span>
                                            <span className="text-red-400 line-through opacity-70">{r.before}</span>
                                            <span className="text-text-muted opacity-40">→</span>
                                            <span className="text-green-500">{r.after}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {totalHidden > 0 && (
                        <button onClick={() => setExpanded(false)} className="mt-2 w-full text-[10px] font-black tracking-widest text-text-muted hover:text-text-primary py-1.5 border border-border rounded-lg hover:bg-hover transition-all">
                            ↑ collapse {totalHidden} items
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export const ScoreLatestChanges = ({ type, scores }: { type: 'url' | 'dns' | 'threat', scores: any[] }) => {
    const [expanded, setExpanded] = useState(false);
    const [hasAutoExpanded, setHasAutoExpanded] = useState(false);

    const runs = scores.filter(s => s.type === type);
    const hasEnoughRuns = runs.length >= 2;
    
    const latest = hasEnoughRuns ? runs[0] : null;
    const prev = hasEnoughRuns ? runs[1] : null;
    const latestBreakdown: Record<string, any> = latest?.breakdown?.[type] || {};
    const prevBreakdown: Record<string, any> = prev?.breakdown?.[type] || {};
    const changes: { category: string; before: string; after: string; weight: number }[] = [];
    
    if (hasEnoughRuns) {
        for (const [cat, snap] of Object.entries(latestBreakdown)) {
            const prevSnap = prevBreakdown[cat];
            if (!prevSnap) continue;
            if (prevSnap.status !== (snap as any).status) {
                changes.push({ category: cat, before: prevSnap.status, after: (snap as any).status, weight: (snap as any).weight });
            }
        }
    }

    React.useEffect(() => {
        if (changes.length > 0 && !expanded && !hasAutoExpanded) {
            setExpanded(true);
            setHasAutoExpanded(true);
        }
    }, [changes.length, expanded, hasAutoExpanded]);

    if (!hasEnoughRuns || changes.length === 0) return null;

    const prevTime = new Date(prev!.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const latestTime = new Date(latest!.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    const visibleChanges = expanded ? changes : changes.slice(0, PREVIEW_LIMIT);
    const totalHidden = changes.length - visibleChanges.length;

    return (
        <div className="bg-card-secondary/30 rounded-xl p-4 border border-border mt-4">
            <div 
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setExpanded(!expanded)}
            >
                <h5 className="text-[10px] font-black tracking-widest text-text-muted flex items-center gap-1.5 uppercase">
                    <BarChart2 size={11} className="text-blue-500" /> {type} LATEST CHANGES
                </h5>
                <div className="text-[9px] font-bold text-text-muted flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">{changes.length} CHG</span>
                    <span className="opacity-50">{prevTime}</span>
                    <span className="opacity-30">→</span>
                    <span className="opacity-80">{latestTime}</span>
                </div>
            </div>

            {expanded && (
                <div className="mt-4 space-y-1 animate-fade-in">
                    {visibleChanges.map((c, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs p-2 bg-background rounded-lg border border-border/50">
                            <span className="font-semibold text-text-primary">{formatCategory(c.category)}</span>
                            <div className="flex items-center gap-1.5 text-[10px] font-black">
                                <span className={`line-through opacity-70 ${c.before === 'allowed' ? 'text-red-400' : c.before === 'blocked' ? 'text-green-500' : 'text-blue-400'}`}>
                                    {c.before}
                                </span>
                                <span className="text-text-muted opacity-40">→</span>
                                <span className={`${c.after === 'allowed' ? 'text-red-500' : c.after === 'blocked' ? 'text-green-500' : 'text-blue-500'}`}>
                                    {c.after}
                                </span>
                            </div>
                        </div>
                    ))}
                    {totalHidden > 0 && (
                        <button onClick={() => setExpanded(false)} className="mt-2 w-full text-[10px] font-black tracking-widest text-text-muted hover:text-text-primary py-1.5 border border-border rounded-lg hover:bg-hover transition-all">
                            ↑ collapse {totalHidden} items
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};
