import React, { useState, useRef, useEffect } from 'react';
import {
    Upload, Play, Square, CheckCircle2, AlertTriangle, X,
    Layers, Server, Globe, RefreshCw, FileText, Shield, ArrowRight,
    Terminal, Lock, ShieldAlert, Activity, Check, Download
} from 'lucide-react';
import toast from 'react-hot-toast';
import { usePeerContext } from '../../PeerContext';

interface PcapReplayModalProps {
    isOpen: boolean;
    onClose: () => void;
    token: string | null;
    isPcapEnabled?: boolean;
}

export const PcapReplayModal: React.FC<PcapReplayModalProps> = ({
    isOpen,
    onClose,
    token,
    isPcapEnabled = true
}) => {
    const { gFetch } = usePeerContext();

    const [activeTab, setActiveTab] = useState<'upload' | 'inspect' | 'replay'>('upload');
    const [isUploading, setIsUploading] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    // Inspection State
    const [tempFileToken, setTempFileToken] = useState<string | null>(null);
    const [inspectionData, setInspectionData] = useState<any>(null);
    const [selectedFlowIds, setSelectedFlowIds] = useState<number[]>([]);
    const [scrubSensitive, setScrubSensitive] = useState<boolean>(true);
    const [profileName, setProfileName] = useState<string>('');
    const [profileCategory, setProfileCategory] = useState<string>('custom');
    const [expectedAppId, setExpectedAppId] = useState<string>('');
    const [isCompiling, setIsCompiling] = useState(false);

    // Replay State
    const [compiledProfiles, setCompiledProfiles] = useState<any[]>([]);
    const [selectedProfile, setSelectedProfile] = useState<string>('');
    const [replayRole, setReplayRole] = useState<'client' | 'server'>('client');
    const [targetIp, setTargetIp] = useState<string>('');
    const [portOverride, setPortOverride] = useState<string>('');
    const [isLooping, setIsLooping] = useState<boolean>(false);
    const [activeJob, setActiveJob] = useState<any>(null);
    const [isStartingReplay, setIsStartingReplay] = useState(false);
    const [discoveredServer, setDiscoveredServer] = useState<{ active: boolean; port?: number; profile_file?: string } | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const profileFileInputRef = useRef<HTMLInputElement>(null);

    const handleDownloadProfile = async (fileName: string) => {
        try {
            const res = await gFetch(`/api/pcap/profiles/download/${fileName}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Download failed');
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (e: any) {
            toast.error(e.message || 'Failed to download profile');
        }
    };

    const handleProfileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.name.endsWith('.stx-replay')) {
            toast.error('Only .stx-replay files can be imported directly');
            return;
        }
        const formData = new FormData();
        formData.append('profile', file);
        try {
            const res = await gFetch('/api/pcap/profiles/upload', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: formData
            });
            if (res.ok) {
                toast.success(`Profile imported: ${file.name}`);
                fetchProfiles();
                setSelectedProfile(file.name);
            } else {
                toast.error('Import failed');
            }
        } catch (err: any) {
            toast.error(err.message || 'Import failed');
        }
    };

    // Auto-discover if target has an active PCAP Replay server
    useEffect(() => {
        if (!isOpen || replayRole !== 'client' || !targetIp || targetIp.trim().length < 7) {
            setDiscoveredServer(null);
            return;
        }

        let isMounted = true;
        const checkTarget = async () => {
            try {
                const res = await gFetch(`/api/pcap/replay/discover?target=${encodeURIComponent(targetIp.trim())}`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (res.ok && isMounted) {
                    const data = await res.json();
                    setDiscoveredServer(data);
                    if (data.active && data.port && !portOverride) {
                        setPortOverride(String(data.port));
                    }
                }
            } catch (_) {}
        };

        checkTarget();
        const interval = setInterval(checkTarget, 3000);
        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [isOpen, replayRole, targetIp, portOverride]);

    // Fetch existing profiles on open
    useEffect(() => {
        if (!isOpen) return;
        fetchProfiles();
        const interval = setInterval(fetchJobs, 2000);
        return () => clearInterval(interval);
    }, [isOpen]);

    const fetchProfiles = async () => {
        try {
            const res = await gFetch('/api/pcap/profiles', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setCompiledProfiles(data.profiles || []);
                if (data.profiles?.length > 0 && !selectedProfile) {
                    setSelectedProfile(data.profiles[0].file_name);
                }
            }
        } catch (_) {}
    };

    const fetchJobs = async () => {
        try {
            const res = await gFetch('/api/pcap/replay/jobs', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                const running = (data.jobs || []).find((j: any) => j.status === 'running');
                if (running) {
                    setActiveJob(running);
                } else if (data.jobs && data.jobs.length > 0) {
                    // Show latest job if no job is currently running
                    setActiveJob(data.jobs[data.jobs.length - 1]);
                }
            }
        } catch (_) {}
    };

    if (!isOpen) return null;

    const handleFileSelect = (file: File) => {
        if (!file.name.endsWith('.pcap') && !file.name.endsWith('.pcapng') && !file.name.endsWith('.cap')) {
            toast.error('Only .pcap and .pcapng files are supported');
            return;
        }
        setSelectedFile(file);
        setProfileName(file.name.replace(/\.[^/.]+$/, ''));
    };

    const handleInspectUpload = async () => {
        if (!selectedFile) return;

        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('pcap', selectedFile);
            formData.append('scrub', String(scrubSensitive));

            const res = await gFetch('/api/pcap/inspect', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`
                },
                body: formData
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Inspection failed');
            }

            setTempFileToken(data.temp_file_token);
            setInspectionData(data.inspection);
            // Select all flows by default
            if (data.inspection?.flows) {
                setSelectedFlowIds(data.inspection.flows.map((f: any) => f.flow_id));
            }
            setActiveTab('inspect');
            toast.success(`Discovered ${data.inspection.flows?.length || 0} active flows!`);
        } catch (err: any) {
            toast.error(err.message || 'Error parsing capture');
        } finally {
            setIsUploading(false);
        }
    };

    const handleCompile = async () => {
        if (!tempFileToken) return;

        if (selectedFlowIds.length === 0) {
            toast.error('Please select at least one flow to include');
            return;
        }

        setIsCompiling(true);
        try {
            const res = await gFetch('/api/pcap/compile', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    temp_file_token: tempFileToken,
                    name: profileName,
                    category: profileCategory,
                    app_id: expectedAppId || undefined,
                    scrub: scrubSensitive,
                    flow_ids: selectedFlowIds
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Compilation failed');
            }

            toast.success(`Profile compiled: ${data.stats?.profile_size_bytes} bytes (${data.stats?.compression_ratio_pct}% of original)`);
            await fetchProfiles();
            setSelectedProfile(data.profile_file);
            setActiveTab('replay');
        } catch (err: any) {
            toast.error(err.message || 'Error compiling profile');
        } finally {
            setIsCompiling(false);
        }
    };

    const handleStartReplay = async () => {
        if (!selectedProfile) {
            toast.error('Select a replay profile');
            return;
        }
        if (replayRole === 'client' && !targetIp) {
            toast.error('Target IP is required for Client role');
            return;
        }

        setIsStartingReplay(true);
        try {
            const res = await gFetch('/api/pcap/replay/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    role: replayRole,
                    profile_file: selectedProfile,
                    target: targetIp || undefined,
                    port: portOverride ? parseInt(portOverride, 10) : undefined,
                    loop: isLooping,
                    interval: 1000
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to start replay');
            }

            toast.success(`Replay started as ${replayRole.toUpperCase()} (PID ${data.pid})`);
            setActiveJob({
                id: data.job_id,
                role: replayRole,
                status: 'running',
                target: targetIp,
                port: portOverride ? parseInt(portOverride, 10) : undefined,
                recentEvents: [
                    {
                        timestamp: Date.now() / 1000,
                        event: 'starting',
                        text: `Démarrage du processus ${replayRole.toUpperCase()} (PID ${data.pid})...`
                    }
                ]
            });
            fetchJobs();
        } catch (err: any) {
            toast.error(err.message || 'Failed to start replay');
        } finally {
            setIsStartingReplay(false);
        }
    };

    const handleStopReplay = async () => {
        if (!activeJob?.id) return;

        try {
            const res = await gFetch('/api/pcap/replay/stop', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ job_id: activeJob.id })
            });

            if (res.ok) {
                toast.success('Replay stopped');
                fetchJobs();
            }
        } catch (_) {}
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-card border border-border w-full max-w-4xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
                {/* Modal Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/20">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center">
                            <Layers size={20} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-base font-bold text-text-primary">PCAP Stateful Replay Engine</h3>
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    M1 & M2 Live
                                </span>
                            </div>
                            <p className="text-xs text-text-muted">
                                Stateful L7 socket turn replay across SD-WAN overlays and Prisma Access
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-muted transition-colors cursor-pointer"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Navigation Tabs */}
                <div className="flex border-b border-border px-6 bg-muted/10 gap-2">
                    <button
                        onClick={() => setActiveTab('upload')}
                        className={`py-3 px-4 text-xs font-semibold border-b-2 cursor-pointer transition-colors flex items-center gap-2 ${
                            activeTab === 'upload'
                                ? 'border-indigo-500 text-indigo-400'
                                : 'border-transparent text-text-muted hover:text-text-primary'
                        }`}
                    >
                        <Upload size={14} /> 1. Upload Capture
                    </button>
                    <button
                        onClick={() => setActiveTab('inspect')}
                        disabled={!inspectionData}
                        className={`py-3 px-4 text-xs font-semibold border-b-2 cursor-pointer transition-colors flex items-center gap-2 ${
                            activeTab === 'inspect'
                                ? 'border-indigo-500 text-indigo-400'
                                : !inspectionData
                                ? 'border-transparent text-text-muted/40 cursor-not-allowed'
                                : 'border-transparent text-text-muted hover:text-text-primary'
                        }`}
                    >
                        <FileText size={14} /> 2. Flow Inspection & Compile
                    </button>
                    <button
                        onClick={() => setActiveTab('replay')}
                        className={`py-3 px-4 text-xs font-semibold border-b-2 cursor-pointer transition-colors flex items-center gap-2 ${
                            activeTab === 'replay'
                                ? 'border-indigo-500 text-indigo-400'
                                : 'border-transparent text-text-muted hover:text-text-primary'
                        }`}
                    >
                        <Play size={14} /> 3. Live Replay Runner
                    </button>
                </div>

                {/* Modal Body */}
                <div className="p-6 overflow-y-auto space-y-5 flex-1">
                    {!isPcapEnabled && (
                        <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-3">
                            <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
                            <div className="text-xs text-amber-300/90 leading-relaxed">
                                <span className="font-bold text-amber-300">Feature Flag Requis :</span> La fonctionnalité PCAP Replay est actuellement désactivée sur cette instance Stigix. Ajoutez <code className="px-1.5 py-0.5 bg-black/40 rounded text-amber-200 font-mono text-[11px]">ENABLE_PCAP_REPLAY=true</code> dans le fichier <code className="px-1.5 py-0.5 bg-black/40 rounded text-amber-200 font-mono text-[11px]">.env</code> de cette machine puis redémarrez le conteneur pour débloquer l'upload et le rejeu en direct.
                            </div>
                        </div>
                    )}

                    {activeTab === 'upload' && (
                        <div className="space-y-4">
                            <div
                                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                onDragLeave={() => setIsDragging(false)}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    setIsDragging(false);
                                    if (e.dataTransfer.files?.[0]) handleFileSelect(e.dataTransfer.files[0]);
                                }}
                                onClick={() => fileInputRef.current?.click()}
                                className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                                    isDragging
                                        ? 'border-indigo-500 bg-indigo-500/10'
                                        : 'border-border/60 hover:border-indigo-500/50 hover:bg-muted/10'
                                }`}
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".pcap,.pcapng,.cap"
                                    className="hidden"
                                    onChange={(e) => {
                                        if (e.target.files?.[0]) handleFileSelect(e.target.files[0]);
                                    }}
                                />
                                <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mb-3">
                                    <Upload size={28} />
                                </div>
                                <h4 className="text-sm font-semibold text-text-primary">
                                    {selectedFile ? selectedFile.name : 'Drop a .pcap or .pcapng file here'}
                                </h4>
                                <p className="text-xs text-text-muted mt-1 max-w-md">
                                    {selectedFile
                                        ? `${(selectedFile.size / 1024).toFixed(1)} KB — Click to change file`
                                        : 'Supports bidirectional TCP and UDP application captures (SAP, Modbus, DICOM, HL7, DNS, HTTP)'}
                                </p>
                            </div>

                            <div className="bg-muted/20 border border-border rounded-xl p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <Shield size={18} className="text-indigo-400" />
                                    <div>
                                        <div className="text-xs font-semibold text-text-primary">Automatic Credential Scrubbing</div>
                                        <div className="text-[11px] text-text-muted">
                                            Masks Basic Auth, Bearer tokens, passwords, and emails while keeping protocol structures intact
                                        </div>
                                    </div>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={scrubSensitive}
                                    onChange={(e) => setScrubSensitive(e.target.checked)}
                                    className="w-4 h-4 accent-indigo-500 rounded cursor-pointer"
                                />
                            </div>

                            <div className="flex justify-end pt-2">
                                <button
                                    onClick={handleInspectUpload}
                                    disabled={!selectedFile || isUploading}
                                    className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer"
                                >
                                    {isUploading ? (
                                        <>
                                            <RefreshCw size={14} className="animate-spin" />
                                            Streaming & Parsing Flows...
                                        </>
                                    ) : (
                                        <>
                                            Inspect Flows
                                            <ArrowRight size={14} />
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'inspect' && inspectionData && (
                        <div className="space-y-5">
                            {/* Summary banner */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div className="p-3 bg-muted/20 border border-border rounded-xl">
                                    <div className="text-[11px] text-text-muted">Original Capture</div>
                                    <div className="text-xs font-bold text-text-primary truncate">{inspectionData.file_name}</div>
                                </div>
                                <div className="p-3 bg-muted/20 border border-border rounded-xl">
                                    <div className="text-[11px] text-text-muted">Packets / Duration</div>
                                    <div className="text-xs font-bold text-text-primary">
                                        {inspectionData.packet_count} pkts / {inspectionData.duration_seconds}s
                                    </div>
                                </div>
                                <div className="p-3 bg-muted/20 border border-border rounded-xl">
                                    <div className="text-[11px] text-text-muted">Discovered Flows</div>
                                    <div className="text-xs font-bold text-indigo-400">{inspectionData.total_active_flows} active</div>
                                </div>
                                <div className="p-3 bg-muted/20 border border-border rounded-xl">
                                    <div className="text-[11px] text-text-muted">Selected for Profile</div>
                                    <div className="text-xs font-bold text-emerald-400">{selectedFlowIds.length} flow(s)</div>
                                </div>
                            </div>

                            {/* Flows table */}
                            <div className="border border-border rounded-xl overflow-hidden">
                                <div className="px-4 py-2.5 bg-muted/30 border-b border-border text-xs font-bold text-text-primary flex items-center justify-between">
                                    <span>Select Flows to Compile into Profile</span>
                                    <span className="text-[11px] text-text-muted font-normal">
                                        Checkboxes determine which flows become the stateful script
                                    </span>
                                </div>
                                <div className="max-h-60 overflow-y-auto">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-muted/20 text-text-muted text-[11px] uppercase">
                                            <tr>
                                                <th className="p-3 w-10"></th>
                                                <th className="p-3">Proto</th>
                                                <th className="p-3">Client Endpoint</th>
                                                <th className="p-3">Server Endpoint</th>
                                                <th className="p-3">Turns</th>
                                                <th className="p-3">Payload</th>
                                                <th className="p-3">Security Warnings</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/60">
                                            {inspectionData.flows?.map((f: any) => {
                                                const isSelected = selectedFlowIds.includes(f.flow_id);
                                                return (
                                                    <tr key={f.flow_id} className="hover:bg-muted/10 transition-colors">
                                                        <td className="p-3">
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                onChange={() => {
                                                                    setSelectedFlowIds(prev =>
                                                                        isSelected ? prev.filter(id => id !== f.flow_id) : [...prev, f.flow_id]
                                                                    );
                                                                }}
                                                                className="w-4 h-4 accent-indigo-500 rounded cursor-pointer"
                                                            />
                                                        </td>
                                                        <td className="p-3 font-semibold text-text-primary uppercase">
                                                            <span className="px-1.5 py-0.5 rounded bg-muted text-[10px]">
                                                                {f.transport}
                                                            </span>
                                                        </td>
                                                        <td className="p-3 text-text-muted font-mono text-[11px]">
                                                            {f.client_ip}:{f.client_port}
                                                        </td>
                                                        <td className="p-3 text-text-muted font-mono text-[11px]">
                                                            {f.server_ip}:{f.server_port}
                                                        </td>
                                                        <td className="p-3 font-bold text-text-primary">
                                                            {f.turns_count} turns
                                                        </td>
                                                        <td className="p-3 text-text-muted">
                                                            {f.payload_bytes} B
                                                        </td>
                                                        <td className="p-3">
                                                            {f.warnings?.length > 0 ? (
                                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1 w-fit">
                                                                    <AlertTriangle size={10} />
                                                                    {f.warnings.join(', ')}
                                                                </span>
                                                            ) : (
                                                                <span className="text-text-muted text-[11px]">Clean</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Compilation metadata settings */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                    <label className="text-[11px] font-medium text-text-muted block mb-1">Profile Name</label>
                                    <input
                                        type="text"
                                        value={profileName}
                                        onChange={(e) => setProfileName(e.target.value)}
                                        className="w-full px-3 py-1.5 bg-muted/20 border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-medium text-text-muted block mb-1">Category</label>
                                    <select
                                        value={profileCategory}
                                        onChange={(e) => setProfileCategory(e.target.value)}
                                        className="w-full px-3 py-1.5 bg-muted/20 border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-indigo-500 cursor-pointer"
                                    >
                                        <option value="custom">Custom Application</option>
                                        <option value="enterprise">Enterprise (SAP, Oracle, Citrix)</option>
                                        <option value="threat">Threat / Exploit Replay</option>
                                        <option value="iot">IoT Device Profile</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[11px] font-medium text-text-muted block mb-1">Expected App-ID (Optional)</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. sap, modbus, dicom"
                                        value={expectedAppId}
                                        onChange={(e) => setExpectedAppId(e.target.value)}
                                        className="w-full px-3 py-1.5 bg-muted/20 border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-indigo-500"
                                    />
                                </div>
                            </div>

                            <div className="flex justify-between items-center pt-2">
                                <button
                                    onClick={() => setActiveTab('upload')}
                                    className="px-4 py-2 border border-border text-xs text-text-muted hover:text-text-primary rounded-xl cursor-pointer"
                                >
                                    Back to Upload
                                </button>
                                <button
                                    onClick={handleCompile}
                                    disabled={isCompiling || selectedFlowIds.length === 0}
                                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer"
                                >
                                    {isCompiling ? (
                                        <>
                                            <RefreshCw size={14} className="animate-spin" />
                                            Compiling .stx-replay...
                                        </>
                                    ) : (
                                        <>
                                            <Check size={14} />
                                            Compile to .stx-replay Profile
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'replay' && (() => {
                        const currentProf = compiledProfiles.find(p => p.file_name === selectedProfile);
                        const connectedEv = activeJob?.recentEvents?.find((e: any) => e.event === 'client_connected');
                        const serverStartedEv = activeJob?.recentEvents?.find((e: any) => e.event === 'session_started');

                        return (
                        <div className="space-y-5">
                            {/* Profile selection card */}
                            <div className="p-4 bg-muted/20 border border-border rounded-2xl space-y-3">
                                <div className="text-xs font-bold text-text-primary flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Layers size={14} className="text-indigo-400" />
                                        <span>Select Replay Profile</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="file"
                                            ref={profileFileInputRef}
                                            onChange={handleProfileUpload}
                                            accept=".stx-replay"
                                            className="hidden"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => profileFileInputRef.current?.click()}
                                            className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer font-medium"
                                            title="Importer un profil .stx-replay depuis le Leader ou une autre machine"
                                        >
                                            <Upload size={11} /> Importer .stx-replay
                                        </button>
                                        {selectedProfile && (
                                            <button
                                                type="button"
                                                onClick={() => handleDownloadProfile(selectedProfile)}
                                                className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer font-medium"
                                                title="Télécharger ce profil .stx-replay pour le copier sur un autre nœud"
                                            >
                                                <Download size={11} /> Exporter Profil
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-[11px] text-text-muted block mb-1">Compiled Profile (.stx-replay)</label>
                                        <select
                                            value={selectedProfile}
                                            onChange={(e) => setSelectedProfile(e.target.value)}
                                            className="w-full px-3 py-2 bg-card border border-border rounded-xl text-xs text-text-primary focus:outline-none focus:border-indigo-500 cursor-pointer"
                                        >
                                            {compiledProfiles.length === 0 && <option value="">No profiles compiled yet</option>}
                                            {compiledProfiles.map(p => (
                                                <option key={p.file_name} value={p.file_name}>
                                                    {p.name ? `${p.name} (${p.file_name})` : p.file_name} ({(p.size_bytes / 1024).toFixed(1)} KB)
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[11px] text-text-muted block mb-1">Replay Role</label>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setReplayRole('client')}
                                                className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                                                    replayRole === 'client'
                                                        ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                                                        : 'border-border text-text-muted hover:text-text-primary'
                                                }`}
                                            >
                                                Client (Initiator)
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setReplayRole('server')}
                                                className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                                                    replayRole === 'server'
                                                        ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                                                        : 'border-border text-text-muted hover:text-text-primary'
                                                }`}
                                            >
                                                Server (Listener)
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {replayRole === 'server' ? (
                                    <div className="pt-2">
                                        <label className="text-[11px] text-text-muted block mb-1">
                                            Listening Port Override (Optional)
                                        </label>
                                        <input
                                            type="number"
                                            placeholder="Defaults to profile port (e.g. 18443 if standard port 80/443/8443 is in use)"
                                            value={portOverride}
                                            onChange={(e) => setPortOverride(e.target.value)}
                                            className="w-full px-3 py-1.5 bg-card border border-border rounded-xl text-xs text-text-primary focus:outline-none focus:border-indigo-500 font-mono"
                                        />
                                        <p className="text-[10px] text-text-muted mt-1">
                                            💡 Si le port d'origine du PCAP est déjà occupé par un service de cette machine (ex: 8443), indiquez un port alternatif libre (ex: 18443).
                                        </p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                                        <div className="sm:col-span-2">
                                            <label className="text-[11px] text-text-muted block mb-1">
                                                Target Stigix Server IP (Destination)
                                            </label>
                                            <input
                                                type="text"
                                                placeholder="e.g. 192.168.203.100 or 192.168.122.51"
                                                value={targetIp}
                                                onChange={(e) => setTargetIp(e.target.value)}
                                                className="w-full px-3 py-1.5 bg-card border border-border rounded-xl text-xs text-text-primary focus:outline-none focus:border-indigo-500 font-mono"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[11px] text-text-muted block mb-1">Port Override (Optional)</label>
                                            <input
                                                type="number"
                                                placeholder="Defaults to profile"
                                                value={portOverride}
                                                onChange={(e) => setPortOverride(e.target.value)}
                                                className="w-full px-3 py-1.5 bg-card border border-border rounded-xl text-xs text-text-primary focus:outline-none focus:border-indigo-500 font-mono"
                                            />
                                        </div>

                                        {/* Auto-discovered active server banner */}
                                        {targetIp && targetIp.trim().length >= 7 && (
                                            <div className="sm:col-span-3 pt-0.5">
                                                {discoveredServer?.active ? (
                                                    <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-emerald-300">
                                                        <div className="flex items-center gap-1.5">
                                                            <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                                                            <span>
                                                                Serveur Stigix actif détecté sur <strong>{targetIp}</strong> : en écoute sur le port <strong>{discoveredServer.port}</strong>.
                                                            </span>
                                                        </div>
                                                        {portOverride !== String(discoveredServer.port) && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setPortOverride(String(discoveredServer.port))}
                                                                className="px-2.5 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 rounded-lg font-semibold text-[10px] cursor-pointer shrink-0"
                                                            >
                                                                ⚡ Aligner sur port {discoveredServer.port}
                                                            </button>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="p-2 bg-muted/30 border border-border/60 rounded-xl flex items-center gap-1.5 text-[10px] text-text-muted">
                                                        <Activity size={12} className="text-text-muted shrink-0" />
                                                        <span>Aucun serveur PCAP Replay n'a été détecté en écoute sur {targetIp}. Démarrez d'abord le mode Serveur sur la machine cible.</span>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {currentProf?.primary_flow?.server_port === 8443 && !portOverride && (
                                    <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-amber-300">
                                        <div className="flex items-center gap-1.5">
                                            <AlertTriangle size={13} className="text-amber-400 shrink-0" />
                                            <span>
                                                <strong>Conflit Port 8443 :</strong> Ce port est utilisé par Stigix Custom Apps sur DC1. Utilisez le port alternatif <strong>18443</strong> sur le Serveur et le Client.
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setPortOverride('18443')}
                                            className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 rounded-lg font-semibold text-[10px] cursor-pointer shrink-0"
                                        >
                                            ⚡ Utiliser 18443
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* IP Mapping & Flow Translation Card */}
                            {currentProf && (
                                <div className="p-3.5 bg-muted/20 border border-border/80 rounded-2xl space-y-2.5 text-xs">
                                    <div className="flex items-center justify-between">
                                        <span className="font-semibold text-text-primary flex items-center gap-1.5">
                                            <Layers size={13} className="text-indigo-400" />
                                            <span>Profil Sélectionné : {currentProf.name || currentProf.file_name}</span>
                                        </span>
                                        <span className="text-[10px] text-text-muted">
                                            {currentProf.total_turns || 0} tours L7 • Catégorie : <span className="uppercase font-semibold text-indigo-400">{currentProf.category || 'custom'}</span>
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                                        <div className="p-2.5 bg-card/60 border border-border/60 rounded-xl">
                                            <div className="text-[10px] uppercase font-bold text-text-muted mb-1">
                                                Capture PCAP Originale (L7)
                                            </div>
                                            <div className="font-mono text-text-secondary truncate">
                                                {currentProf.primary_flow?.client_endpoint || 'Client'} ➔ {currentProf.primary_flow?.server_endpoint || 'Serveur'}
                                            </div>
                                            <div className="text-[10px] text-text-muted mt-1">
                                                Adresses historiques de la capture (non injectées sur le réseau).
                                            </div>
                                        </div>

                                        <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
                                            <div className="text-[10px] uppercase font-bold text-indigo-400 mb-1">
                                                Flux Réseau Réel (L3/L4 Routed)
                                            </div>
                                            <div className="font-mono text-text-primary font-bold truncate">
                                                {replayRole === 'client'
                                                    ? `Client Local ➔ ${targetIp || '192.168.203.100'}:${portOverride || currentProf.primary_flow?.server_port || 8080}`
                                                    : `0.0.0.0:${portOverride || currentProf.primary_flow?.server_port || 8080} (Serveur Écoute)`
                                                }
                                            </div>
                                            <div className="text-[10px] text-indigo-300/80 mt-1">
                                                {replayRole === 'client'
                                                    ? `Vraie connexion TCP établie vers la cible.`
                                                    : `En attente d'une connexion TCP réelle.`}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="text-[10px] text-text-muted flex items-center gap-1.5 px-1">
                                        <Globe size={11} className="text-indigo-400 shrink-0" />
                                        <span>
                                            <strong>Remplacement IP :</strong> Les paquets utilisent vos vraies IP réseau. Seuls les octets applicatifs L7 sont rejoués à l'identique pour déclencher les signatures (App-ID / Menaces).
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* Runner control and status */}
                            <div className="p-4 bg-muted/20 border border-border rounded-2xl space-y-4">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Activity size={16} className={activeJob?.status === 'running' ? 'text-emerald-400 animate-pulse' : 'text-text-muted'} />
                                        <span className="text-xs font-bold text-text-primary">
                                            Live Execution Telemetry
                                        </span>
                                        {activeJob?.status && (
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                                activeJob.status === 'running' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                                activeJob.status === 'completed' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' :
                                                'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                            }`}>
                                                {activeJob.status}
                                            </span>
                                        )}
                                        {activeJob?.lastVerdict && (
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                                activeJob.lastVerdict === 'Bypass' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                                                activeJob.lastVerdict.startsWith('Enforced') ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                                'bg-muted text-text-muted border border-border'
                                            }`}>
                                                Verdict: {activeJob.lastVerdict}
                                            </span>
                                        )}
                                    </div>

                                    {activeJob?.status === 'running' ? (
                                        <button
                                            onClick={handleStopReplay}
                                            className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl shadow-sm flex items-center gap-1.5 cursor-pointer"
                                        >
                                            <Square size={13} /> Stop Replay
                                        </button>
                                    ) : (
                                        <button
                                            onClick={handleStartReplay}
                                            disabled={isStartingReplay || !selectedProfile}
                                            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-sm flex items-center gap-1.5 cursor-pointer"
                                        >
                                            <Play size={13} /> Start Replay
                                        </button>
                                    )}
                                </div>

                                {/* Active Live Connection Badge */}
                                {connectedEv && (
                                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl space-y-1">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                                                <CheckCircle2 size={14} className="text-emerald-400" />
                                                Connexion Réseau Réelle Établie (L3/L4)
                                            </span>
                                            <span className="text-[10px] font-mono text-emerald-300">RTT: {connectedEv.handshake_rtt_ms} ms</span>
                                        </div>
                                        <div className="flex items-center gap-2 font-mono text-xs text-text-primary">
                                            <span className="font-bold text-emerald-300">{connectedEv.local_ip}:{connectedEv.local_port}</span>
                                            <span className="text-text-muted">➔</span>
                                            <span className="font-bold text-indigo-300">{connectedEv.target_ip}:{connectedEv.target_port}</span>
                                        </div>
                                        <div className="text-[10px] text-text-muted flex items-center gap-1 flex-wrap">
                                            <span>Remplacement IP effectué :</span>
                                            <span className="font-mono line-through opacity-70">{connectedEv.pcap_original_src} ➔ {connectedEv.pcap_original_dst}</span>
                                            <span className="text-emerald-400 font-semibold">remplacé par les adresses réseau réelles ci-dessus.</span>
                                        </div>
                                    </div>
                                )}

                                {serverStartedEv && (
                                    <div className="p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl space-y-1">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="font-bold text-indigo-400 flex items-center gap-1.5">
                                                <Activity size={14} className="animate-pulse" />
                                                Session Rejeu Serveur Active
                                            </span>
                                            <span className="text-[10px] font-mono text-text-muted">{serverStartedEv.total_turns} tours prévus</span>
                                        </div>
                                        <div className="flex items-center gap-2 font-mono text-xs text-text-primary">
                                            <span className="text-text-muted">Client distant :</span>
                                            <span className="font-bold text-emerald-300">{serverStartedEv.client_ip}:{serverStartedEv.client_port}</span>
                                            <span className="text-text-muted">➔ Port local :</span>
                                            <span className="font-bold text-indigo-300">{serverStartedEv.server_port}</span>
                                        </div>
                                    </div>
                                )}

                                {/* Event Logs */}
                                <div className="bg-black/60 border border-border/80 rounded-xl p-3 font-mono text-[11px] h-44 overflow-y-auto space-y-1">
                                    {(!activeJob?.recentEvents || activeJob.recentEvents.length === 0) ? (
                                        <div className="text-text-muted/60 italic py-8 text-center flex flex-col items-center justify-center gap-2">
                                            {activeJob?.status === 'running' ? (
                                                <>
                                                    <RefreshCw size={16} className="animate-spin text-indigo-400" />
                                                    <span>Établissement de la connexion vers {activeJob.target || 'serveur'}:{activeJob.port || 'port par défaut'}...</span>
                                                </>
                                            ) : (
                                                <span>Aucun rejeu actif. Cliquez sur "Start Replay" pour lancer la séquence.</span>
                                            )}
                                        </div>
                                    ) : (
                                        activeJob.recentEvents.map((ev: any, idx: number) => (
                                            <div key={idx} className="flex gap-2">
                                                <span className="text-text-muted">[{new Date(ev.timestamp * 1000).toLocaleTimeString()}]</span>
                                                <span className="text-indigo-400 font-semibold">{ev.event}:</span>
                                                <span className="text-text-primary">
                                                    {ev.error ? <span className="text-rose-400 font-bold">{ev.error}</span> :
                                                     ev.verdict ? <span className="text-emerald-400 font-bold">Verdict ➔ {ev.verdict} ({ev.duration_ms}ms)</span> :
                                                     ev.event === 'client_connected' ? <span className="text-emerald-300 font-semibold">Socket Connected: {ev.local_ip}:{ev.local_port} ➔ {ev.target_ip}:{ev.target_port} (RTT {ev.handshake_rtt_ms}ms)</span> :
                                                     ev.event === 'session_started' ? <span className="text-indigo-300 font-semibold">Client Connected: {ev.client_ip}:{ev.client_port} ➔ Port {ev.server_port}</span> :
                                                     ev.event === 'server_listening' ? <span className="text-indigo-300 font-semibold">Listening on {ev.bind_ip}:{ev.port}</span> :
                                                     ev.event === 'port_fallback' ? <span className="text-amber-400 font-semibold">{ev.reason}</span> :
                                                     ev.text ? <span className="text-indigo-300">{ev.text}</span> :
                                                     ev.sender ? `Turn #${ev.seq} (${ev.sender}) - ${ev.bytes}B in ${ev.duration_ms}ms` :
                                                     JSON.stringify(ev)}
                                                </span>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                        );
                    })()}
                </div>
            </div>
        </div>
    );
};
