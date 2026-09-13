import React, { useState } from 'react';
import type { ApiLogEntry } from '../../types/api-studio';
import { X, Copy, Check, Zap, ArrowRight, Clock, Server, FileCode, AlertTriangle, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';

interface ApiLogDetailDrawerProps {
    log: ApiLogEntry | null;
    onClose: () => void;
    onReplay: (log: ApiLogEntry) => void;
}

export const ApiLogDetailDrawer: React.FC<ApiLogDetailDrawerProps> = ({ log, onClose, onReplay }) => {
    const [copiedCurl, setCopiedCurl] = useState(false);
    const [copiedReqBody, setCopiedReqBody] = useState(false);
    const [copiedResBody, setCopiedResBody] = useState(false);
    const [activeTab, setActiveTab] = useState<'response' | 'request' | 'headers' | 'curl'>('response');

    if (!log) return null;

    const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success('Copied to clipboard');
        setTimeout(() => setCopied(false), 2000);
    };

    const getStatusColor = (code: number) => {
        if (code >= 200 && code < 300) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
        if (code >= 300 && code < 400) return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
        if (code >= 400 && code < 500) return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
        return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
    };

    const getMethodColor = (method: string) => {
        switch (method.toUpperCase()) {
            case 'GET': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
            case 'POST': return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
            case 'PUT': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
            case 'DELETE': return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
            case 'PATCH': return 'text-purple-400 bg-purple-500/10 border-purple-500/20';
            default: return 'text-gray-400 bg-gray-500/10 border-gray-500/20';
        }
    };

    const formatJson = (data: any) => {
        if (data === undefined || data === null) return 'No data';
        if (typeof data === 'string') {
            try {
                return JSON.stringify(JSON.parse(data), null, 2);
            } catch {
                return data;
            }
        }
        return JSON.stringify(data, null, 2);
    };

    return (
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-card border-l border-border shadow-2xl flex flex-col backdrop-blur-md animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-4 border-b border-border flex items-center justify-between bg-card-header/60">
                <div className="flex items-center space-x-3 overflow-hidden">
                    <span className={`px-2.5 py-1 text-xs font-bold font-mono rounded border ${getMethodColor(log.method)}`}>
                        {log.method}
                    </span>
                    <span className={`px-2 py-0.5 text-xs font-bold font-mono rounded border ${getStatusColor(log.statusCode)}`}>
                        {log.statusCode || 'ERR'}
                    </span>
                    <span className="text-xs text-text-muted truncate font-mono max-w-[280px]" title={log.url}>
                        {log.pathname || log.url}
                    </span>
                </div>
                <div className="flex items-center space-x-2">
                    <button
                        onClick={() => onReplay(log)}
                        className="flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-xs font-semibold shadow transition-colors"
                        title="Load this request into API Playground"
                    >
                        <Zap className="w-3.5 h-3.5" />
                        <span>Replay in Playground</span>
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-text-muted hover:text-text hover:bg-card-hover rounded-md transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Quick Metadata Bar */}
            <div className="px-5 py-3 border-b border-border/60 bg-card-body/40 flex flex-wrap gap-4 text-xs">
                <div className="flex items-center space-x-1 text-text-muted">
                    <Clock className="w-3.5 h-3.5 text-blue-400" />
                    <span>{log.durationMs} ms</span>
                </div>
                <div className="flex items-center space-x-1 text-text-muted">
                    <Server className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="capitalize">{log.source} {log.scriptName ? `(${log.scriptName})` : ''}</span>
                </div>
                <div className="flex items-center space-x-1 text-text-muted">
                    <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
                    <span>Secrets Masked</span>
                </div>
                <div className="ml-auto text-text-muted text-[11px]">
                    {new Date(log.timestamp).toLocaleTimeString()}
                </div>
            </div>

            {/* URL Display */}
            <div className="px-5 py-2.5 bg-black/20 border-b border-border/40 flex items-center justify-between">
                <span className="text-xs font-mono text-blue-300 break-all select-all">{log.url}</span>
            </div>

            {/* Error Banner if present */}
            {log.error && (
                <div className="mx-5 mt-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg flex items-start space-x-2 text-xs text-rose-300">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div className="break-all font-mono">{log.error}</div>
                </div>
            )}

            {/* Tabs */}
            <div className="px-5 pt-3 border-b border-border flex space-x-4 text-xs font-medium">
                <button
                    onClick={() => setActiveTab('response')}
                    className={`pb-2 transition-colors border-b-2 flex items-center space-x-1.5 ${
                        activeTab === 'response' ? 'border-blue-500 text-blue-400 font-semibold' : 'border-transparent text-text-muted hover:text-text'
                    }`}
                >
                    <span>Response Body</span>
                </button>
                <button
                    onClick={() => setActiveTab('request')}
                    className={`pb-2 transition-colors border-b-2 flex items-center space-x-1.5 ${
                        activeTab === 'request' ? 'border-blue-500 text-blue-400 font-semibold' : 'border-transparent text-text-muted hover:text-text'
                    }`}
                >
                    <span>Request Body</span>
                </button>
                <button
                    onClick={() => setActiveTab('headers')}
                    className={`pb-2 transition-colors border-b-2 flex items-center space-x-1.5 ${
                        activeTab === 'headers' ? 'border-blue-500 text-blue-400 font-semibold' : 'border-transparent text-text-muted hover:text-text'
                    }`}
                >
                    <span>Headers ({Object.keys(log.requestHeaders || {}).length + Object.keys(log.responseHeaders || {}).length})</span>
                </button>
                <button
                    onClick={() => setActiveTab('curl')}
                    className={`pb-2 transition-colors border-b-2 flex items-center space-x-1.5 ${
                        activeTab === 'curl' ? 'border-blue-500 text-blue-400 font-semibold' : 'border-transparent text-text-muted hover:text-text'
                    }`}
                >
                    <span>cURL Snippet</span>
                </button>
            </div>

            {/* Tab Contents */}
            <div className="flex-1 overflow-y-auto p-5 font-mono text-xs">
                {activeTab === 'response' && (
                    <div className="relative">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-[11px] text-text-muted">Status: {log.statusCode}</span>
                            {log.responseBody && (
                                <button
                                    onClick={() => copyToClipboard(formatJson(log.responseBody), setCopiedResBody)}
                                    className="flex items-center space-x-1 px-2 py-1 bg-card hover:bg-card-hover border border-border rounded text-[11px] text-text-muted hover:text-text transition-colors"
                                >
                                    {copiedResBody ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                    <span>Copy JSON</span>
                                </button>
                            )}
                        </div>
                        <pre className="p-3 bg-black/40 border border-border rounded-lg overflow-x-auto text-emerald-300 text-[11px] leading-relaxed max-h-[450px]">
                            {formatJson(log.responseBody)}
                        </pre>
                    </div>
                )}

                {activeTab === 'request' && (
                    <div className="relative">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-[11px] text-text-muted">Payload:</span>
                            {log.requestBody && (
                                <button
                                    onClick={() => copyToClipboard(formatJson(log.requestBody), setCopiedReqBody)}
                                    className="flex items-center space-x-1 px-2 py-1 bg-card hover:bg-card-hover border border-border rounded text-[11px] text-text-muted hover:text-text transition-colors"
                                >
                                    {copiedReqBody ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                    <span>Copy JSON</span>
                                </button>
                            )}
                        </div>
                        <pre className="p-3 bg-black/40 border border-border rounded-lg overflow-x-auto text-blue-300 text-[11px] leading-relaxed max-h-[450px]">
                            {formatJson(log.requestBody)}
                        </pre>
                    </div>
                )}

                {activeTab === 'headers' && (
                    <div className="space-y-4">
                        <div>
                            <h4 className="text-xs font-semibold text-text mb-2">Request Headers</h4>
                            {log.requestHeaders && Object.keys(log.requestHeaders).length > 0 ? (
                                <div className="border border-border rounded-lg overflow-hidden">
                                    <table className="w-full text-left text-[11px]">
                                        <tbody className="divide-y divide-border/40">
                                            {Object.entries(log.requestHeaders).map(([k, v]) => (
                                                <tr key={k} className="hover:bg-card-hover/40">
                                                    <td className="p-2 font-semibold text-blue-400 w-1/3 break-all">{k}</td>
                                                    <td className="p-2 text-text-muted break-all">{String(v)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <p className="text-text-muted text-[11px]">No request headers captured</p>
                            )}
                        </div>

                        <div>
                            <h4 className="text-xs font-semibold text-text mb-2">Response Headers</h4>
                            {log.responseHeaders && Object.keys(log.responseHeaders).length > 0 ? (
                                <div className="border border-border rounded-lg overflow-hidden">
                                    <table className="w-full text-left text-[11px]">
                                        <tbody className="divide-y divide-border/40">
                                            {Object.entries(log.responseHeaders).map(([k, v]) => (
                                                <tr key={k} className="hover:bg-card-hover/40">
                                                    <td className="p-2 font-semibold text-emerald-400 w-1/3 break-all">{k}</td>
                                                    <td className="p-2 text-text-muted break-all">{String(v)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <p className="text-text-muted text-[11px]">No response headers captured</p>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'curl' && (
                    <div className="relative">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-[11px] text-text-muted">Reproducible cURL Command:</span>
                            <button
                                onClick={() => copyToClipboard(log.curlSnippet || '', setCopiedCurl)}
                                className="flex items-center space-x-1 px-2.5 py-1 bg-card hover:bg-card-hover border border-border rounded text-[11px] text-text-muted hover:text-text transition-colors"
                            >
                                {copiedCurl ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                <span>Copy cURL</span>
                            </button>
                        </div>
                        <pre className="p-3 bg-black/50 border border-border rounded-lg overflow-x-auto text-amber-300 text-[11px] leading-relaxed whitespace-pre-wrap">
                            {log.curlSnippet || 'No cURL command generated'}
                        </pre>
                    </div>
                )}
            </div>
        </div>
    );
};
