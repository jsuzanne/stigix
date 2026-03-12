import React, { useState, useEffect } from 'react';
import { Cloud, Zap, Download, ShieldAlert, Info, Globe, AlertTriangle, CheckCircle, XCircle, Loader2, ArrowRight, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';

interface TargetScenario {
    id: string;
    label: string;
    description: string;
    path: string;
    params?: Record<string, string | number>;
    category: 'info' | 'saas' | 'download' | 'security' | 'error';
    signedUrl: string;
}

interface CloudTargetProps {
    token: string | null;
}

export default function CloudTarget({ token }: CloudTargetProps) {
    const [scenarios, setScenarios] = useState<TargetScenario[]>([]);
    const [loading, setLoading] = useState(true);
    const [results, setResults] = useState<Record<string, any>>({});
    const [executing, setExecuting] = useState<Record<string, boolean>>({});
    const [useProxy, setUseProxy] = useState(false);

    useEffect(() => {
        fetchScenarios();
    }, []);

    const fetchScenarios = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/target/scenarios', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setScenarios(data);
            }
        } catch (error) {
            toast.error('Failed to load target scenarios');
        } finally {
            setLoading(false);
        }
    };

    const executeScenario = async (scenario: TargetScenario) => {
        const id = scenario.id;
        setExecuting(prev => ({ ...prev, [id]: true }));
        setResults(prev => ({ ...prev, [id]: null }));

        const startTime = Date.now();
        const urlOrProxy = useProxy
            ? `/api/target/proxy${scenario.path}${scenario.params ? '?' + new URLSearchParams(scenario.params as any).toString() : ''}`
            : scenario.signedUrl;

        try {
            const res = await fetch(urlOrProxy, {
                headers: useProxy ? { 'Authorization': `Bearer ${token}` } : {}
            });

            const duration = Date.now() - startTime;

            if (scenario.id === 'security-eicar') {
                if (res.status === 200) {
                    const text = await res.text();
                    if (text.includes('EICAR')) {
                        setResults(prev => ({ ...prev, [id]: { status: 'FAILED', message: 'Malware file downloaded! Security policy not blocking.', duration } }));
                        toast.error('Security alert: EICAR downloaded!');
                    } else {
                        setResults(prev => ({ ...prev, [id]: { status: 'BLOCKED', message: 'Connection established but content was sanitized.', duration } }));
                    }
                } else {
                    setResults(prev => ({ ...prev, [id]: { status: 'SUCCESS', message: `Blocked (HTTP ${res.status})`, duration } }));
                    toast.success('Security test passed: EICAR blocked.');
                }
                return;
            }

            if (scenario.category === 'download') {
                // For large downloads, we just check completion
                await res.blob();
                setResults(prev => ({ ...prev, [id]: { status: 'OK', duration, message: `Download complete (${scenario.params?.size || 'unknown size'})` } }));
            } else {
                const data = await res.json();
                setResults(prev => ({ ...prev, [id]: { ...data, _duration: duration } }));
            }

            if (res.ok) toast.success(`${scenario.label} complete`);
            else toast.error(`${scenario.label} failed (HTTP ${res.status})`);

        } catch (error: any) {
            const duration = Date.now() - startTime;
            if (scenario.id === 'security-eicar') {
                setResults(prev => ({ ...prev, [id]: { status: 'SUCCESS', message: 'Blocked (Network Error/Reset)', duration } }));
                toast.success('Security test passed: Connection reset.');
            } else {
                setResults(prev => ({ ...prev, [id]: { error: error.message, _duration: duration } }));
                toast.error(`Error: ${error.message}`);
            }
        } finally {
            setExecuting(prev => ({ ...prev, [id]: false }));
        }
    };

    const getIcon = (category: string) => {
        switch (category) {
            case 'info': return <Globe size={20} />;
            case 'saas': return <Zap size={20} />;
            case 'download': return <Download size={20} />;
            case 'security': return <ShieldAlert size={20} />;
            case 'error': return <AlertTriangle size={20} />;
            default: return <Info size={20} />;
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center p-20 text-text-muted">
                <Loader2 className="animate-spin mb-4" size={48} />
                <p className="text-xl font-medium">Loading Cloud Scenarios...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-black tracking-tight text-text-primary flex items-center gap-3">
                        <Cloud className="text-blue-500" />
                        Cloud Target Integration
                    </h2>
                    <p className="text-text-muted text-sm mt-1">
                        Programmable egress points for SaaS performance and SASE security validation.
                    </p>
                </div>

                <div className="flex items-center gap-4 bg-card-secondary/50 p-1 rounded-xl border border-border">
                    <button
                        onClick={() => setUseProxy(false)}
                        className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${!useProxy ? 'bg-blue-600 text-white shadow-lg' : 'text-text-muted hover:text-text-primary'}`}
                    >
                        Direct Egress
                    </button>
                    <button
                        onClick={() => setUseProxy(true)}
                        className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${useProxy ? 'bg-purple-600 text-white shadow-lg' : 'text-text-muted hover:text-text-primary'}`}
                    >
                        Backend Proxy
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {scenarios.map(scenario => {
                    const result = results[scenario.id];
                    const isRunning = executing[scenario.id];

                    return (
                        <div key={scenario.id} className="bg-card border border-border rounded-2xl p-6 shadow-sm hover:shadow-md transition-all flex flex-col group">
                            <div className="flex items-start justify-between mb-4">
                                <div className={`p-3 rounded-xl border ${scenario.category === 'security' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                                        scenario.category === 'saas' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' :
                                            scenario.category === 'download' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                                'bg-blue-500/10 text-blue-500 border-blue-500/20'
                                    }`}>
                                    {getIcon(scenario.category)}
                                </div>
                                <button
                                    onClick={() => executeScenario(scenario)}
                                    disabled={isRunning}
                                    className="p-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed group-hover:scale-110 duration-200"
                                >
                                    {isRunning ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} fill="currentColor" />}
                                </button>
                            </div>

                            <h3 className="font-bold text-text-primary mb-1">{scenario.label}</h3>
                            <p className="text-text-muted text-xs leading-relaxed mb-4 flex-grow">
                                {scenario.description}
                                {scenario.params && (
                                    <span className="block mt-2 font-mono text-[10px] bg-card-secondary p-1 rounded">
                                        params: {JSON.stringify(scenario.params)}
                                    </span>
                                )}
                            </p>

                            {result && (
                                <div className="mt-4 p-4 rounded-xl bg-card-secondary border border-border animate-in slide-in-from-top-2">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-text-muted">Result</span>
                                        <span className="text-[10px] font-mono font-bold text-blue-400">{result._duration || result.duration}ms</span>
                                    </div>

                                    {scenario.category === 'info' && result.ip ? (
                                        <div className="space-y-1 text-xs">
                                            <div className="flex justify-between"><span className="text-text-muted">IP</span> <span className="font-bold text-blue-400">{result.ip}</span></div>
                                            <div className="flex justify-between"><span className="text-text-muted">ASN</span> <span className="font-medium">{result.asOrganization || result.asn}</span></div>
                                            <div className="flex justify-between"><span className="text-text-muted">City</span> <span className="font-medium">{result.city}, {result.country}</span></div>
                                        </div>
                                    ) : scenario.id === 'security-eicar' ? (
                                        <div className="flex items-center gap-2">
                                            {result.status === 'SUCCESS' ? <CheckCircle className="text-green-500" size={16} /> : <XCircle className="text-red-500" size={16} />}
                                            <span className={`text-xs font-bold ${result.status === 'SUCCESS' ? 'text-green-500' : 'text-red-500'}`}>
                                                {result.message}
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="text-xs text-text-primary font-medium line-clamp-2">
                                            {result.message || JSON.stringify(result).substring(0, 100)}
                                        </div>
                                    )}
                                </div>
                            )}

                            {!useProxy && scenario.signedUrl && (
                                <a
                                    href={scenario.signedUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-4 flex items-center justify-center gap-2 text-[10px] font-bold text-text-muted hover:text-blue-400 transition-colors py-2 border border-dashed border-border rounded-lg"
                                >
                                    Open Direct Link <ExternalLink size={12} />
                                </a>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="mt-8 p-6 bg-blue-600/5 border border-blue-500/20 rounded-2xl flex items-start gap-4">
                <Info className="text-blue-500 shrink-0" size={24} />
                <div className="space-y-2">
                    <h4 className="font-bold text-text-primary">Why use Direct vs Proxy?</h4>
                    <p className="text-sm text-text-muted leading-relaxed">
                        <strong className="text-blue-400 text-xs uppercase tracking-tight">Direct Egress:</strong> The request is sent from your browser. This measurements exactly what is happening
                        over the SD-WAN or SASE client tunnel on your workstation. It is the gold standard for validating QoS and path selection policies.
                    </p>
                    <p className="text-sm text-text-muted leading-relaxed">
                        <strong className="text-purple-400 text-xs uppercase tracking-tight">Backend Proxy:</strong> The request is sent from the Stigix server container. Useful if your workstation
                        has local firewall restrictions or if you want to test the egress of the branch site itself.
                    </p>
                </div>
            </div>
        </div>
    );
}

