import React, { useState } from 'react';
import { 
    AlertTriangle, 
    CheckCircle2, 
    XCircle, 
    Info, 
    Sparkles, 
    ArrowDownRight, 
    Sliders, 
    Zap, 
    ChevronDown, 
    ChevronUp,
    ShieldAlert
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { explainDEMScore, type DEMScoreExplanation } from '../../utils/dem-scoring';

interface ProbeScoreCardProps {
    probe: any;
    result: any;
    onQuickFixStatus?: (statusCode: number) => Promise<void> | void;
    className?: string;
    onOpenEditModal?: () => void;
}

export const ProbeScoreCard: React.FC<ProbeScoreCardProps> = ({
    probe,
    result,
    onQuickFixStatus,
    className,
    onOpenEditModal
}) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const [isFixing, setIsFixing] = useState(false);
    const [fixSuccess, setFixSuccess] = useState(false);

    const explanation: DEMScoreExplanation = explainDEMScore(probe, result);
    const { finalScore, verdict, primaryReason, factors, recommendations, canAddStatusCode, missingStatusCode, allowedStatusCodes } = explanation;

    const handleApplyFix = async () => {
        if (!missingStatusCode || !onQuickFixStatus) return;
        setIsFixing(true);
        try {
            await onQuickFixStatus(missingStatusCode);
            setFixSuccess(true);
        } catch (e) {
            console.error('Failed to apply quick fix', e);
        } finally {
            setIsFixing(false);
        }
    };

    const getVerdictBadge = () => {
        switch (verdict) {
            case 'optimal':
                return {
                    bg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
                    icon: <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />,
                    label: 'Score Optimal'
                };
            case 'good':
                return {
                    bg: 'bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400',
                    icon: <CheckCircle2 size={16} className="text-blue-500 shrink-0" />,
                    label: 'Performances Bonnes'
                };
            case 'degraded':
                return {
                    bg: 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400',
                    icon: <AlertTriangle size={16} className="text-amber-500 shrink-0" />,
                    label: 'Score Dégradé'
                };
            case 'critical':
            case 'down':
            default:
                return {
                    bg: 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400',
                    icon: <XCircle size={16} className="text-red-500 shrink-0" />,
                    label: verdict === 'down' ? 'Hôte Injoignable' : 'Score Critique'
                };
        }
    };

    const badge = getVerdictBadge();

    return (
        <div className={cn(
            "rounded-2xl border transition-all duration-200 overflow-hidden shadow-sm",
            finalScore >= 80 
                ? "bg-card-secondary/20 border-border hover:border-emerald-500/30" 
                : finalScore >= 50
                    ? "bg-amber-950/10 border-amber-500/30 shadow-amber-500/5"
                    : "bg-red-950/15 border-red-500/30 shadow-red-500/5",
            className
        )}>
            {/* Header bar */}
            <div 
                className="px-5 py-3.5 flex items-center justify-between cursor-pointer select-none bg-card/60 backdrop-blur-sm border-b border-border/60"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3">
                    <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm tracking-tight border shadow-inner",
                        finalScore >= 80 
                            ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400" 
                            : finalScore >= 50
                                ? "bg-amber-500/15 border-amber-500/30 text-amber-400"
                                : "bg-red-500/20 border-red-500/40 text-red-400"
                    )}>
                        {finalScore}
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-black uppercase tracking-wider text-text-primary">
                                Diagnostic du Score DEM
                            </span>
                            <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border flex items-center gap-1", badge.bg)}>
                                {badge.icon} {badge.label}
                            </span>
                        </div>
                        <p className="text-xs text-text-secondary mt-0.5 font-medium line-clamp-1">
                            {primaryReason}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {canAddStatusCode && missingStatusCode && !fixSuccess && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleApplyFix();
                            }}
                            disabled={isFixing}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] shadow-sm transition-all"
                            title={`Ajouter ${missingStatusCode} aux codes attendus`}
                        >
                            <Zap size={13} className="text-yellow-300" />
                            {isFixing ? 'Correction...' : `Accepter code ${missingStatusCode}`}
                        </button>
                    )}
                    {fixSuccess && (
                        <span className="text-emerald-400 text-xs font-bold flex items-center gap-1">
                            <CheckCircle2 size={14} /> Corrigé !
                        </span>
                    )}
                    <button 
                        type="button"
                        className="p-1.5 text-text-muted hover:text-text-primary rounded-lg transition-colors"
                        aria-label="Toggle explanation details"
                    >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                </div>
            </div>

            {/* Expandable breakdown content */}
            {isExpanded && (
                <div className="p-5 space-y-4">
                    {/* Visual Math Stepper */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-text-muted">
                            <span>Décomposition Mathématique</span>
                            <span>Base 100 ➔ Score final {finalScore}</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                            {factors.map((f, idx) => (
                                <div 
                                    key={idx}
                                    className={cn(
                                        "p-3 rounded-xl border text-xs flex flex-col justify-between transition-all",
                                        f.isCritical || f.impact <= -50
                                            ? "bg-red-500/10 border-red-500/30 text-text-primary"
                                            : f.impact < 0
                                                ? "bg-amber-500/5 border-amber-500/20 text-text-primary"
                                                : "bg-card-secondary/40 border-border/80 text-text-primary"
                                    )}
                                >
                                    <div className="flex items-start justify-between gap-1 mb-1">
                                        <span className="font-bold text-[11px] text-text-secondary">{f.name}</span>
                                        <span className={cn(
                                            "font-black px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap",
                                            f.impact < 0 
                                                ? f.impact <= -50 ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"
                                                : "bg-emerald-500/10 text-emerald-400"
                                        )}>
                                            {f.impact < 0 ? `${f.impact} pts` : '0 pt (OK)'}
                                        </span>
                                    </div>
                                    <div className="text-sm font-black text-text-primary font-mono my-0.5">
                                        {f.value}
                                    </div>
                                    <p className="text-[10px] text-text-muted leading-tight mt-1">
                                        {f.detail}
                                    </p>
                                    {f.formula && (
                                        <div className="text-[9px] font-mono text-indigo-400/90 bg-indigo-500/5 px-2 py-0.5 rounded mt-1.5 border border-indigo-500/10">
                                            {f.formula}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Quick Rectify Banner when degraded by status code or SLA */}
                    {canAddStatusCode && missingStatusCode && (
                        <div className="p-4 rounded-xl bg-indigo-950/20 border border-indigo-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                            <div className="flex items-start gap-3">
                                <ShieldAlert size={20} className="text-indigo-400 shrink-0 mt-0.5" />
                                <div>
                                    <h4 className="text-xs font-black text-indigo-300 uppercase tracking-wide">
                                        Comment rectifier ce score ?
                                    </h4>
                                    <p className="text-xs text-text-secondary mt-0.5">
                                        Le code <strong>HTTP {missingStatusCode}</strong> a fait chuter le score à <strong>20</strong> car il n’est pas dans la liste des codes autorisés ({allowedStatusCodes.join(', ')}).
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={handleApplyFix}
                                    disabled={isFixing || fixSuccess}
                                    className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs transition-all shadow-md flex items-center gap-1.5 disabled:opacity-50"
                                >
                                    <Zap size={14} className="text-yellow-300" />
                                    {fixSuccess ? 'Code 429 autorisé' : `Autoriser le code ${missingStatusCode}`}
                                </button>
                                {onOpenEditModal && (
                                    <button
                                        type="button"
                                        onClick={onOpenEditModal}
                                        className="px-3 py-2 rounded-xl border border-border bg-card-secondary hover:bg-card-secondary/80 text-text-primary text-xs font-bold transition-all flex items-center gap-1"
                                    >
                                        <Sliders size={13} />
                                        Modifier la sonde
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Recommendations list */}
                    {recommendations.length > 0 && (
                        <div className="pt-2 border-t border-border/40 flex items-start gap-2 text-xs text-text-muted">
                            <Info size={15} className="text-blue-400 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                                <span className="font-bold text-text-primary text-[11px] uppercase tracking-wider block">
                                    Recommandations d'optimisation
                                </span>
                                {recommendations.map((rec, i) => (
                                    <p key={i} className="text-[11px] text-text-secondary leading-relaxed">
                                        • {rec}
                                    </p>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

interface ScoreCellProps {
    score: number;
    probe: any;
    result: any;
    onClick?: () => void;
}

export const InteractiveScoreBadge: React.FC<ScoreCellProps> = ({ score, probe, result, onClick }) => {
    const [showTooltip, setShowTooltip] = useState(false);
    const explanation = explainDEMScore(probe, result);

    return (
        <div className="relative inline-block">
            <button
                type="button"
                onClick={onClick}
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
                className={cn(
                    "font-black px-2.5 py-1 rounded-lg text-[11px] border transition-all cursor-pointer shadow-sm hover:scale-105",
                    score >= 80 
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20" 
                        : score >= 50
                            ? "bg-amber-500/10 border-amber-500/30 text-amber-500 hover:bg-amber-500/20"
                            : "bg-red-500/10 border-red-500/30 text-red-500 hover:bg-red-500/20"
                )}
            >
                {score}
            </button>

            {/* Hover Tooltip Popover */}
            {showTooltip && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 bg-card border border-border shadow-2xl rounded-xl z-50 text-left pointer-events-none animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-center justify-between border-b border-border pb-1.5 mb-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-text-muted">
                            Calcul du Score ({score}/100)
                        </span>
                        <span className={cn(
                            "text-[9px] font-black uppercase px-1.5 py-0.5 rounded",
                            score >= 80 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                        )}>
                            {explanation.verdict}
                        </span>
                    </div>
                    <p className="text-[11px] font-bold text-text-primary leading-tight mb-2">
                        {explanation.primaryReason}
                    </p>
                    <div className="space-y-1 text-[10px]">
                        {explanation.factors.slice(0, 3).map((f, i) => (
                            <div key={i} className="flex items-center justify-between text-text-muted font-mono">
                                <span>{f.name}: {f.value}</span>
                                <span className={f.impact < 0 ? "text-red-400 font-bold" : "text-emerald-400"}>
                                    {f.impact < 0 ? `${f.impact} pts` : '0 pt'}
                                </span>
                            </div>
                        ))}
                    </div>
                    <div className="text-[9px] text-indigo-400 mt-2 pt-1.5 border-t border-border/50 text-center font-bold">
                        Cliquez pour inspecter la formule complète
                    </div>
                </div>
            )}
        </div>
    );
};
