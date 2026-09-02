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
    const [isCurrentAppPort, setIsCurrentAppPort] = useState(false);
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
    const [discoveredTargets, setDiscoveredTargets] = useState<Array<{ id: string; name: string; host: string; isLocal?: boolean }>>([]);
    const [newPeer, setNewPeer] = useState<Partial<PeerConfig>>({
        name: '',
        siteName: '',
        host: '',
        port: 8443,
        enabled: true,
        tags: []
    });

    useEffect(() => {
        if (isOpen) {
            fetch('/api/targets', { headers: token ? { 'Authorization': `Bearer ${token}` } : {} })
                .then(r => r.json())
                .then(data => {
                    const list = Array.isArray(data) ? data : (data.targets || []);
                    setDiscoveredTargets(list);
                })
                .catch(() => {});
        }
    }, [isOpen, token]);

    const handleAddDiscoveredTarget = (t: { name: string; host: string }) => {
        const port = formData.listener.port || 8443;
        const exists = formData.peers.some(p => p.host === t.host && p.port === port);
        if (exists) return;
        const peer: PeerConfig = {
            id: `peer-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
            name: t.name || t.host,
            siteName: t.name || t.host,
            host: t.host,
            port,
            enabled: true,
            tags: ['discovered']
        };
        setFormData(prev => ({ ...prev, peers: [...prev.peers, peer] }));
    };

    const handleAddAllDiscovered = () => {
        const port = formData.listener.port || 8443;
        const newPeers: PeerConfig[] = [...formData.peers];
        for (const t of discoveredTargets) {
            if (t.isLocal) continue;
            const exists = newPeers.some(p => p.host === t.host && p.port === port);
            if (!exists && t.host) {
                newPeers.push({
                    id: `peer-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
                    name: t.name || t.host,
                    siteName: t.name || t.host,
                    host: t.host,
                    port,
                    enabled: true,
                    tags: ['discovered']
                });
            }
        }
        setFormData(prev => ({ ...prev, peers: newPeers }));
    };

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
            setIsCurrentAppPort(!!data.isCurrentAppPort);
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
    };    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
            <div className="bg-card border border-border rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-text-primary">
                {/* Header */}
                <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-card-secondary/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-600 dark:text-indigo-400">
                            <Layers size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-text-primary tracking-wide">
                                {editingApp ? `Edit Application: ${editingApp.name}` : 'Create Custom TCP Application'}
                            </h2>
                            <p className="text-xs text-text-muted">
                                Step {step} of 4 — {
                                    step === 1 ? 'Identity & Listener' :
                                    step === 2 ? 'Server Behavior' :
                                    step === 3 ? 'Client Behavior & Peers' : 'Review & Validation'
                                }
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1.5 rounded-lg hover:bg-card-hover transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Stepper Bar */}
                <div className="grid grid-cols-4 border-b border-border text-xs font-semibold bg-card-secondary/30">
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
                                    ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-indigo-500/5'
                                    : 'border-transparent text-text-muted hover:text-text-primary'
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
                                    <label className="block text-xs font-semibold text-text-secondary mb-1.5">Application Name *</label>
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
                                        className="w-full bg-card-secondary border border-border rounded-xl px-3.5 py-2 text-sm text-text-primary focus:outline-none focus:border-indigo-500 shadow-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-text-secondary mb-1.5">Application ID</label>
                                    <input
                                        type="text"
                                        value={formData.id}
                                        onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({ ...prev, id: e.target.value.trim() }))}
                                        placeholder="e.g. erp-tcp"
                                        className="w-full bg-card-secondary border border-border rounded-xl px-3.5 py-2 text-sm text-text-secondary font-mono focus:outline-none focus:border-indigo-500 shadow-sm"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Description (Optional)</label>
                                <input
                                    type="text"
                                    value={formData.description || ''}
                                    onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({ ...prev, description: e.target.value }))}
                                    placeholder="e.g. Core ERP transactional workload between Branch and DC"
                                    className="w-full bg-card-secondary border border-border rounded-xl px-3.5 py-2 text-sm text-text-primary focus:outline-none focus:border-indigo-500 shadow-sm"
                                />
                            </div>

                            <div className="p-4 bg-card-secondary/40 border border-border rounded-2xl space-y-4">
                                <h3 className="text-sm font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                                    <Server size={16} /> Local Host TCP Listener Settings
                                </h3>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <label className="block text-xs font-semibold text-text-secondary mb-1.5">TCP Port (Host) *</label>
                                        <input
                                            type="number"
                                            value={formData.listener.port}
                                            onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                ...prev,
                                                listener: { ...prev.listener, port: parseInt(e.target.value, 10) || 8443 }
                                            }))}
                                            min={1024}
                                            max={65535}
                                            className="w-full bg-card border border-border rounded-xl px-3.5 py-2 text-sm text-amber-600 dark:text-amber-400 font-mono font-bold focus:outline-none focus:border-indigo-500 shadow-sm"
                                        />
                                        <span className="text-[10px] text-text-muted mt-1 block">Must be non-privileged (1024-65535)</span>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-text-secondary mb-1.5">Bind Address</label>
                                        <input
                                            type="text"
                                            value={formData.listener.bindAddress}
                                            onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                ...prev,
                                                listener: { ...prev.listener, bindAddress: e.target.value.trim() }
                                            }))}
                                            placeholder="0.0.0.0"
                                            className="w-full bg-card border border-border rounded-xl px-3.5 py-2 text-sm text-text-primary font-mono focus:outline-none focus:border-indigo-500 shadow-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-text-secondary mb-1.5">Max Connections</label>
                                        <input
                                            type="number"
                                            value={formData.listener.maxConnections}
                                            onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                ...prev,
                                                listener: { ...prev.listener, maxConnections: parseInt(e.target.value, 10) || 100 }
                                            }))}
                                            min={1}
                                            max={500}
                                            className="w-full bg-card border border-border rounded-xl px-3.5 py-2 text-sm text-text-primary focus:outline-none focus:border-indigo-500 shadow-sm"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-semibold text-text-secondary mb-1.5">CIDR Allowlist (Optional)</label>
                                    <input
                                        type="text"
                                        value={allowCidrsInput}
                                        onChange={e => handleAllowCidrsChange(e.target.value)}
                                        placeholder="e.g. 10.0.0.0/8, 192.168.0.0/16 (Leave empty for open lab access)"
                                        className="w-full bg-card border border-border rounded-xl px-3.5 py-2 text-sm text-text-primary font-mono focus:outline-none focus:border-indigo-500 shadow-sm"
                                    />
                                    <span className="text-[10px] text-text-muted mt-1 block">Comma-separated IPv4 subnets or IPs authorized to connect.</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* STEP 2: SERVER BEHAVIOR */}
                    {step === 2 && (
                        <div className="space-y-4 animate-fadeIn">
                            {/* Role Clarification Banner */}
                            <div className="p-3.5 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-start gap-3 text-xs">
                                <Server size={18} className="text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-0.5" />
                                <div>
                                    <span className="font-bold text-text-primary">Server Role / Inbound (Incoming Request Handling)</span>
                                    <p className="text-text-muted mt-0.5 leading-relaxed">
                                        These settings define how <strong>this node replies</strong> when receiving requests on its local listener port (:{formData.listener.port}).
                                        <em> If this node only acts as a Client sending traffic to a remote Data Center, this behavior remains dormant locally (the behavior configured on the remote target server will execute).</em>
                                    </p>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-text-secondary mb-2">Server Response Simulation Mode</label>
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
                                            className={`p-3.5 rounded-2xl border text-left transition-all ${
                                                formData.serverBehavior.mode === m.id
                                                    ? 'bg-indigo-500/10 border-indigo-500 text-text-primary shadow-sm'
                                                    : 'bg-card-secondary border-border text-text-muted hover:border-border hover:bg-card-hover'
                                            }`}
                                        >
                                            <div className="font-bold text-xs text-indigo-600 dark:text-indigo-400">{m.label}</div>
                                            <div className="text-[11px] text-text-muted mt-1 leading-tight">{m.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Mode Specific Parameters */}
                            <div className="p-4 bg-card-secondary/40 border border-border rounded-2xl space-y-4">
                                <h3 className="text-sm font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                                    <Cpu size={16} /> Simulation Parameters ({formData.serverBehavior.mode})
                                </h3>

                                {formData.serverBehavior.mode === 'fixed_delay' && (
                                    <div>
                                        <label className="block text-xs font-semibold text-text-secondary mb-1.5">Fixed Delay (ms)</label>
                                        <input
                                            type="number"
                                            value={formData.serverBehavior.fixedDelayMs}
                                            onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                ...prev,
                                                serverBehavior: { ...prev.serverBehavior, fixedDelayMs: parseInt(e.target.value, 10) || 500 }
                                            }))}
                                            min={10}
                                            max={10000}
                                            className="w-48 bg-card border border-border rounded-xl px-3.5 py-2 text-sm text-text-primary shadow-sm"
                                        />
                                    </div>
                                )}

                                {formData.serverBehavior.mode === 'random_delay' && (
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Min Delay (ms)</label>
                                            <input
                                                type="number"
                                                value={formData.serverBehavior.randomDelayMinMs}
                                                onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                    ...prev,
                                                    serverBehavior: { ...prev.serverBehavior, randomDelayMinMs: parseInt(e.target.value, 10) || 100 }
                                                }))}
                                                className="w-full bg-card border border-border rounded-xl px-3.5 py-2 text-sm text-text-primary shadow-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Max Delay (ms)</label>
                                            <input
                                                type="number"
                                                value={formData.serverBehavior.randomDelayMaxMs}
                                                onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                    ...prev,
                                                    serverBehavior: { ...prev.serverBehavior, randomDelayMaxMs: parseInt(e.target.value, 10) || 1000 }
                                                }))}
                                                className="w-full bg-card border border-border rounded-xl px-3.5 py-2 text-sm text-text-primary shadow-sm"
                                            />
                                        </div>
                                    </div>
                                )}

                                {formData.serverBehavior.mode === 'looping_delay' && (
                                    <div className="grid grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Normal Phase (sec)</label>
                                            <input
                                                type="number"
                                                value={formData.serverBehavior.loopingNormalSec}
                                                onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                    ...prev,
                                                    serverBehavior: { ...prev.serverBehavior, loopingNormalSec: parseInt(e.target.value, 10) || 60 }
                                                }))}
                                                className="w-full bg-card border border-border rounded-xl px-3.5 py-2 text-sm text-text-primary shadow-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Slow Phase (sec)</label>
                                            <input
                                                type="number"
                                                value={formData.serverBehavior.loopingSlowSec}
                                                onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                    ...prev,
                                                    serverBehavior: { ...prev.serverBehavior, loopingSlowSec: parseInt(e.target.value, 10) || 60 }
                                                }))}
                                                className="w-full bg-card border border-border rounded-xl px-3.5 py-2 text-sm text-text-primary shadow-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Slow Delay (ms)</label>
                                            <input
                                                type="number"
                                                value={formData.serverBehavior.loopingSlowDelayMs}
                                                onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                    ...prev,
                                                    serverBehavior: { ...prev.serverBehavior, loopingSlowDelayMs: parseInt(e.target.value, 10) || 1500 }
                                                }))}
                                                className="w-full bg-card border border-border rounded-xl px-3.5 py-2 text-sm text-text-primary shadow-sm"
                                            />
                                        </div>
                                    </div>
                                )}

                                {formData.serverBehavior.mode === 'drop_response' && (
                                    <div>
                                        <label className="block text-xs font-semibold text-text-secondary mb-1.5">Drop Probability (%)</label>
                                        <input
                                            type="number"
                                            value={formData.serverBehavior.dropProbability}
                                            onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                ...prev,
                                                serverBehavior: { ...prev.serverBehavior, dropProbability: parseInt(e.target.value, 10) || 10 }
                                            }))}
                                            min={1}
                                            max={100}
                                            className="w-48 bg-card border border-border rounded-xl px-3.5 py-2 text-sm text-rose-500 font-bold shadow-sm"
                                        />
                                        <span className="text-[10px] text-text-muted block mt-1">Simulates packet/response loss while keeping TCP session open.</span>
                                    </div>
                                )}

                                {formData.serverBehavior.mode === 'error_response' && (
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Error Probability (%)</label>
                                            <input
                                                type="number"
                                                value={formData.serverBehavior.errorProbability}
                                                onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                    ...prev,
                                                    serverBehavior: { ...prev.serverBehavior, errorProbability: parseInt(e.target.value, 10) || 10 }
                                                }))}
                                                min={1}
                                                max={100}
                                                className="w-full bg-card border border-border rounded-xl px-3.5 py-2 text-sm text-rose-500 font-bold shadow-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Error Code</label>
                                            <input
                                                type="text"
                                                value={formData.serverBehavior.errorCode || 'SIMULATED_DB_ERROR'}
                                                onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                    ...prev,
                                                    serverBehavior: { ...prev.serverBehavior, errorCode: e.target.value }
                                                }))}
                                                className="w-full bg-card border border-border rounded-xl px-3.5 py-2 text-sm text-text-primary font-mono shadow-sm"
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
                            {/* Role Clarification Banner */}
                            <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-start gap-3 text-xs">
                                <Play size={18} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                                <div>
                                    <span className="font-bold text-text-primary">Client Role / Outbound (Workload Generation to Remote Peers)</span>
                                    <p className="text-text-muted mt-0.5 leading-relaxed">
                                        This workload generator defines the traffic emitted from <strong>this node to remote target peers</strong>. The response behavior (latency, echo, error simulation) will be dictated by the remote server answering your requests.
                                    </p>
                                </div>
                            </div>

                            <div className="p-4 bg-card-secondary/40 border border-border rounded-2xl space-y-4">
                                <h3 className="text-sm font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                                    <Play size={16} /> Client Workload Generation Defaults
                                </h3>

                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                    <div>
                                        <label className="block text-xs font-semibold text-text-secondary mb-1.5">Workload Mode</label>
                                        <select
                                            value={formData.clientDefaults.mode}
                                            onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                ...prev,
                                                clientDefaults: { ...prev.clientDefaults, mode: e.target.value as ClientWorkloadMode }
                                            }))}
                                            className="w-full bg-card border border-border rounded-xl px-3.5 py-2 text-sm text-text-primary shadow-sm"
                                        >
                                            <option value="persistent_request_reply">Persistent Sessions</option>
                                            <option value="transactional">Transactional</option>
                                            <option value="heartbeat">Heartbeat</option>
                                            <option value="bulk_burst">Bulk Burst</option>
                                            <option value="continuous_stream">Continuous Stream</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-text-secondary mb-1.5">Connections / Peer</label>
                                        <input
                                            type="number"
                                            value={formData.clientDefaults.connectionsPerPeer}
                                            onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                ...prev,
                                                clientDefaults: { ...prev.clientDefaults, connectionsPerPeer: parseInt(e.target.value, 10) || 1 }
                                            }))}
                                            min={1}
                                            max={50}
                                            className="w-full bg-card border border-border rounded-xl px-3.5 py-2 text-sm text-text-primary shadow-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-text-secondary mb-1.5">Cadence / Interval (ms)</label>
                                        <input
                                            type="number"
                                            value={formData.clientDefaults.intervalMs}
                                            onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                ...prev,
                                                clientDefaults: { ...prev.clientDefaults, intervalMs: parseInt(e.target.value, 10) || 1000 }
                                            }))}
                                            min={50}
                                            step={100}
                                            className="w-full bg-card border border-border rounded-xl px-3.5 py-2 text-sm text-text-primary shadow-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-text-secondary mb-1.5">Payload Size (Bytes)</label>
                                        <input
                                            type="number"
                                            value={formData.clientDefaults.payloadBytes}
                                            onChange={e => setFormData((prev: CustomTcpApplicationConfig) => ({
                                                ...prev,
                                                clientDefaults: { ...prev.clientDefaults, payloadBytes: parseInt(e.target.value, 10) || 1024 }
                                            }))}
                                            min={64}
                                            max={1048576}
                                            className="w-full bg-card border border-border rounded-xl px-3.5 py-2 text-sm text-text-primary shadow-sm"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Peers Table */}
                            <div className="p-4 bg-card-secondary/40 border border-border rounded-2xl space-y-4">
                                <h3 className="text-sm font-bold text-indigo-600 dark:text-indigo-400 flex items-center justify-between">
                                    <span className="flex items-center gap-2"><Globe size={16} /> Remote Peer Stigix Instances ({formData.peers.length})</span>
                                </h3>

                                {/* Quick Pick Discovered Stigix Endpoints */}
                                <div className="p-3.5 bg-indigo-500/5 border border-indigo-500/20 rounded-2xl space-y-2.5">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400">
                                            <Cpu size={14} className="text-indigo-500" />
                                            <span>Discovered Stigix Endpoints ({discoveredTargets.filter(t => !t.isLocal).length})</span>
                                        </div>
                                        {discoveredTargets.filter(t => !t.isLocal).length > 0 && (
                                            <button
                                                type="button"
                                                onClick={handleAddAllDiscovered}
                                                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-[11px] font-bold flex items-center gap-1 transition-all shadow-sm"
                                            >
                                                <Plus size={12} /> Add All Discovered Nodes
                                            </button>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                        {discoveredTargets.filter(t => !t.isLocal).map(t => {
                                            const isAdded = formData.peers.some(p => p.host === t.host && p.port === (formData.listener.port || 8443));
                                            return (
                                                <button
                                                    key={t.id || t.host}
                                                    type="button"
                                                    onClick={() => handleAddDiscoveredTarget(t)}
                                                    disabled={isAdded}
                                                    className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 border transition-all ${
                                                        isAdded
                                                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 opacity-60 cursor-default'
                                                            : 'bg-card hover:bg-indigo-500/10 border-border hover:border-indigo-500 text-text-secondary hover:text-text-primary shadow-sm'
                                                    }`}
                                                >
                                                    {isAdded ? <CheckCircle2 size={12} className="text-emerald-500" /> : <Plus size={12} className="text-indigo-500" />}
                                                    <span>{t.name || t.host}</span>
                                                    <span className="text-[10px] text-text-muted font-mono">({t.host})</span>
                                                </button>
                                            );
                                        })}
                                        {discoveredTargets.filter(t => !t.isLocal).length === 0 && (
                                            <span className="text-xs text-text-muted italic">No remote Stigix targets discovered yet. Use manual input below.</span>
                                        )}
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 bg-card-secondary/60 p-3 rounded-xl border border-border">
                                    <input
                                        type="text"
                                        value={newPeer.name}
                                        onChange={e => setNewPeer((prev: Partial<PeerConfig>) => ({ ...prev, name: e.target.value, siteName: prev.siteName || e.target.value }))}
                                        placeholder="Peer Name (e.g. DC-LYON)"
                                        className="bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary shadow-sm"
                                    />
                                    <input
                                        type="text"
                                        value={newPeer.host}
                                        onChange={e => setNewPeer((prev: Partial<PeerConfig>) => ({ ...prev, host: e.target.value }))}
                                        placeholder="Host IP / FQDN (e.g. 10.20.30.40)"
                                        className="bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary shadow-sm"
                                    />
                                    <input
                                        type="number"
                                        value={newPeer.port}
                                        onChange={e => setNewPeer((prev: Partial<PeerConfig>) => ({ ...prev, port: parseInt(e.target.value, 10) || 8443 }))}
                                        placeholder="Port (8443)"
                                        className="bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400 font-mono font-bold shadow-sm"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddPeer}
                                        disabled={!newPeer.name || !newPeer.host}
                                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                                    >
                                        <Plus size={14} /> Add Peer
                                    </button>
                                </div>

                                {formData.peers.length === 0 ? (
                                    <div className="text-center py-4 text-xs text-text-muted italic">
                                        No remote peers declared yet. Application will operate in Server-only mode until peers are added.
                                    </div>
                                ) : (
                                    <div className="divide-y divide-border border border-border rounded-xl overflow-hidden bg-card-secondary/20">
                                        {formData.peers.map((p: PeerConfig) => (
                                            <div key={p.id} className="p-3 flex items-center justify-between hover:bg-card-secondary/40 transition-colors text-xs">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                                                    <div>
                                                        <div className="font-semibold text-text-primary">{p.name} <span className="text-text-muted font-mono text-[10px]">({p.siteName})</span></div>
                                                        <div className="text-text-secondary font-mono text-[11px]">{p.host}:{p.port}</div>
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemovePeer(p.id)}
                                                    className="text-text-muted hover:text-rose-500 p-1.5 rounded-lg hover:bg-card-hover transition-colors"
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
                            <div className="p-4 bg-card-secondary/40 border border-border rounded-2xl space-y-4">
                                <div className="flex items-center justify-between border-b border-border pb-3">
                                    <div>
                                        <h3 className="text-base font-bold text-text-primary">{formData.name || 'Unnamed Application'}</h3>
                                        <p className="text-xs text-text-muted font-mono">ID: {formData.id} | TCP Port: :{formData.listener.port}</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={runValidation}
                                        disabled={isValidating}
                                        className="px-3.5 py-2 bg-card-secondary hover:bg-card-hover text-text-primary border border-border rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
                                    >
                                        <RefreshCw size={14} className={isValidating ? 'animate-spin' : ''} /> Test Port Availability
                                    </button>
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                    <div className="bg-card-secondary/60 p-3.5 rounded-xl border border-border">
                                        <div className="text-text-muted">Server Mode</div>
                                        <div className="font-bold text-indigo-600 dark:text-indigo-400 mt-1 capitalize">{formData.serverBehavior.mode.replace('_', ' ')}</div>
                                    </div>
                                    <div className="bg-card-secondary/60 p-3.5 rounded-xl border border-border">
                                        <div className="text-text-muted">Client Workload</div>
                                        <div className="font-bold text-emerald-600 dark:text-emerald-400 mt-1 capitalize">{formData.clientDefaults.mode.replace(/_/g, ' ')}</div>
                                    </div>
                                    <div className="bg-card-secondary/60 p-3.5 rounded-xl border border-border">
                                        <div className="text-text-muted">Configured Peers</div>
                                        <div className="font-bold text-text-primary mt-1">{formData.peers.length} remote nodes</div>
                                    </div>
                                    <div className="bg-card-secondary/60 p-3.5 rounded-xl border border-border">
                                        <div className="text-text-muted">Host Port Status</div>
                                        <div className="font-bold mt-1">
                                            {isCurrentAppPort ? (
                                                <span className="text-cyan-600 dark:text-cyan-400 flex items-center gap-1"><CheckCircle2 size={13} /> Active (Live Update)</span>
                                            ) : portAvailable === true ? (
                                                <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><CheckCircle2 size={13} /> Available</span>
                                            ) : portAvailable === false ? (
                                                <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1"><AlertTriangle size={13} /> Port Occupied</span>
                                            ) : (
                                                <span className="text-text-muted">Untested</span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Errors & Warnings Display */}
                                {validationErrors.length > 0 && (
                                    <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-600 dark:text-rose-300 text-xs space-y-1">
                                        <div className="font-bold flex items-center gap-1.5"><AlertTriangle size={14} /> Validation Errors:</div>
                                        {validationErrors.map((e, idx) => (
                                            <div key={idx} className="ml-5 list-disc">• {e}</div>
                                        ))}
                                    </div>
                                )}

                                {validationWarnings.length > 0 && (
                                    <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-600 dark:text-amber-300 text-xs space-y-1">
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
                <div className="px-6 py-4 border-t border-border flex items-center justify-between bg-card-secondary/50">
                    <button
                        type="button"
                        onClick={() => setStep(prev => Math.max(1, prev - 1) as any)}
                        disabled={step === 1}
                        className="px-4 py-2 bg-card-secondary hover:bg-card-hover disabled:opacity-30 text-text-secondary rounded-xl text-xs font-semibold border border-border transition-colors"
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
                                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm"
                            >
                                Next Step
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={handleFinish}
                                disabled={isSaving || validationErrors.length > 0}
                                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors shadow-sm"
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
