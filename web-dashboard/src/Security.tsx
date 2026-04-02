import React, { useState, useEffect } from 'react';
import { Shield, Play, AlertTriangle, CheckCircle, XCircle, Clock, Download, Trash2, ChevronDown, ChevronUp, Copy, Filter, Link, Upload, RefreshCcw, ShieldAlert, Globe, ListTree, RefreshCw, MoreVertical, Settings, Database, Server, Info, Search, History as HistoryIcon, Zap, ChevronRight } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { clsx, type ClassValue } from 'clsx';
import { URL_CATEGORIES, DNS_TEST_DOMAINS } from '../shared/security-categories';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface SecurityProps {
    token: string;
}

interface TestResult {
    testId?: number;
    timestamp: number;
    testType: string;
    testName: string;
    result: any;
}

interface SecurityConfig {
    url_filtering: {
        enabled_categories: string[];
        protocol: 'http' | 'https';
    };
    dns_security: {
        enabled_tests: string[];
    };
    threat_prevention: {
        enabled: boolean;
        eicar_endpoint: string;
        eicar_endpoints?: string[];
    };
    scheduled_execution?: {
        url: { enabled: boolean; interval_minutes: number; last_run_time?: number | null; next_run_time?: number | null };
        dns: { enabled: boolean; interval_minutes: number; last_run_time?: number | null; next_run_time?: number | null };
        threat: { enabled: boolean; interval_minutes: number; last_run_time?: number | null; next_run_time?: number | null };
    };
    statistics?: {
        total_tests_run: number;
        url_tests_blocked: number;
        url_tests_allowed: number;
        dns_tests_blocked: number;
        dns_tests_sinkholed: number;
        dns_tests_allowed: number;
        threat_tests_blocked: number;
        threat_tests_allowed: number;
        last_test_time: number | null;
    };
    test_history: TestResult[];
    edlTesting: {
        ipList: { remoteUrl: string | null; lastSyncTime: number; elementsCount?: number };
        urlList: { remoteUrl: string | null; lastSyncTime: number; elementsCount?: number };
        dnsList: { remoteUrl: string | null; lastSyncTime: number; elementsCount?: number };
        testMode: 'sequential' | 'random';
        randomSampleSize: number;
        maxElementsPerRun: number;
    };
}

// Sub-component for scheduler settings to avoid unmounting on parent re-render
const SchedulerSettings = ({
    type,
    title,
    config,
    onUpdate
}: {
    type: 'url' | 'dns' | 'threat',
    title: string,
    config: SecurityConfig | null,
    onUpdate: (type: 'url' | 'dns' | 'threat', enabled: boolean, minutes: number) => Promise<void>
}) => {
    if (!config?.scheduled_execution) return null;

    // Robustness: ensure we have the expected structure
    const schedule = (config.scheduled_execution as any)[type] || { enabled: false, interval_minutes: 15 };

    const formatTime = (ts: number | null | undefined) => {
        if (!ts) return null;
        return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-4 bg-card-secondary p-2 rounded-lg border border-border">
                <div className="flex items-center gap-2">
                    <Clock size={14} className={schedule.enabled ? "text-blue-600 dark:text-blue-400" : "text-text-muted"} />
                    <span className="text-xs font-bold text-text-muted tracking-tight">{title} Schedule:</span>
                </div>

                <div className="flex items-center gap-2">
                    <select
                        value={schedule.interval_minutes}
                        onChange={(e) => onUpdate(type, schedule.enabled, parseInt(e.target.value))}
                        disabled={!schedule.enabled}
                        className="bg-card border-border text-text-primary text-[10px] rounded p-0.5 focus:ring-1 focus:ring-blue-500 outline-none disabled:opacity-50 font-bold"
                    >
                        {[5, 10, 15, 30, 45, 60].map(m => (
                            <option key={m} value={m}>{m}m</option>
                        ))}
                    </select>

                    <button
                        onClick={() => onUpdate(type, !schedule.enabled, schedule.interval_minutes)}
                        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-all focus:outline-none shadow-inner ${schedule.enabled ? 'bg-blue-600' : 'bg-card'}`}
                    >
                        <span className={`inline-block h-2 w-2 transform rounded-full bg-white transition-transform shadow-sm ${schedule.enabled ? 'translate-x-4' : 'translate-x-1'}`} />
                    </button>
                </div>
            </div>
            {schedule.enabled && schedule.next_run_time && (
                <div className="flex items-center gap-1 text-[9px] text-blue-600 dark:text-blue-400 font-black tracking-widest px-2 opacity-80">
                    <Clock size={10} />
                    Next test at {formatTime(schedule.next_run_time)}
                </div>
            )}
        </div>
    );
};

export default function Security({ token }: SecurityProps) {
    const [config, setConfig] = useState<SecurityConfig | null>(null);
    const [testResults, setTestResults] = useState<TestResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [batchProcessingUrl, setBatchProcessingUrl] = useState(false);
    const [batchProcessingDns, setBatchProcessingDns] = useState(false);
    const [testing, setTesting] = useState<{ [key: string]: boolean }>({});
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

    // Collapsible sections
    const [urlExpanded, setUrlExpanded] = useState(true);
    const [dnsExpanded, setDnsExpanded] = useState(true);
    const [threatExpanded, setThreatExpanded] = useState(true);
    const [edlExpanded, setEdlExpanded] = useState(true);
    const [resultsExpanded, setResultsExpanded] = useState(true);

    const [edlResults, setEdlResults] = useState<{ [key: string]: { results: any[], summary?: any } }>({
        ip: { results: [] },
        url: { results: [] },
        dns: { results: [] }
    });
    const [edlSyncing, setEdlSyncing] = useState<{ [key: string]: boolean }>({});
    const [edlTestingState, setEdlTestingState] = useState<{ [key: string]: boolean }>({});

    // Test results filter
    const [testTypeFilter, setTestTypeFilter] = useState<'all' | 'url_filtering' | 'dns_security' | 'threat_prevention'>('all');

    // Search and pagination
    const [searchQuery, setSearchQuery] = useState('');
    const [totalResults, setTotalResults] = useState(0);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);

    // Detailed log viewer
    const [selectedTest, setSelectedTest] = useState<any>(null);
    const [showDetailModal, setShowDetailModal] = useState(false);
    const [modalSearchQuery, setModalSearchQuery] = useState('');

    // System health
    const [systemHealth, setSystemHealth] = useState<any>(null);


    // EICAR endpoint input
    const [eicarEndpoint, setEicarEndpoint] = useState('');
    const [securityTargets, setSecurityTargets] = useState<any[]>([]);

    const authHeaders = () => ({ 'Authorization': `Bearer ${token}` });

    const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

    const copyToClipboard = (text: string) => {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => {
                showToast('Command copied to clipboard!', 'success');
            }).catch(() => {
                fallbackCopyTextToClipboard(text);
            });
        } else {
            fallbackCopyTextToClipboard(text);
        }
    };

    const fallbackCopyTextToClipboard = (text: string) => {
        const textArea = document.createElement("textarea");
        textArea.value = text;

        // Ensure the textarea is not visible
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);

        textArea.focus();
        textArea.select();

        try {
            const successful = document.execCommand('copy');
            if (successful) {
                showToast('Command copied to clipboard!', 'success');
            } else {
                showToast('Failed to copy command', 'error');
            }
        } catch (err) {
            showToast('Failed to copy command', 'error');
        }

        document.body.removeChild(textArea);
    };

    // Load configuration and start polling
    useEffect(() => {
        fetchConfig();
        fetchResults();
        fetchHealth();
        // Fetch shared targets with security capability
        fetch('/api/targets', { headers: authHeaders() })
            .then(r => r.json())
            .then(data => setSecurityTargets((Array.isArray(data) ? data : []).filter((t: any) => t.enabled && t.capabilities?.security)))
            .catch(() => { });

        // Background polling for statistics (refreshes counters from scheduled tests)
        const pollInterval = setInterval(() => {
            fetchConfig();
            fetchHealth();
        }, 30000); // 30 seconds

        return () => clearInterval(pollInterval);
    }, []);

    // Initialize eicarEndpoint from config only once
    const eicarInitialized = React.useRef(false);
    useEffect(() => {
        if (config?.threat_prevention?.eicar_endpoint && !eicarInitialized.current) {
            setEicarEndpoint(config.threat_prevention.eicar_endpoint);
            eicarInitialized.current = true;
        }
    }, [config]);

    const fetchHealth = async () => {
        try {
            const res = await fetch('/api/system/health', { headers: authHeaders() });
            const data = await res.json();
            setSystemHealth(data);
        } catch (e) {
            console.error('Failed to fetch system health:', e);
        }
    };


    const fetchConfig = async () => {
        try {
            const res = await fetch('/api/security/config', { headers: authHeaders() });
            if (!res.ok) {
                console.error(`Failed to fetch security config: ${res.status} ${res.statusText}`);
                return;
            }
            const data = await res.json();

            if (!data) {
                console.error('Security config data is empty');
                return;
            }

            // Ensure scheduled_execution has the new structure if it's from an old config
            if (data.scheduled_execution) {
                if (typeof data.scheduled_execution !== 'object' || !data.scheduled_execution.url) {
                    console.log('Migrating scheduled_execution in frontend...');
                    data.scheduled_execution = {
                        url: data.scheduled_execution?.url || { enabled: false, interval_minutes: 15 },
                        dns: data.scheduled_execution?.dns || { enabled: false, interval_minutes: 15 },
                        threat: data.scheduled_execution?.threat || { enabled: false, interval_minutes: 30 }
                    };
                }
            } else {
                data.scheduled_execution = {
                    url: { enabled: false, interval_minutes: 15 },
                    dns: { enabled: false, interval_minutes: 15 },
                    threat: { enabled: false, interval_minutes: 30 }
                };
            }

            setConfig(data);

        } catch (e) {
            console.error('Failed to fetch security config:', e);
        }
    };

    const updateSchedule = async (type: 'url' | 'dns' | 'threat', enabled: boolean, minutes: number) => {
        if (!config) return;

        const newConfig = { ...config };
        if (!newConfig.scheduled_execution) {
            newConfig.scheduled_execution = {
                url: { enabled: false, interval_minutes: 15 },
                dns: { enabled: false, interval_minutes: 15 },
                threat: { enabled: false, interval_minutes: 30 }
            };
        }

        newConfig.scheduled_execution[type] = { enabled, interval_minutes: minutes };

        try {
            const res = await fetch('/api/security/config', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(newConfig)
            });
            const data = await res.json();
            if (data.success) {
                setConfig(data.config);
                showToast(`${type.toUpperCase()} test schedule updated`, 'success');
            }
        } catch (e) {
            showToast('Failed to update schedule', 'error');
        }
    };


    const fetchResults = async (offset = 0, append = false) => {
        try {
            const params = new URLSearchParams({
                limit: '50',
                offset: offset.toString(),
                ...(searchQuery && { search: searchQuery }),
                ...(testTypeFilter !== 'all' && { type: testTypeFilter })
            });

            const res = await fetch(`/api/security/results?${params}`, { headers: authHeaders() });
            const data = await res.json();

            // Map id to testId for frontend compatibility
            const mappedResults = (data.results || []).map((r: any) => ({
                ...r,
                testId: r.id,
                testType: r.type,
                testName: r.name,
                result: { status: r.status } // For getStatusBadge compatibility
            }));

            if (append) {
                setTestResults(prev => [...prev, ...mappedResults]);
            } else {
                setTestResults(mappedResults);
            }

            setTotalResults(data.total || 0);
            setHasMore((data.results?.length || 0) === 50);
        } catch (e) {
            console.error('Failed to fetch test results:', e);
        }
    };

    const loadMore = async () => {
        if (loadingMore || !hasMore) return;
        setLoadingMore(true);
        await fetchResults(testResults.length, true);
        setLoadingMore(false);
    };

    const handleSearch = (query: string) => {
        setSearchQuery(query);
        setTestResults([]);
    };

    // Debounced search effect
    useEffect(() => {
        const timer = setTimeout(() => {
            fetchResults(0, false);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery, testTypeFilter]);

    const viewTestDetails = async (testId: number) => {
        setModalSearchQuery('');
        try {
            const response = await fetch(`/api/security/results/${testId}`, {
                headers: authHeaders()
            });
            const data = await response.json();
            setSelectedTest(data);
            setShowDetailModal(true);
        } catch (e) {
            console.error('Failed to fetch test details:', e);
            showToast('Failed to load test details', 'error');
        }
    };

    const saveConfig = async (newConfig: Partial<SecurityConfig>) => {
        try {
            const res = await fetch('/api/security/config', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(newConfig)
            });
            const data = await res.json();
            if (data.success) {
                setConfig(data.config);
            }
        } catch (e) {
            console.error('Failed to save config:', e);
        }
    };

    const toggleURLCategory = (categoryId: string) => {
        if (!config) return;
        const enabled = config.url_filtering.enabled_categories;
        const newEnabled = enabled.includes(categoryId)
            ? enabled.filter(id => id !== categoryId)
            : [...enabled, categoryId];

        saveConfig({
            url_filtering: { ...config.url_filtering, enabled_categories: newEnabled }
        });
    };

    const toggleDNSTest = (testId: string) => {
        if (!config) return;
        const enabled = config.dns_security.enabled_tests;
        const newEnabled = enabled.includes(testId)
            ? enabled.filter(id => id !== testId)
            : [...enabled, testId];

        saveConfig({
            dns_security: { ...config.dns_security, enabled_tests: newEnabled }
        });
    };

    const toggleAllURLCategories = () => {
        if (!config) return;
        const allIds = URL_CATEGORIES.map(cat => cat.id);
        const allEnabled = config.url_filtering.enabled_categories.length === allIds.length;

        saveConfig({
            url_filtering: { ...config.url_filtering, enabled_categories: allEnabled ? [] : allIds }
        });
    };

    const toggleAllDNSTests = () => {
        if (!config) return;
        const allIds = DNS_TEST_DOMAINS.map(test => test.id);
        const allEnabled = config.dns_security.enabled_tests.length === allIds.length;

        saveConfig({
            dns_security: { ...config.dns_security, enabled_tests: allEnabled ? [] : allIds }
        });
    };

    const runURLTest = async (category: typeof URL_CATEGORIES[0]) => {
        setTesting({ ...testing, [`url-${category.id}`]: true });
        try {
            const res = await fetch('/api/security/url-test', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: category.url, category: category.name })
            });
            const result = await res.json();
            await fetchResults();
            await fetchConfig();
        } catch (e) {
            console.error('URL test failed:', e);
        } finally {
            setTesting({ ...testing, [`url-${category.id}`]: false });
        }
    };

    const runURLBatchTest = async () => {
        if (!config || batchProcessingUrl) return;
        setBatchProcessingUrl(true);
        showToast(`Running ${config.url_filtering.enabled_categories.length} URL filtering tests...`, 'info');
        try {
            const enabledCategories = URL_CATEGORIES.filter(cat =>
                config.url_filtering.enabled_categories.includes(cat.id)
            );

            const tests = enabledCategories.map(cat => ({ url: cat.url, category: cat.name }));

            await fetch('/api/security/url-test-batch', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ tests })
            });
            await fetchResults();
            await fetchConfig();
            showToast('URL filtering tests completed!', 'success');
        } catch (e) {
            console.error('Batch URL test failed:', e);
            showToast('URL filtering tests failed', 'error');
        } finally {
            setBatchProcessingUrl(false);
        }
    };

    const runDNSTest = async (test: typeof DNS_TEST_DOMAINS[0]) => {
        setTesting({ ...testing, [`dns-${test.id}`]: true });
        try {
            const res = await fetch('/api/security/dns-test', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain: test.domain, testName: test.name })
            });
            await fetchResults();
            await fetchConfig();
        } catch (e) {
            console.error('DNS test failed:', e);
        } finally {
            setTesting({ ...testing, [`dns-${test.id}`]: false });
        }
    };

    const runDNSBatchTest = async () => {
        if (!config || batchProcessingDns) return;
        setBatchProcessingDns(true);
        showToast(`Running ${config.dns_security.enabled_tests.length} DNS security tests...`, 'info');
        try {
            const enabledTests = DNS_TEST_DOMAINS.filter(test =>
                config.dns_security.enabled_tests.includes(test.id)
            );

            const tests = enabledTests.map(test => ({ domain: test.domain, testName: test.name }));

            await fetch('/api/security/dns-test-batch', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ tests })
            });
            await fetchResults();
            await fetchConfig();
            showToast('DNS security tests completed!', 'success');
        } catch (e) {
            console.error('Batch DNS test failed:', e);
            showToast('DNS security tests failed', 'error');
        } finally {
            setBatchProcessingDns(false);
        }
    };

    const runThreatTest = async () => {
        setLoading(true);
        showToast('Running EICAR threat test...', 'info');
        try {
            const res = await fetch('/api/security/threat-test', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: eicarEndpoint })
            });
            await fetchResults();
            await fetchConfig();
            showToast('EICAR threat test completed!', 'success');

            // Save endpoint to config
            if (config) {
                saveConfig({
                    threat_prevention: { ...config.threat_prevention, eicar_endpoint: eicarEndpoint }
                });
            }
        } catch (e) {
            console.error('Threat test failed:', e);
        } finally {
            setLoading(false);
        }
    };

    const syncEdl = async (type: 'ip' | 'url' | 'dns') => {
        setEdlSyncing(prev => ({ ...prev, [type]: true }));
        try {
            const res = await fetch('/api/security/edl-sync', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ type })
            });
            const data = await res.json();
            if (data.success) {
                showToast(`EDL ${type.toUpperCase()} synced: ${data.elementsCount} elements`, 'success');
                fetchConfig(); // Refresh counts
            } else {
                showToast(data.message || 'Sync failed', 'error');
            }
        } catch (e) {
            showToast('Sync failed', 'error');
        } finally {
            setEdlSyncing(prev => ({ ...prev, [type]: false }));
        }
    };

    const uploadEdl = async (type: 'ip' | 'url' | 'dns', file: File) => {
        const formData = new FormData();
        formData.append('type', type);
        formData.append('file', file);

        setEdlSyncing(prev => ({ ...prev, [type]: true }));
        try {
            const res = await fetch('/api/security/edl-upload', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }, // No content-type for FormData
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                showToast(`EDL ${type.toUpperCase()} uploaded: ${data.elementsCount} elements`, 'success');
                fetchConfig(); // Refresh counts
            } else {
                showToast(data.message || 'Upload failed', 'error');
            }
        } catch (e) {
            showToast('Upload failed', 'error');
        } finally {
            setEdlSyncing(prev => ({ ...prev, [type]: false }));
        }
    };

    const updateEdlConfig = async (updates: any) => {
        try {
            const res = await fetch('/api/security/edl-config', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            const data = await res.json();
            if (data.success) {
                showToast('EDL configuration saved', 'success');
                fetchConfig();
            }
        } catch (e) {
            showToast('Failed to save EDL config', 'error');
        }
    };

    const runEdlTest = async (type: 'ip' | 'url' | 'dns') => {
        setEdlTestingState(prev => ({ ...prev, [type]: true }));
        try {
            const res = await fetch('/api/security/edl-test', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ type })
            });
            const data = await res.json();
            if (data.success) {
                setEdlResults(prev => ({
                    ...prev,
                    [type]: {
                        results: data.results || [],
                        summary: {
                            testedCount: data.testedCount,
                            allowedCount: data.allowedCount,
                            blockedCount: data.blockedCount,
                            errorCount: data.errorCount,
                            successRate: data.successRate
                        }
                    }
                }));
                const summary = `${data.testedCount} tested – ${data.allowedCount} allowed, ${data.blockedCount} blocked (${(data.successRate * 100).toFixed(0)}% OK)`;
                showToast(`EDL ${type.toUpperCase()} test completed: ${summary}`, 'success');
                fetchResults(); // Update global log
            } else {
                showToast(data.error || 'Test failed', 'error');
            }
        } catch (e) {
            showToast('Test failed', 'error');
        } finally {
            setEdlTestingState(prev => ({ ...prev, [type]: false }));
        }
    };

    const clearHistory = async () => {
        if (!confirm('Clear all test history?')) return;
        try {
            await fetch('/api/security/results', {
                method: 'DELETE',
                headers: authHeaders()
            });
            setTestResults([]);
        } catch (e) {
            console.error('Failed to clear history:', e);
        }
    };

    const resetCounters = async () => {
        if (!confirm('Are you sure you want to reset all security statistics, clear the entire test history, and reset the test counter to #1? This action cannot be undone.')) return;
        setLoading(true);
        try {
            const res = await fetch('/api/security/statistics', {
                method: 'DELETE',
                headers: authHeaders()
            });
            const data = await res.json();
            if (data.success) {
                await fetchConfig();
                await fetchResults();
                showToast('Statistics and history reset successfully', 'success');
            }
        } catch (e) {
            console.error('Failed to reset statistics:', e);
            showToast('Failed to reset statistics', 'error');
        } finally {
            setLoading(false);
        }
    };

    const exportResults = () => {
        const dataStr = JSON.stringify(testResults, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `security-test-results-${Date.now()}.json`;
        link.click();
    };

    const getStatusBadge = (result: any) => {
        if (!result) return null;

        const status = result.status || (result.success ? 'allowed' : 'blocked');

        if (status === 'blocked') {
            return <span className="flex items-center gap-1 text-red-400 text-sm"><XCircle size={14} /> Blocked</span>;
        } else if (status === 'sinkholed') {
            return <span className="flex items-center gap-1 text-yellow-400 text-sm"><AlertTriangle size={14} /> Sinkholed</span>;
        } else if (status === 'allowed' || status === 'resolved') {
            return <span className="flex items-center gap-1 text-green-400 text-sm"><CheckCircle size={14} /> Allowed </span>;
        } else if (status === 'unreachable') {
            return <span className="flex items-center gap-1 text-orange-400 text-sm"><AlertTriangle size={14} /> Unreachable</span>;
        } else if (status === 'error') {
            return <span className="flex items-center gap-1 text-orange-400 text-sm"><XCircle size={14} /> Error</span>;
        } else {
            // This should never happen - log it for debugging
            console.warn('Unknown test status:', status);
            return <span className="flex items-center gap-1 text-text-muted text-sm"><Clock size={14} /> Unknown</span>;
        }
    };

    if (!config) {
        return <div className="p-8 text-center text-text-muted animate-pulse font-black tracking-widest text-xs">Loading security configuration...</div>;
    }

    const basicDNSTests = DNS_TEST_DOMAINS.filter(t => t.category === 'basic');
    const advancedDNSTests = DNS_TEST_DOMAINS.filter(t => t.category === 'advanced');

    return (
        <div className="space-y-6 max-w-7xl mx-auto pb-12">
            {/* Toast Notification */}
            {toast && (
                <div className={`fixed top-4 right-4 z-50 px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300 border border-white/10 ${toast.type === 'success' ? 'bg-green-600/90 text-white' :
                    toast.type === 'error' ? 'bg-red-600/90 text-white' :
                        'bg-blue-600/90 text-white'
                    }`}>
                    {toast.type === 'success' && <CheckCircle size={20} />}
                    {toast.type === 'error' && <XCircle size={20} />}
                    {toast.type === 'info' && <Clock size={20} />}
                    <span className="font-bold tracking-tight text-sm">{toast.message}</span>
                </div>
            )}

            {/* Header - Compact Horizontal Layout */}
            <div className="bg-gradient-to-r from-red-600/5 to-orange-600/5 border border-red-500/20 rounded-2xl p-4 shadow-sm flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                {/* Left: Title & Descriptions */}
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-red-600/10 rounded-xl border border-red-500/20 text-red-600 dark:text-red-400">
                        <Shield size={24} />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-text-primary tracking-tight leading-none">Security Testing</h2>
                        <p className="text-text-muted text-[11px] mt-1 font-medium">
                            Test URL Filtering, DNS Security, and Threat Prevention (EICAR)
                        </p>
                    </div>
                </div>

                {/* Right: Badges & Health */}
                <div className="flex items-center gap-3 w-full lg:w-auto overflow-hidden">
                    <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2 flex items-center gap-2 shadow-sm min-w-max">
                        <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
                        <div>
                            <p className="text-amber-600 dark:text-amber-400 text-[10px] font-black tracking-widest leading-none">Direct Policy Impact</p>
                            <p className="text-text-muted text-[9px] mt-0.5 italic hidden sm:block">Triggers firewall alerts</p>
                        </div>
                    </div>

                    {systemHealth && (
                        <div className={`rounded-lg px-3 py-2 flex items-center gap-2 border shadow-sm min-w-max ${systemHealth.ready
                            ? 'bg-green-600/5 border-green-500/20'
                            : 'bg-red-600/5 border-red-500/20'
                            }`}>
                            {systemHealth.ready ? (
                                <>
                                    <CheckCircle size={14} className="text-green-600 dark:text-green-400 flex-shrink-0" />
                                    <div>
                                        <div className="text-green-600 dark:text-green-400 text-[10px] font-black tracking-widest leading-none">System Health: OK</div>
                                        <div className="text-text-muted text-[9px] mt-0.5 font-bold tracking-tight opacity-70 hidden sm:block">Tools ready ({systemHealth.platform})</div>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <XCircle size={14} className="text-red-500 flex-shrink-0" />
                                    <div>
                                        <div className="text-red-500 text-[10px] font-black tracking-widest leading-none">System Health: Degraded</div>
                                        <div className="text-text-muted text-[9px] mt-0.5 font-bold tracking-tight opacity-70 truncate max-w-[100px] hidden sm:block">
                                            Missing: {Object.entries(systemHealth.commands).filter(([_, cmd]: any) => !cmd.available).map(([name]: any) => name).join(', ')}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Statistics Dashboard */}
            {config.statistics && (
                <div className="flex flex-col gap-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <h3 className="text-lg font-black text-text-primary tracking-tight">Security Efficacy</h3>
                            <span className="px-2 py-0.5 rounded-full bg-blue-600/10 border border-blue-500/20 text-[9px] font-black text-blue-600 dark:text-blue-400 tracking-widest">Real-time stats</span>
                        </div>
                        <button
                            onClick={resetCounters}
                            className="flex items-center gap-2 px-4 py-1.5 text-[10px] font-black tracking-widest text-red-600 hover:text-red-500 hover:bg-red-500/5 border border-red-500/20 rounded-lg transition-all shadow-sm"
                        >
                            <Trash2 size={14} />
                            Reset Counters
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="bg-card border border-border p-5 rounded-xl shadow-sm hover:shadow-md transition-shadow">
                            <div className="flex items-center justify-between mb-3 text-text-muted">
                                <span className="text-[10px] font-black tracking-widest opacity-80">Total Tests</span>
                                <div className="p-1.5 bg-blue-600/10 rounded-lg text-blue-600 dark:text-blue-400 border border-blue-500/20">
                                    <Shield size={16} />
                                </div>
                            </div>
                            <div className="text-3xl font-black text-text-primary tabular-nums tracking-tighter">{config.statistics.total_tests_run}</div>
                            <div className="mt-2 text-[10px] font-medium text-text-muted flex items-center gap-1.5 tracking-widest">
                                <Clock size={12} className="opacity-50" />
                                Last: {config.statistics.last_test_time ? new Date(config.statistics.last_test_time).toLocaleTimeString() : 'Never'}
                            </div>
                        </div>

                        <div className="bg-card border border-border p-5 rounded-xl shadow-sm hover:shadow-md transition-shadow">
                            <div className="flex items-center justify-between mb-3 text-red-600 dark:text-red-400">
                                <span className="text-[10px] font-black tracking-widest opacity-80">URL Filter</span>
                                <div className="p-1.5 bg-red-600/10 rounded-lg border border-red-500/20">
                                    <Shield size={16} />
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <div>
                                    <div className="text-3xl font-black text-red-600 dark:text-red-400 tabular-nums tracking-tighter">{config.statistics.url_tests_blocked}</div>
                                    <div className="text-[10px] font-black text-text-muted uppercase tracking-widest opacity-60">Blocked</div>
                                </div>
                                <div className="w-px h-8 bg-border/50" />
                                <div>
                                    <div className="text-3xl font-black text-green-600 dark:text-green-400 tabular-nums tracking-tighter">{config.statistics.url_tests_allowed}</div>
                                    <div className="text-[10px] font-black text-text-muted uppercase tracking-widest opacity-60">Allowed</div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-card border border-border p-5 rounded-xl shadow-sm hover:shadow-md transition-shadow">
                            <div className="flex items-center justify-between mb-3 text-orange-600 dark:text-orange-400">
                                <span className="text-[10px] font-black tracking-widest opacity-80">DNS Protect</span>
                                <div className="p-1.5 bg-orange-600/10 rounded-lg border border-orange-500/20">
                                    <Shield size={16} />
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <div>
                                    <div className="text-3xl font-black text-orange-600 dark:text-orange-400 tabular-nums tracking-tighter">{config.statistics.dns_tests_blocked}</div>
                                    <div className="text-[10px] font-black text-text-muted uppercase tracking-widest opacity-60">Blocked</div>
                                </div>
                                <div className="w-px h-8 bg-border/50" />
                                <div>
                                    <div className="text-3xl font-black text-yellow-600 dark:text-yellow-400 tabular-nums tracking-tighter">{config.statistics.dns_tests_sinkholed || 0}</div>
                                    <div className="text-[10px] font-black text-text-muted tracking-widest opacity-60">Sinkhole</div>
                                </div>
                                <div className="w-px h-8 bg-border/50" />
                                <div>
                                    <div className="text-3xl font-black text-green-600 dark:text-green-400 tabular-nums tracking-tighter">{config.statistics.dns_tests_allowed || 0}</div>
                                    <div className="text-[10px] font-black text-text-muted uppercase tracking-widest opacity-60">Allowed</div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-card border border-border p-5 rounded-xl shadow-sm hover:shadow-md transition-shadow">
                            <div className="flex items-center justify-between mb-3 text-purple-600 dark:text-purple-400">
                                <span className="text-[10px] font-black tracking-widest opacity-80">Threat Prev</span>
                                <div className="p-1.5 bg-purple-600/10 rounded-lg border border-purple-500/20">
                                    <Shield size={16} />
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <div>
                                    <div className="text-3xl font-black text-purple-600 dark:text-purple-400 tabular-nums tracking-tighter">{config.statistics.threat_tests_blocked}</div>
                                    <div className="text-[10px] font-black text-text-muted uppercase tracking-widest opacity-60">Blocked</div>
                                </div>
                                <div className="w-px h-8 bg-border/50" />
                                <div>
                                    <div className="text-3xl font-black text-green-600 dark:text-green-400 tabular-nums tracking-tighter">{config.statistics.threat_tests_allowed}</div>
                                    <div className="text-[10px] font-black text-text-muted tracking-widest opacity-60">Bypass</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* URL Filtering Tests */}
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                <button
                    onClick={() => setUrlExpanded(!urlExpanded)}
                    className="w-full px-6 py-4 flex items-center justify-between bg-card-secondary/50 hover:bg-card-hover transition-all border-b border-border"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-red-600/10 rounded-lg text-red-600 dark:text-red-400 border border-red-500/20">
                            <Link size={18} />
                        </div>
                        <div>
                            <h3 className="text-sm font-black text-text-primary tracking-tight">URL Filtering</h3>
                            <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest opacity-70">
                                {config.url_filtering.enabled_categories.length} / {URL_CATEGORIES.length} Categories Active
                            </p>
                        </div>
                    </div>
                    {urlExpanded ? <ChevronUp size={20} className="text-text-muted" /> : <ChevronDown size={20} className="text-text-muted" />}
                </button>

                {urlExpanded && (
                    <div className="p-6 space-y-6">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="flex flex-wrap items-center gap-6">
                                <label className="flex items-center gap-2 cursor-pointer group">
                                    <div className="relative flex items-center">
                                        <input
                                            type="checkbox"
                                            checked={config.url_filtering.enabled_categories.length === URL_CATEGORIES.length}
                                            onChange={toggleAllURLCategories}
                                            className="w-4 h-4 rounded border-border bg-card-secondary text-blue-600 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                        />
                                    </div>
                                    <span className="text-[10px] font-black uppercase tracking-widest text-text-muted group-hover:text-text-primary transition-colors">Select All</span>
                                </label>

                                <SchedulerSettings type="url" title="URL" config={config} onUpdate={updateSchedule} />
                            </div>
                            <button
                                onClick={runURLBatchTest}
                                disabled={loading || batchProcessingUrl || config.url_filtering.enabled_categories.length === 0 || (systemHealth && !systemHealth.ready)}
                                className={cn(
                                    "px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg flex items-center gap-2",
                                    batchProcessingUrl || loading
                                        ? "bg-card-secondary text-text-muted border border-border cursor-not-allowed"
                                        : "bg-red-600 hover:bg-red-500 text-white shadow-red-900/40"
                                )}
                                title={systemHealth && !systemHealth.ready ? 'System not ready - missing required commands' : ''}
                            >
                                {batchProcessingUrl ? (
                                    <>
                                        <RefreshCcw size={16} className="animate-spin" />
                                        Testing...
                                    </>
                                ) : (
                                    <>
                                        <Play size={16} fill="currentColor" /> Run Selected Categories
                                    </>
                                )}
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-96 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-border">
                            {URL_CATEGORIES.map(category => {
                                const isEnabled = config.url_filtering.enabled_categories.includes(category.id);
                                const isTesting = testing[`url-${category.id}`];
                                const lastResult = testResults.find(r =>
                                    (r.testType === 'url_filtering' || r.testType === 'url') && r.testName === category.name
                                );

                                return (
                                    <div
                                        key={category.id}
                                        className={cn(
                                            "bg-card border rounded-xl p-3 flex items-center justify-between transition-all group hover:shadow-md",
                                            isEnabled ? "border-red-500/20 shadow-sm" : "border-border opacity-60 hover:opacity-100"
                                        )}
                                    >
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            <input
                                                type="checkbox"
                                                checked={isEnabled}
                                                onChange={() => toggleURLCategory(category.id)}
                                                className="w-4 h-4 rounded border-border bg-card-secondary text-red-600 focus:ring-1 focus:ring-red-500 outline-none transition-all"
                                            />
                                            <div className="min-w-0 pr-2">
                                                <div className={cn("text-xs font-black tracking-tight truncate", isEnabled ? "text-text-primary" : "text-text-muted")}>
                                                    {category.name}
                                                </div>
                                                <div className="text-[9px] text-text-muted font-mono truncate opacity-60 group-hover:opacity-100 transition-opacity">
                                                    {category.url.replace('http://', '')}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {lastResult && getStatusBadge(lastResult.result)}
                                            <div className="flex gap-1.5 ml-2 p-1 bg-card-secondary/50 rounded-lg border border-border/50">
                                                <button
                                                    onClick={() => copyToClipboard(`docker exec sdwan-web-ui sh -c "curl -fsS --max-time 10 -o /dev/null -w '%{http_code}' '${category.url}'"`)}
                                                    className="p-1.5 hover:bg-card border border-transparent hover:border-border rounded-lg text-text-muted hover:text-blue-600 transition-all"
                                                    title="Copy CLI command"
                                                >
                                                    <Copy size={13} />
                                                </button>
                                                <button
                                                    onClick={() => runURLTest(category)}
                                                    disabled={isTesting}
                                                    className="p-1.5 hover:bg-card border border-transparent hover:border-border rounded-lg text-text-muted hover:text-red-500 transition-all disabled:opacity-50"
                                                    title="Run test"
                                                >
                                                    {isTesting ? <RefreshCcw size={13} className="animate-spin" /> : <Play size={13} fill="currentColor" />}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* DNS Security Tests */}
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                <button
                    onClick={() => setDnsExpanded(!dnsExpanded)}
                    className="w-full px-6 py-4 flex items-center justify-between bg-card-secondary/50 hover:bg-card-hover transition-all border-b border-border"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-600/10 rounded-lg text-blue-600 dark:text-blue-400 border border-blue-500/20">
                            <Shield size={18} />
                        </div>
                        <div>
                            <h3 className="text-sm font-black text-text-primary tracking-tight">DNS Security Tests</h3>
                            <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest opacity-70">
                                {config.dns_security.enabled_tests.length} / {DNS_TEST_DOMAINS.length} Domains Active
                            </p>
                        </div>
                    </div>
                    {dnsExpanded ? <ChevronUp size={20} className="text-text-muted" /> : <ChevronDown size={20} className="text-text-muted" />}
                </button>

                {dnsExpanded && (
                    <div className="p-6 space-y-8">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="flex flex-wrap items-center gap-6">
                                <label className="flex items-center gap-2 cursor-pointer group">
                                    <div className="relative flex items-center">
                                        <input
                                            type="checkbox"
                                            checked={config.dns_security.enabled_tests.length === DNS_TEST_DOMAINS.length}
                                            onChange={toggleAllDNSTests}
                                            className="w-4 h-4 rounded border-border bg-card-secondary text-blue-600 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                        />
                                    </div>
                                    <span className="text-[10px] font-black uppercase tracking-widest text-text-muted group-hover:text-text-primary transition-colors">Select All</span>
                                </label>

                                <SchedulerSettings type="dns" title="DNS" config={config} onUpdate={updateSchedule} />
                            </div>
                            <button
                                onClick={runDNSBatchTest}
                                disabled={loading || batchProcessingDns || config.dns_security.enabled_tests.length === 0 || (systemHealth && !systemHealth.ready)}
                                className={cn(
                                    "px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg flex items-center gap-2",
                                    batchProcessingDns || loading
                                        ? "bg-card-secondary text-text-muted border border-border cursor-not-allowed"
                                        : "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/40"
                                )}
                                title={systemHealth && !systemHealth.ready ? 'System not ready - missing required commands' : ''}
                            >
                                {batchProcessingDns ? (
                                    <>
                                        <RefreshCcw size={16} className="animate-spin" />
                                        Testing...
                                    </>
                                ) : (
                                    <>
                                        <Play size={16} fill="currentColor" /> Run Selected Domains
                                    </>
                                )}
                            </button>
                        </div>

                        {/* Basic DNS Tests */}
                        <div>
                            <h4 className="text-[10px] font-black text-text-muted tracking-[0.2em] mb-4 border-l-2 border-blue-600 dark:border-blue-400 pl-2">Critical DNS Threats</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-80 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-border">
                                {basicDNSTests.map(test => {
                                    const isEnabled = config.dns_security.enabled_tests.includes(test.id);
                                    const isTesting = testing[`dns-${test.id}`];
                                    const lastResult = testResults.find(r =>
                                        (r.testType === 'dns_security' || r.testType === 'dns') && r.testName === test.name
                                    );

                                    return (
                                        <div
                                            key={test.id}
                                            className={cn(
                                                "bg-card border rounded-xl p-3 flex items-center justify-between transition-all group hover:shadow-md",
                                                isEnabled ? "border-blue-500/20 shadow-sm" : "border-border opacity-60 hover:opacity-100"
                                            )}
                                        >
                                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                                <input
                                                    type="checkbox"
                                                    checked={isEnabled}
                                                    onChange={() => toggleDNSTest(test.id)}
                                                    className="w-4 h-4 rounded border-border bg-card-secondary text-blue-600 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                                />
                                                <div className="min-w-0 pr-2">
                                                    <div className={cn("text-xs font-black tracking-tight truncate", isEnabled ? "text-text-primary" : "text-text-muted")}>
                                                        {test.name}
                                                    </div>
                                                    <div className="text-[9px] text-text-muted font-mono truncate opacity-60 group-hover:opacity-100 transition-opacity">
                                                        {test.domain}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {lastResult && getStatusBadge(lastResult.result)}
                                                <div className="flex gap-1.5 ml-2 p-1 bg-card-secondary/50 rounded-lg border border-border/50">
                                                    <button
                                                        onClick={() => copyToClipboard(`docker exec sdwan-web-ui sh -c "getent ahosts ${test.domain}"`)}
                                                        className="p-1.5 hover:bg-card border border-transparent hover:border-border rounded-lg text-text-muted hover:text-blue-600 transition-all"
                                                        title="Copy CLI command"
                                                    >
                                                        <Copy size={13} />
                                                    </button>
                                                    <button
                                                        onClick={() => runDNSTest(test)}
                                                        disabled={isTesting}
                                                        className="p-1.5 hover:bg-card border border-transparent hover:border-border rounded-lg text-text-muted hover:text-blue-600 transition-all disabled:opacity-50"
                                                        title="Run test"
                                                    >
                                                        {isTesting ? <RefreshCcw size={13} className="animate-spin" /> : <Play size={13} fill="currentColor" />}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Advanced DNS Tests */}
                        <div>
                            <h4 className="text-[10px] font-black text-text-muted tracking-[0.2em] mb-4 border-l-2 border-purple-600 dark:border-purple-400 pl-2">Advanced DNS Security</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-80 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-border">
                                {advancedDNSTests.map(test => {
                                    const isEnabled = config.dns_security.enabled_tests.includes(test.id);
                                    const isTesting = testing[`dns-${test.id}`];
                                    const lastResult = testResults.find(r =>
                                        (r.testType === 'dns_security' || r.testType === 'dns') && r.testName === test.name
                                    );

                                    return (
                                        <div
                                            key={test.id}
                                            className={cn(
                                                "bg-card border rounded-xl p-3 flex items-center justify-between transition-all group hover:shadow-md",
                                                isEnabled ? "border-purple-500/20 shadow-sm" : "border-border opacity-60 hover:opacity-100"
                                            )}
                                        >
                                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                                <input
                                                    type="checkbox"
                                                    checked={isEnabled}
                                                    onChange={() => toggleDNSTest(test.id)}
                                                    className="w-4 h-4 rounded border-border bg-card-secondary text-purple-600 focus:ring-1 focus:ring-purple-500 outline-none transition-all"
                                                />
                                                <div className="min-w-0 pr-2">
                                                    <div className={cn("text-xs font-black tracking-tight truncate", isEnabled ? "text-text-primary" : "text-text-muted")}>
                                                        {test.name}
                                                    </div>
                                                    <div className="text-[9px] text-text-muted font-mono truncate opacity-60 group-hover:opacity-100 transition-opacity">
                                                        {test.domain}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {lastResult && getStatusBadge(lastResult.result)}
                                                <div className="flex gap-1.5 ml-2 p-1 bg-card-secondary/50 rounded-lg border border-border/50">
                                                    <button
                                                        onClick={() => copyToClipboard(`docker exec sdwan-web-ui sh -c "getent ahosts ${test.domain}"`)}
                                                        className="p-1.5 hover:bg-card border border-transparent hover:border-border rounded-lg text-text-muted hover:text-blue-600 transition-all"
                                                        title="Copy CLI command"
                                                    >
                                                        <Copy size={13} />
                                                    </button>
                                                    <button
                                                        onClick={() => runDNSTest(test)}
                                                        disabled={isTesting}
                                                        className="p-1.5 hover:bg-card border border-transparent hover:border-border rounded-lg text-text-muted hover:text-purple-600 transition-all disabled:opacity-50"
                                                        title="Run test"
                                                    >
                                                        {isTesting ? <RefreshCcw size={13} className="animate-spin" /> : <Play size={13} fill="currentColor" />}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Threat Prevention Tests */}
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                <button
                    onClick={() => setThreatExpanded(!threatExpanded)}
                    className="w-full px-6 py-4 flex items-center justify-between bg-card-secondary hover:bg-card-hover transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <Shield size={20} className="text-red-400" />
                        <h3 className="text-lg font-semibold text-foreground">Threat Prevention (Eicap)</h3>
                    </div>
                    {threatExpanded ? <ChevronUp size={20} className="text-text-secondary" /> : <ChevronDown size={20} className="text-text-secondary" />}
                </button>

                {threatExpanded && (
                    <div className="p-6 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <p className="text-text-muted text-sm">
                                Test IPS/Threat Prevention by downloading EICAR test file
                            </p>
                            <SchedulerSettings type="threat" title="Threat" config={config} onUpdate={updateSchedule} />
                        </div>

                        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                            <div className="flex items-start gap-2 mb-3">
                                <AlertTriangle size={18} className="text-red-400 mt-0.5 flex-shrink-0" />
                                <div>
                                    <p className="text-red-300 text-sm font-semibold">EICAR Test File</p>
                                    <p className="text-red-300/80 text-xs mt-1">
                                        This test downloads a harmless EICAR test file to trigger IPS alerts. The file is automatically deleted after the test.
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div>
                                    {/* Target picker from shared registry */}
                                    {securityTargets.length > 0 && (
                                        <div className="mb-3">
                                            <label className="block text-[10px] font-bold text-text-muted mb-1.5 uppercase tracking-widest">Available Security Targets</label>
                                            <select
                                                onChange={e => {
                                                    if (!e.target.value) return;
                                                    const t = securityTargets.find((st: any) => st.id === e.target.value);
                                                    if (t) setEicarEndpoint(`http://${t.host}:${t.ports?.http ?? 8082}/eicar.com.txt`);
                                                }}
                                                className="w-full bg-card-secondary border border-border text-text-primary rounded-lg px-4 py-2 focus:border-red-500 outline-none text-sm"
                                                defaultValue=""
                                            >
                                                <option value="">-- Select a Site (auto-fill URL) --</option>
                                                {securityTargets.map((t: any) => (
                                                    <option key={t.id} value={t.id}>{t.name} — {t.host}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                    <label className="block text-sm font-medium text-text-secondary mb-2">
                                        EICAR Endpoint URL
                                    </label>
                                    <input
                                        type="text"
                                        value={eicarEndpoint}
                                        onChange={(e) => setEicarEndpoint(e.target.value)}
                                        placeholder="Select a target above or enter URL manually"
                                        className="w-full bg-card-secondary border border-border text-text-primary rounded-lg px-4 py-2 focus:border-red-500 outline-none"
                                    />
                                </div>

                                <div className="flex gap-2">
                                    <button
                                        onClick={() => copyToClipboard(`docker exec sdwan-web-ui sh -c "curl -fsS --max-time 20 ${eicarEndpoint} -o /tmp/eicar.com.txt && rm -f /tmp/eicar.com.txt"`)}
                                        className="px-4 py-3 bg-card-hover hover:bg-card border border-border text-text-primary rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                                        title="Copy CLI command"
                                    >
                                        <Copy size={18} /> Copy Command
                                    </button>
                                    <button
                                        onClick={runThreatTest}
                                        disabled={loading || !eicarEndpoint || (systemHealth && !systemHealth.ready)}
                                        className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-500 disabled:bg-card-secondary disabled:text-text-muted text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                                    >
                                        <Play size={18} /> Run EICAR Test
                                    </button>
                                </div>

                                {testResults.find(r => r.testType === 'threat_prevention' || r.testType === 'threat') && (
                                    <div className="mt-3">
                                        {getStatusBadge(testResults.find(r => r.testType === 'threat_prevention' || r.testType === 'threat')?.result)}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* EDL Lists (IP / URL / DNS) */}
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                <button
                    onClick={() => setEdlExpanded(!edlExpanded)}
                    className="w-full px-6 py-4 flex items-center justify-between bg-card-secondary/50 hover:bg-card-hover transition-all border-b border-border"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-600/10 rounded-lg text-orange-600 dark:text-orange-400 border border-orange-500/20">
                            <ListTree size={18} />
                        </div>
                        <div>
                            <h3 className="text-sm font-black text-text-primary tracking-tight">External Dynamic Lists (Edl)</h3>
                            <p className="text-[10px] text-text-muted font-bold tracking-widest opacity-70">Automated Threat Feeds</p>
                        </div>
                    </div>
                    {edlExpanded ? <ChevronUp size={20} className="text-text-muted" /> : <ChevronDown size={20} className="text-text-muted" />}
                </button>

                {edlExpanded && (
                    <div className="p-6 space-y-8">
                        {/* 3 Columns for Lists */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {(['ip', 'url', 'dns'] as const).map(type => {
                                const listName = `${type}List` as keyof typeof config.edlTesting;
                                const list = config.edlTesting[listName] as any;
                                const isSyncing = edlSyncing[type];

                                return (
                                    <div key={type} className="bg-card border border-border rounded-2xl p-5 space-y-5 shadow-sm hover:shadow-md transition-shadow">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="p-1.5 bg-orange-600/10 rounded-lg text-orange-600 dark:text-orange-400 border border-orange-500/20">
                                                    {type === 'ip' ? <Globe size={14} /> : type === 'url' ? <Link size={14} /> : <Shield size={14} />}
                                                </div>
                                                <h4 className="text-[11px] font-black text-text-primary uppercase tracking-[0.1em]">{type} Lists</h4>
                                            </div>
                                            <span className="text-[9px] font-black font-mono bg-card-secondary border border-border text-orange-600 dark:text-orange-400 px-2.5 py-1 rounded-full tracking-widest">
                                                {list.elementsCount || 0} Elements
                                            </span>
                                        </div>

                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-[9px] uppercase font-black text-text-muted mb-2 ml-1 tracking-widest opacity-70">Feed source</label>
                                                <div className="flex gap-2">
                                                    <div className="relative flex-1">
                                                        <input
                                                            type="text"
                                                            value={list.remoteUrl || ''}
                                                            onChange={(e) => updateEdlConfig({ [listName]: { remoteUrl: e.target.value } })}
                                                            placeholder="https://feeds.threat.ai/v1/..."
                                                            className="w-full bg-card-secondary border border-border text-text-primary text-xs rounded-xl px-4 py-2.5 outline-none focus:ring-1 focus:ring-orange-500 shadow-inner transition-all"
                                                        />
                                                    </div>
                                                    <button
                                                        onClick={() => syncEdl(type)}
                                                        disabled={isSyncing || !list.remoteUrl}
                                                        className="p-2.5 bg-orange-600 text-white hover:bg-orange-500 disabled:bg-card-secondary disabled:text-text-muted rounded-xl transition-all shadow-lg shadow-orange-900/20"
                                                        title="Sync from URL"
                                                    >
                                                        <RefreshCcw size={16} className={isSyncing ? 'animate-spin' : ''} />
                                                    </button>
                                                </div>
                                            </div>

                                            <div>
                                                <label className="block text-[9px] uppercase font-black text-text-muted mb-2 ml-1 tracking-widest opacity-70">Manual import</label>
                                                <label className="flex items-center justify-center gap-2 px-3 py-3 bg-card-secondary border-2 border-dashed border-border hover:border-orange-500/50 hover:bg-orange-500/5 rounded-xl cursor-pointer transition-all group">
                                                    <Upload size={14} className="text-text-muted group-hover:text-orange-500" />
                                                    <span className="text-[9px] text-text-muted font-black uppercase tracking-widest group-hover:text-orange-600 dark:group-hover:text-orange-400">Choose .txt / .csv</span>
                                                    <input
                                                        type="file"
                                                        className="hidden"
                                                        accept=".txt,.csv"
                                                        onChange={(e) => {
                                                            const file = e.target.files?.[0];
                                                            if (file) uploadEdl(type, file);
                                                        }}
                                                    />
                                                </label>
                                            </div>

                                            <div className="pt-3 border-t border-border flex flex-col gap-1.5">
                                                <div className="flex items-center justify-between text-[9px] text-text-muted font-bold uppercase tracking-widest opacity-60">
                                                    <span>Last Synchronization</span>
                                                    <span className="text-text-primary">{list.lastSyncTime ? new Date(list.lastSyncTime).toLocaleTimeString() : 'N/A'}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Parameter Controls */}
                        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                            <h4 className="text-[10px] font-black text-text-muted tracking-[0.2em] mb-6 flex items-center gap-2 border-l-2 border-orange-500 pl-2">
                                <Settings size={14} /> Global Edl Configuration
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                                <div>
                                    <label className="block text-[9px] uppercase font-black text-text-muted mb-3 ml-1 tracking-widest opacity-70">Simulation Mode</label>
                                    <div className="flex bg-card-secondary p-1 rounded-xl border border-border shadow-inner">
                                        {(['sequential', 'random'] as const).map(m => (
                                            <button
                                                key={m}
                                                onClick={() => updateEdlConfig({ testMode: m })}
                                                className={cn(
                                                    "flex-1 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                                                    config.edlTesting.testMode === m
                                                        ? "bg-orange-600 text-white shadow-lg shadow-orange-900/40"
                                                        : "text-text-muted hover:text-text-primary"
                                                )}
                                            >
                                                {m}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[9px] uppercase font-black text-text-muted mb-3 ml-1 tracking-widest opacity-70">Sample Size</label>
                                    <input
                                        type="number"
                                        value={config.edlTesting.randomSampleSize}
                                        onChange={(e) => updateEdlConfig({ randomSampleSize: e.target.value })}
                                        className="w-full bg-card-secondary border border-border text-text-primary text-xs font-mono rounded-xl px-4 py-2.5 outline-none focus:ring-1 focus:ring-orange-500 transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[9px] uppercase font-black text-text-muted mb-3 ml-1 tracking-widest opacity-70">Max Elements</label>
                                    <input
                                        type="number"
                                        value={config.edlTesting.maxElementsPerRun}
                                        onChange={(e) => updateEdlConfig({ maxElementsPerRun: e.target.value })}
                                        className="w-full bg-card-secondary border border-border text-text-primary text-xs font-mono rounded-xl px-4 py-2.5 outline-none focus:ring-1 focus:ring-orange-500 transition-all"
                                    />
                                </div>
                                <div className="flex items-end">
                                    <button
                                        onClick={() => showToast('Configuration automatically saved', 'info')}
                                        className="w-full py-2.5 bg-card-secondary hover:bg-card-hover border border-border text-text-primary rounded-xl text-[9px] font-black tracking-widest transition-all shadow-sm"
                                    >
                                        <Database size={14} className="inline mr-2" /> Commit Changes
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Test Execution & Mini Results */}
                        <div className="space-y-6">
                            <h4 className="text-[10px] font-black text-text-muted tracking-[0.2em] flex items-center gap-2 border-l-2 border-orange-500 pl-2">
                                <Play size={14} fill="currentColor" /> List Execution
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {(['ip', 'url', 'dns'] as const).map(type => {
                                    const edlData = (edlResults as any)[type];
                                    const results = edlData.results;
                                    const summary = edlData.summary;
                                    const isTesting = edlTestingState[type];
                                    const listName = `${type}List` as keyof typeof config.edlTesting;
                                    const list = config.edlTesting[listName] as any;

                                    return (
                                        <div key={type} className="space-y-4">
                                            <button
                                                onClick={() => runEdlTest(type)}
                                                disabled={isTesting || !list.elementsCount}
                                                className={cn(
                                                    "w-full py-4 rounded-2xl font-black text-[10px] tracking-widest transition-all flex items-center justify-center gap-2 group shadow-lg",
                                                    isTesting || !list.elementsCount
                                                        ? "bg-card-secondary text-text-muted border border-border cursor-not-allowed"
                                                        : "bg-orange-600 hover:bg-orange-500 text-white shadow-orange-900/40"
                                                )}
                                            >
                                                {isTesting ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" className="group-hover:scale-110 transition-transform" />}
                                                Test {type} Feed
                                            </button>

                                            {summary && (
                                                <div className="bg-card border border-border rounded-xl p-3 flex flex-col gap-2 shadow-sm border-l-4 border-l-orange-500">
                                                    <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest">
                                                        <span className="text-text-muted">Diagnostic Summary</span>
                                                        <span className={cn(
                                                            "px-2 py-0.5 rounded-full font-black",
                                                            summary.successRate >= 0.8 ? "bg-green-600/10 text-green-600 dark:text-green-400" : summary.successRate >= 0.5 ? "bg-orange-600/10 text-orange-600 dark:text-orange-400" : "bg-red-600/10 text-red-600 dark:text-red-400"
                                                        )}>
                                                            {(summary.successRate * 100).toFixed(0)}% Efficacy
                                                        </span>
                                                    </div>
                                                    <div className="flex gap-4 text-[9px] items-center font-bold tracking-tight">
                                                        <div className="flex flex-col">
                                                            <span className="text-text-muted opacity-60">Verified</span>
                                                            <span className="text-text-primary">{summary.testedCount}</span>
                                                        </div>
                                                        <div className="w-px h-4 bg-border/50" />
                                                        <div className="flex flex-col">
                                                            <span className="text-text-muted opacity-60 font-medium">Bypass</span>
                                                            <span className="text-green-600 dark:text-green-400">{summary.allowedCount}</span>
                                                        </div>
                                                        <div className="w-px h-4 bg-border/50" />
                                                        <div className="flex flex-col">
                                                            <span className="text-text-muted opacity-60">Blocked</span>
                                                            <span className="text-red-600 dark:text-red-400">{summary.blockedCount}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {results && results.length > 0 && (
                                                <div className="bg-card-secondary border border-border rounded-lg overflow-hidden shadow-sm">
                                                    <table className="w-full text-[10px]">
                                                        <thead className="bg-card">
                                                            <tr className="border-b border-border">
                                                                <th className="text-left py-2 px-3 text-text-muted uppercase">Value</th>
                                                                <th className="text-right py-2 px-3 text-text-muted uppercase">Status</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-border/50">
                                                            {results.slice(0, 5).map((r: any, i: number) => (
                                                                <tr key={i} className="hover:bg-card-hover/30">
                                                                    <td className="py-2 px-3 text-text-primary font-mono truncate max-w-[120px]">{r.value}</td>
                                                                    <td className="py-2 px-3 text-right">
                                                                        <span className={`px-1.5 py-0.5 rounded-md font-bold uppercase text-[9px] ${r.status === 'allowed' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                                                                            }`}>
                                                                            {r.status}
                                                                        </span>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                            {results.length > 5 && (
                                                                <tr>
                                                                    <td colSpan={2} className="py-2 px-3 text-center text-text-muted font-medium italic border-t border-border">
                                                                        + {results.length - 5} more results in global log
                                                                    </td>
                                                                </tr>
                                                            )}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Test Results */}
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                <button
                    onClick={() => setResultsExpanded(!resultsExpanded)}
                    className="w-full px-6 py-4 flex items-center justify-between bg-card-secondary/50 hover:bg-card-hover transition-all border-b border-border"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-green-600/10 rounded-lg text-green-600 dark:text-green-400 border border-green-500/20">
                            <HistoryIcon size={18} />
                        </div>
                        <div>
                            <h3 className="text-sm font-black text-text-primary tracking-tight">Security Test Log</h3>
                            <p className="text-[10px] text-text-muted font-bold tracking-widest opacity-70">
                                {totalResults} entries tracked • showing {testResults.length}
                            </p>
                        </div>
                    </div>
                    {resultsExpanded ? <ChevronUp size={20} className="text-text-muted" /> : <ChevronDown size={20} className="text-text-muted" />}
                </button>

                {resultsExpanded && (
                    <div className="p-6 space-y-6">
                        {/* Search and Filters */}
                        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
                            <div className="relative flex-1 group">
                                <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted group-focus-within:text-blue-500 transition-colors" />
                                <input
                                    type="text"
                                    placeholder="Search by ID, name, or status..."
                                    value={searchQuery}
                                    onChange={(e) => handleSearch(e.target.value)}
                                    className="w-full pl-12 pr-4 py-3 bg-card-secondary border border-border text-text-primary rounded-xl text-xs font-medium outline-none focus:ring-1 focus:ring-blue-500 shadow-inner transition-all"
                                />
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="relative">
                                    <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                                    <select
                                        value={testTypeFilter}
                                        onChange={(e) => setTestTypeFilter(e.target.value as any)}
                                        className="pl-9 pr-8 py-3 bg-card-secondary border border-border text-text-primary rounded-xl text-xs font-bold tracking-widest outline-none focus:ring-1 focus:ring-blue-500 transition-all appearance-none"
                                    >
                                        <option value="all">All Lists</option>
                                        <option value="url">URL Lists</option>
                                        <option value="dns">DNS Lists</option>
                                        <option value="threat">Threat Lists</option>
                                    </select>
                                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                                </div>
                                <button
                                    onClick={exportResults}
                                    disabled={testResults.length === 0}
                                    className="px-4 py-3 bg-card-secondary hover:bg-card-hover border border-border disabled:opacity-50 text-text-primary rounded-xl text-[10px] font-black tracking-widest transition-all flex items-center gap-2 shadow-sm"
                                >
                                    <Download size={14} /> Export
                                </button>
                                <button
                                    onClick={clearHistory}
                                    disabled={testResults.length === 0}
                                    className="px-4 py-3 bg-card-secondary hover:bg-red-500/10 hover:text-red-500 border border-border disabled:opacity-50 text-text-primary rounded-xl text-[10px] font-black tracking-widest transition-all flex items-center gap-2 shadow-sm"
                                >
                                    <Trash2 size={14} /> Purge
                                </button>
                            </div>
                        </div>

                        {testResults.length === 0 ? (
                            <div className="text-center py-8 text-slate-500">
                                <Shield size={48} className="mx-auto mb-3 opacity-30" />
                                <p>{searchQuery ? 'No results found for your search' : 'No test results yet. Run some tests to see results here.'}</p>
                            </div>
                        ) : (
                            <>
                                <div className="overflow-x-auto max-h-[500px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-border" onScroll={(e) => {
                                    const target = e.currentTarget;
                                    if (target.scrollHeight - target.scrollTop <= target.clientHeight + 100 && hasMore && !loadingMore) {
                                        loadMore();
                                    }
                                }}>
                                    <table className="w-full">
                                        <thead className="bg-card sticky top-0 z-10">
                                            <tr className="border-b border-border">
                                                <th className="text-left px-4 py-4 text-[9px] font-black text-text-muted tracking-widest">Descriptor</th>
                                                <th className="text-left px-4 py-4 text-[9px] font-black text-text-muted tracking-widest">Timeline</th>
                                                <th className="text-left px-4 py-4 text-[9px] font-black text-text-muted tracking-widest">List</th>
                                                <th className="text-left px-4 py-4 text-[9px] font-black text-text-muted tracking-widest">Identity</th>
                                                <th className="text-right px-4 py-4 text-[9px] font-black text-text-muted tracking-widest">Disposition</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/50">
                                            {testResults.map((result, index) => (
                                                <tr
                                                    key={result.testId || index}
                                                    onClick={() => result.testId && viewTestDetails(result.testId)}
                                                    className="hover:bg-card-secondary/50 transition-all cursor-pointer group"
                                                >
                                                    <td className="px-4 py-4 text-xs text-text-muted font-black font-mono">
                                                        #{result.testId || 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-4 text-[10px] text-text-muted font-medium">
                                                        <div className="flex items-center gap-2">
                                                            <Clock size={12} className="opacity-50" />
                                                            {new Date(result.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                        </div>
                                                        <div className="text-[9px] opacity-40 ml-5 font-bold uppercase tracking-tighter">
                                                            {new Date(result.timestamp).toLocaleDateString()}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-4">
                                                        <span className={cn(
                                                            "px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border shadow-sm",
                                                            result.testType === 'url_filtering' || result.testType === 'url' ? 'bg-blue-600/5 text-blue-600 dark:text-blue-400 border-blue-500/20' :
                                                                result.testType === 'dns_security' || result.testType === 'dns' ? 'bg-purple-600/5 text-purple-600 dark:text-purple-400 border-purple-500/20' :
                                                                    'bg-red-600/5 text-red-600 dark:text-red-400 border-red-500/20'
                                                        )}>
                                                            {result.testType === 'url_filtering' || result.testType === 'url' ? 'URL' :
                                                                result.testType === 'dns_security' || result.testType === 'dns' ? 'DNS' :
                                                                    'Threat'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-4 text-[11px] text-text-primary font-bold tracking-tight truncate max-w-xs group-hover:text-blue-500 transition-colors">
                                                        {result.testName}
                                                    </td>
                                                    <td className="px-4 py-4 text-right">
                                                        <div className="flex justify-end">
                                                            {getStatusBadge(result.result)}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {loadingMore && (
                                        <div className="flex items-center justify-center py-8 gap-3">
                                            <RefreshCw size={18} className="animate-spin text-blue-500" />
                                            <span className="text-[10px] font-black text-text-muted uppercase tracking-widest">Retrieving telemetry...</span>
                                        </div>
                                    )}
                                </div>
                                {hasMore && !loadingMore && (
                                    <div className="text-center pt-2">
                                        <button
                                            onClick={loadMore}
                                            className="px-6 py-2.5 bg-card-secondary hover:bg-card-hover border border-border text-text-primary rounded-xl text-[10px] font-black tracking-widest transition-all shadow-sm"
                                        >
                                            See More entries
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Detailed Log Viewer Modal */}
            {showDetailModal && selectedTest && (
                <div className="fixed inset-0 bg-slate-950/40 dark:bg-black/60 flex items-center justify-center z-[100] p-4 backdrop-blur-md animate-in fade-in duration-200" onClick={() => setShowDetailModal(false)}>
                    <div className="bg-card border border-border shadow-2xl rounded-3xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col scale-in animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                        {/* Modal Header */}
                        <div className="px-8 py-6 border-b border-border flex items-center justify-between bg-card-secondary/50">
                            <div className="flex items-center gap-4">
                                <div className={cn(
                                    "p-3 rounded-2xl shadow-lg border",
                                    selectedTest.type === 'url' ? "bg-blue-600 text-white shadow-blue-900/20 border-blue-500/20" :
                                        selectedTest.type === 'dns' ? "bg-purple-600 text-white shadow-purple-900/20 border-purple-500/20" :
                                            "bg-red-600 text-white shadow-red-900/20 border-red-500/20"
                                )}>
                                    <ShieldAlert size={24} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-black text-text-primary tracking-tight">Telemetry Diagnostic</h3>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-[10px] font-black font-mono text-text-muted bg-card px-2 py-0.5 rounded border border-border">ID #{selectedTest.id}</span>
                                        <span className="text-[10px] font-black text-text-muted tracking-widest opacity-60">
                                            {new Date(selectedTest.timestamp).toLocaleString()}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowDetailModal(false)}
                                className="p-2.5 hover:bg-card border border-transparent hover:border-border rounded-xl transition-all text-text-muted hover:text-text-primary group"
                            >
                                <XCircle size={24} className="group-hover:rotate-90 transition-transform duration-300" />
                            </button>
                        </div>

                        {/* Modal Content */}
                        <div className="p-8 overflow-y-auto custom-scrollbar space-y-8 flex-1">
                            {/* Top Stats Row */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="bg-card-secondary/50 border border-border rounded-2xl p-4 shadow-sm">
                                    <label className="text-[9px] font-black text-text-muted tracking-[0.2em] mb-2 block opacity-60">List Class</label>
                                    <p className="text-sm font-black text-text-primary">
                                        {selectedTest.type === 'url' ? 'URL Filtering' : selectedTest.type === 'dns' ? 'DNS Security' : 'Threat Prevention'}
                                    </p>
                                </div>
                                <div className="bg-card-secondary/50 border border-border rounded-2xl p-4 shadow-sm">
                                    <label className="text-[9px] font-black text-text-muted tracking-[0.2em] mb-2 block opacity-60">Security State</label>
                                    <div className="mt-1">{getStatusBadge({ status: selectedTest.status })}</div>
                                </div>
                                <div className="bg-card-secondary/50 border border-border rounded-2xl p-4 shadow-sm">
                                    <label className="text-[9px] font-black text-text-muted tracking-[0.2em] mb-2 block opacity-60">Execution Time</label>
                                    <p className="text-sm font-black text-text-primary tracking-tighter">
                                        {selectedTest.details?.executionTime ? `${selectedTest.details.executionTime}ms` : 'N/A'}
                                    </p>
                                </div>
                            </div>

                            {/* Test Identity Card */}
                            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                                    <Settings size={80} />
                                </div>
                                <label className="text-[9px] font-black text-text-muted tracking-[0.2em] mb-3 block opacity-60">Test Descriptor</label>
                                <p className="text-lg font-black text-text-primary leading-tight tracking-tight">{selectedTest.name}</p>
                            </div>

                            {/* Detailed Telemetry Data */}
                            {selectedTest.details && (
                                <div className="space-y-6">
                                    <div className="flex items-center gap-2">
                                        <div className="h-4 w-1 bg-blue-500 rounded-full" />
                                        <h4 className="text-[10px] font-black text-text-primary uppercase tracking-widest">Detailed Observation Log</h4>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4">
                                        {selectedTest.details.url && (
                                            <div className="bg-card-secondary/30 rounded-xl p-4 border border-border/50 group">
                                                <span className="text-[9px] font-black text-text-muted uppercase tracking-widest block mb-2 opacity-60">Target Resource</span>
                                                <span className="text-xs font-mono text-text-primary break-all group-hover:text-blue-500 transition-colors uppercase">{selectedTest.details.url}</span>
                                            </div>
                                        )}
                                        {selectedTest.details.domain && (
                                            <div className="bg-card-secondary/30 rounded-xl p-4 border border-border/50 group">
                                                <span className="text-[9px] font-black text-text-muted uppercase tracking-widest block mb-2 opacity-60">Destination Host</span>
                                                <span className="text-xs font-mono text-text-primary break-all group-hover:text-purple-500 transition-colors uppercase">{selectedTest.details.domain}</span>
                                            </div>
                                        )}
                                        {selectedTest.details.resolvedIp && (
                                            <div className="bg-card-secondary/30 rounded-xl p-4 border border-border/50 group">
                                                <span className="text-[9px] font-black text-text-muted uppercase tracking-widest block mb-2 opacity-60">Resolved Network Address</span>
                                                <span className="text-xs font-mono text-text-primary break-all group-hover:text-green-500 transition-colors">{selectedTest.details.resolvedIp}</span>
                                            </div>
                                        )}
                                        {selectedTest.details.command && (
                                            <div className="bg-card-secondary/30 rounded-xl p-4 border border-border/50">
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="text-[9px] font-black text-text-muted uppercase tracking-widest opacity-60">Shell Command Execution</span>
                                                    <button
                                                        onClick={() => copyToClipboard(selectedTest.details.command)}
                                                        className="text-[9px] font-black text-blue-500 uppercase hover:underline"
                                                    >
                                                        Copy Command
                                                    </button>
                                                </div>
                                                <pre className="text-[10px] font-mono text-text-secondary bg-black/20 dark:bg-black/40 p-3 rounded-lg overflow-x-auto border border-border/30">{selectedTest.details.command}</pre>
                                            </div>
                                        )}
                                        {selectedTest.details.output && (
                                            <div className="bg-card-secondary/30 rounded-xl p-4 border border-border/50">
                                                <span className="text-[9px] font-black text-text-muted uppercase tracking-widest block mb-2 opacity-60">System Raw Output</span>
                                                <pre className="text-[10px] font-mono text-text-secondary bg-black/20 dark:bg-black/40 p-3 rounded-lg overflow-x-auto max-h-48 border border-border/30 custom-scrollbar">{selectedTest.details.output}</pre>
                                            </div>
                                        )}
                                        {selectedTest.details.error && (
                                            <div className="bg-red-500/5 rounded-xl p-4 border border-red-500/20">
                                                <span className="text-[9px] font-black text-red-500 uppercase tracking-widest block mb-2">Diagnostic Error Signature</span>
                                                <pre className="text-[10px] font-mono text-red-400 bg-black/20 p-3 rounded-lg overflow-x-auto border border-red-500/10 uppercase tracking-tighter">{selectedTest.details.error}</pre>
                                            </div>
                                        )}

                                        {selectedTest.details.isBatch && selectedTest.details.results && (
                                            <div className="space-y-4 pt-4">
                                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                                    <div className="flex items-center gap-2">
                                                        <div className="h-4 w-1 bg-orange-500 rounded-full" />
                                                        <h4 className="text-[10px] font-black text-text-primary uppercase tracking-widest">Batch Analysis Manifest</h4>
                                                    </div>
                                                    <div className="relative group flex-1 sm:max-w-[240px]">
                                                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted group-focus-within:text-blue-500 transition-colors" />
                                                        <input
                                                            type="text"
                                                            placeholder="Filter results..."
                                                            value={modalSearchQuery}
                                                            onChange={(e) => setModalSearchQuery(e.target.value)}
                                                            className="w-full bg-card-secondary border border-border rounded-xl py-2 pl-9 pr-3 text-[10px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all shadow-inner"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
                                                    <div className="max-h-96 overflow-y-auto custom-scrollbar">
                                                        <table className="w-full">
                                                            <thead className="bg-card-secondary sticky top-0 z-10 shadow-sm">
                                                                <tr className="border-b border-border">
                                                                    <th className="text-left py-3 px-4 text-text-muted font-black tracking-widest text-[9px]">Resource Identity</th>
                                                                    <th className="text-right py-3 px-4 text-text-muted font-black tracking-widest text-[9px]">Security Status</th>
                                                                    <th className="text-left py-3 px-4 text-text-muted font-black tracking-widest text-[9px]">Observation Details</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-border/50">
                                                                {selectedTest.details.results
                                                                    .filter((r: any) =>
                                                                        r.value.toLowerCase().includes(modalSearchQuery.toLowerCase()) ||
                                                                        r.status.toLowerCase().includes(modalSearchQuery.toLowerCase()) ||
                                                                        (r.details && r.details.toLowerCase().includes(modalSearchQuery.toLowerCase()))
                                                                    )
                                                                    .map((r: any, i: number) => (
                                                                        <tr key={i} className="hover:bg-card-secondary/30 transition-colors group">
                                                                            <td className="py-3 px-4 text-text-primary font-mono text-[10px] break-all group-hover:text-blue-500 transition-colors uppercase tracking-widest">{r.value}</td>
                                                                            <td className="py-3 px-4 text-right">
                                                                                <span className={cn(
                                                                                    "px-2 py-0.5 rounded-lg font-black uppercase text-[9px] border shadow-sm",
                                                                                    r.status === 'allowed' ? 'bg-green-600/5 text-green-600 dark:text-green-400 border-green-500/20' :
                                                                                        r.status === 'error' ? 'bg-orange-600/5 text-orange-600 dark:text-orange-400 border-orange-500/20' :
                                                                                            'bg-red-600/5 text-red-600 dark:text-red-400 border-red-500/20'
                                                                                )}>
                                                                                    {r.status}
                                                                                </span>
                                                                            </td>
                                                                            <td className="py-3 px-4 text-text-muted text-[10px] font-medium break-words max-w-[200px] uppercase opacity-60 group-hover:opacity-100">{r.details || '-'}</td>
                                                                        </tr>
                                                                    ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {selectedTest.details.reason && (
                                            <div className="mt-8 p-6 bg-blue-600/5 border border-blue-500/20 rounded-2xl relative overflow-hidden group">
                                                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform duration-500">
                                                    <Info size={40} className="text-blue-600" />
                                                </div>
                                                <span className="text-blue-600 dark:text-blue-400 font-black uppercase text-[10px] tracking-widest block mb-2">Disposition Reasoning</span>
                                                <p className="text-sm text-text-primary font-bold leading-relaxed uppercase tracking-tight">{selectedTest.details.reason}</p>
                                            </div>
                                        )}

                                        {selectedTest.details.slsDiagnostic && (
                                            <div className="mt-8 p-6 bg-slate-900/50 border border-slate-700/50 rounded-2xl relative overflow-hidden shadow-2xl">
                                                <div className="absolute top-0 right-0 p-4 opacity-20">
                                                    <Shield size={60} className="text-slate-400" />
                                                </div>
                                                <div className="flex items-center gap-3 mb-6">
                                                    <div className="p-2 bg-blue-600/20 rounded-lg border border-blue-500/30">
                                                        <Zap size={18} className="text-blue-500" />
                                                    </div>
                                                    <div>
                                                        <span className="text-blue-500 font-black uppercase text-[10px] tracking-widest block">Cloud Diagnostic</span>
                                                        <h4 className="text-sm font-black text-text-primary uppercase tracking-tight">Strata Logging Service (SLS)</h4>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    <div className="bg-card-secondary/40 p-3 rounded-xl border border-border/50">
                                                        <span className="text-[9px] font-black text-text-muted uppercase tracking-widest block mb-1 opacity-60">Matched Rule</span>
                                                        <span className="text-xs font-bold text-text-primary">{selectedTest.details.slsDiagnostic.rule || 'Unknown Rule'}</span>
                                                    </div>
                                                    <div className="bg-card-secondary/40 p-3 rounded-xl border border-border/50">
                                                        <span className="text-[9px] font-black text-text-muted uppercase tracking-widest block mb-1 opacity-60">Security Profile</span>
                                                        <span className="text-xs font-bold text-text-primary">{selectedTest.details.slsDiagnostic.security_profile || 'None'}</span>
                                                    </div>
                                                    <div className="bg-card-secondary/40 p-3 rounded-xl border border-border/50">
                                                        <span className="text-[9px] font-black text-text-muted uppercase tracking-widest block mb-1 opacity-60">Application ID</span>
                                                        <span className="text-xs font-mono font-bold text-blue-500 uppercase">{selectedTest.details.slsDiagnostic.app || 'Any'}</span>
                                                    </div>
                                                    <div className="bg-card-secondary/40 p-3 rounded-xl border border-border/50">
                                                        <span className="text-[9px] font-black text-text-muted uppercase tracking-widest block mb-1 opacity-60">URL Category</span>
                                                        <span className="text-xs font-bold text-text-primary uppercase">{selectedTest.details.slsDiagnostic.category || 'N/A'}</span>
                                                    </div>
                                                    <div className="bg-card-secondary/40 p-3 rounded-xl border border-border/50">
                                                        <span className="text-[9px] font-black text-text-muted uppercase tracking-widest block mb-1 opacity-60">Device / Site</span>
                                                        <span className="text-xs font-bold text-text-primary truncate">{selectedTest.details.slsDiagnostic.device_name || 'Unknown Device'}</span>
                                                    </div>
                                                    <div className="bg-card-secondary/40 p-3 rounded-xl border border-border/50">
                                                        <span className="text-[9px] font-black text-text-muted uppercase tracking-widest block mb-1 opacity-60">System (VSYS)</span>
                                                        <span className="text-xs font-bold text-text-primary uppercase">{selectedTest.details.slsDiagnostic.vsys_name || 'N/A'}</span>
                                                    </div>
                                                    <div className="bg-card-secondary/40 p-3 rounded-xl border border-border/50 col-span-2">
                                                        <span className="text-[9px] font-black text-text-muted uppercase tracking-widest block mb-1 opacity-60">Service Provider / Origin</span>
                                                        <div className="flex items-center gap-2">
                                                            <span className={twMerge(
                                                                "text-[10px] font-black px-2 py-0.5 rounded border",
                                                                selectedTest.details.slsDiagnostic.parent_device_group?.toLowerCase().includes('access') 
                                                                    ? "bg-purple-600/10 text-purple-600 border-purple-500/20" 
                                                                    : "bg-blue-600/10 text-blue-600 border-blue-500/20"
                                                            )}>
                                                                {selectedTest.details.slsDiagnostic.parent_device_group?.toLowerCase().includes('access') ? 'PRISMA ACCESS' : 'PRISMA SD-WAN'}
                                                            </span>
                                                            <span className="text-xs font-bold text-text-primary opacity-70">
                                                                ({selectedTest.details.slsDiagnostic.parent_device_group || 'Default DG'})
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="bg-card-secondary/40 p-3 rounded-xl border border-border/50">
                                                        <span className="text-[9px] font-black text-text-muted uppercase tracking-widest block mb-1 opacity-60">Zone Insight</span>
                                                        <span className="text-[10px] font-bold text-text-primary uppercase flex items-center gap-2">
                                                            {selectedTest.details.slsDiagnostic.source_zone || '?'}
                                                            <ChevronRight size={12} className="text-text-muted" />
                                                            {selectedTest.details.slsDiagnostic.dest_zone || '?'}
                                                        </span>
                                                    </div>
                                                    <div className="bg-card-secondary/40 p-3 rounded-xl border border-border/50">
                                                        <span className="text-[9px] font-black text-text-muted uppercase tracking-widest block mb-1 opacity-60">Cloud Action</span>
                                                        <span className={twMerge(
                                                            "px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border",
                                                            selectedTest.details.slsDiagnostic.action === 'allow' 
                                                                ? "bg-green-600/10 text-green-600 border-green-500/20" 
                                                                : "bg-red-600/10 text-red-600 border-red-500/20"
                                                        )}>
                                                            {selectedTest.details.slsDiagnostic.action || 'Unknown'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="px-8 py-4 border-t border-border bg-card-secondary/30 flex justify-end">
                            <button
                                onClick={() => setShowDetailModal(false)}
                                className="px-6 py-2.5 bg-card hover:bg-card-hover border border-border text-text-primary rounded-xl text-[10px] font-black tracking-widest transition-all shadow-sm"
                            >
                                Close Diagnostic
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
