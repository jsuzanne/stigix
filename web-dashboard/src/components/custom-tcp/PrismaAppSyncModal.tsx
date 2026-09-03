import React, { useState, useEffect, Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import {
    Cloud, CheckCircle2, AlertCircle, RefreshCw, Trash2,
    Plus, ExternalLink, ShieldCheck, X, Loader2, ArrowRight
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { CustomTcpApplicationConfig } from '../../../custom-tcp-apps/types.js';

interface PrismaAppSyncModalProps {
    isOpen: boolean;
    onClose: () => void;
    token: string | null;
    applications: CustomTcpApplicationConfig[];
}

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

class ModalErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('PrismaAppSyncModal error:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="p-8 text-center space-y-3">
                    <div className="text-rose-500 font-bold text-sm">
                        An error occurred while displaying the Prisma integration:
                    </div>
                    <div className="text-xs text-text-muted font-mono bg-card-secondary p-3 rounded-xl max-w-lg mx-auto overflow-x-auto">
                        {this.state.error?.message || 'Unknown error'}
                    </div>
                    <button
                        onClick={() => this.setState({ hasError: false, error: null })}
                        className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold"
                    >
                        Retry
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

export const PrismaAppSyncModal: React.FC<PrismaAppSyncModalProps> = ({
    isOpen,
    onClose,
    token,
    applications
}) => {
    const [isLoading, setIsLoading] = useState(false);
    const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
    const [isGlobalActionLoading, setIsGlobalActionLoading] = useState(false);
    const [prismaData, setPrismaData] = useState<{
        success?: boolean;
        tenant_id?: string;
        total_apps?: number;
        stigix_apps_count?: number;
        apps?: any[];
        error?: any;
    } | null>(null);

    useEffect(() => {
        if (isOpen && token) {
            loadPrismaStatus();
        }
    }, [isOpen, token]);

    const loadPrismaStatus = async () => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/custom-tcp-apps/prisma/status', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            setPrismaData(data);
        } catch (err: any) {
            console.error('Failed to load Prisma SD-WAN status:', err);
            setPrismaData({ success: false, error: err?.message || 'Network request failed' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleSyncSingleApp = async (appId: string) => {
        setActionLoadingId(appId);
        try {
            const res = await fetch(`/api/custom-tcp-apps/prisma/sync-app/${appId}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok && data.success) {
                toast.success(`Application registered in Prisma SD-WAN! (${data.name || ''})`);
                await loadPrismaStatus();
            } else {
                toast.error(typeof data.error === 'string' ? data.error : 'Failed to sync application to Prisma SD-WAN');
            }
        } catch (err: any) {
            toast.error(err.message || 'Network error');
        } finally {
            setActionLoadingId(null);
        }
    };

    const handleDeleteSingleApp = async (appId: string) => {
        setActionLoadingId(appId);
        try {
            const res = await fetch(`/api/custom-tcp-apps/prisma/delete-app/${appId}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok && data.success) {
                toast.success('Application removed from Prisma SD-WAN');
                await loadPrismaStatus();
            } else {
                toast.error(typeof data.error === 'string' ? data.error : 'Failed to remove application');
            }
        } catch (err: any) {
            toast.error(err.message || 'Network error');
        } finally {
            setActionLoadingId(null);
        }
    };

    const handleSyncAll = async () => {
        setIsGlobalActionLoading(true);
        try {
            const res = await fetch('/api/custom-tcp-apps/prisma/sync-all', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok && data.success) {
                toast.success(data.message || 'All applications synchronized to Prisma SD-WAN!');
                await loadPrismaStatus();
            } else {
                toast.error(typeof data.error === 'string' ? data.error : 'Failed to sync applications');
            }
        } catch (err: any) {
            toast.error(err.message || 'Network error');
        } finally {
            setIsGlobalActionLoading(false);
        }
    };

    const handleCleanAll = async () => {
        if (!confirm('Are you sure you want to delete all Stigix-created custom applications from your Prisma SD-WAN tenant? This will not affect other tenant applications.')) {
            return;
        }
        setIsGlobalActionLoading(true);
        try {
            const res = await fetch('/api/custom-tcp-apps/prisma/clean-all', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok && data.success) {
                toast.success(data.message || 'Cleaned all Stigix applications from tenant');
                await loadPrismaStatus();
            } else {
                toast.error(typeof data.error === 'string' ? data.error : 'Failed to clean applications');
            }
        } catch (err: any) {
            toast.error(err.message || 'Network error');
        } finally {
            setIsGlobalActionLoading(false);
        }
    };

    if (!isOpen) return null;

    const prismaAppsList = Array.isArray(prismaData?.apps) ? prismaData.apps : [];
    const applicationsList = Array.isArray(applications) ? applications : [];

    const getErrorMessage = () => {
        if (!prismaData?.error) return 'Unavailable / Check Credentials';
        if (typeof prismaData.error === 'string') return prismaData.error;
        try {
            return JSON.stringify(prismaData.error);
        } catch {
            return 'Connection failed';
        }
    };

    return (
        <ModalErrorBoundary>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
                <div className="bg-card border border-border w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                    {/* Header */}
                    <div className="p-6 border-b border-border bg-card/50 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-2xl text-blue-500">
                                <Cloud size={24} />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h2 className="text-lg font-bold text-text-primary tracking-wide">
                                        Prisma SD-WAN Custom App Integration
                                    </h2>
                                    <span className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 rounded text-[10px] font-bold uppercase tracking-wider">
                                        Flow Browser Ready
                                    </span>
                                </div>
                                <p className="text-xs text-text-muted mt-0.5">
                                    Automatically provision and classify custom TCP application ports in your Prisma SASE tenant for full Flow Browser visibility.
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-card-secondary rounded-xl text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Body Content */}
                    <div className="p-6 overflow-y-auto space-y-6 flex-1">
                        {/* Status Banner */}
                        <div className="bg-card-secondary/70 border border-border rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-xl border ${prismaData?.success ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' : 'bg-amber-500/10 border-amber-500/30 text-amber-500'}`}>
                                    {prismaData?.success ? <ShieldCheck size={20} /> : <AlertCircle size={20} />}
                                </div>
                                <div>
                                    <div className="text-xs font-bold text-text-primary flex items-center gap-2">
                                        <span>Tenant Connection:</span>
                                        {isLoading ? (
                                            <span className="text-text-muted flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Querying...</span>
                                        ) : prismaData?.success ? (
                                            <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-mono">
                                                ● Connected (TSG: {String(prismaData.tenant_id || '')})
                                            </span>
                                        ) : (
                                            <span className="text-rose-500 font-medium">{getErrorMessage()}</span>
                                        )}
                                    </div>
                                    <div className="text-[11px] text-text-muted mt-0.5">
                                        Total Tenant Apps: <strong className="text-text-secondary">{typeof prismaData?.total_apps === 'number' ? prismaData.total_apps : '—'}</strong> | Managed by Stigix: <strong className="text-blue-500">{typeof prismaData?.stigix_apps_count === 'number' ? prismaData.stigix_apps_count : '—'}</strong>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    onClick={loadPrismaStatus}
                                    disabled={isLoading}
                                    className="px-3 py-1.5 bg-card hover:bg-card-hover border border-border rounded-xl text-xs font-semibold text-text-secondary hover:text-text-primary flex items-center gap-1.5 transition-all cursor-pointer"
                                    title="Refresh Prisma SD-WAN Appdefs"
                                >
                                    <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                                    Refresh
                                </button>
                                <button
                                    onClick={handleSyncAll}
                                    disabled={isGlobalActionLoading || isLoading || !prismaData?.success}
                                    className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
                                >
                                    {isGlobalActionLoading ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />}
                                    Sync All to Prisma
                                </button>
                                <button
                                    onClick={handleCleanAll}
                                    disabled={isGlobalActionLoading || isLoading || !prismaData?.success}
                                    className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 text-rose-600 dark:text-rose-400 border border-rose-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                                    title="Clean up Stigix-created apps from tenant"
                                >
                                    <Trash2 size={14} />
                                    Clean All
                                </button>
                            </div>
                        </div>

                        {/* Applications Mapping Matrix */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between text-xs font-bold text-text-muted uppercase tracking-wider">
                                <span>Stigix Custom TCP Apps ({applicationsList.length})</span>
                                <span>Prisma SD-WAN Appdef Mapping</span>
                            </div>

                            <div className="border border-border rounded-2xl overflow-hidden divide-y divide-border">
                                {applicationsList.length === 0 ? (
                                    <div className="p-8 text-center text-xs text-text-muted">
                                        No Custom TCP applications configured in Stigix yet.
                                    </div>
                                ) : (
                                    applicationsList.map(app => {
                                        const port = app?.listener?.port || app?.peers?.[0]?.port;
                                        const rawName = app?.name || app?.id || 'App';
                                        const expectedPrismaName = `STX_${String(rawName).replace(/[^a-zA-Z0-9_\-]/g, '_')}`;
                                        
                                        const matchedPrismaApp = prismaAppsList.find(pa => {
                                            if (!pa) return false;
                                            const paName = String(pa.name || '').toLowerCase();
                                            const expName = expectedPrismaName.toLowerCase();
                                            const rawAppName = String(rawName).toLowerCase();
                                            const tcpPorts: number[] = Array.isArray(pa.tcp_ports) ? pa.tcp_ports : [];
                                            const hasPortMatch = port ? tcpPorts.includes(Number(port)) : false;
                                            return (paName && (paName === expName || paName === rawAppName)) || hasPortMatch;
                                        });

                                        const isSynced = !!matchedPrismaApp;
                                        const isItemLoading = actionLoadingId === app.id;

                                        return (
                                            <div
                                                key={app.id}
                                                className="p-4 bg-card hover:bg-card-secondary/50 transition-colors flex flex-wrap items-center justify-between gap-4"
                                            >
                                                {/* Stigix App Details */}
                                                <div className="flex items-center gap-3 min-w-[240px]">
                                                    <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-500 flex items-center justify-center font-bold text-xs">
                                                        TCP
                                                    </div>
                                                    <div>
                                                        <div className="text-sm font-bold text-text-primary flex items-center gap-2">
                                                            <span>{rawName}</span>
                                                            <span className="px-2 py-0.5 rounded-md bg-card-secondary font-mono text-[11px] text-indigo-600 dark:text-indigo-400 font-bold border border-border">
                                                                Port :{port || '—'}
                                                            </span>
                                                        </div>
                                                        <div className="text-[11px] text-text-muted mt-0.5">
                                                            {app?.description || 'Custom LOB application'}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Mapping Arrow & Prisma Info */}
                                                <div className="flex items-center gap-3">
                                                    <ArrowRight size={16} className="text-text-muted/50 hidden sm:block" />

                                                    <div className="min-w-[200px]">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs font-mono font-bold text-text-primary">
                                                                {expectedPrismaName}
                                                            </span>
                                                            {isSynced ? (
                                                                <span className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 rounded-full text-[9px] font-bold uppercase tracking-wider flex items-center gap-1">
                                                                    <CheckCircle2 size={10} /> Synced
                                                                </span>
                                                            ) : (
                                                                <span className="px-2 py-0.5 bg-card-secondary border border-border text-text-muted rounded-full text-[9px] font-bold uppercase tracking-wider">
                                                                    Not Synced
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-[10px] text-text-muted font-mono mt-0.5 truncate max-w-[220px]">
                                                            {matchedPrismaApp ? `ID: ${matchedPrismaApp.id}` : 'Classified as generic TCP'}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Actions */}
                                                <div className="flex items-center gap-2">
                                                    {isSynced ? (
                                                        <button
                                                            onClick={() => handleDeleteSingleApp(app.id)}
                                                            disabled={isItemLoading}
                                                            className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                                                            title="Remove appdef from Prisma SD-WAN"
                                                        >
                                                            {isItemLoading ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                                            Remove
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleSyncSingleApp(app.id)}
                                                            disabled={isItemLoading || !prismaData?.success}
                                                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
                                                            title="Register appdef in Prisma SD-WAN"
                                                        >
                                                            {isItemLoading ? <Loader2 size={13} className="animate-spin" /> : <Cloud size={13} />}
                                                            Register in Prisma
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        {/* How It Works Explainer */}
                        <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 text-xs space-y-2 text-text-secondary">
                            <div className="font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                                <Cloud size={14} /> How Prisma SD-WAN Flow Browser Identification Works:
                            </div>
                            <p>
                                When Stigix creates a Custom Application on your Prisma SD-WAN tenant with tag <code className="font-mono bg-card px-1 py-0.5 rounded text-blue-500">stigix</code>, the ION appliances automatically correlate any packet targeting that destination TCP port and display the flow under the application name (e.g. <strong>STX_SAP-ERP</strong>) in the <strong>Flow Browser</strong>, <strong>Analytics</strong>, and <strong>QoS/Security Policies</strong>.
                            </p>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-border bg-card/50 flex justify-end">
                        <button
                            onClick={onClose}
                            className="px-5 py-2 bg-card-secondary hover:bg-card-hover border border-border text-text-primary rounded-xl text-xs font-bold transition-colors cursor-pointer"
                        >
                            Done
                        </button>
                    </div>
                </div>
            </div>
        </ModalErrorBoundary>
    );
};
