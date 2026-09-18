import React, { useState, useEffect } from 'react';
import {
    Activity, Gauge, Zap, CheckCircle2, AlertTriangle, Network,
    ArrowRight, Copy, Check, RotateCcw, X, Loader2, Terminal,
    Layers, ShieldAlert, Cpu
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { CustomTcpApplicationConfig, PathProbeResult, PeerConfig } from '../../../custom-tcp-apps/types.js';

interface PathProbeModalProps {
    isOpen: boolean;
    onClose: () => void;
    app: CustomTcpApplicationConfig | null;
    initialTargetHost?: string;
    token: string | null;
    onProbeComplete?: (appId: string, result: PathProbeResult) => void;
}

export const PathProbeModal: React.FC<PathProbeModalProps> = ({
    isOpen,
    onClose,
    app,
    initialTargetHost,
    token,
    onProbeComplete
}) => {
    const [selectedTarget, setSelectedTarget] = useState<string>('');
    const [running, setRunning] = useState<boolean>(false);
    const [result, setResult] = useState<PathProbeResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copiedCli, setCopiedCli] = useState<string | null>(null);
    const [copiedReport, setCopiedReport] = useState<boolean>(false);
    const [activeCliTab, setActiveCliTab] = useState<'cisco' | 'vyos' | 'linux'>('vyos');

    const targetPeers: PeerConfig[] = app?.peers || [];

    // Initialize selected target
    useEffect(() => {
        if (isOpen && app) {
            if (initialTargetHost) {
                setSelectedTarget(initialTargetHost);
            } else if (targetPeers.length > 0) {
                setSelectedTarget(targetPeers[0].host);
            } else {
                setSelectedTarget('127.0.0.1');
            }
            setResult(null);
            setError(null);
        }
    }, [isOpen, app, initialTargetHost]);

    // Auto-run probe when opened
    useEffect(() => {
        if (isOpen && app && selectedTarget) {
            handleRunProbe();
        }
    }, [isOpen, selectedTarget]);

    if (!isOpen || !app) return null;

    const handleRunProbe = async () => {
        if (!selectedTarget) return;
        setRunning(true);
        setError(null);

        try {
            const peer = targetPeers.find(p => p.host === selectedTarget);
            const targetPort = peer?.port || app.listener?.port || 8083;

            const res = await fetch(`/api/custom-tcp-apps/${encodeURIComponent(app.id)}/diagnose-path`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                    targetHost: selectedTarget,
                    targetPort,
                    runPrismaCorrelation: true
                })
            });

            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                const text = await res.text();
                throw new Error(
                    res.status === 404
                        ? `Le backend n'a pas encore la route d'analyse active (HTTP 404). Assurez-vous que le conteneur Stigix v2 a été mis à jour et redémarré.`
                        : `Réponse inattendue du serveur (HTTP ${res.status}): ${text.substring(0, 100)}`
                );
            }

            const data = await res.json();
            if (!res.ok || data.success === false) {
                throw new Error(data.error || 'Diagnostic probe failed');
            }

            setResult(data.result);
            if (onProbeComplete && data.result) {
                onProbeComplete(app.id, data.result);
            }
        } catch (err: any) {
            setError(err.message || String(err));
            toast.error(`Probe error: ${err.message || String(err)}`);
        } finally {
            setRunning(false);
        }
    };

    const handleCopyCli = (text: string, key: string) => {
        navigator.clipboard.writeText(text);
        setCopiedCli(key);
        toast.success('CLI command copied to clipboard');
        setTimeout(() => setCopiedCli(null), 2000);
    };

    const handleCopyFullReport = () => {
        if (!result) return;
        const report = `=== Stigix Path MTU & SD-WAN Diagnostic Report ===
Application: ${result.appName} (Port ${result.targetPort})
Target: ${result.targetHost}
Timestamp: ${result.timestamp}
Max Path MTU: ${result.maxPathMtu} Bytes
Recommended MSS: ${result.recommendedMss} Bytes
Fragmentation: ${result.fragmentationDetected ? `YES (Overhead: ${result.overheadBytes}B)` : 'NO (Optimal)'}
Average RTT: ${result.avgRttMs} ms
One-Way Forward Delay: ${result.oneWayDelay?.forwardMs ?? 'N/A'} ms
One-Way Reverse Delay: ${result.oneWayDelay?.reverseMs ?? 'N/A'} ms
Routing Asymmetry: ${result.oneWayDelay?.asymmetryMs ?? 'N/A'} ms (${result.oneWayDelay?.status ?? 'N/A'})

--- Prisma SD-WAN Routing ---
Active Circuit: ${result.prismaFlow?.activeCircuit || 'N/A'}
ION Interface: ${result.prismaFlow?.ionInterface || 'N/A'}
Path Policy: ${result.prismaFlow?.pathPolicy || 'N/A'}
Egress Path: ${result.prismaFlow?.egressPath || 'N/A'}

--- Recommended Fix ---
${result.recommendations.summary}
VyOS: ${result.recommendations.vyos}
Cisco: ${result.recommendations.ciscoIos}
Linux: ${result.recommendations.linux}
`;
        navigator.clipboard.writeText(report);
        setCopiedReport(true);
        toast.success('Diagnostic report copied to clipboard');
        setTimeout(() => setCopiedReport(false), 2500);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto animate-fade-in">
            <div className="relative w-full max-w-4xl bg-slate-900/95 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden my-8">
                
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
                    <div className="flex items-center space-x-3">
                        <div className="p-2.5 rounded-xl bg-teal-500/10 border border-teal-500/30 text-teal-400">
                            <Gauge className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="flex items-center space-x-2">
                                <h2 className="text-base font-bold text-white tracking-wide">
                                    Path MTU & SD-WAN Transport Diagnostics
                                </h2>
                                <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-teal-500/20 text-teal-300 border border-teal-500/30 uppercase tracking-wider">
                                    Active Probe
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">
                                Application <span className="text-teal-400 font-semibold">{app.name}</span> · Port {app.listener?.port || 8083}
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                        aria-label="Close modal"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Peer Selector Bar */}
                <div className="px-6 py-3 bg-slate-900/80 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center space-x-2">
                        <span className="text-slate-400 font-medium">Target Peer:</span>
                        {targetPeers.length > 0 ? (
                            <div className="flex items-center space-x-1.5">
                                {targetPeers.map(peer => (
                                    <button
                                        key={peer.id || peer.host}
                                        disabled={running}
                                        onClick={() => setSelectedTarget(peer.host)}
                                        className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                                            selectedTarget === peer.host
                                                ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40 shadow-sm'
                                                : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 border border-slate-700/50'
                                        }`}
                                    >
                                        {peer.name || peer.host}
                                        <span className="ml-1.5 opacity-60 text-[10px]">({peer.host})</span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <input
                                type="text"
                                value={selectedTarget}
                                onChange={e => setSelectedTarget(e.target.value)}
                                placeholder="192.168.x.x"
                                className="px-3 py-1 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono text-xs w-44"
                            />
                        )}
                    </div>

                    <button
                        onClick={handleRunProbe}
                        disabled={running || !selectedTarget}
                        className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white font-semibold text-xs transition-all shadow-md"
                    >
                        <RotateCcw className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} />
                        <span>{running ? 'Probing Path...' : 'Re-run Diagnostic'}</span>
                    </button>
                </div>

                {/* Main Content Area */}
                <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">

                    {/* Loading State */}
                    {running && (
                        <div className="py-12 text-center space-y-4">
                            <div className="relative inline-flex">
                                <div className="w-14 h-14 rounded-full border-4 border-teal-500/20 border-t-teal-400 animate-spin" />
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <Gauge className="w-6 h-6 text-teal-400 animate-pulse" />
                                </div>
                            </div>
                            <div>
                                <h3 className="text-sm font-semibold text-white">
                                    Injecting Tiered MTU Probes & Correlating SD-WAN Flow...
                                </h3>
                                <p className="text-xs text-slate-400 mt-1 font-mono">
                                    Testing packet sizes [1500B ➔ 1200B] to {selectedTarget}:{app.listener?.port || 8083}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Error State */}
                    {!running && error && (
                        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-start space-x-3">
                            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5 text-rose-400" />
                            <div className="text-xs space-y-1">
                                <div className="font-bold">Diagnostic Probe Failed</div>
                                <div className="font-mono text-rose-200/90">{error}</div>
                            </div>
                        </div>
                    )}

                    {/* Result View */}
                    {!running && result && (
                        <div className="space-y-6 animate-fade-in">
                            
                            {/* Key Diagnostic Metric Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                
                                {/* Card 1: Max Path MTU */}
                                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 relative overflow-hidden">
                                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                                        <span className="font-semibold uppercase tracking-wider text-[10px]">Max Path MTU</span>
                                        <Gauge className="w-4 h-4 text-teal-400" />
                                    </div>
                                    <div className="flex items-baseline space-x-2">
                                        <span className="text-3xl font-extrabold text-white font-mono tracking-tight">
                                            {result.maxPathMtu}
                                        </span>
                                        <span className="text-xs text-slate-400 font-semibold">Bytes</span>
                                    </div>
                                    <div className="mt-2.5 flex items-center space-x-1.5">
                                        {result.fragmentationDetected ? (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                                <AlertTriangle className="w-3 h-3 mr-1" />
                                                Tunnel Overhead (~{result.overheadBytes}B)
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                                Full Standard MTU (1500B)
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Card 2: Recommended TCP MSS */}
                                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 relative overflow-hidden">
                                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                                        <span className="font-semibold uppercase tracking-wider text-[10px]">Recommended MSS</span>
                                        <Layers className="w-4 h-4 text-cyan-400" />
                                    </div>
                                    <div className="flex items-baseline space-x-2">
                                        <span className="text-3xl font-extrabold text-white font-mono tracking-tight text-cyan-400">
                                            {result.recommendedMss}
                                        </span>
                                        <span className="text-xs text-slate-400 font-semibold">Bytes</span>
                                    </div>
                                    <div className="mt-2.5 text-[11px] text-slate-400">
                                        Max Segment Size <span className="font-mono text-slate-300">(MTU - 40B)</span>
                                    </div>
                                </div>

                                {/* Card 3: WAN Latency & Asymmetry */}
                                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 relative overflow-hidden">
                                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                                        <span className="font-semibold uppercase tracking-wider text-[10px]">Average RTT</span>
                                        <Activity className="w-4 h-4 text-purple-400" />
                                    </div>
                                    <div className="flex items-baseline space-x-2">
                                        <span className="text-3xl font-extrabold text-white font-mono tracking-tight text-purple-400">
                                            {result.avgRttMs}
                                        </span>
                                        <span className="text-xs text-slate-400 font-semibold">ms</span>
                                    </div>
                                    <div className="mt-2.5 flex items-center space-x-1.5">
                                        {result.oneWayDelay ? (
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                                                result.oneWayDelay.status === 'SYMMETRIC'
                                                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                                    : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                            }`}>
                                                Δ {result.oneWayDelay.asymmetryMs}ms ({result.oneWayDelay.status})
                                            </span>
                                        ) : (
                                            <span className="text-[11px] text-slate-400">
                                                Deterministic 5-tuple probe
                                            </span>
                                        )}
                                    </div>
                                </div>

                            </div>

                            {/* Section 2: Prisma SD-WAN Flow Browser Correlation */}
                            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center space-x-2 text-xs font-bold text-white">
                                        <Network className="w-4 h-4 text-blue-400" />
                                        <span>Prisma SD-WAN Flow Browser Correlation</span>
                                    </div>
                                    <span className="text-[10px] text-slate-400 font-mono">
                                        5-Tuple: {result.sourceIp}:{result.sourcePort} ➔ {result.targetHost}:{result.targetPort}
                                    </span>
                                </div>

                                {result.prismaFlow?.flowFound ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
                                        <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
                                            <div className="text-[10px] font-semibold text-slate-400 uppercase">Active Circuit</div>
                                            <div className="text-xs font-bold text-emerald-400 truncate mt-0.5">
                                                🟢 {result.prismaFlow.activeCircuit}
                                            </div>
                                            {result.prismaFlow.circuitId && (
                                                <div className="text-[10px] text-slate-400 font-mono truncate">
                                                    ID: {result.prismaFlow.circuitId}
                                                </div>
                                            )}
                                        </div>

                                        <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
                                            <div className="text-[10px] font-semibold text-slate-400 uppercase">ION Interface</div>
                                            <div className="text-xs font-bold text-white truncate mt-0.5">
                                                {result.prismaFlow.ionInterface || 'Controller Port'}
                                            </div>
                                            <div className="text-[10px] text-slate-400 truncate">
                                                Site: {result.prismaFlow.siteName || 'Local'}
                                            </div>
                                        </div>

                                        <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
                                            <div className="text-[10px] font-semibold text-slate-400 uppercase">Matched Path Policy</div>
                                            <div className="text-xs font-bold text-cyan-300 truncate mt-0.5">
                                                {result.prismaFlow.pathPolicy || 'Standard Routing'}
                                            </div>
                                            <div className="text-[10px] text-slate-400 truncate">
                                                Type: {result.prismaFlow.pathType || 'SD-WAN Overlay'}
                                            </div>
                                        </div>

                                        <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
                                            <div className="text-[10px] font-semibold text-slate-400 uppercase">Egress Path</div>
                                            <div className="text-xs font-semibold text-slate-200 truncate mt-0.5" title={result.prismaFlow.egressPath}>
                                                {result.prismaFlow.egressPath || 'Direct'}
                                            </div>
                                            {result.prismaFlow.backupCircuit && (
                                                <div className="text-[10px] text-slate-400 truncate">
                                                    Backup: {result.prismaFlow.backupCircuit}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-800/80 text-xs text-slate-400 flex items-center justify-between">
                                        <span>
                                            {result.prismaFlow?.error || 'Prisma SD-WAN credentials not configured or flow still buffering in ION controller.'}
                                        </span>
                                        <span className="text-[10px] font-mono text-slate-400">
                                            (Target probe completed via direct socket transport)
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Section 3: One-Way Latency & MTU Ladder Breakdown */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                
                                {/* One-Way Latency */}
                                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="font-bold text-white flex items-center space-x-1.5">
                                            <Activity className="w-3.5 h-3.5 text-purple-400" />
                                            <span>One-Way Delay & Asymmetry</span>
                                        </span>
                                        {result.oneWayDelay && (
                                            <span className="text-[10px] font-bold text-slate-400">
                                                Delta: {result.oneWayDelay.asymmetryMs} ms
                                            </span>
                                        )}
                                    </div>

                                    {result.oneWayDelay ? (
                                        <div className="space-y-2 pt-1 text-xs">
                                            <div>
                                                <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                                                    <span>Forward (Spoke ➔ DC)</span>
                                                    <span className="font-mono font-bold text-white">{result.oneWayDelay.forwardMs} ms</span>
                                                </div>
                                                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                                                    <div
                                                        className="bg-purple-500 h-full rounded-full transition-all"
                                                        style={{ width: `${Math.min(100, (result.oneWayDelay.forwardMs / (result.avgRttMs || 1)) * 100)}%` }}
                                                    />
                                                </div>
                                            </div>

                                            <div>
                                                <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                                                    <span>Reverse (DC ➔ Spoke)</span>
                                                    <span className="font-mono font-bold text-white">{result.oneWayDelay.reverseMs} ms</span>
                                                </div>
                                                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                                                    <div
                                                        className="bg-cyan-500 h-full rounded-full transition-all"
                                                        style={{ width: `${Math.min(100, (result.oneWayDelay.reverseMs / (result.avgRttMs || 1)) * 100)}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-xs text-slate-400 py-3">
                                            Peer responded via standard echo mode. Update remote peer to unlock clock delta synchronization.
                                        </div>
                                    )}
                                </div>

                                {/* Step-by-Step MTU Ladder */}
                                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="font-bold text-white flex items-center space-x-1.5">
                                            <Gauge className="w-3.5 h-3.5 text-teal-400" />
                                            <span>MTU Test Ladder (DF bit)</span>
                                        </span>
                                        <span className="text-[10px] text-slate-400 font-mono">
                                            {result.steps.filter(s => s.success).length}/{result.steps.length} Passed
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 pt-1">
                                        {result.steps.map(step => (
                                            <div
                                                key={step.stepBytes}
                                                className={`p-2 rounded-lg border text-center text-xs font-mono transition-all ${
                                                    step.success
                                                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                                        : 'bg-rose-500/10 border-rose-500/30 text-rose-400 opacity-60'
                                                }`}
                                            >
                                                <div className="font-bold text-[11px]">{step.stepBytes}B</div>
                                                <div className="text-[9px] mt-0.5">
                                                    {step.success ? `${step.rttMs}ms` : 'DROP'}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                            </div>

                            {/* Section 4: Actionable Configuration Fix (CLI Generator) */}
                            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center space-x-2 text-xs font-bold text-white">
                                        <Terminal className="w-4 h-4 text-amber-400" />
                                        <span>Recommended Router / SD-WAN Configuration</span>
                                    </div>
                                    <div className="flex items-center space-x-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-[10px]">
                                        <button
                                            onClick={() => setActiveCliTab('vyos')}
                                            className={`px-2 py-0.5 rounded font-semibold transition-all ${
                                                activeCliTab === 'vyos' ? 'bg-teal-500/20 text-teal-300' : 'text-slate-400 hover:text-white'
                                            }`}
                                        >
                                            VyOS
                                        </button>
                                        <button
                                            onClick={() => setActiveCliTab('cisco')}
                                            className={`px-2 py-0.5 rounded font-semibold transition-all ${
                                                activeCliTab === 'cisco' ? 'bg-teal-500/20 text-teal-300' : 'text-slate-400 hover:text-white'
                                            }`}
                                        >
                                            Cisco IOS
                                        </button>
                                        <button
                                            onClick={() => setActiveCliTab('linux')}
                                            className={`px-2 py-0.5 rounded font-semibold transition-all ${
                                                activeCliTab === 'linux' ? 'bg-teal-500/20 text-teal-300' : 'text-slate-400 hover:text-white'
                                            }`}
                                        >
                                            Linux / iptables
                                        </button>
                                    </div>
                                </div>

                                <p className="text-xs text-slate-400">
                                    {result.recommendations.summary}
                                </p>

                                <div className="relative group">
                                    <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono text-teal-300 overflow-x-auto">
                                        {activeCliTab === 'vyos' && result.recommendations.vyos}
                                        {activeCliTab === 'cisco' && result.recommendations.ciscoIos}
                                        {activeCliTab === 'linux' && result.recommendations.linux}
                                    </pre>
                                    <button
                                        onClick={() => {
                                            const cmd = activeCliTab === 'vyos'
                                                ? result.recommendations.vyos
                                                : activeCliTab === 'cisco'
                                                    ? result.recommendations.ciscoIos
                                                    : result.recommendations.linux;
                                            handleCopyCli(cmd, activeCliTab);
                                        }}
                                        className="absolute right-2 top-2 p-1.5 rounded-md bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-all shadow"
                                        title="Copy CLI command"
                                    >
                                        {copiedCli === activeCliTab ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                    </button>
                                </div>
                            </div>

                        </div>
                    )}

                </div>

                {/* Footer Actions */}
                <div className="px-6 py-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between">
                    <button
                        onClick={handleCopyFullReport}
                        disabled={!result || running}
                        className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs font-semibold transition-all border border-slate-700"
                    >
                        {copiedReport ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedReport ? 'Report Copied!' : 'Copy Full Diagnostic Report'}</span>
                    </button>

                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition-colors"
                    >
                        Close
                    </button>
                </div>

            </div>
        </div>
    );
};
