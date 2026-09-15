import React, { useState } from 'react';
import { ApiLogInspector } from './components/api-studio/ApiLogInspector';
import { ApiPlayground } from './components/api-studio/ApiPlayground';
import type { ApiLogEntry } from './types/api-studio';
import { Terminal, PlayCircle, Activity, Sparkles, Sliders, ShieldCheck } from 'lucide-react';

interface ApiStudioProps {
    token: string | null;
}

export const ApiStudio: React.FC<ApiStudioProps> = ({ token }) => {
    const [activeSubTab, setActiveSubTab] = useState<'inspector' | 'playground'>('inspector');
    const [replayLog, setReplayLog] = useState<ApiLogEntry | null>(null);

    const handleReplayInPlayground = (log: ApiLogEntry) => {
        setReplayLog(log);
        setActiveSubTab('playground');
    };

    return (
        <div className="flex flex-col h-[calc(100vh-5rem)] p-4 md:p-6 space-y-4 max-w-[1700px] mx-auto w-full">
            {/* Header / Sub-tab Switcher */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-card/60 backdrop-blur border border-border p-4 rounded-xl shadow-sm">
                <div className="flex items-center space-x-3">
                    <div className="p-2.5 bg-blue-600/10 border border-blue-500/20 text-blue-400 rounded-lg shadow-inner">
                        <Terminal className="w-6 h-6" />
                    </div>
                    <div>
                        <div className="flex items-center space-x-2">
                            <h1 className="text-lg font-bold text-text tracking-tight">API Studio & Observability</h1>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                Live Telemetry
                            </span>
                        </div>
                        <p className="text-xs text-text-muted mt-0.5">
                            Real-time API log inspector across Node.js & Python engines with interactive request composer & presets.
                        </p>
                    </div>
                </div>

                {/* Sub Tab Switcher Buttons */}
                <div className="flex items-center bg-input/80 border border-input-border p-1 rounded-xl shadow-inner">
                    <button
                        onClick={() => setActiveSubTab('inspector')}
                        className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                            activeSubTab === 'inspector'
                                ? 'bg-blue-600 text-white shadow-md'
                                : 'text-text-muted hover:text-text'
                        }`}
                    >
                        <Activity className="w-3.5 h-3.5" />
                        <span>Live API Inspector</span>
                    </button>

                    <button
                        onClick={() => setActiveSubTab('playground')}
                        className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                            activeSubTab === 'playground'
                                ? 'bg-blue-600 text-white shadow-md'
                                : 'text-text-muted hover:text-text'
                        }`}
                    >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>API Playground & Presets</span>
                    </button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 min-h-0">
                {activeSubTab === 'inspector' ? (
                    <ApiLogInspector
                        token={token}
                        onReplayInPlayground={handleReplayInPlayground}
                    />
                ) : (
                    <ApiPlayground
                        token={token}
                        initialLogToReplay={replayLog}
                        onClearReplay={() => setReplayLog(null)}
                    />
                )}
            </div>
        </div>
    );
};

export default ApiStudio;
