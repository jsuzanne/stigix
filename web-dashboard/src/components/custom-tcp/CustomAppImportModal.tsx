import React, { useState, useRef } from 'react';
import {
    Upload, FileJson, CheckCircle2, AlertTriangle, X,
    Layers, Server, Globe, ArrowRight, RefreshCw, AlertCircle, FileText
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { CustomTcpApplicationConfig } from '../../../custom-tcp-apps/types.js';

interface CustomAppImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    token: string | null;
    onSuccess: () => void;
    existingApps: CustomTcpApplicationConfig[];
}

export const CustomAppImportModal: React.FC<CustomAppImportModalProps> = ({
    isOpen,
    onClose,
    token,
    onSuccess,
    existingApps
}) => {
    const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
    const [rawJsonText, setRawJsonText] = useState<string>('');
    const [parsedApps, setParsedApps] = useState<any[]>([]);
    const [parseError, setParseError] = useState<string | null>(null);
    const [fileName, setFileName] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [inputTab, setInputTab] = useState<'file' | 'paste'>('file');

    const fileInputRef = useRef<HTMLInputElement>(null);

    if (!isOpen) return null;

    const processJsonContent = (text: string, sourceName?: string) => {
        setRawJsonText(text);
        if (sourceName) setFileName(sourceName);
        setParseError(null);

        if (!text.trim()) {
            setParsedApps([]);
            return;
        }

        try {
            const parsed = JSON.parse(text);
            let apps: any[] = [];

            if (Array.isArray(parsed)) {
                apps = parsed;
            } else if (parsed && typeof parsed === 'object') {
                if (Array.isArray(parsed.applications)) {
                    apps = parsed.applications;
                } else if (parsed.application && typeof parsed.application === 'object') {
                    apps = [parsed.application];
                } else if (parsed.name && (parsed.listener || parsed.protocol)) {
                    // Single application raw object
                    apps = [parsed];
                }
            }

            if (!apps || apps.length === 0) {
                setParseError('No valid Custom TCP Application profiles found in this JSON.');
                setParsedApps([]);
                return;
            }

            // Validate that apps have at least names
            const valid = apps.filter(a => a && typeof a === 'object' && a.name);
            if (valid.length === 0) {
                setParseError('Found objects but none had a valid "name" field.');
                setParsedApps([]);
                return;
            }

            setParsedApps(valid);
        } catch (err: any) {
            setParseError(`JSON Syntax Error: ${err.message}`);
            setParsedApps([]);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result as string;
            processJsonContent(text, file.name);
        };
        reader.readAsText(file);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result as string;
            processJsonContent(text, file.name);
        };
        reader.readAsText(file);
    };

    const handleImport = async () => {
        if (!parsedApps.length || !token) return;

        setIsSubmitting(true);
        try {
            const res = await fetch('/api/custom-tcp-apps/import', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    mode: importMode,
                    applications: parsedApps
                })
            });

            const data = await res.json();
            if (res.ok && data.success) {
                if (importMode === 'replace') {
                    toast.success(`Successfully replaced with ${data.importedCount} application(s)!`, { icon: '🚀' });
                } else {
                    toast.success(`Import complete: +${data.addedCount} added, 🔄 ${data.updatedCount} updated`, { icon: '✅' });
                }
                onSuccess();
                onClose();
            } else {
                toast.error(data.error || 'Import failed');
            }
        } catch (err: any) {
            toast.error(`Import failed: ${err.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
            <div className="bg-card border border-border rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Modal Header */}
                <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-card-secondary/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xl">
                            <Upload size={20} />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-text-primary">
                                Import Custom Applications
                            </h2>
                            <p className="text-xs text-text-muted">
                                Load custom application profiles from a JSON bundle or clipboard
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-card-hover text-text-muted hover:text-text-primary rounded-xl transition-colors cursor-pointer"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Modal Body */}
                <div className="p-6 overflow-y-auto space-y-5 flex-1 custom-scrollbar text-xs">
                    {/* Method Selector Tabs */}
                    <div className="flex items-center gap-2 p-1 bg-card-secondary border border-border rounded-xl">
                        <button
                            type="button"
                            onClick={() => setInputTab('file')}
                            className={`flex-1 py-2 px-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                                inputTab === 'file'
                                    ? 'bg-card text-text-primary shadow-sm border border-border'
                                    : 'text-text-muted hover:text-text-primary'
                            }`}
                        >
                            <FileJson size={14} /> Upload JSON File
                        </button>
                        <button
                            type="button"
                            onClick={() => setInputTab('paste')}
                            className={`flex-1 py-2 px-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                                inputTab === 'paste'
                                    ? 'bg-card text-text-primary shadow-sm border border-border'
                                    : 'text-text-muted hover:text-text-primary'
                            }`}
                        >
                            <FileText size={14} /> Paste JSON Text
                        </button>
                    </div>

                    {/* File Upload Zone */}
                    {inputTab === 'file' ? (
                        <div
                            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                            className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 ${
                                isDragging
                                    ? 'border-indigo-500 bg-indigo-500/10'
                                    : 'border-border hover:border-indigo-500/50 hover:bg-card-secondary/40'
                            }`}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".json,application/json"
                                onChange={handleFileChange}
                                className="hidden"
                            />
                            <div className="p-3 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-2xl">
                                <FileJson size={28} />
                            </div>
                            <div>
                                <p className="font-bold text-text-primary">
                                    {fileName ? fileName : 'Click to select or drag and drop JSON file'}
                                </p>
                                <p className="text-[11px] text-text-muted mt-1">
                                    Supports Stigix Custom TCP App bundles or single application exports
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div>
                            <textarea
                                value={rawJsonText}
                                onChange={(e) => processJsonContent(e.target.value)}
                                placeholder="Paste your application JSON export here..."
                                rows={6}
                                className="w-full bg-card-secondary border border-border rounded-xl p-3 text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-indigo-500"
                            />
                        </div>
                    )}

                    {/* Parse Error Alert */}
                    {parseError && (
                        <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-3 text-rose-600 dark:text-rose-400">
                            <AlertCircle size={16} className="shrink-0" />
                            <span className="text-xs font-medium">{parseError}</span>
                        </div>
                    )}

                    {/* Import Mode Selector */}
                    {parsedApps.length > 0 && (
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-text-primary uppercase tracking-wider block">
                                Import Strategy
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={() => setImportMode('merge')}
                                    className={`p-3 rounded-xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                                        importMode === 'merge'
                                            ? 'bg-indigo-500/10 border-indigo-500 text-text-primary shadow-sm'
                                            : 'bg-card-secondary border-border text-text-muted hover:text-text-primary'
                                    }`}
                                >
                                    <div className={`p-1.5 rounded-lg mt-0.5 ${importMode === 'merge' ? 'bg-indigo-500 text-white' : 'bg-card text-text-muted'}`}>
                                        <RefreshCw size={14} />
                                    </div>
                                    <div>
                                        <div className="font-bold text-xs text-text-primary flex items-center gap-1.5">
                                            Merge & Update
                                            <span className="text-[9px] font-black uppercase px-1.5 py-0.5 bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded">
                                                Recommended
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-text-muted mt-0.5">
                                            Adds new applications and updates matching existing ones. Preserves other configured apps.
                                        </p>
                                    </div>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setImportMode('replace')}
                                    className={`p-3 rounded-xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                                        importMode === 'replace'
                                            ? 'bg-rose-500/10 border-rose-500 text-text-primary shadow-sm'
                                            : 'bg-card-secondary border-border text-text-muted hover:text-text-primary'
                                    }`}
                                >
                                    <div className={`p-1.5 rounded-lg mt-0.5 ${importMode === 'replace' ? 'bg-rose-500 text-white' : 'bg-card text-text-muted'}`}>
                                        <AlertTriangle size={14} />
                                    </div>
                                    <div>
                                        <div className="font-bold text-xs text-rose-600 dark:text-rose-400">
                                            Replace All Existing
                                        </div>
                                        <p className="text-[11px] text-text-muted mt-0.5">
                                            Overwrites and deletes current applications with the imported bundle.
                                        </p>
                                    </div>
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Parsed Applications Preview */}
                    {parsedApps.length > 0 && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-text-primary uppercase tracking-wider">
                                    Detected Applications ({parsedApps.length})
                                </span>
                            </div>

                            <div className="space-y-2 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
                                {parsedApps.map((app, idx) => {
                                    const port = app.listener?.port || 9000;
                                    const isHttp = app.protocol === 'http_1_1';
                                    const peerCount = (app.peers || []).length;
                                    const conflict = existingApps.find(
                                        e => e.listener?.port === port && e.name.toLowerCase() !== app.name.toLowerCase()
                                    );

                                    return (
                                        <div
                                            key={app.id || idx}
                                            className="p-3 bg-card-secondary border border-border rounded-xl flex items-center justify-between gap-3"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 bg-card border border-border rounded-lg text-indigo-500">
                                                    <Server size={14} />
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-text-primary text-xs">
                                                            {app.name}
                                                        </span>
                                                        <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${
                                                            isHttp
                                                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                                                                : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-600 dark:text-indigo-400'
                                                        }`}>
                                                            {isHttp ? 'HTTP/1.1' : 'TCP Raw'}
                                                        </span>
                                                    </div>
                                                    <div className="text-[11px] text-text-muted mt-0.5 flex items-center gap-2">
                                                        <span>Port: <strong className="font-mono text-text-primary">{port}</strong></span>
                                                        <span>•</span>
                                                        <span>{peerCount} Target Peer(s)</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {conflict && importMode === 'merge' ? (
                                                <div className="flex items-center gap-1.5 text-amber-500 bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/30 text-[10px] font-bold" title={`Port ${port} is currently used by "${conflict.name}"`}>
                                                    <AlertTriangle size={12} />
                                                    <span>Port match with {conflict.name}</span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1 text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-lg text-[10px] font-bold">
                                                    <CheckCircle2 size={12} /> Ready
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* Modal Footer */}
                <div className="px-6 py-4 border-t border-border flex items-center justify-between bg-card-secondary/50">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary border border-border rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        disabled={parsedApps.length === 0 || isSubmitting}
                        onClick={handleImport}
                        className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-md shadow-indigo-600/20 cursor-pointer"
                    >
                        {isSubmitting ? (
                            <>
                                <RefreshCw size={14} className="animate-spin" />
                                <span>Importing...</span>
                            </>
                        ) : (
                            <>
                                <Upload size={14} />
                                <span>Import {parsedApps.length > 0 ? `${parsedApps.length} App(s)` : ''}</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
