/**
 * Stigix Custom TCP Inter-Site Applications — Settings Configuration Tab
 */

import React, { useState, useEffect } from 'react';
import {
    Server, Plus, Play, Square, Edit3, Copy, Trash2,
    Download, Upload, Shield, Globe, RefreshCw, AlertTriangle, CheckCircle2
} from 'lucide-react';
import toast from 'react-hot-toast';
import type {
    CustomTcpApplicationConfig,
    CustomTcpApplicationsFile
} from '../../../custom-tcp-apps/types.js';
import { CustomAppWizardModal } from './CustomAppWizardModal';

interface CustomTcpSettingsTabProps {
    token: string | null;
}

export const CustomTcpSettingsTab: React.FC<CustomTcpSettingsTabProps> = ({ token }) => {
    const [applications, setApplications] = useState<CustomTcpApplicationConfig[]>([]);
    const [instanceInfo, setInstanceInfo] = useState<any>(null);
    const [appStatuses, setAppStatuses] = useState<Record<string, any>>({});
    const [isLoading, setIsLoading] = useState(false);
    const [isWizardOpen, setIsWizardOpen] = useState(false);
    const [editingApp, setEditingApp] = useState<CustomTcpApplicationConfig | null>(null);

    useEffect(() => {
        loadData();
    }, [token]);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [configRes, statusRes] = await Promise.all([
                fetch('/api/custom-tcp-apps', { headers: { 'Authorization': `Bearer ${token}` } }),
                fetch('/api/custom-tcp-apps/summary/all', { headers: { 'Authorization': `Bearer ${token}` } })
            ]);

            if (configRes.ok) {
                const configData = await configRes.json();
                setApplications(configData.applications || []);
                setInstanceInfo(configData.instance || null);
            }
            if (statusRes.ok) {
                const statusData = await statusRes.json();
                const map: Record<string, any> = {};
                (statusData.statuses || []).forEach((s: any) => { map[s.appId] = s; });
                setAppStatuses(map);
            }
        } catch (err: any) {
            console.error('Failed to load Custom TCP settings:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveApp = async (app: CustomTcpApplicationConfig) => {
        const isEdit = !!editingApp;
        const method = isEdit ? 'PUT' : 'POST';
        const url = isEdit ? `/api/custom-tcp-apps/${app.id}` : '/api/custom-tcp-apps';

        const res = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(app)
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to save application');
        }

        toast.success(isEdit ? 'Application updated' : 'Application created');
        await loadData();
    };

    const handleToggleListener = async (appId: string, currentListening: boolean) => {
        const action = currentListening ? 'stop' : 'start';
        try {
            const res = await fetch(`/api/custom-tcp-apps/${appId}/listener/${action}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok) {
                toast.success(currentListening ? 'Listener stopped' : 'Listener started on host port');
                await loadData();
            } else {
                toast.error(data.error || `Failed to ${action} listener`);
            }
        } catch (e: any) {
            toast.error(e.message);
        }
    };

    const handleDuplicate = async (appId: string) => {
        try {
            const res = await fetch(`/api/custom-tcp-apps/${appId}/duplicate`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                toast.success('Application duplicated');
                await loadData();
            } else {
                const data = await res.json();
                toast.error(data.error || 'Failed to duplicate');
            }
        } catch (e: any) {
            toast.error(e.message);
        }
    };

    const handleDelete = async (appId: string, appName: string) => {
        if (!window.confirm(`Are you sure you want to delete application "${appName}"?`)) return;
        try {
            const res = await fetch(`/api/custom-tcp-apps/${appId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                toast.success('Application deleted');
                await loadData();
            } else {
                const data = await res.json();
                toast.error(data.error || 'Failed to delete');
            }
        } catch (e: any) {
            toast.error(e.message);
        }
    };

    const handleExportJson = () => {
        const exportData = {
            version: 1,
            instance: instanceInfo,
            applications
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `stigix-custom-tcp-apps-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Top Toolbar */}
            <div className="bg-card border border-border p-5 rounded-2xl flex flex-wrap items-center justify-between gap-4 shadow-sm">
                <div>
                    <h3 className="text-lg font-bold text-text-primary flex items-center gap-2">
                        <Server size={20} className="text-indigo-400" /> Custom TCP Application Profiles
                    </h3>
                    <p className="text-xs text-text-muted mt-0.5">
                        Configure local TCP server listeners, simulation behaviors, and peer topologies for inter-site traffic testing.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={handleExportJson}
                        className="px-3 py-1.5 bg-bg-secondary hover:bg-bg-tertiary text-text-secondary rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors border border-border"
                    >
                        <Download size={14} /> Export JSON
                    </button>

                    <button
                        onClick={() => {
                            setEditingApp(null);
                            setIsWizardOpen(true);
                        }}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-md shadow-indigo-600/20"
                    >
                        <Plus size={15} /> Add Application Profile
                    </button>
                </div>
            </div>

            {/* Profiles Table */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
                {applications.length === 0 ? (
                    <div className="p-12 text-center text-xs text-text-muted italic">
                        No custom TCP application profiles defined yet. Click "Add Application Profile" to create one.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="border-b border-border bg-bg-secondary/50 text-text-muted font-bold text-[11px] uppercase tracking-wider">
                                    <th className="py-3.5 px-4">Application</th>
                                    <th className="py-3.5 px-4">TCP Port (Host)</th>
                                    <th className="py-3.5 px-4">Listener State</th>
                                    <th className="py-3.5 px-4">Server Mode</th>
                                    <th className="py-3.5 px-4">Client Mode</th>
                                    <th className="py-3.5 px-4">Peers</th>
                                    <th className="py-3.5 px-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {applications.map(app => {
                                    const status = appStatuses[app.id];
                                    const isListening = status?.listenerState === 'listening';
                                    return (
                                        <tr key={app.id} className="hover:bg-bg-secondary/30 transition-colors">
                                            <td className="py-3 px-4 font-bold text-text-primary">
                                                <div className="flex items-center gap-2">
                                                    <span>{app.name}</span>
                                                    {app.startup?.startClientWorkload && (
                                                        <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                                            ⚡ ZTP Auto-Start
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-[10px] text-text-muted font-mono font-normal">{app.id}</div>
                                            </td>
                                            <td className="py-3 px-4 font-mono font-bold text-amber-400">
                                                :{app.listener?.port}
                                            </td>
                                            <td className="py-3 px-4">
                                                <button
                                                    onClick={() => handleToggleListener(app.id, isListening)}
                                                    className={`px-2.5 py-1 rounded-full text-[10px] font-bold border flex items-center gap-1.5 transition-all ${
                                                        isListening
                                                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                                                    }`}
                                                >
                                                    <span className={`w-1.5 h-1.5 rounded-full ${isListening ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                                                    {isListening ? 'LISTENING' : 'STOPPED'}
                                                </button>
                                            </td>
                                            <td className="py-3 px-4 text-text-secondary capitalize">
                                                {app.serverBehavior?.mode.replace('_', ' ')}
                                            </td>
                                            <td className="py-3 px-4 text-text-secondary capitalize">
                                                {app.clientDefaults?.mode.replace(/_/g, ' ')}
                                            </td>
                                            <td className="py-3 px-4 font-semibold text-text-primary">
                                                {app.peers?.length || 0} nodes
                                            </td>
                                            <td className="py-3 px-4 text-right">
                                                <div className="flex items-center justify-end gap-1.5">
                                                    <button
                                                        onClick={() => {
                                                            setEditingApp(app);
                                                            setIsWizardOpen(true);
                                                        }}
                                                        className="p-1.5 text-text-muted hover:text-indigo-400 rounded hover:bg-bg-secondary transition-colors"
                                                        title="Edit Profile"
                                                    >
                                                        <Edit3 size={15} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDuplicate(app.id)}
                                                        className="p-1.5 text-text-muted hover:text-emerald-400 rounded hover:bg-bg-secondary transition-colors"
                                                        title="Duplicate Profile"
                                                    >
                                                        <Copy size={15} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(app.id, app.name)}
                                                        className="p-1.5 text-text-muted hover:text-rose-400 rounded hover:bg-bg-secondary transition-colors"
                                                        title="Delete Profile"
                                                    >
                                                        <Trash2 size={15} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Creation / Edition Wizard */}
            <CustomAppWizardModal
                isOpen={isWizardOpen}
                onClose={() => {
                    setIsWizardOpen(false);
                    setEditingApp(null);
                }}
                onSave={handleSaveApp}
                editingApp={editingApp}
                token={token}
            />
        </div>
    );
};
