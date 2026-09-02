/**
 * Stigix Custom TCP Inter-Site Applications — 4-Step Creation & Edition Wizard Modal
 */

import React, { useState, useEffect } from 'react';
import {
    X, Server, Play, Shield, Globe, Plus, Trash2, CheckCircle2,
    AlertTriangle, RefreshCw, Cpu, Layers, HelpCircle
} from 'lucide-react';
import type {
    CustomTcpApplicationConfig,
    PeerConfig,
    ServerBehaviorMode,
    ClientWorkloadMode
} from '../../../custom-tcp-apps/types.js';

interface CustomAppWizardModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (app: CustomTcpApplicationConfig) => Promise<void>;
    editingApp?: CustomTcpApplicationConfig | null;
    token: string | null;
}

export const CustomAppWizardModal: React.FC<CustomAppWizardModalProps> = ({
    isOpen,
    onClose,
    onSave,
    editingApp,
    token
}) => {
    const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
    const [isSaving, setIsSaving] = useState(false);
    const [isValidating, setIsValidating] = useState(false);
    const [validationErrors, setValidationErrors] = useState<string[]>([]);
    const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
    const [portAvailable, setPortAvailable] = useState<boolean | null>(null);

    // Form State
    const [formData, setFormData] = useState<CustomTcpApplicationConfig>(() => {
        if (editingApp) return JSON.parse(JSON.stringify(editingApp));
        return {
            id: `app-${Date.now().toString(36)}`,
            name: '',
            description: '',
            enabled: true,
            listener: {
                bindAddress: '0.0.0.0',
                port: 8443,
                maxConnections: 100,
                idleTimeoutMs: 60000,
                maxPayloadBytes: 1048576,
                tcpKeepalive: true,
                allowCidrs: [],
                auth: { enabled: false }
            },
            serverBehavior: {
                mode: 'echo',
                fixedDelayMs: 500,
                randomDelayMinMs: 100,
                randomDelayMaxMs: 1000,
                loopingNormalSec: 60,
                loopingSlowSec: 60,
                loopingSlowDelayMs: 1000,
                dropProbability: 0,
                errorProbability: 0
            },
            clientDefaults: {
                mode: 'persistent_request_reply',
                connectionsPerPeer: 2,
                intervalMs: 1000,
                payloadBytes: 1024,
                requestTimeoutMs: 5000,
                connectTimeoutMs: 5000,
                autoReconnect: true,
                reconnectInitialMs: 1000,
                reconnectMaxMs: 30000,
                tcpKeepalive: true,
                sourceInterface: 'auto'
            },
            peers: [],
            startup: {
                startListener: true,
                startClientWorkload: false
            }
        };
    });

    const [allowCidrsInput, setAllowCidrsInput] = useState('');
    const [newPeer, setNewPeer] = useState<Partial<PeerConfig>>({
        name: '',
        siteName: '',
        host: '',
        port: 8443,
        enabled: true,
        tags: []
    });

    useEffect(() => {
        if (editingApp) {
            setFormData(JSON.parse(JSON.stringify(editingApp)));
            setAllowCidrsInput((editingApp.listener?.allowCidrs || []).join(', '));
        } else {
            setFormData({
                id: `app-${Date.now().toString(36)}`,
                name: '',
                description: '',
                enabled: true,
                listener: {
                    bindAddress: '0.0.0.0',
                    port: 8443,
                    maxConnections: 100,
                    idleTimeoutMs: 60000,
                    maxPayloadBytes: 1048576,
                    tcpKeepalive: true,
                    allowCidrs: [],
                    auth: { enabled: false }
                },
                serverBehavior: {
                    mode: 'echo',
                    fixedDelayMs: 500,
                    randomDelayMinMs: 100,
                    randomDelayMaxMs: 1000,
                    loopingNormalSec: 60,
                    loopingSlowSec: 60,
                    loopingSlowDelayMs: 1000,
                    dropProbability: 0,
                    errorProbability: 0
                },
                clientDefaults: {
                    mode: 'persistent_request_reply',
                    connectionsPerPeer: 2,
                    intervalMs: 1000,
                    payloadBytes: 1024,
                    requestTimeoutMs: 5000,
                    connectTimeoutMs: 5000,
                    autoReconnect: true,
                    reconnectInitialMs: 1000,
                    reconnectMaxMs: 30000,
                    tcpKeepalive: true,
                    sourceInterface: 'auto'
                },
                peers: [],
                startup: {
                    startListener: true,
                    startClientWorkload: false
                }
            });
            setAllowCidrsInput('');
        }
        setStep(1);
        setValidationErrors([]);
        setValidationWarnings([]);
        setPortAvailable(null);
    }, [editingApp, isOpen]);

    if (!isOpen) return null;

    const handleAllowCidrsChange = (val: string) => {
        setAllowCidrsInput(val);
        const parsed = val.split(',').map(s => s.trim()).filter(s => s.length > 0);
        setFormData((prev: CustomTcpApplicationConfig) => ({
            ...prev,
            listener: { ...prev.listener, allowCidrs: parsed }
        }));
    };

    const handleAddPeer = () => {
        if (!newPeer.name || !newPeer.host) return;
        const peerToAdd: PeerConfig = {
            id: `peer-${Date.now().toString(36)}`,
            name: newPeer.name.trim(),
            siteName: (newPeer.siteName || newPeer.name).trim().toUpperCase(),
            host: newPeer.host.trim(),
            port: Number(newPeer.port) || formData.listener.port || 8443,
            enabled: true,
            tags: newPeer.tags || []
        };
        setFormData((prev: CustomTcpApplicationConfig) => ({
            ...prev,
            peers: [...prev.peers, peerToAdd]
        }));
        setNewPeer({ name: '', siteName: '', host: '', port: formData.listener.port || 8443, enabled: true, tags: [] });
    };

    const handleRemovePeer = (peerId: string) => {
        setFormData((prev: CustomTcpApplicationConfig) => ({
            ...prev,
            peers: prev.peers.filter((p: PeerConfig) => p.id !== peerId)
        }));
    };

    const runValidation = async () => {
        setIsValidating(true);
        setValidationErrors([]);
        setValidationWarnings([]);
        try {
            const res = await fetch('/api/custom-tcp-apps/validate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(formData)
            });
            const data = await res.json();
            setValidationErrors(data.errors || []);
            setValidationWarnings(data.warnings || []);
            setPortAvailable(data.portAvailable);
        } catch (e: any) {
            setValidationErrors([e.message || 'Validation request failed']);
        } finally {
            setIsValidating(false);
        }
    };

    const handleFinish = async () => {
        setIsSaving(true);
        try {
            await onSave(formData);
            onClose();
        } catch (e: any) {
            setValidationErrors([e.message || 'Failed to save application']);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
            <div className="bg-[#0b1329] border border-slate-700/80 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-slate-100">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-indigo-400">
                            <Layers size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white tracking-wide">
                                {editingApp ? `Edit Application: ${editingApp.name}` : 'Create Custom TCP Application'}
                            </h2>
                            <p className="text-xs text-slate-400">
                                Step {step} of 4 — {
                                    step === 1 ? 'Identity & Listener' :
                                    step === 2 ? 'Server Behavior' :
                                    step === 3 ? 'Client Behavior & Peers' : 'Review & Validation'
                                }
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Stepper Bar */}
                <div className="grid grid-cols-4 border-b border-slate-800 text-xs font-semibold bg-slate-950/40">
                    {[
                        { num: 1, label: '1. Identity & Listener' },
                        { num: 2, label: '2. Server Behavior' },
                        { num: 3, label: '3. Client & Peers' },
                        { num: 4, label: '4. Review & Validate' }
                    ].map(s => (
                        <button
                            key={s.num}
                            onClick={() => {
                                if (s.num === 4) runValidation();
                                setStep(s.num as any);
                            }}
                            className={`py-3 px-4 text-center border-b-2 transition-all ${
                                step === s.num
                                    ? 'border-indigo-500 text-indigo-400 bg-indigo-500/5'
                                    : 'border-transparent text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            {s.label}
                        </button>
                    ))}
                </div>

                {/* Body Content */}
                <div className="p-6 overflow-y-auto flex-1 space-y-6">
                    {/* STEP 1: IDENTITY & LISTENER */}
                    {step === 1 && (
                        <div className="space-y-4 animate-fadeIn">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-300 mb-1">Application Name *</label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={e => {
                                            const val = e.target.value;
                                            setFormData((prev: CustomTcpApplicationConfig) => ({
                                                ...prev,
                                                name: val,
                                                id: prev.id || val.toLowerCase().replace(/[^a-z0-9-_]/g, '-')
                                            }));
                                        }}
                                        placeholder="e.g. ERP-TCP, POS-Checkout, DB-Sync"
                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-300 mb-1">Application ID</label>
                                    <input
                                        type="text"
                                        value={formData.id}
                                        onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({ ...prev, id: e.target.value.trim() }))}
                                        placeholder="e.g. erp-tcp"
                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 font-mono focus:outline-none focus:border-indigo-500"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-1">Description (Optional)</label>
                                <input
                                    type="text"
                                    value={formData.description || ''}
                                    onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({ ...prev, description: e.target.value }))}
                                    placeholder="e.g. Core ERP transactional workload between Branch and DC"
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                                />
                            </div>

                            <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl space-y-4">
                                <h3 className="text-sm font-semibold text-indigo-300 flex items-center gap-2">
                                    <Server size={16} /> Local Host TCP Listener Settings
                                </h3>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-300 mb-1">TCP Port (Host) *</label>
                                        <input
                                            type="number"
                                            value={formData.listener.port}
                                            onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                ...prev,
                                                listener: { ...prev.listener, port: parseInt(e.target.value, 10) || 8443 }
                                            }))}
                                            min={1024}
                                            max={65535}
                                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-amber-300 font-mono focus:outline-none focus:border-indigo-500"
                                        />
                                        <span className="text-[10px] text-slate-500">Must be non-privileged (1024-65535)</span>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-300 mb-1">Bind Address</label>
                                        <input
                                            type="text"
                                            value={formData.listener.bindAddress}
                                            onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                ...prev,
                                                listener: { ...prev.listener, bindAddress: e.target.value.trim() }
                                            }))}
                                            placeholder="0.0.0.0"
                                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-300 mb-1">Max Connections</label>
                                        <input
                                            type="number"
                                            value={formData.listener.maxConnections}
                                            onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                ...prev,
                                                listener: { ...prev.listener, maxConnections: parseInt(e.target.value, 10) || 100 }
                                            }))}
                                            min={1}
                                            max={500}
                                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-slate-300 mb-1">CIDR Allowlist (Optional)</label>
                                    <input
                                        type="text"
                                        value={allowCidrsInput}
                                        onChange={e => handleAllowCidrsChange(e.target.value)}
                                        placeholder="e.g. 10.0.0.0/8, 192.168.0.0/16 (Leave empty for open lab access)"
                                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
                                    />
                                    <span className="text-[10px] text-slate-500">Comma-separated IPv4 subnets or IPs authorized to connect.</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* STEP 2: SERVER BEHAVIOR */}
                    {step === 2 && (
                        <div className="space-y-4 animate-fadeIn">
                            <div>
                                <label className="block text-xs font-medium text-slate-300 mb-2">Server Response Simulation Mode</label>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    {[
                                        { id: 'echo', label: 'Echo', desc: 'Replies back with exact payload' },
                                        { id: 'acknowledge', label: 'Acknowledge', desc: 'Compact ACK without payload' },
                                        { id: 'fixed_delay', label: 'Fixed Delay', desc: 'Injects fixed delay before reply' },
                                        { id: 'random_delay', label: 'Random Delay', desc: 'Jittered delay between min/max' },
                                        { id: 'looping_delay', label: 'Looping Delay', desc: 'Alternates normal/slow phases' },
                                        { id: 'drop_response', label: 'Drop Response', desc: 'Simulates response loss' },
                                        { id: 'close_connection', label: 'Close Connection', desc: 'Closes socket after N requests' },
                                        { id: 'error_response', label: 'Error Response', desc: 'Simulates server application errors' }
                                    ].map(m => (
                                        <button
                                            key={m.id}
                                            type="button"
                                            onClick={() => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                ...prev,
                                                serverBehavior: { ...prev.serverBehavior, mode: m.id as ServerBehaviorMode }
                                            }))}
                                            className={`p-3 rounded-xl border text-left transition-all ${
                                                formData.serverBehavior.mode === m.id
                                                    ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-md'
                                                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                                            }`}
                                        >
                                            <div className="font-semibold text-xs text-indigo-300">{m.label}</div>
                                            <div className="text-[11px] text-slate-500 mt-1 leading-tight">{m.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Mode Specific Parameters */}
                            <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl space-y-4">
                                <h3 className="text-sm font-semibold text-indigo-300 flex items-center gap-2">
                                    <Cpu size={16} /> Simulation Parameters ({formData.serverBehavior.mode})
                                </h3>

                                {formData.serverBehavior.mode === 'fixed_delay' && (
                                    <div>
                                        <label className="block text-xs font-medium text-slate-300 mb-1">Fixed Delay (ms)</label>
                                        <input
                                            type="number"
                                            value={formData.serverBehavior.fixedDelayMs}
                                            onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                ...prev,
                                                serverBehavior: { ...prev.serverBehavior, fixedDelayMs: parseInt(e.target.value, 10) || 500 }
                                            }))}
                                            min={10}
                                            max={10000}
                                            className="w-48 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                                        />
                                    </div>
                                )}

                                {formData.serverBehavior.mode === 'random_delay' && (
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-medium text-slate-300 mb-1">Min Delay (ms)</label>
                                            <input
                                                type="number"
                                                value={formData.serverBehavior.randomDelayMinMs}
                                                onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                    ...prev,
                                                    serverBehavior: { ...prev.serverBehavior, randomDelayMinMs: parseInt(e.target.value, 10) || 100 }
                                                }))}
                                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-slate-300 mb-1">Max Delay (ms)</label>
                                            <input
                                                type="number"
                                                value={formData.serverBehavior.randomDelayMaxMs}
                                                onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                    ...prev,
                                                    serverBehavior: { ...prev.serverBehavior, randomDelayMaxMs: parseInt(e.target.value, 10) || 1000 }
                                                }))}
                                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                                            />
                                        </div>
                                    </div>
                                )}

                                {formData.serverBehavior.mode === 'looping_delay' && (
                                    <div className="grid grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-xs font-medium text-slate-300 mb-1">Normal Phase (sec)</label>
                                            <input
                                                type="number"
                                                value={formData.serverBehavior.loopingNormalSec}
                                                onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                    ...prev,
                                                    serverBehavior: { ...prev.serverBehavior, loopingNormalSec: parseInt(e.target.value, 10) || 60 }
                                                }))}
                                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-slate-300 mb-1">Slow Phase (sec)</label>
                                            <input
                                                type="number"
                                                value={formData.serverBehavior.loopingSlowSec}
                                                onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                    ...prev,
                                                    serverBehavior: { ...prev.serverBehavior, loopingSlowSec: parseInt(e.target.value, 10) || 60 }
                                                }))}
                                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-slate-300 mb-1">Slow Delay (ms)</label>
                                            <input
                                                type="number"
                                                value={formData.serverBehavior.loopingSlowDelayMs}
                                                onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                    ...prev,
                                                    serverBehavior: { ...prev.serverBehavior, loopingSlowDelayMs: parseInt(e.target.value, 10) || 1500 }
                                                }))}
                                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                                            />
                                        </div>
                                    </div>
                                )}

                                {formData.serverBehavior.mode === 'drop_response' && (
                                    <div>
                                        <label className="block text-xs font-medium text-slate-300 mb-1">Drop Probability (%)</label>
                                        <input
                                            type="number"
                                            value={formData.serverBehavior.dropProbability}
                                            onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                ...prev,
                                                serverBehavior: { ...prev.serverBehavior, dropProbability: parseInt(e.target.value, 10) || 10 }
                                            }))}
                                            min={1}
                                            max={100}
                                            className="w-48 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-rose-400 font-bold"
                                        />
                                        <span className="text-[10px] text-slate-500 block mt-1">Simulates packet/response loss while keeping TCP session open.</span>
                                    </div>
                                )}

                                {formData.serverBehavior.mode === 'error_response' && (
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-medium text-slate-300 mb-1">Error Probability (%)</label>
                                            <input
                                                type="number"
                                                value={formData.serverBehavior.errorProbability}
                                                onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                    ...prev,
                                                    serverBehavior: { ...prev.serverBehavior, errorProbability: parseInt(e.target.value, 10) || 10 }
                                                }))}
                                                min={1}
                                                max={100}
                                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-rose-400 font-bold"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-slate-300 mb-1">Error Code</label>
                                            <input
                                                type="text"
                                                value={formData.serverBehavior.errorCode || 'SIMULATED_DB_ERROR'}
                                                onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                    ...prev,
                                                    serverBehavior: { ...prev.serverBehavior, errorCode: e.target.value }
                                                }))}
                                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* STEP 3: CLIENT BEHAVIOR & PEERS */}
                    {step === 3 && (
                        <div className="space-y-4 animate-fadeIn">
                            <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl space-y-4">
                                <h3 className="text-sm font-semibold text-indigo-300 flex items-center gap-2">
                                    <Play size={16} /> Client Workload Generation Defaults
                                </h3>

                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-300 mb-1">Workload Mode</label>
                                        <select
                                            value={formData.clientDefaults.mode}
                                            onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                ...prev,
                                                clientDefaults: { ...prev.clientDefaults, mode: e.target.value as ClientWorkloadMode }
                                            }))}
                                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                                        >
                                            <option value="persistent_request_reply">Persistent Sessions</option>
                                            <option value="transactional">Transactional</option>
                                            <option value="heartbeat">Heartbeat</option>
                                            <option value="bulk_burst">Bulk Burst</option>
                                            <option value="continuous_stream">Continuous Stream</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-300 mb-1">Connections / Peer</label>
                                        <input
                                            type="number"
                                            value={formData.clientDefaults.connectionsPerPeer}
                                            onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                ...prev,
                                                clientDefaults: { ...prev.clientDefaults, connectionsPerPeer: parseInt(e.target.value, 10) || 1 }
                                            }))}
                                            min={1}
                                            max={50}
                                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-300 mb-1">Cadence / Interval (ms)</label>
                                        <input
                                            type="number"
                                            value={formData.clientDefaults.intervalMs}
                                            onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                ...prev,
                                                clientDefaults: { ...prev.clientDefaults, intervalMs: parseInt(e.target.value, 10) || 1000 }
                                            }))}
                                            min={50}
                                            step={100}
                                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-300 mb-1">Payload Size (Bytes)</label>
                                        <input
                                            type="number"
                                            value={formData.clientDefaults.payloadBytes}
                                            onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                ...prev,
                                                clientDefaults: { ...prev.clientDefaults, payloadBytes: parseInt(e.target.value, 10) || 1024 }
                                            }))}
                                            min={64}
                                            max={1048576}
                                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Peers Table */}
                            <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl space-y-4">
                                <h3 className="text-sm font-semibold text-indigo-300 flex items-center justify-between">
                                    <span className="flex items-center gap-2"><Globe size={16} /> Remote Peer Stigix Instances ({formData.peers.length})</span>
                                </h3>

                                <div className="grid grid-cols-1 md:grid-cols-4 gap-2 bg-slate-950 p-3 rounded-lg border border-slate-800">
                                    <input
                                        type="text"
                                        value={newPeer.name}
                                        onChange={e => setNewPeer((prev: Partial<PeerConfig>) => ({ ...prev, name: e.target.value, siteName: prev.siteName || e.target.value }))}
                                        placeholder="Peer Name (e.g. DC-LYON)"
                                        className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
                                    />
                                    <input
                                        type="text"
                                        value={newPeer.host}
                                        onChange={e => setNewPeer((prev: Partial<PeerConfig>) => ({ ...prev, host: e.target.value }))}
                                        placeholder="Host IP / FQDN (e.g. 10.20.30.40)"
                                        className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
                                    />
                                    <input
                                        type="number"
                                        value={newPeer.port}
                                        onChange={e => setNewPeer((prev: Partial<PeerConfig>) => ({ ...prev, port: parseInt(e.target.value, 10) || 8443 }))}
                                        placeholder="Port (8443)"
                                        className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-amber-300 font-mono"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddPeer}
                                        disabled={!newPeer.name || !newPeer.host}
                                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                                    >
                                        <Plus size={14} /> Add Peer
                                    </button>
                                </div>

                                {formData.peers.length === 0 ? (
                                    <div className="text-center py-4 text-xs text-slate-500 italic">
                                        No remote peers declared yet. Application will operate in Server-only mode until peers are added.
                                    </div>
                                ) : (
                                    <div className="divide-y divide-slate-800 border border-slate-800 rounded-lg overflow-hidden">
                                        {formData.peers.map((p: PeerConfig) => (
                                            <div key={p.id} className="p-3 flex items-center justify-between bg-slate-900/40 text-xs">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                                                    <div>
                                                        <div className="font-semibold text-white">{p.name} <span className="text-slate-500 font-mono text-[10px]">({p.siteName})</span></div>
                                                        <div className="text-slate-400 font-mono text-[11px]">{p.host}:{p.port}</div>
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemovePeer(p.id)}
                                                    className="text-slate-500 hover:text-rose-400 p-1 rounded hover:bg-slate-800 transition-colors"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* STEP 4: REVIEW & VALIDATE */}
                    {step === 4 && (
                        <div className="space-y-4 animate-fadeIn">
                            <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl space-y-4">
                                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                                    <div>
                                        <h3 className="text-base font-bold text-white">{formData.name || 'Unnamed Application'}</h3>
                                        <p className="text-xs text-slate-400 font-mono">ID: {formData.id} | TCP Port: :{formData.listener.port}</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={runValidation}
                                        disabled={isValidating}
                                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                                    >
                                        <RefreshCw size={14} className={isValidating ? 'animate-spin' : ''} /> Test Port Availability
                                    </button>
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                                        <div className="text-slate-500">Server Mode</div>
                                        <div className="font-bold text-indigo-400 mt-1 capitalize">{formData.serverBehavior.mode.replace('_', ' ')}</div>
                                    </div>
                                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                                        <div className="text-slate-500">Client Workload</div>
                                        <div className="font-bold text-emerald-400 mt-1 capitalize">{formData.clientDefaults.mode.replace(/_/g, ' ')}</div>
                                    </div>
                                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                                        <div className="text-slate-500">Configured Peers</div>
                                        <div className="font-bold text-white mt-1">{formData.peers.length} remote nodes</div>
                                    </div>
                                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                                        <div className="text-slate-500">Host Port Status</div>
                                        <div className="font-bold mt-1">
                                            {portAvailable === true ? (
                                                <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 size={13} /> Available</span>
                                            ) : portAvailable === false ? (
                                                <span className="text-rose-400 flex items-center gap-1"><AlertTriangle size={13} /> Port Occupied</span>
                                            ) : (
                                                <span className="text-slate-400">Untested</span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Errors & Warnings Display */}
                                {validationErrors.length > 0 && (
                                    <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-300 text-xs space-y-1">
                                        <div className="font-bold flex items-center gap-1.5"><AlertTriangle size={14} /> Validation Errors:</div>
                                        {validationErrors.map((e, idx) => (
                                            <div key={idx} className="ml-5 list-disc">• {e}</div>
                                        ))}
                                    </div>
                                )}

                                {validationWarnings.length > 0 && (
                                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-xs space-y-1">
                                        <div className="font-bold flex items-center gap-1.5"><HelpCircle size={14} /> Warnings:</div>
                                        {validationWarnings.map((w, idx) => (
                                            <div key={idx} className="ml-5 list-disc">• {w}</div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Controls */}
                <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-between bg-slate-900/50">
                    <button
                        type="button"
                        onClick={() => setStep(prev => Math.max(1, prev - 1) as any)}
                        disabled={step === 1}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 rounded-lg text-xs font-semibold transition-colors"
                    >
                        Back
                    </button>

                    <div className="flex items-center gap-2">
                        {step < 4 ? (
                            <button
                                type="button"
                                onClick={() => {
                                    if (step === 3) runValidation();
                                    setStep(prev => Math.min(4, prev + 1) as any);
                                }}
                                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition-colors"
                            >
                                Next Step
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={handleFinish}
                                disabled={isSaving || validationErrors.length > 0}
                                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors shadow-lg shadow-emerald-600/20"
                            >
                                {isSaving ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                {editingApp ? 'Save Changes' : 'Create Application'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
