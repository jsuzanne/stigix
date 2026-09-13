import React, { useState, useEffect } from 'react';
import type { ApiPreset, AutoAuthType, PlaygroundExecutionResult, ApiLogEntry } from '../../types/api-studio';
import { API_PRESETS } from './presets';
import { generateCurlCode, generatePythonRequestsCode, generatePrismaSasePythonCode, generateNodeFetchCode } from './code-generators';
import { 
    Send, Play, Copy, Check, Plus, Trash2, Code, Sparkles, 
    Shield, Clock, Server, AlertTriangle, FileCode, CheckCircle2, ChevronDown 
} from 'lucide-react';
import toast from 'react-hot-toast';

interface ApiPlaygroundProps {
    token: string | null;
    initialLogToReplay?: ApiLogEntry | null;
    onClearReplay?: () => void;
}

interface KeyValueRow {
    id: string;
    key: string;
    value: string;
    enabled: boolean;
}

export const ApiPlayground: React.FC<ApiPlaygroundProps> = ({ 
    token, 
    initialLogToReplay, 
    onClearReplay 
}) => {
    const [selectedPresetId, setSelectedPresetId] = useState<string>('custom');
    const [method, setMethod] = useState<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'>('GET');
    const [url, setUrl] = useState<string>('/sdwan/v2.1/api/sites');
    const [autoAuth, setAutoAuth] = useState<AutoAuthType>('sase');
    const [activeTab, setActiveTab] = useState<'body' | 'headers' | 'params' | 'export'>('body');
    const [exportLanguage, setExportLanguage] = useState<'curl' | 'python_sase' | 'python_requests' | 'node'>('curl');

    // Headers & Params table states
    const [headers, setHeaders] = useState<KeyValueRow[]>([
        { id: '1', key: 'Content-Type', value: 'application/json', enabled: true }
    ]);
    const [queryParams, setQueryParams] = useState<KeyValueRow[]>([]);
    const [bodyText, setBodyText] = useState<string>('{}');

    // Execution & Response states
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [executionResult, setExecutionResult] = useState<PlaygroundExecutionResult | null>(null);
    const [copiedExport, setCopiedExport] = useState<boolean>(false);
    const [copiedResponse, setCopiedResponse] = useState<boolean>(false);

    // Load initial log if provided via Replay
    useEffect(() => {
        if (initialLogToReplay) {
            setSelectedPresetId('custom');
            setMethod(initialLogToReplay.method as any);
            setUrl(initialLogToReplay.url);
            
            // Guess autoAuth or set to none
            if (initialLogToReplay.url.includes('paloaltonetworks.com') || initialLogToReplay.url.includes('/sdwan/')) {
                setAutoAuth('sase');
            } else if (initialLogToReplay.url.includes('/show') || initialLogToReplay.source === 'vyos') {
                setAutoAuth('vyos');
            } else if (initialLogToReplay.url.startsWith('/api/')) {
                setAutoAuth('stigix');
            } else {
                setAutoAuth('none');
            }

            if (initialLogToReplay.requestHeaders) {
                const headerRows = Object.entries(initialLogToReplay.requestHeaders).map(([k, v], idx) => ({
                    id: String(idx + 1),
                    key: k,
                    value: String(v),
                    enabled: true
                }));
                setHeaders(headerRows);
            }

            if (initialLogToReplay.requestBody) {
                setBodyText(
                    typeof initialLogToReplay.requestBody === 'object'
                        ? JSON.stringify(initialLogToReplay.requestBody, null, 2)
                        : String(initialLogToReplay.requestBody)
                );
                setActiveTab('body');
            }

            toast.success(`Loaded "${initialLogToReplay.method} ${initialLogToReplay.pathname || initialLogToReplay.url}" into Playground!`);
            if (onClearReplay) onClearReplay();
        }
    }, [initialLogToReplay]);

    // Handle Preset Selection
    const handleSelectPreset = (presetId: string) => {
        setSelectedPresetId(presetId);
        if (presetId === 'custom') return;

        const preset = API_PRESETS.find(p => p.id === presetId);
        if (!preset) return;

        setMethod(preset.method);
        setUrl(preset.url);
        setAutoAuth(preset.autoAuth);

        if (preset.headers) {
            const hRows = Object.entries(preset.headers).map(([k, v], i) => ({
                id: String(i + 1),
                key: k,
                value: v,
                enabled: true
            }));
            setHeaders(hRows);
        } else {
            setHeaders([{ id: '1', key: 'Content-Type', value: 'application/json', enabled: true }]);
        }

        if (preset.body) {
            setBodyText(JSON.stringify(preset.body, null, 2));
            setActiveTab('body');
        } else {
            setBodyText('');
            setActiveTab('headers');
        }
    };

    // Format JSON Body
    const handleFormatJson = () => {
        try {
            const parsed = JSON.parse(bodyText);
            setBodyText(JSON.stringify(parsed, null, 2));
            toast.success('JSON formatted');
        } catch {
            toast.error('Invalid JSON syntax');
        }
    };

    // Send Request Execution
    const handleSendRequest = async () => {
        if (!url.trim()) {
            toast.error('Please enter a target URL or endpoint path');
            return;
        }

        setIsLoading(true);
        setExecutionResult(null);

        // Build active headers map
        const headerMap: Record<string, string> = {};
        headers.forEach(h => {
            if (h.enabled && h.key.trim()) {
                headerMap[h.key.trim()] = h.value;
            }
        });

        // Parse body if present
        let parsedBody: any = undefined;
        if (!['GET', 'HEAD'].includes(method) && bodyText.trim()) {
            try {
                parsedBody = JSON.parse(bodyText);
            } catch {
                parsedBody = bodyText;
            }
        }

        // Build final URL with Query Parameters
        let finalUrl = url.trim();
        const activeParams = queryParams.filter(p => p.enabled && p.key.trim());
        if (activeParams.length > 0) {
            const searchParams = new URLSearchParams();
            activeParams.forEach(p => searchParams.append(p.key.trim(), p.value));
            finalUrl += (finalUrl.includes('?') ? '&' : '?') + searchParams.toString();
        }

        try {
            const res = await fetch('/api/playground/execute', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    method,
                    url: finalUrl,
                    headers: headerMap,
                    body: parsedBody,
                    autoAuth
                })
            });

            const data = await res.json();
            setExecutionResult(data);

            if (data.success && data.statusCode >= 200 && data.statusCode < 300) {
                toast.success(`Success (${data.statusCode}) in ${data.durationMs}ms`);
            } else if (data.statusCode) {
                toast.error(`Received HTTP ${data.statusCode}`);
            } else {
                toast.error(data.response?.error || 'Request execution failed');
            }
        } catch (err: any) {
            toast.error(`Execution error: ${err.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    // Copy to clipboard helper
    const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success('Copied to clipboard');
        setTimeout(() => setCopied(false), 2000);
    };

    // Export code calculation
    const getExportCode = () => {
        const headerMap: Record<string, string> = {};
        headers.forEach(h => {
            if (h.enabled && h.key.trim()) headerMap[h.key.trim()] = h.value;
        });

        let parsedBody: any = undefined;
        if (bodyText.trim()) {
            try { parsedBody = JSON.parse(bodyText); } catch { parsedBody = bodyText; }
        }

        switch (exportLanguage) {
            case 'curl':
                return generateCurlCode(method, url, headerMap, parsedBody, autoAuth);
            case 'python_requests':
                return generatePythonRequestsCode(method, url, headerMap, parsedBody, autoAuth);
            case 'python_sase':
                return generatePrismaSasePythonCode(method, url, parsedBody);
            case 'node':
                return generateNodeFetchCode(method, url, headerMap, parsedBody, autoAuth);
            default:
                return '';
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 h-full">
            {/* Left Column: Request Builder (7 cols) */}
            <div className="lg:col-span-7 flex flex-col bg-card rounded-xl border border-border overflow-hidden shadow-sm">
                {/* Preset Selector Banner */}
                <div className="p-3.5 border-b border-border bg-card-header/40 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center space-x-2">
                        <Sparkles className="w-4 h-4 text-blue-400" />
                        <span className="text-xs font-semibold text-text">Preset Catalog:</span>
                        <select
                            value={selectedPresetId}
                            onChange={(e) => handleSelectPreset(e.target.value)}
                            className="bg-input border border-input-border rounded-lg px-3 py-1 text-xs text-text focus:outline-none max-w-[280px]"
                        >
                            <option value="custom">-- Custom Request (Scratchpad) --</option>
                            <optgroup label="Prisma SD-WAN (CloudGenix)">
                                {API_PRESETS.filter(p => p.category === 'Prisma SD-WAN').map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </optgroup>
                            <optgroup label="Palo Alto SCM & SLS">
                                {API_PRESETS.filter(p => p.category === 'Palo Alto SCM').map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </optgroup>
                            <optgroup label="VyOS SD-WAN">
                                {API_PRESETS.filter(p => p.category === 'VyOS SD-WAN').map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </optgroup>
                            <optgroup label="Stigix Platform">
                                {API_PRESETS.filter(p => p.category === 'Stigix Platform').map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </optgroup>
                            <optgroup label="External Probes & Targets">
                                {API_PRESETS.filter(p => p.category === 'External Probes').map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </optgroup>
                        </select>
                    </div>

                    {/* Auto-Auth Pill */}
                    <div className="flex items-center space-x-1.5 text-xs">
                        <Shield className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-text-muted text-[11px]">Auto Auth:</span>
                        <select
                            value={autoAuth}
                            onChange={(e) => setAutoAuth(e.target.value as AutoAuthType)}
                            className="bg-input border border-input-border rounded-md px-2 py-0.5 text-[11px] text-text font-medium focus:outline-none"
                        >
                            <option value="none">None / Manual</option>
                            <option value="sase">Prisma SASE OAuth</option>
                            <option value="vyos">VyOS API Key</option>
                            <option value="stigix">Stigix JWT Token</option>
                        </select>
                    </div>
                </div>

                {/* Method & URL Input Bar */}
                <div className="p-4 border-b border-border/70 flex items-center space-x-2 bg-card-body/20">
                    <select
                        value={method}
                        onChange={(e) => setMethod(e.target.value as any)}
                        className={`bg-input border border-input-border rounded-lg px-3 py-2 text-xs font-bold font-mono focus:outline-none ${
                            method === 'GET' ? 'text-emerald-400' :
                            method === 'POST' ? 'text-blue-400' :
                            method === 'PUT' ? 'text-amber-400' :
                            method === 'DELETE' ? 'text-rose-400' : 'text-purple-400'
                        }`}
                    >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="DELETE">DELETE</option>
                        <option value="PATCH">PATCH</option>
                    </select>

                    <div className="relative flex-1">
                        <input
                            type="text"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            onKeyDown={(e) => {
                                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                    handleSendRequest();
                                }
                            }}
                            placeholder="/sdwan/v2.1/api/sites or https://..."
                            className="w-full px-3 py-2 bg-input border border-input-border rounded-lg text-xs font-mono text-text focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </div>

                    <button
                        onClick={handleSendRequest}
                        disabled={isLoading}
                        className="flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow transition-all shrink-0"
                        title="Execute request via Stigix proxy (Ctrl+Enter / Cmd+Enter)"
                    >
                        {isLoading ? (
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <Send className="w-3.5 h-3.5" />
                        )}
                        <span>{isLoading ? 'Sending...' : 'Send'}</span>
                    </button>
                </div>

                {/* Request Tabs */}
                <div className="px-4 pt-3 border-b border-border flex space-x-4 text-xs font-medium bg-card-header/20">
                    <button
                        onClick={() => setActiveTab('body')}
                        className={`pb-2.5 transition-colors border-b-2 flex items-center space-x-1.5 ${
                            activeTab === 'body' ? 'border-blue-500 text-blue-400 font-semibold' : 'border-transparent text-text-muted hover:text-text'
                        }`}
                    >
                        <span>JSON Body</span>
                        {bodyText.trim() && bodyText !== '{}' && (
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab('headers')}
                        className={`pb-2.5 transition-colors border-b-2 flex items-center space-x-1.5 ${
                            activeTab === 'headers' ? 'border-blue-500 text-blue-400 font-semibold' : 'border-transparent text-text-muted hover:text-text'
                        }`}
                    >
                        <span>Headers ({headers.filter(h => h.enabled).length})</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('params')}
                        className={`pb-2.5 transition-colors border-b-2 flex items-center space-x-1.5 ${
                            activeTab === 'params' ? 'border-blue-500 text-blue-400 font-semibold' : 'border-transparent text-text-muted hover:text-text'
                        }`}
                    >
                        <span>Query Params ({queryParams.filter(p => p.enabled).length})</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('export')}
                        className={`pb-2.5 transition-colors border-b-2 flex items-center space-x-1.5 ${
                            activeTab === 'export' ? 'border-blue-500 text-blue-400 font-semibold' : 'border-transparent text-text-muted hover:text-text'
                        }`}
                    >
                        <Code className="w-3.5 h-3.5" />
                        <span>Code Export</span>
                    </button>
                </div>

                {/* Tab Contents */}
                <div className="flex-1 p-4 overflow-y-auto">
                    {/* 1. Body Editor */}
                    {activeTab === 'body' && (
                        <div className="flex flex-col h-full space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] text-text-muted font-medium">JSON Payload:</span>
                                <button
                                    onClick={handleFormatJson}
                                    className="px-2.5 py-1 bg-card hover:bg-card-hover border border-border rounded text-[11px] text-text-muted hover:text-text transition-colors flex items-center space-x-1"
                                >
                                    <Sparkles className="w-3 h-3 text-blue-400" />
                                    <span>Format JSON</span>
                                </button>
                            </div>
                            <textarea
                                value={bodyText}
                                onChange={(e) => setBodyText(e.target.value)}
                                placeholder='{\n  "key": "value"\n}'
                                className="w-full flex-1 min-h-[260px] p-3 bg-black/40 border border-border rounded-lg font-mono text-xs text-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-500 leading-relaxed resize-none"
                            />
                        </div>
                    )}

                    {/* 2. Headers Editor */}
                    {activeTab === 'headers' && (
                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                                <span className="text-[11px] text-text-muted">Custom HTTP Headers:</span>
                                <button
                                    onClick={() => setHeaders(prev => [...prev, { id: String(Date.now()), key: '', value: '', enabled: true }])}
                                    className="flex items-center space-x-1 px-2.5 py-1 bg-card hover:bg-card-hover border border-border rounded text-[11px] text-text transition-colors"
                                >
                                    <Plus className="w-3 h-3 text-emerald-400" />
                                    <span>Add Header</span>
                                </button>
                            </div>

                            <div className="border border-border rounded-lg overflow-hidden">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-card-header/60 text-text-muted text-[11px]">
                                        <tr>
                                            <th className="p-2 w-8 text-center">✓</th>
                                            <th className="p-2 w-1/3">Key</th>
                                            <th className="p-2">Value</th>
                                            <th className="p-2 w-10 text-center">✕</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/40 font-mono text-xs">
                                        {headers.map((h, index) => (
                                            <tr key={h.id}>
                                                <td className="p-2 text-center">
                                                    <input
                                                        type="checkbox"
                                                        checked={h.enabled}
                                                        onChange={(e) => {
                                                            const updated = [...headers];
                                                            updated[index].enabled = e.target.checked;
                                                            setHeaders(updated);
                                                        }}
                                                    />
                                                </td>
                                                <td className="p-1">
                                                    <input
                                                        type="text"
                                                        value={h.key}
                                                        onChange={(e) => {
                                                            const updated = [...headers];
                                                            updated[index].key = e.target.value;
                                                            setHeaders(updated);
                                                        }}
                                                        placeholder="Header-Name"
                                                        className="w-full bg-input border border-input-border rounded px-2 py-1 text-xs text-text focus:outline-none"
                                                    />
                                                </td>
                                                <td className="p-1">
                                                    <input
                                                        type="text"
                                                        value={h.value}
                                                        onChange={(e) => {
                                                            const updated = [...headers];
                                                            updated[index].value = e.target.value;
                                                            setHeaders(updated);
                                                        }}
                                                        placeholder="Header Value"
                                                        className="w-full bg-input border border-input-border rounded px-2 py-1 text-xs text-text focus:outline-none"
                                                    />
                                                </td>
                                                <td className="p-1 text-center">
                                                    <button
                                                        onClick={() => setHeaders(headers.filter((_, i) => i !== index))}
                                                        className="text-text-muted hover:text-rose-400 p-1"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* 3. Query Params Editor */}
                    {activeTab === 'params' && (
                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                                <span className="text-[11px] text-text-muted">URL Query Parameters:</span>
                                <button
                                    onClick={() => setQueryParams(prev => [...prev, { id: String(Date.now()), key: '', value: '', enabled: true }])}
                                    className="flex items-center space-x-1 px-2.5 py-1 bg-card hover:bg-card-hover border border-border rounded text-[11px] text-text transition-colors"
                                >
                                    <Plus className="w-3 h-3 text-emerald-400" />
                                    <span>Add Parameter</span>
                                </button>
                            </div>

                            <div className="border border-border rounded-lg overflow-hidden">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-card-header/60 text-text-muted text-[11px]">
                                        <tr>
                                            <th className="p-2 w-8 text-center">✓</th>
                                            <th className="p-2 w-1/3">Key</th>
                                            <th className="p-2">Value</th>
                                            <th className="p-2 w-10 text-center">✕</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/40 font-mono text-xs">
                                        {queryParams.map((p, index) => (
                                            <tr key={p.id}>
                                                <td className="p-2 text-center">
                                                    <input
                                                        type="checkbox"
                                                        checked={p.enabled}
                                                        onChange={(e) => {
                                                            const updated = [...queryParams];
                                                            updated[index].enabled = e.target.checked;
                                                            setQueryParams(updated);
                                                        }}
                                                    />
                                                </td>
                                                <td className="p-1">
                                                    <input
                                                        type="text"
                                                        value={p.key}
                                                        onChange={(e) => {
                                                            const updated = [...queryParams];
                                                            updated[index].key = e.target.value;
                                                            setQueryParams(updated);
                                                        }}
                                                        placeholder="param_name"
                                                        className="w-full bg-input border border-input-border rounded px-2 py-1 text-xs text-text focus:outline-none"
                                                    />
                                                </td>
                                                <td className="p-1">
                                                    <input
                                                        type="text"
                                                        value={p.value}
                                                        onChange={(e) => {
                                                            const updated = [...queryParams];
                                                            updated[index].value = e.target.value;
                                                            setQueryParams(updated);
                                                        }}
                                                        placeholder="param_value"
                                                        className="w-full bg-input border border-input-border rounded px-2 py-1 text-xs text-text focus:outline-none"
                                                    />
                                                </td>
                                                <td className="p-1 text-center">
                                                    <button
                                                        onClick={() => setQueryParams(queryParams.filter((_, i) => i !== index))}
                                                        className="text-text-muted hover:text-rose-400 p-1"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* 4. Code Export Generator */}
                    {activeTab === 'export' && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex space-x-1.5 bg-card border border-border rounded-lg p-1 text-xs font-mono">
                                    {(['curl', 'python_sase', 'python_requests', 'node'] as const).map(lang => (
                                        <button
                                            key={lang}
                                            onClick={() => setExportLanguage(lang)}
                                            className={`px-2.5 py-1 rounded transition-colors ${
                                                exportLanguage === lang ? 'bg-blue-600 text-white font-semibold' : 'text-text-muted hover:text-text'
                                            }`}
                                        >
                                            {lang === 'curl' ? 'cURL' :
                                             lang === 'python_sase' ? 'Python (prisma_sase)' :
                                             lang === 'python_requests' ? 'Python (requests)' : 'Node.js (fetch)'}
                                        </button>
                                    ))}
                                </div>

                                <button
                                    onClick={() => copyToClipboard(getExportCode(), setCopiedExport)}
                                    className="flex items-center space-x-1 px-3 py-1 bg-card hover:bg-card-hover border border-border rounded text-xs text-text font-medium transition-colors"
                                >
                                    {copiedExport ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                    <span>Copy Snippet</span>
                                </button>
                            </div>

                            <pre className="p-3.5 bg-black/50 border border-border rounded-lg font-mono text-xs text-amber-300 overflow-x-auto leading-relaxed max-h-[350px] whitespace-pre-wrap">
                                {getExportCode()}
                            </pre>
                        </div>
                    )}
                </div>
            </div>

            {/* Right Column: Execution Response Viewer (5 cols) */}
            <div className="lg:col-span-5 flex flex-col bg-card rounded-xl border border-border overflow-hidden shadow-sm">
                {/* Response Header */}
                <div className="p-3.5 border-b border-border bg-card-header/40 flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                        <Server className="w-4 h-4 text-emerald-400" />
                        <span className="text-xs font-semibold text-text">Response Inspector</span>
                    </div>

                    {executionResult && (
                        <div className="flex items-center space-x-2">
                            <span className={`px-2 py-0.5 rounded text-xs font-bold font-mono border ${
                                executionResult.statusCode >= 200 && executionResult.statusCode < 300
                                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                    : executionResult.statusCode >= 400 && executionResult.statusCode < 500
                                        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                        : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                            }`}>
                                {executionResult.statusCode || 'ERR'}
                            </span>
                            <span className="text-xs text-text-muted font-mono flex items-center space-x-1">
                                <Clock className="w-3 h-3 text-blue-400" />
                                <span>{executionResult.durationMs}ms</span>
                            </span>
                        </div>
                    )}
                </div>

                {/* Response Body Content */}
                <div className="flex-1 p-4 overflow-y-auto font-mono text-xs">
                    {!executionResult && !isLoading && (
                        <div className="flex flex-col items-center justify-center h-72 text-center text-text-muted">
                            <Play className="w-10 h-10 mb-2 opacity-30 text-blue-400" />
                            <p className="text-xs font-semibold text-text">Ready to Execute</p>
                            <p className="text-[11px] max-w-xs mt-1">
                                Select a preset or compose a custom request, then click <strong>Send</strong> to inspect live response payloads.
                            </p>
                        </div>
                    )}

                    {isLoading && (
                        <div className="flex flex-col items-center justify-center h-72 space-y-3">
                            <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
                            <p className="text-xs font-mono text-text-muted">Dispatching via Stigix proxy...</p>
                        </div>
                    )}

                    {executionResult && !isLoading && (
                        <div className="space-y-4">
                            {/* Auto Auth / Proxy Meta Badge */}
                            {executionResult.request.autoAuthDetails && (
                                <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-md text-[11px] text-blue-300 flex items-center space-x-1.5">
                                    <Shield className="w-3.5 h-3.5 shrink-0 text-blue-400" />
                                    <span>{executionResult.request.autoAuthDetails}</span>
                                </div>
                            )}

                            {/* Execution Error Banner */}
                            {executionResult.response.error && (
                                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-300 flex items-start space-x-2">
                                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                                    <div className="break-all">{executionResult.response.error}</div>
                                </div>
                            )}

                            {/* Response JSON Body */}
                            <div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <span className="text-[11px] text-text-muted font-sans font-semibold">Response JSON / Text:</span>
                                    <button
                                        onClick={() => copyToClipboard(JSON.stringify(executionResult.response.body, null, 2), setCopiedResponse)}
                                        className="flex items-center space-x-1 px-2 py-0.5 bg-card hover:bg-card-hover border border-border rounded text-[10px] text-text-muted hover:text-text transition-colors"
                                    >
                                        {copiedResponse ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                        <span>Copy JSON</span>
                                    </button>
                                </div>

                                <pre className="p-3 bg-black/50 border border-border rounded-lg overflow-x-auto text-emerald-300 text-[11px] leading-relaxed max-h-[380px]">
                                    {typeof executionResult.response.body === 'object'
                                        ? JSON.stringify(executionResult.response.body, null, 2)
                                        : executionResult.response.body || 'Empty response'}
                                </pre>
                            </div>

                            {/* Response Headers Accordion */}
                            {executionResult.response.headers && Object.keys(executionResult.response.headers).length > 0 && (
                                <div>
                                    <span className="text-[11px] text-text-muted font-sans font-semibold block mb-1">
                                        Response Headers ({Object.keys(executionResult.response.headers).length}):
                                    </span>
                                    <div className="border border-border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                                        <table className="w-full text-left text-[10px]">
                                            <tbody className="divide-y divide-border/40">
                                                {Object.entries(executionResult.response.headers).map(([k, v]) => (
                                                    <tr key={k} className="hover:bg-card-hover/40">
                                                        <td className="p-1.5 font-semibold text-emerald-400 w-1/3 break-all">{k}</td>
                                                        <td className="p-1.5 text-text-muted break-all">{String(v)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
