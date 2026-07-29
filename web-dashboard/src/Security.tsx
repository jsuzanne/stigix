import React, { useState, useEffect } from 'react';
import { Shield, Play, AlertTriangle, CheckCircle, XCircle, Clock, Download, Trash2, ChevronDown, ChevronUp, Copy, Filter, Link, Upload, RefreshCcw, ShieldAlert, Globe, ListTree, RefreshCw, MoreVertical, Settings, Database, Server, Info, Search, History as HistoryIcon, Zap, ChevronRight, Activity, FileJson } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { clsx, type ClassValue } from 'clsx';
// Types only — runtime data is loaded from /api/security/profile (config/security-profile.json)
import { URL_CATEGORIES, DNS_TEST_DOMAINS, C2_SCENARIOS, AI_SECURITY_SCENARIOS, type URLCategory, type DNSTestDomain, type C2Scenario, type AISecurityScenario } from '../shared/security-categories';

import { ScoreDashboard } from './components/ScoreDashboard';
import { useSecurityScores } from './hooks/useSecurityScores';
import { ScoreGapAnalysis, ScoreLatestChanges } from './components/ScoreDetails';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface SecurityProps {
    token: string;
    onGoToCloudSettings?: () => void;
}

interface TestResult {
    testId?: number;
    timestamp: number;
    testType: string;
    testName: string;
    status: string;
    previousStatus?: string | null;
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
    type: 'url' | 'dns' | 'threat' | 'c2' | 'ai',
    title: string,
    config: SecurityConfig | null,
    onUpdate: (type: 'url' | 'dns' | 'threat' | 'c2' | 'ai', enabled: boolean, minutes: number) => Promise<void>
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
                        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-all focus:outline-none shadow-inner ${schedule.enabled ? 'bg-blue-600' : 'bg-card-hover'}`}
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

export default function Security({ token, onGoToCloudSettings }: SecurityProps) {
    const {
        scores, loading: scoresLoading,
        urlBaseline, dnsBaseline, threatBaseline,
        urlDiff, dnsDiff, threatDiff,
        handleSetBaseline
    } = useSecurityScores(token);

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
    const [c2Expanded, setC2Expanded] = useState(true);
    const [aiExpanded, setAIExpanded] = useState(true);
    const [edlExpanded, setEdlExpanded] = useState(true);
    const [resultsExpanded, setResultsExpanded] = useState(true);

    // Security profile (catalogue loaded from API — source: config/security-profile.json)
    const [securityProfile, setSecurityProfile] = useState<{
        url_filtering: { items: URLCategory[] };
        dns_security: { items: DNSTestDomain[] };
        threat_prevention: { default_eicar_endpoints: string[] };
        c2_scenarios: C2Scenario[];
        ai_security_scenarios: AISecurityScenario[];
    }>({
        url_filtering: { items: URL_CATEGORIES },
        dns_security: { items: DNS_TEST_DOMAINS },
        threat_prevention: { default_eicar_endpoints: ['https://secure.eicar.org/eicar.com.txt'] },
        c2_scenarios: C2_SCENARIOS,
        ai_security_scenarios: AI_SECURITY_SCENARIOS
    });

    // C2 scenario state
    const [c2SelectedScenarios, setC2SelectedScenarios] = useState<string[]>(C2_SCENARIOS.map(s => s.id));
    const [batchProcessingC2, setBatchProcessingC2] = useState(false);

    // AI Security scenario state
    const [aiSelectedScenarios, setAISelectedScenarios] = useState<string[]>(AI_SECURITY_SCENARIOS.map(s => s.id));
    const [batchProcessingAI, setBatchProcessingAI] = useState(false);

    const [edlResults, setEdlResults] = useState<{ [key: string]: { results: any[], summary?: any } }>({
        ip: { results: [] },
        url: { results: [] },
        dns: { results: [] }
    });
    const [edlSyncing, setEdlSyncing] = useState<{ [key: string]: boolean }>({});
    const [edlTestingState, setEdlTestingState] = useState<{ [key: string]: boolean }>({});

    // Test results filter
    const [testTypeFilter, setTestTypeFilter] = useState<'all' | 'url_filtering' | 'dns_security' | 'threat_prevention' | 'c2_scenario' | 'ai_security'>('all');

    const [showChangesOnly, setShowChangesOnly] = useState(false);

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

    // Global autocomplete search states
    const [globalSearchQuery, setGlobalSearchQuery] = useState('');
    const [isGlobalSearchFocused, setIsGlobalSearchFocused] = useState(false);
    const searchRef = React.useRef<HTMLDivElement>(null);

    // Local widget search states
    const [urlSearchQuery, setUrlSearchQuery] = useState('');
    const [dnsSearchQuery, setDnsSearchQuery] = useState('');
    const [c2SearchQuery, setC2SearchQuery] = useState('');
    const [aiSearchQuery, setAiSearchQuery] = useState('');

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
                setIsGlobalSearchFocused(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const getSuggestions = () => {
        if (!globalSearchQuery.trim()) return [];
        const query = globalSearchQuery.toLowerCase();
        const results: Array<{
            type: 'url' | 'dns' | 'c2' | 'ai';
            id: string;
            name: string;
            detail: string;
            isActive: boolean;
            rawItem: any;
        }> = [];

        if (securityProfile?.url_filtering?.items) {
            securityProfile.url_filtering.items.forEach(cat => {
                if (cat.name.toLowerCase().includes(query) || cat.id.toLowerCase().includes(query)) {
                    results.push({
                        type: 'url',
                        id: cat.id,
                        name: cat.name,
                        detail: cat.url.replace('http://', ''),
                        isActive: config?.url_filtering?.enabled_categories?.includes(cat.id) || false,
                        rawItem: cat
                    });
                }
            });
        }

        if (securityProfile?.dns_security?.items) {
            securityProfile.dns_security.items.forEach(test => {
                if (test.name.toLowerCase().includes(query) || test.id.toLowerCase().includes(query) || test.domain.toLowerCase().includes(query)) {
                    results.push({
                        type: 'dns',
                        id: test.id,
                        name: test.name,
                        detail: test.domain,
                        isActive: config?.dns_security?.enabled_tests?.includes(test.id) || false,
                        rawItem: test
                    });
                }
            });
        }

        if (securityProfile?.c2_scenarios) {
            securityProfile.c2_scenarios.forEach(scen => {
                if (scen.name.toLowerCase().includes(query) || scen.id.toLowerCase().includes(query) || scen.target.toLowerCase().includes(query)) {
                    results.push({
                        type: 'c2',
                        id: scen.id,
                        name: scen.name,
                        detail: scen.target,
                        isActive: c2SelectedScenarios.includes(scen.id),
                        rawItem: scen
                    });
                }
            });
        }

        if (securityProfile?.ai_security_scenarios) {
            securityProfile.ai_security_scenarios.forEach(scen => {
                if (scen.name.toLowerCase().includes(query) || scen.id.toLowerCase().includes(query) || scen.description.toLowerCase().includes(query)) {
                    results.push({
                        type: 'ai',
                        id: scen.id,
                        name: scen.name,
                        detail: scen.description,
                        isActive: aiSelectedScenarios.includes(scen.id),
                        rawItem: scen
                    });
                }
            });
        }

        return results.slice(0, 8);
    };

    const suggestions = getSuggestions();

    const handleSelectSuggestion = (suggestion: any) => {
        setGlobalSearchQuery('');
        setIsGlobalSearchFocused(false);

        let elementId = '';
        if (suggestion.type === 'url') {
            elementId = `url-item-${suggestion.id}`;
            setUrlExpanded(true);
            if (config && !config.url_filtering.enabled_categories.includes(suggestion.id)) {
                const newEnabled = [...config.url_filtering.enabled_categories, suggestion.id];
                saveConfig({
                    url_filtering: { ...config.url_filtering, enabled_categories: newEnabled }
                });
            }
        } else if (suggestion.type === 'dns') {
            elementId = `dns-item-${suggestion.id}`;
            setDnsExpanded(true);
            if (config && !config.dns_security.enabled_tests.includes(suggestion.id)) {
                const newEnabled = [...config.dns_security.enabled_tests, suggestion.id];
                saveConfig({
                    dns_security: { ...config.dns_security, enabled_tests: newEnabled }
                });
            }
        } else if (suggestion.type === 'c2') {
            elementId = `c2-item-${suggestion.id}`;
            setC2Expanded(true);
            if (!c2SelectedScenarios.includes(suggestion.id)) {
                setC2SelectedScenarios(prev => [...prev, suggestion.id]);
            }
        } else if (suggestion.type === 'ai') {
            elementId = `ai-item-${suggestion.id}`;
            setAIExpanded(true);
            if (!aiSelectedScenarios.includes(suggestion.id)) {
                setAISelectedScenarios(prev => [...prev, suggestion.id]);
            }
        }

        setTimeout(() => {
            const element = document.getElementById(elementId);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                element.classList.add('ring-2', 'ring-blue-500', 'dark:ring-blue-400', 'scale-[1.03]', 'shadow-[0_0_20px_rgba(59,130,246,0.4)]', 'z-10');
                setTimeout(() => {
                    element.classList.remove('ring-2', 'ring-blue-500', 'dark:ring-blue-400', 'scale-[1.03]', 'shadow-[0_0_20px_rgba(59,130,246,0.4)]', 'z-10');
                }, 2500);
            }
        }, 150);
    };

    const highlightText = (text: string, highlight: string) => {
        if (!highlight.trim()) return text;
        const parts = text.split(new RegExp(`(${highlight.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi'));
        return (
            <span>
                {parts.map((part, index) => 
                    part.toLowerCase() === highlight.toLowerCase() 
                        ? <mark key={index} className="bg-blue-500/30 text-text-primary rounded-sm px-0.5">{part}</mark>
                        : part
                )}
            </span>
        );
    };


    // EICAR targets selection
    const [cloudEicarUrl, setCloudEicarUrl] = useState('');
    const [cloudHasKey, setCloudHasKey] = useState(true);
    const [customEicarUrl, setCustomEicarUrl] = useState('');
    const [selectedEicarTargets, setSelectedEicarTargets] = useState<string[]>([]);
    const [securityTargets, setSecurityTargets] = useState<any[]>([]);
    const [targetReachability, setTargetReachability] = useState<Record<string, boolean | 'loading'>>({});
    const [runningEicarTarget, setRunningEicarTarget] = useState<string | null>(null);


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

        // Load security profile (catalogue: URL/DNS/EICAR/C2/AI)
        fetch('/api/security/profile', { headers: authHeaders() })
            .then(r => r.ok ? r.json() : null)
            .then(profile => {
                if (profile?.url_filtering?.items?.length) {
                    setSecurityProfile(profile);
                    // Re-initialize selection state from profile
                    setC2SelectedScenarios((profile.c2_scenarios || []).map((s: C2Scenario) => s.id));
                    setAISelectedScenarios((profile.ai_security_scenarios || []).map((s: AISecurityScenario) => s.id));
                }
            })
            .catch(() => { /* keep TS fallback */ });

        // Fetch shared targets with security capability
        fetch('/api/targets', { headers: authHeaders() })
            .then(r => r.json())
            .then(data => setSecurityTargets((Array.isArray(data) ? data : []).filter((t: any) => t.enabled && t.capabilities?.security)))
            .catch(() => { });

        // Fetch cloud eicar url
        fetch('/api/security/cloud-eicar-url', { headers: authHeaders() })
            .then(r => r.json())
            .then(data => {
                if (data.url) {
                    setCloudEicarUrl(data.url);
                    setCloudHasKey(data.hasKey !== false);
                    // Only auto-select if the key is configured
                    if (data.hasKey !== false) {
                        setSelectedEicarTargets(prev => prev.includes(data.url) ? prev : [...prev, data.url]);
                    }
                }
            })
            .catch(() => {});

        // Background polling for statistics and results (picks up scheduled + MCP-launched tests)
        const pollInterval = setInterval(() => {
            fetchConfig();
            fetchHealth();
            fetchResults(); // Refresh results so MCP/scheduled tests appear automatically
        }, 30000); // 30 seconds

        return () => clearInterval(pollInterval);
    }, []);

    // Initialize eicar targets from config only once
    const eicarInitialized = React.useRef(false);
    useEffect(() => {
        if (config?.threat_prevention && !eicarInitialized.current) {
            const saved = config.threat_prevention.eicar_endpoints;
            if (saved && Array.isArray(saved) && saved.length > 0) {
                // If cloud URL was already added by the other useEffect, we don't want to duplicate
                setSelectedEicarTargets(prev => Array.from(new Set([...prev, ...saved])));
            } else if (config.threat_prevention.eicar_endpoint) {
                // Legacy fallback
                setSelectedEicarTargets(prev => Array.from(new Set([...prev, config.threat_prevention.eicar_endpoint])));
            }
            eicarInitialized.current = true;
        }
    }, [config]);

    useEffect(() => {
        const targetsToPing: { host: string, port: number }[] = [];
        
        securityTargets.forEach(st => {
            if (!targetsToPing.find(t => t.host === st.host)) {
                // We must ping the Convergence UDP port (default 6200) for reachability, NOT the HTTP port
                targetsToPing.push({ host: st.host, port: st.ports?.convergence ?? 6200 }); 
            }
        });

        const checkReachability = async () => {
            // The Cloudflare worker does not respond to UDP pings, we assume it's reachable if configured
            if (cloudEicarUrl) {
                try { 
                    const host = new URL(cloudEicarUrl).hostname;
                    setTargetReachability(prev => ({ ...prev, [host]: true }));
                } catch {}
            }

            if (!targetsToPing.length) return;

            for (const t of targetsToPing) {
                setTargetReachability(prev => ({ ...prev, [t.host]: 'loading' }));
                try {
                    const res = await fetch('/api/convergence/reachability', {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ target: t.host, port: t.port })
                    });
                    const data = await res.json();
                    setTargetReachability(prev => ({ ...prev, [t.host]: !!data.reachable }));
                } catch {
                    setTargetReachability(prev => ({ ...prev, [t.host]: false }));
                }
            }
        };

        checkReachability();
        const interval = setInterval(checkReachability, 60000);
        return () => clearInterval(interval);
    }, [securityTargets, cloudEicarUrl, token]);



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

    const updateSchedule = async (type: 'url' | 'dns' | 'threat' | 'c2' | 'ai', enabled: boolean, minutes: number) => {
        if (!config) return;

        const newConfig = { ...config };
        if (!newConfig.scheduled_execution) {
            newConfig.scheduled_execution = {
                url: { enabled: false, interval_minutes: 15 },
                dns: { enabled: false, interval_minutes: 15 },
                threat: { enabled: false, interval_minutes: 30 }
            };
        }

        (newConfig.scheduled_execution as any)[type] = { enabled, interval_minutes: minutes };

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
                ...(testTypeFilter !== 'all' && { type: testTypeFilter === 'c2_scenario' ? 'c2' : testTypeFilter === 'ai_security' ? 'ai' : testTypeFilter })
            });

            const res = await fetch(`/api/security/results?${params}`, { headers: authHeaders() });
            const data = await res.json();

            // Map id to testId for frontend compatibility
            // Note: backend now uses type='c2' for c2_scenario entries
            const mappedResults = (data.results || []).map((r: any) => {
                const isC2 = r.type === 'c2';
                const isAI = r.type === 'ai';
                return {
                    ...r,
                    testId: r.id,
                    testType: isC2 ? 'c2_scenario' : isAI ? 'ai_security' : r.type,
                    testName: r.name,
                    previousStatus: r.previousStatus ?? null,
                    result: (isC2 || isAI) ? {
                        status: r.status,
                        output: r.details?.output,
                        command: r.details?.command,
                        verdict_reason: r.details?.verdict_reason,
                        domain: r.details?.domain,
                        url: r.details?.url,
                        http_code: r.details?.http_code,
                        dns_ip: r.details?.dns_ip,
                        attackType: r.details?.attackType,
                        scenarioId: r.details?.scenarioId,
                        app_results: r.details?.app_results,
                        reached_count: r.details?.reached_count,
                        total_count: r.details?.total_count,
                    } : { status: r.status, ...r.details }
                };
            });

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
        const visibleCats = securityProfile.url_filtering.items.filter(cat =>
            cat.name.toLowerCase().includes(urlSearchQuery.toLowerCase()) ||
            cat.url.toLowerCase().includes(urlSearchQuery.toLowerCase())
        );
        const visibleIds = visibleCats.map(cat => cat.id);
        const allVisibleEnabled = visibleIds.every(id => config.url_filtering.enabled_categories.includes(id));

        let newEnabled: string[];
        if (allVisibleEnabled) {
            newEnabled = config.url_filtering.enabled_categories.filter(id => !visibleIds.includes(id));
        } else {
            newEnabled = Array.from(new Set([...config.url_filtering.enabled_categories, ...visibleIds]));
        }

        saveConfig({
            url_filtering: { ...config.url_filtering, enabled_categories: newEnabled }
        });
    };

    const toggleAllDNSTests = () => {
        if (!config) return;
        const visibleTests = securityProfile.dns_security.items.filter(test =>
            test.name.toLowerCase().includes(dnsSearchQuery.toLowerCase()) ||
            test.domain.toLowerCase().includes(dnsSearchQuery.toLowerCase())
        );
        const visibleIds = visibleTests.map(test => test.id);
        const allVisibleEnabled = visibleIds.every(id => config.dns_security.enabled_tests.includes(id));

        let newEnabled: string[];
        if (allVisibleEnabled) {
            newEnabled = config.dns_security.enabled_tests.filter(id => !visibleIds.includes(id));
        } else {
            newEnabled = Array.from(new Set([...config.dns_security.enabled_tests, ...visibleIds]));
        }

        saveConfig({
            dns_security: { ...config.dns_security, enabled_tests: newEnabled }
        });
    };
    // Helper to notify of status changes during manual testing
    const notifyStatusChange = (testName: string, current: string, previous: string | null) => {
        if (!previous || current === previous) return;

        const isRegression = (previous === 'blocked' || previous === 'sinkholed') && 
                            (current !== 'blocked' && current !== 'sinkholed');
        const isImprovement = (current === 'blocked' || current === 'sinkholed') && 
                             (previous !== 'blocked' && previous !== 'sinkholed');

        if (isRegression) {
            showToast(`⚠️ REGRESSION: ${testName} is now ${current.toUpperCase()} (was ${previous.toUpperCase()})`, 'error');
        } else if (isImprovement) {
            showToast(`✅ FIXED: ${testName} is now ${current.toUpperCase()} (was ${previous.toUpperCase()})`, 'success');
        } else {
            showToast(`ℹ️ ${testName} status changed: ${previous} → ${current}`, 'info');
        }
    };

    const runURLTest = async (category: URLCategory) => {
        setTesting({ ...testing, [`url-${category.id}`]: true });
        try {
            const res = await fetch('/api/security/url-test', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: category.url, category: category.name })
            });
            const result = await res.json();
            if (result.status) {
                notifyStatusChange(category.name, result.status, result.previousStatus);
            }
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
            const enabledCategories = securityProfile.url_filtering.items.filter(cat =>
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

    const runDNSTest = async (test: DNSTestDomain) => {
        setTesting({ ...testing, [`dns-${test.id}`]: true });
        try {
            const res = await fetch('/api/security/dns-test', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain: test.domain, testName: test.name })
            });
            const data = await res.json();
            if (data.status) {
                notifyStatusChange(test.name, data.status, data.previousStatus);
            }
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
            const enabledTests = securityProfile.dns_security.items.filter(test =>
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

    // ── C2 Attack Scenarios ───────────────────────────────────────────────────
    // ── AI Security verdict badge (also used for C2 — shared logic) ──────────
    // Unified verdict badge — covers URL/DNS/EICAR (blocked/allowed/sinkholed)
    // AND C2/AI (enforced→Blocked, bypass→Allowed, inconclusive, completed)
    // Single source of truth for all test types.

    const runC2Test = async (scenario: C2Scenario) => {
        setTesting(prev => ({ ...prev, [`c2-${scenario.id}`]: true }));
        try {
            const res = await fetch('/api/security/c2-test', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scenarioId: scenario.id,
                    scenarioName: scenario.name,
                    attackType: scenario.attack_type,
                    target: scenario.target
                })
            });
            const data = await res.json();
            if (data.status) {
                const label = data.status === 'enforced' ? '✓ Blocked' : data.status === 'bypass' ? '⊗ Allowed' : '⚠ Inconclusive';
                showToast(`${scenario.name}: ${label}`, data.status === 'enforced' ? 'success' : data.status === 'bypass' ? 'error' : 'info');
            }
            await fetchResults();
        } catch (e) {
            console.error('C2 test failed:', e);
            showToast('C2 test failed', 'error');
        } finally {
            setTesting(prev => ({ ...prev, [`c2-${scenario.id}`]: false }));
        }
    };

    const runC2BatchTest = async () => {
        if (batchProcessingC2 || c2SelectedScenarios.length === 0) return;
        setBatchProcessingC2(true);
        showToast(`Running ${c2SelectedScenarios.length} C2 attack scenarios...`, 'info');
        try {
            const selectedScenarios = securityProfile.c2_scenarios
                .filter(s => c2SelectedScenarios.includes(s.id))
                .map(s => ({ scenarioId: s.id, scenarioName: s.name, attackType: s.attack_type, target: s.target }));
            await fetch('/api/security/c2-test-batch', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ scenarios: selectedScenarios })
            });
            // Poll for results after a delay (batch runs in background)
            setTimeout(async () => {
                await fetchResults();
                showToast('C2 batch completed!', 'success');
                setBatchProcessingC2(false);
            }, selectedScenarios.length * 4000 + 2000);
        } catch (e) {
            console.error('C2 batch failed:', e);
            showToast('C2 batch failed', 'error');
            setBatchProcessingC2(false);
        }
    };

    const toggleAllC2Scenarios = () => {
        const visibleScenarios = securityProfile.c2_scenarios.filter(scenario =>
            scenario.name.toLowerCase().includes(c2SearchQuery.toLowerCase()) ||
            scenario.target.toLowerCase().includes(c2SearchQuery.toLowerCase())
        );
        const visibleIds = visibleScenarios.map(s => s.id);
        const allVisibleSelected = visibleIds.every(id => c2SelectedScenarios.includes(id));

        if (allVisibleSelected) {
            setC2SelectedScenarios(c2SelectedScenarios.filter(id => !visibleIds.includes(id)));
        } else {
            setC2SelectedScenarios(Array.from(new Set([...c2SelectedScenarios, ...visibleIds])));
        }
    };

    // ── AI Security Test Functions ────────────────────────────────────────────
    const runAITest = async (scenario: AISecurityScenario) => {
        setTesting(prev => ({ ...prev, [`ai-${scenario.id}`]: true }));
        try {
            const res = await fetch('/api/security/ai-test', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scenarioId: scenario.id,
                    scenarioName: scenario.name,
                    attackType: scenario.attack_type,
                    targets: scenario.targets
                })
            });
            const data = await res.json();
            if (data.result?.status) {
                const s = data.result.status;
                const label = s === 'enforced' ? '✓ Blocked' : s === 'bypass' ? '⊗ Allowed' : s === 'completed' ? '✓ Completed' : '⚠ Inconclusive';
                showToast(`${scenario.name}: ${label}`, s === 'enforced' || s === 'completed' ? 'success' : s === 'bypass' ? 'error' : 'info');
            }
            await fetchResults();
        } catch (e) {
            console.error('AI test failed:', e);
            showToast('AI Security test failed', 'error');
        } finally {
            setTesting(prev => ({ ...prev, [`ai-${scenario.id}`]: false }));
        }
    };

    const runAIBatchTest = async () => {
        if (batchProcessingAI || aiSelectedScenarios.length === 0) return;
        setBatchProcessingAI(true);
        showToast(`Running ${aiSelectedScenarios.length} AI Security scenarios...`, 'info');
        try {
            const selectedScenarios = securityProfile.ai_security_scenarios
                .filter(s => aiSelectedScenarios.includes(s.id))
                .map(s => ({ scenarioId: s.id, scenarioName: s.name, attackType: s.attack_type, targets: s.targets }));
            await fetch('/api/security/ai-test-batch', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ scenarios: selectedScenarios })
            });
            setTimeout(async () => {
                await fetchResults();
                showToast('AI Security batch completed!', 'success');
                setBatchProcessingAI(false);
            }, selectedScenarios.length * 6000 + 2000); // volume test takes longer
        } catch (e) {
            console.error('AI batch failed:', e);
            showToast('AI Security batch failed', 'error');
            setBatchProcessingAI(false);
        }
    };

    const toggleAllAIScenarios = () => {
        const visibleScenarios = securityProfile.ai_security_scenarios.filter(scenario =>
            scenario.name.toLowerCase().includes(aiSearchQuery.toLowerCase()) ||
            scenario.description.toLowerCase().includes(aiSearchQuery.toLowerCase())
        );
        const visibleIds = visibleScenarios.map(s => s.id);
        const allVisibleSelected = visibleIds.every(id => aiSelectedScenarios.includes(id));

        if (allVisibleSelected) {
            setAISelectedScenarios(aiSelectedScenarios.filter(id => !visibleIds.includes(id)));
        } else {
            setAISelectedScenarios(Array.from(new Set([...aiSelectedScenarios, ...visibleIds])));
        }
    };


    const runThreatTest = async () => {
        const endpointsToTest = [...selectedEicarTargets];
        if (customEicarUrl && !endpointsToTest.includes(customEicarUrl)) {
            endpointsToTest.push(customEicarUrl);
        }

        if (endpointsToTest.length === 0) {
            showToast('Please select at least one target to test.', 'error');
            return;
        }

        setLoading(true);
        showToast(`Running EICAR threat test to ${endpointsToTest.length} targets...`, 'info');
        try {
            const res = await fetch('/api/security/threat-test', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: endpointsToTest })
            });
            await fetchResults();
            await fetchConfig();
            showToast('EICAR threat tests completed!', 'success');

            // Save endpoints to config for scheduled tests
            if (config) {
                saveConfig({
                    threat_prevention: { ...config.threat_prevention, eicar_endpoints: endpointsToTest }
                });
            }
        } catch (e) {
            console.error('Threat test failed:', e);
            showToast('Threat test failed', 'error');
        } finally {
            setLoading(false);
        }
    };

    const runSingleEicarTest = async (endpoint: string, e: React.MouseEvent) => {
        e.stopPropagation(); // prevent row selection toggle
        if (runningEicarTarget || loading) return;
        setRunningEicarTarget(endpoint);
        showToast(`Running EICAR test on ${endpoint}...`, 'info');
        try {
            await fetch('/api/security/threat-test', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: [endpoint] })
            });
            await fetchResults();
            await fetchConfig();
            showToast('EICAR test completed!', 'success');
        } catch (err) {
            console.error('Single EICAR test failed:', err);
            showToast('EICAR test failed', 'error');
        } finally {
            setRunningEicarTarget(null);
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

        if (status === 'blocked' || status === 'enforced') {
            return <span className="flex items-center gap-1 text-red-400 text-sm"><XCircle size={14} /> Blocked</span>;
        } else if (status === 'sinkholed') {
            return <span className="flex items-center gap-1 text-yellow-400 text-sm"><AlertTriangle size={14} /> Sinkholed</span>;
        } else if (status === 'allowed' || status === 'resolved' || status === 'bypass') {
            return <span className="flex items-center gap-1 text-green-400 text-sm"><CheckCircle size={14} /> Allowed</span>;
        } else if (status === 'completed') {
            return <span className="flex items-center gap-1 text-cyan-400 text-sm"><CheckCircle size={14} /> Completed{result.reached_count != null ? ` ${result.reached_count}/${result.total_count}` : ''}</span>;
        } else if (status === 'inconclusive') {
            return <span className="flex items-center gap-1 text-orange-400 text-sm"><AlertTriangle size={14} /> Inconclusive</span>;
        } else if (status === 'unreachable') {
            return <span className="flex items-center gap-1 text-orange-400 text-sm"><AlertTriangle size={14} /> Unreachable</span>;
        } else if (status === 'error') {
            return <span className="flex items-center gap-1 text-orange-400 text-sm"><XCircle size={14} /> Error</span>;
        } else {
            return <span className="flex items-center gap-1 text-text-muted text-sm"><Clock size={14} /> Unknown</span>;
        }
    };

    // ── Import / Export Security Profile ──────────────────────────────────
    const [importingProfile, setImportingProfile] = useState(false);

    const exportProfile = async () => {
        try {
            const res = await fetch('/api/security/profile', { headers: authHeaders() });
            const profile = await res.json();
            const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `security-profile-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Security profile exported successfully', 'success');
        } catch (e) {
            showToast('Failed to export security profile', 'error');
        }
    };

    const importProfile = async (file: File) => {
        setImportingProfile(true);
        try {
            const text = await file.text();
            const profile = JSON.parse(text);
            const res = await fetch('/api/security/profile', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(profile)
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Import failed');
            }
            const { profile: saved } = await res.json();
            setSecurityProfile(saved);
            // Re-sync selection state
            setC2SelectedScenarios((saved.c2_scenarios || []).map((s: C2Scenario) => s.id));
            setAISelectedScenarios((saved.ai_security_scenarios || []).map((s: AISecurityScenario) => s.id));
            showToast(`Profile imported: ${saved.url_filtering.items.length} URL categories, ${saved.dns_security.items.length} DNS domains`, 'success');
        } catch (e: any) {
            showToast(`Import failed: ${e.message}`, 'error');
        } finally {
            setImportingProfile(false);
        }
    };

    if (!config) {
        return <div className="p-8 text-center text-text-muted animate-pulse font-black tracking-widest text-xs">Loading security configuration...</div>;
    }

    const basicDNSTests = securityProfile.dns_security.items.filter(t => t.category === 'basic');
    const advancedDNSTests = securityProfile.dns_security.items.filter(t => t.category === 'advanced');

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

            {/* Dynamic Autocomplete Search Bar */}
            <div ref={searchRef} className="relative w-full z-20">
                <div className="relative">
                    <Search className="absolute left-4 top-3.5 text-text-muted" size={18} />
                    <input
                        type="text"
                        value={globalSearchQuery}
                        onChange={(e) => {
                            setGlobalSearchQuery(e.target.value);
                            setIsGlobalSearchFocused(true);
                        }}
                        onFocus={() => setIsGlobalSearchFocused(true)}
                        placeholder="Search security categories, domains, or attack scenarios (e.g., Phishing, Dating, SQL Injection, C2...)"
                        className="w-full bg-card border border-border hover:border-border/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 text-text-primary text-sm rounded-2xl pl-12 pr-10 py-3.5 outline-none transition-all shadow-sm"
                    />
                    {globalSearchQuery && (
                        <button
                            onClick={() => setGlobalSearchQuery('')}
                            className="absolute right-4 top-3.5 text-text-muted hover:text-text-primary transition-colors"
                        >
                            <XCircle size={18} />
                        </button>
                    )}
                </div>

                {isGlobalSearchFocused && suggestions.length > 0 && (
                    <div className="absolute z-50 w-full mt-2 bg-card/95 backdrop-blur-md border border-border rounded-2xl shadow-2xl max-h-80 overflow-y-auto p-2 space-y-1 divide-y divide-border/25">
                        {suggestions.map((suggestion) => {
                            const badgeColors = {
                                url: 'bg-red-500/10 border-red-500/20 text-red-500 dark:text-red-400',
                                dns: 'bg-blue-500/10 border-blue-500/20 text-blue-500 dark:text-blue-400',
                                c2: 'bg-purple-500/10 border-purple-500/20 text-purple-500 dark:text-purple-400',
                                ai: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-500 dark:text-cyan-400',
                            };
                            const typeLabels = {
                                url: 'URL Category',
                                dns: 'DNS Test',
                                c2: 'C2 Scenario',
                                ai: 'AI Security',
                            };

                            return (
                                <button
                                    key={`${suggestion.type}-${suggestion.id}`}
                                    onClick={() => handleSelectSuggestion(suggestion)}
                                    className="w-full text-left px-4 py-3 hover:bg-card-hover/80 rounded-xl transition-colors flex items-center justify-between gap-4 group border-none outline-none"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded border ${badgeColors[suggestion.type]}`}>
                                            {typeLabels[suggestion.type]}
                                        </span>
                                        <div className="min-w-0">
                                            <div className="text-xs font-black text-text-primary group-hover:text-blue-500 transition-colors">
                                                {highlightText(suggestion.name, globalSearchQuery)}
                                            </div>
                                            <div className="text-[10px] text-text-muted truncate mt-0.5 font-mono opacity-80">
                                                {highlightText(suggestion.detail, globalSearchQuery)}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        {suggestion.isActive ? (
                                            <span className="flex items-center gap-1 text-[10px] text-green-500 font-bold bg-green-500/10 border border-green-500/25 px-2 py-0.5 rounded-full">
                                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                                Active
                                            </span>
                                        ) : (
                                            <span className="text-[10px] text-text-muted font-bold bg-card-secondary border border-border px-2 py-0.5 rounded-full">
                                                Inactive
                                            </span>
                                        )}
                                        <ChevronRight size={14} className="text-text-muted group-hover:text-text-primary transition-colors group-hover:translate-x-0.5 transform transition-transform" />
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Import / Export Security Profile */}
            <div className="flex items-center justify-between bg-card-secondary border border-border rounded-xl px-4 py-3">
                <div className="flex items-center gap-2">
                    <FileJson size={15} className="text-text-muted" />
                    <div>
                        <span className="text-[11px] font-black text-text-primary tracking-tight">Security Profile</span>
                        <span className="text-[10px] text-text-muted ml-2 font-medium">
                            {securityProfile.url_filtering.items.length} URL · {securityProfile.dns_security.items.length} DNS · {securityProfile.c2_scenarios.length} C2 · {securityProfile.ai_security_scenarios.length} AI
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {/* Import */}
                    <label
                        htmlFor="security-profile-import"
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black tracking-wide border cursor-pointer transition-all select-none
                            ${ importingProfile
                                ? 'opacity-50 cursor-not-allowed bg-card-secondary border-border text-text-muted'
                                : 'bg-blue-600/10 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-600/20 hover:border-blue-500/50'
                            }`}
                    >
                        <Upload size={12} />
                        {importingProfile ? 'Importing…' : 'Import'}
                    </label>
                    <input
                        id="security-profile-import"
                        type="file"
                        accept=".json,application/json"
                        className="hidden"
                        disabled={importingProfile}
                        onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) importProfile(file);
                            e.target.value = '';
                        }}
                    />
                    {/* Export */}
                    <button
                        onClick={exportProfile}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black tracking-wide border bg-green-600/10 border-green-500/30 text-green-600 dark:text-green-400 hover:bg-green-600/20 hover:border-green-500/50 transition-all"
                    >
                        <Download size={12} />
                        Export
                    </button>
                </div>
            </div>

            <ScoreDashboard 
                scores={scores} 
                loading={scoresLoading} 
                urlBaseline={urlBaseline} 
                dnsBaseline={dnsBaseline} 
                threatBaseline={threatBaseline} 
                handleSetBaseline={handleSetBaseline} 
            />

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
                                <span className="text-[10px] font-black tracking-widest opacity-80">URL Filtering</span>
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
                                    <div className="text-[10px] font-black text-text-muted tracking-widest opacity-60">Allowed</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* URL Filtering */}
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                <button
                    onClick={() => setUrlExpanded(!urlExpanded)}
                    className="w-full px-6 py-4 flex items-center justify-between bg-card-secondary/50 hover:bg-card-hover transition-all border-b border-border"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-red-600/10 rounded-lg text-red-600 dark:text-red-400 border border-red-500/20">
                            <Link size={18} />
                        </div>
                        <div className="text-left">
                            <h3 className="text-sm font-black text-text-primary tracking-tight">URL Filtering</h3>
                            <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest opacity-70">
                                {config.url_filtering.enabled_categories.length} / {securityProfile.url_filtering.items.length} Categories Active
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" size={12} />
                            <input
                                type="text"
                                placeholder="Search URL cats..."
                                value={urlSearchQuery}
                                onChange={(e) => {
                                    setUrlSearchQuery(e.target.value);
                                    if (!urlExpanded) setUrlExpanded(true);
                                }}
                                onFocus={() => {
                                    if (!urlExpanded) setUrlExpanded(true);
                                }}
                                className="bg-card/50 border border-border/80 focus:border-red-500 focus:ring-1 focus:ring-red-500/20 text-text-primary text-xs rounded-lg pl-7 pr-7 py-1 outline-none transition-all w-32 focus:w-44"
                            />
                            {urlSearchQuery && (
                                <button
                                    onClick={() => setUrlSearchQuery('')}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                                >
                                    <XCircle size={12} />
                                </button>
                            )}
                        </div>
                        <div className="cursor-pointer text-text-muted hover:text-text-primary transition-colors p-1" onClick={() => setUrlExpanded(!urlExpanded)}>
                            {urlExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        </div>
                    </div>
                </button>

                {urlExpanded && (() => {
                    const visibleCats = securityProfile.url_filtering.items.filter(category =>
                        category.name.toLowerCase().includes(urlSearchQuery.toLowerCase()) ||
                        category.url.toLowerCase().includes(urlSearchQuery.toLowerCase())
                    );
                    const visibleCatIds = visibleCats.map(c => c.id);
                    const allVisibleCatsEnabled = visibleCatIds.length > 0 && visibleCatIds.every(id => config.url_filtering.enabled_categories.includes(id));

                    return (
                        <div className="p-6 space-y-6">
                            <div className="flex flex-wrap items-center justify-between gap-4">
                                <div className="flex flex-wrap items-center gap-6">
                                    <label className="flex items-center gap-2 cursor-pointer group">
                                        <div className="relative flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={allVisibleCatsEnabled}
                                                onChange={toggleAllURLCategories}
                                                className="w-4 h-4 rounded border-border bg-card-secondary text-red-600 focus:ring-1 focus:ring-red-500 outline-none transition-all"
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

                            {visibleCats.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-96 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-border">
                                    {visibleCats.map(category => {
                                        const isEnabled = config.url_filtering.enabled_categories.includes(category.id);
                                        const isTesting = testing[`url-${category.id}`];
                                        const lastResult = testResults.find(r =>
                                            (r.testType === 'url_filtering' || r.testType === 'url') && r.testName === category.name
                                        );

                                        return (
                                            <div
                                                key={category.id}
                                                id={`url-item-${category.id}`}
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
                                                            onClick={() => copyToClipboard(`curl -fsS --max-time 10 -o /dev/null -w '%{http_code}' '${category.url}'`)}
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
                            ) : (
                                <div className="flex flex-col items-center justify-center py-10 px-4 bg-card-secondary/20 rounded-xl border border-dashed border-border/60">
                                    <ShieldAlert className="text-text-muted opacity-40 mb-2" size={24} />
                                    <p className="text-xs font-bold text-text-muted tracking-wide text-center">No categories found matching "{urlSearchQuery}"</p>
                                </div>
                            )}

                            {(urlDiff || scores.find((s: any) => s.type === 'url')) && (
                                <div className="pt-2 border-t border-border mt-6">
                                    <ScoreLatestChanges type="url" scores={scores} />
                                    <ScoreGapAnalysis diff={urlDiff} title="URL Filtering" />
                                </div>
                            )}
                        </div>
                    );
                })()}
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
                        <div className="text-left">
                            <h3 className="text-sm font-black text-text-primary tracking-tight">DNS Security Tests</h3>
                            <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest opacity-70">
                                {config.dns_security.enabled_tests.length} / {securityProfile.dns_security.items.length} Domains Active
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" size={12} />
                            <input
                                type="text"
                                placeholder="Search DNS tests..."
                                value={dnsSearchQuery}
                                onChange={(e) => {
                                    setDnsSearchQuery(e.target.value);
                                    if (!dnsExpanded) setDnsExpanded(true);
                                }}
                                onFocus={() => {
                                    if (!dnsExpanded) setDnsExpanded(true);
                                }}
                                className="bg-card/50 border border-border/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 text-text-primary text-xs rounded-lg pl-7 pr-7 py-1 outline-none transition-all w-32 focus:w-44"
                            />
                            {dnsSearchQuery && (
                                <button
                                    onClick={() => setDnsSearchQuery('')}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                                >
                                    <XCircle size={12} />
                                </button>
                            )}
                        </div>
                        <div className="cursor-pointer text-text-muted hover:text-text-primary transition-colors p-1" onClick={() => setDnsExpanded(!dnsExpanded)}>
                            {dnsExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        </div>
                    </div>
                </button>

                {dnsExpanded && (() => {
                    const visibleBasicDNS = basicDNSTests.filter(test =>
                        test.name.toLowerCase().includes(dnsSearchQuery.toLowerCase()) ||
                        test.domain.toLowerCase().includes(dnsSearchQuery.toLowerCase())
                    );
                    const visibleAdvancedDNS = advancedDNSTests.filter(test =>
                        test.name.toLowerCase().includes(dnsSearchQuery.toLowerCase()) ||
                        test.domain.toLowerCase().includes(dnsSearchQuery.toLowerCase())
                    );
                    const visibleTests = [...visibleBasicDNS, ...visibleAdvancedDNS];
                    const visibleIds = visibleTests.map(t => t.id);
                    const allVisibleTestsEnabled = visibleIds.length > 0 && visibleIds.every(id => config.dns_security.enabled_tests.includes(id));

                    return (
                        <div className="p-6 space-y-8">
                            <div className="flex flex-wrap items-center justify-between gap-4">
                                <div className="flex flex-wrap items-center gap-6">
                                    <label className="flex items-center gap-2 cursor-pointer group">
                                        <div className="relative flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={allVisibleTestsEnabled}
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
                                            : "bg-blue-600 hover:bg-blue-500 text-white shadow-red-900/40"
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

                            {visibleTests.length > 0 ? (
                                <>
                                    {/* Basic DNS Tests */}
                                    {visibleBasicDNS.length > 0 && (
                                        <div>
                                            <h4 className="text-[10px] font-black text-text-muted tracking-[0.2em] mb-4 border-l-2 border-blue-600 dark:border-blue-400 pl-2">Critical DNS Threats</h4>
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-80 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-border">
                                                {visibleBasicDNS.map(test => {
                                                    const isEnabled = config.dns_security.enabled_tests.includes(test.id);
                                                    const isTesting = testing[`dns-${test.id}`];
                                                    const lastResult = testResults.find(r =>
                                                        (r.testType === 'dns_security' || r.testType === 'dns') && r.testName === test.name
                                                    );

                                                    return (
                                                        <div
                                                            key={test.id}
                                                            id={`dns-item-${test.id}`}
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
                                                                        onClick={() => copyToClipboard(`nslookup -timeout=2 ${test.domain}`)}
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
                                    )}

                                    {/* Advanced DNS Tests */}
                                    {visibleAdvancedDNS.length > 0 && (
                                        <div>
                                            <h4 className="text-[10px] font-black text-text-muted tracking-[0.2em] mb-4 border-l-2 border-purple-600 dark:border-purple-400 pl-2">Advanced DNS Security</h4>
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-80 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-border">
                                                {visibleAdvancedDNS.map(test => {
                                                    const isEnabled = config.dns_security.enabled_tests.includes(test.id);
                                                    const isTesting = testing[`dns-${test.id}`];
                                                    const lastResult = testResults.find(r =>
                                                        (r.testType === 'dns_security' || r.testType === 'dns') && r.testName === test.name
                                                    );

                                                    return (
                                                        <div
                                                            key={test.id}
                                                            id={`dns-item-${test.id}`}
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
                                                                        onClick={() => copyToClipboard(`nslookup -timeout=2 ${test.domain}`)}
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
                                    )}
                                </>
                            ) : (
                                <div className="flex flex-col items-center justify-center py-10 px-4 bg-card-secondary/20 rounded-xl border border-dashed border-border/60">
                                    <ShieldAlert className="text-text-muted opacity-40 mb-2" size={24} />
                                    <p className="text-xs font-bold text-text-muted tracking-wide text-center">No DNS tests found matching "{dnsSearchQuery}"</p>
                                </div>
                            )}

                            {(dnsDiff || scores.find((s: any) => s.type === 'dns')) && (
                                <div className="pt-2 border-t border-border mt-6">
                                    <ScoreLatestChanges type="dns" scores={scores} />
                                    <ScoreGapAnalysis diff={dnsDiff} title="DNS Protect" />
                                </div>
                            )}
                        </div>
                    );
                })()}
            </div>

            {/* Threat Prevention Tests */}
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                <button
                    onClick={() => setThreatExpanded(!threatExpanded)}
                    className="w-full px-6 py-4 flex items-center justify-between bg-card-secondary hover:bg-card-hover transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <Shield size={20} className="text-red-400" />
                        <h3 className="text-lg font-semibold text-foreground">Threat Prevention (Eicar)</h3>
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
                                    <label className="text-[10px] font-black text-text-muted tracking-widest mb-3 flex items-center gap-2">
                                        <ShieldAlert size={14} className="text-red-500" />
                                        Select Target endpoints to test
                                    </label>
                                    
                                    <div className="flex flex-col gap-2 max-h-[350px] overflow-y-auto pr-1">
                                        {/* Cloudflare Worker Target */}
                                        {cloudEicarUrl && (() => {
                                            const isSelected = selectedEicarTargets.includes(cloudEicarUrl);
                                            let host = '';
                                            try { host = new URL(cloudEicarUrl).hostname; } catch {}
                                            const status = targetReachability[host];
                                            const disabled = !cloudHasKey;

                                            return (
                                                <div
                                                    onClick={() => {
                                                        if (disabled) return;
                                                        setSelectedEicarTargets(prev => isSelected ? prev.filter(u => u !== cloudEicarUrl) : [...prev, cloudEicarUrl]);
                                                    }}
                                                    className={`bg-card border px-4 py-3 rounded-xl group transition-all flex items-center gap-3 shadow-sm ${
                                                        disabled
                                                            ? 'opacity-50 cursor-not-allowed border-amber-500/30 bg-amber-500/5'
                                                            : `cursor-pointer hover:shadow-md ${isSelected ? 'border-red-500 bg-red-600/5 shadow-red-500/10' : 'border-border'}`
                                                    }`}
                                                >
                                                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all shrink-0 ${isSelected && !disabled ? 'bg-red-600 border-red-500' : 'bg-card-secondary border-border'}`}>
                                                        {isSelected && !disabled && <CheckCircle size={10} className="text-white" fill="currentColor" />}
                                                    </div>
                                                    <div className="flex flex-col min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <h4 className={`text-xs font-bold transition-colors tracking-tight truncate ${isSelected && !disabled ? 'text-red-500' : 'text-text-primary'}`}>Stigix Cloud (Public Worker)</h4>
                                                            {disabled && (
                                                                <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 tracking-wide whitespace-nowrap shrink-0">
                                                                    ⚠ Requires STIGIX_TARGET_MASTER_KEY
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-[9px] text-text-muted font-mono mt-0.5 truncate">{cloudEicarUrl}</p>
                                                        {disabled && (
                                                            <p className="text-[8px] text-amber-600 dark:text-amber-500 mt-1">
                                                                Configure your key in{' '}
                                                                {onGoToCloudSettings ? (
                                                                    <button
                                                                        onClick={onGoToCloudSettings}
                                                                        className="underline underline-offset-2 hover:text-amber-400 transition-colors font-black"
                                                                    >
                                                                        Settings → Cloud Target Security
                                                                    </button>
                                                                ) : (
                                                                    <span>Settings → Cloud Target Security</span>
                                                                )}{' '}
                                                                to enable this endpoint.
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-1.5 ml-2 border-l border-border/50 pl-3">
                                                        {/* Status dot */}
                                                        {disabled ? (
                                                            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="Key not configured" />
                                                        ) : status === 'loading' || status === undefined ? (
                                                            <div className="w-1.5 h-1.5 rounded-full bg-border animate-pulse shrink-0" title="Checking reachability..." />
                                                        ) : status ? (
                                                            <div className="relative flex h-2 w-2 items-center justify-center shrink-0" title="Reachable">
                                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" style={{ animationDuration: '3s' }}></span>
                                                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
                                                            </div>
                                                        ) : (
                                                            <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)] shrink-0" title="Unreachable" />
                                                        )}
                                                        {/* Copy curl command button */}
                                                        {!disabled && (
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); copyToClipboard(`curl -fsS --max-time 20 "${cloudEicarUrl}" -o /tmp/eicar.com.txt && rm -f /tmp/eicar.com.txt`); }}
                                                                title="Copy curl command"
                                                                className="w-6 h-6 flex items-center justify-center rounded bg-card-hover hover:bg-card-secondary text-text-muted hover:text-text-primary transition-colors shrink-0"
                                                            >
                                                                <Copy size={10} />
                                                            </button>
                                                        )}
                                                        {/* Individual play button */}
                                                        {!disabled && (
                                                            <button
                                                                onClick={(e) => runSingleEicarTest(cloudEicarUrl, e)}
                                                                disabled={!!runningEicarTarget || loading}
                                                                title="Run EICAR test on this target"
                                                                className="w-6 h-6 flex items-center justify-center rounded bg-red-600/10 hover:bg-red-600/25 text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
                                                            >
                                                                {runningEicarTarget === cloudEicarUrl ? (
                                                                    <span className="w-3 h-3 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                                                                ) : (
                                                                    <Play size={10} fill="currentColor" />
                                                                )}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {/* Dynamic Stigix Targets */}
                                        {securityTargets.map((t) => {
                                            const url = `http://${t.host}:${t.ports?.http ?? 8082}/eicar.com.txt`;
                                            const isSelected = selectedEicarTargets.includes(url);
                                            const status = targetReachability[t.host];

                                            return (
                                                <div
                                                    key={`tgt-${t.id}`}
                                                    onClick={() => {
                                                        setSelectedEicarTargets(prev => isSelected ? prev.filter(u => u !== url) : [...prev, url]);
                                                    }}
                                                    className={`bg-card border px-4 py-3 rounded-xl group cursor-pointer transition-all flex items-center gap-3 shadow-sm hover:shadow-md ${isSelected ? 'border-red-500 bg-red-600/5 shadow-red-500/10' : 'border-border'}`}
                                                >
                                                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all shrink-0 ${isSelected ? 'bg-red-600 border-red-500' : 'bg-card-secondary border-border'}`}>
                                                        {isSelected && <CheckCircle size={10} className="text-white" fill="currentColor" />}
                                                    </div>
                                                    <div className="flex flex-col min-w-0 flex-1">
                                                        <h4 className={`text-xs font-bold transition-colors tracking-tight truncate ${isSelected ? 'text-red-500' : 'text-text-primary'}`}>{t.name}</h4>
                                                        <p className="text-[9px] text-text-muted font-mono mt-0.5 truncate">{url}</p>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 ml-2 border-l border-border/50 pl-3">
                                                        {/* Status dot */}
                                                        {status === 'loading' || status === undefined ? (
                                                            <div className="w-1.5 h-1.5 rounded-full bg-border animate-pulse shrink-0" title="Checking reachability..." />
                                                        ) : status ? (
                                                            <div className="relative flex h-2 w-2 items-center justify-center shrink-0" title="Reachable">
                                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" style={{ animationDuration: '3s' }}></span>
                                                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
                                                            </div>
                                                        ) : (
                                                            <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)] shrink-0" title="Unreachable" />
                                                        )}
                                                        {/* Copy curl command button */}
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); copyToClipboard(`curl -fsS --max-time 20 "${url}" -o /tmp/eicar.com.txt && rm -f /tmp/eicar.com.txt`); }}
                                                            title="Copy curl command"
                                                            className="w-6 h-6 flex items-center justify-center rounded bg-card-hover hover:bg-card-secondary text-text-muted hover:text-text-primary transition-colors shrink-0"
                                                        >
                                                            <Copy size={10} />
                                                        </button>
                                                        {/* Individual play button */}
                                                        <button
                                                            onClick={(e) => runSingleEicarTest(url, e)}
                                                            disabled={!!runningEicarTarget || loading}
                                                            title="Run EICAR test on this target"
                                                            className="w-6 h-6 flex items-center justify-center rounded bg-red-600/10 hover:bg-red-600/25 text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
                                                        >
                                                            {runningEicarTarget === url ? (
                                                                <span className="w-3 h-3 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                                                            ) : (
                                                                <Play size={10} fill="currentColor" />
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                                
                                <div className="mt-4 pt-4 border-t border-border">
                                    <label className="text-[10px] font-black text-text-muted tracking-widest mb-1.5 block">Custom Endpoint URL (Optional)</label>
                                    <input
                                        type="text"
                                        value={customEicarUrl}
                                        onChange={(e) => setCustomEicarUrl(e.target.value)}
                                        placeholder="http://your-server.com/eicar.com.txt"
                                        className="w-full bg-card-secondary border border-border text-text-primary rounded-lg px-4 py-2 focus:border-red-500 outline-none text-sm"
                                    />
                                </div>

                                <div className="flex gap-2">
                                    <button
                                        onClick={() => {
                                            const urls = [...selectedEicarTargets];
                                            if (customEicarUrl && !urls.includes(customEicarUrl)) urls.push(customEicarUrl);
                                            if (urls.length === 0) return showToast('Select a target first', 'error');
                                            copyToClipboard(`curl -fsS --max-time 20 "${urls[0]}" -o /tmp/eicar.com.txt && rm -f /tmp/eicar.com.txt`);
                                        }}
                                        className="px-4 py-3 bg-card-hover hover:bg-card border border-border text-text-primary rounded-lg font-medium transition-colors flex items-center justify-center gap-2 text-sm"
                                        title="Copy CLI command"
                                    >
                                        <Copy size={16} /> Copy Command
                                    </button>
                                    <button
                                        onClick={runThreatTest}
                                        disabled={loading || (selectedEicarTargets.length === 0 && !customEicarUrl) || (systemHealth && !systemHealth.ready)}
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

            {/* C2 Attack Scenarios */}
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                <button
                    onClick={() => setC2Expanded(!c2Expanded)}
                    className="w-full px-6 py-4 flex items-center justify-between bg-card-secondary/50 hover:bg-card-hover transition-all border-b border-border"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-600/10 rounded-lg text-purple-600 dark:text-purple-400 border border-purple-500/20">
                            <ShieldAlert size={18} />
                        </div>
                        <div className="text-left">
                            <div className="flex items-center gap-2">
                                <h3 className="text-sm font-black text-text-primary tracking-tight">C2 Attack Scenarios</h3>
                                <span className="px-1.5 py-0.5 text-[8px] font-black tracking-widest uppercase bg-blue-500/10 text-blue-500 dark:text-blue-400 border border-blue-500/20 rounded-md">Beta</span>
                            </div>
                            <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest opacity-70">
                                {c2SelectedScenarios.length} / {securityProfile.c2_scenarios.length} Scenarios Active
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" size={12} />
                            <input
                                type="text"
                                placeholder="Search C2..."
                                value={c2SearchQuery}
                                onChange={(e) => {
                                    setC2SearchQuery(e.target.value);
                                    if (!c2Expanded) setC2Expanded(true);
                                }}
                                onFocus={() => {
                                    if (!c2Expanded) setC2Expanded(true);
                                }}
                                className="bg-card/50 border border-border/80 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20 text-text-primary text-xs rounded-lg pl-7 pr-7 py-1 outline-none transition-all w-32 focus:w-44"
                            />
                            {c2SearchQuery && (
                                <button
                                    onClick={() => setC2SearchQuery('')}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                                >
                                    <XCircle size={12} />
                                </button>
                            )}
                        </div>
                        <div className="cursor-pointer text-text-muted hover:text-text-primary transition-colors p-1" onClick={() => setC2Expanded(!c2Expanded)}>
                            {c2Expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        </div>
                    </div>
                </button>

                {c2Expanded && (() => {
                    const visibleScenarios = securityProfile.c2_scenarios.filter(scenario =>
                        scenario.name.toLowerCase().includes(c2SearchQuery.toLowerCase()) ||
                        scenario.target.toLowerCase().includes(c2SearchQuery.toLowerCase())
                    );
                    const visibleIds = visibleScenarios.map(s => s.id);
                    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => c2SelectedScenarios.includes(id));

                    return (
                        <div className="p-6 space-y-6">
                            {/* Controls row */}
                            <div className="flex flex-wrap items-center justify-between gap-4">
                                <div className="flex flex-wrap items-center gap-6">
                                    <label className="flex items-center gap-2 cursor-pointer group">
                                        <div className="relative flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={allVisibleSelected}
                                                onChange={toggleAllC2Scenarios}
                                                className="w-4 h-4 rounded border-border bg-card-secondary text-purple-600 focus:ring-1 focus:ring-purple-500 outline-none transition-all"
                                            />
                                        </div>
                                        <span className="text-[10px] font-black uppercase tracking-widest text-text-muted group-hover:text-text-primary transition-colors">Select All</span>
                                    </label>

                                    {/* C2 Scheduler — same pattern as DNS/URL */}
                                    <SchedulerSettings type="c2" title="C2" config={config} onUpdate={updateSchedule} />
                                </div>
                                <button
                                    onClick={runC2BatchTest}
                                    disabled={batchProcessingC2 || c2SelectedScenarios.length === 0}
                                    className={cn(
                                        "px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg flex items-center gap-2",
                                        batchProcessingC2
                                            ? "bg-card-secondary text-text-muted border border-border cursor-not-allowed"
                                            : "bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/40"
                                    )}
                                >
                                    {batchProcessingC2 ? (
                                        <><RefreshCcw size={16} className="animate-spin" /> Testing...</>
                                    ) : (
                                        <><Play size={16} fill="currentColor" /> Run Selected Scenarios</>
                                    )}
                                </button>
                            </div>

                            {/* Section separator */}
                            <div>
                                <h4 className="text-[10px] font-black text-text-muted tracking-[0.2em] mb-4 border-l-2 border-purple-600 dark:border-purple-400 pl-2">Attack Simulation Scenarios</h4>
                                {visibleScenarios.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {visibleScenarios.map(scenario => {
                                            const isEnabled = c2SelectedScenarios.includes(scenario.id);
                                            const isTesting = testing[`c2-${scenario.id}`];
                                            const lastResult = testResults.find(r =>
                                                r.testType === 'c2_scenario' && r.testName === scenario.name
                                            );

                                            return (
                                                <div
                                                    key={scenario.id}
                                                    id={`c2-item-${scenario.id}`}
                                                    className={cn(
                                                        "bg-card border rounded-xl p-3 flex items-center justify-between transition-all group hover:shadow-md",
                                                        isEnabled ? "border-purple-500/20 shadow-sm" : "border-border opacity-60 hover:opacity-100"
                                                    )}
                                                >
                                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                                        <input
                                                            type="checkbox"
                                                            checked={isEnabled}
                                                            onChange={() => setC2SelectedScenarios(prev =>
                                                                prev.includes(scenario.id) ? prev.filter(id => id !== scenario.id) : [...prev, scenario.id]
                                                            )}
                                                            className="w-4 h-4 rounded border-border bg-card-secondary text-purple-600 focus:ring-1 focus:ring-purple-500 outline-none transition-all"
                                                        />
                                                        <div className="min-w-0 pr-2">
                                                            <div className={cn("text-xs font-black tracking-tight truncate", isEnabled ? "text-text-primary" : "text-text-muted")}>
                                                                {scenario.name}
                                                            </div>
                                                            <div className="text-[9px] text-text-muted font-mono truncate opacity-60 group-hover:opacity-100 transition-opacity">
                                                                {scenario.target}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {lastResult && getStatusBadge(lastResult.result)}
                                                        <div className="flex gap-1.5 ml-2 p-1 bg-card-secondary/50 rounded-lg border border-border/50">
                                                            <button
                                                                onClick={() => copyToClipboard(scenario.cliHint)}
                                                                className="p-1.5 hover:bg-card border border-transparent hover:border-border rounded-lg text-text-muted hover:text-purple-600 transition-all"
                                                                title="Copy CLI command"
                                                            >
                                                                <Copy size={13} />
                                                            </button>
                                                            <button
                                                                onClick={() => runC2Test(scenario)}
                                                                disabled={isTesting}
                                                                className="p-1.5 hover:bg-card border border-transparent hover:border-border rounded-lg text-text-muted hover:text-purple-600 transition-all disabled:opacity-50"
                                                                title="Run this scenario"
                                                            >
                                                                {isTesting ? <RefreshCcw size={13} className="animate-spin" /> : <Play size={13} fill="currentColor" />}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-10 px-4 bg-card-secondary/20 rounded-xl border border-dashed border-border/60">
                                        <ShieldAlert className="text-text-muted opacity-40 mb-2" size={24} />
                                        <p className="text-xs font-bold text-text-muted tracking-wide text-center">No C2 scenarios found matching "{c2SearchQuery}"</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })()}
            </div>

            {/* AI Security Tests */}

            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                <button
                    onClick={() => setAIExpanded(!aiExpanded)}
                    className="w-full px-6 py-4 flex items-center justify-between bg-card-secondary/50 hover:bg-card-hover transition-all border-b border-border"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-cyan-600/10 rounded-lg text-cyan-600 dark:text-cyan-400 border border-cyan-500/20">
                            <Zap size={18} />
                        </div>
                        <div className="text-left">
                            <div className="flex items-center gap-2">
                                <h3 className="text-sm font-black text-text-primary tracking-tight">AI Security Tests</h3>
                                <span className="px-1.5 py-0.5 text-[8px] font-black tracking-widest uppercase bg-blue-500/10 text-blue-500 dark:text-blue-400 border border-blue-500/20 rounded-md">Beta</span>
                            </div>
                            <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest opacity-70">
                                {aiSelectedScenarios.length} / {securityProfile.ai_security_scenarios.length} Scenarios Active · Palo Alto AI Security (AISA)
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" size={12} />
                            <input
                                type="text"
                                placeholder="Search AI..."
                                value={aiSearchQuery}
                                onChange={(e) => {
                                    setAiSearchQuery(e.target.value);
                                    if (!aiExpanded) setAIExpanded(true);
                                }}
                                onFocus={() => {
                                    if (!aiExpanded) setAIExpanded(true);
                                }}
                                className="bg-card/50 border border-border/80 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 text-text-primary text-xs rounded-lg pl-7 pr-7 py-1 outline-none transition-all w-32 focus:w-44"
                            />
                            {aiSearchQuery && (
                                <button
                                    onClick={() => setAiSearchQuery('')}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                                >
                                    <XCircle size={12} />
                                </button>
                            )}
                        </div>
                        <div className="cursor-pointer text-text-muted hover:text-text-primary transition-colors p-1" onClick={() => setAIExpanded(!aiExpanded)}>
                            {aiExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        </div>
                    </div>
                </button>

                {aiExpanded && (() => {
                    const visibleScenarios = securityProfile.ai_security_scenarios.filter(scenario =>
                        scenario.name.toLowerCase().includes(aiSearchQuery.toLowerCase()) ||
                        scenario.description.toLowerCase().includes(aiSearchQuery.toLowerCase())
                    );
                    const visibleIds = visibleScenarios.map(s => s.id);
                    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => aiSelectedScenarios.includes(id));

                    return (
                        <div className="p-6 space-y-6">
                            {/* Controls row */}
                            <div className="flex flex-wrap items-center justify-between gap-4">
                                <div className="flex flex-wrap items-center gap-6">
                                    <label className="flex items-center gap-2 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={allVisibleSelected}
                                            onChange={toggleAllAIScenarios}
                                            className="w-4 h-4 rounded border-border bg-card-secondary text-cyan-600 focus:ring-1 focus:ring-cyan-500 outline-none transition-all"
                                        />
                                        <span className="text-[10px] font-black uppercase tracking-widest text-text-muted group-hover:text-text-primary transition-colors">Select All</span>
                                    </label>

                                    {/* AI Scheduler */}
                                    <SchedulerSettings type="ai" title="AI" config={config} onUpdate={updateSchedule} />
                                </div>
                                <button
                                    onClick={runAIBatchTest}
                                    disabled={batchProcessingAI || aiSelectedScenarios.length === 0}
                                    className={cn(
                                        "px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg flex items-center gap-2",
                                        batchProcessingAI
                                            ? "bg-card-secondary text-text-muted border border-border cursor-not-allowed"
                                            : "bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-900/40"
                                    )}
                                >
                                    {batchProcessingAI ? (
                                        <><RefreshCcw size={16} className="animate-spin" /> Testing...</>
                                    ) : (
                                        <><Play size={16} fill="currentColor" /> Run Selected Scenarios</>
                                    )}
                                </button>
                            </div>

                            <div>
                                <h4 className="text-[10px] font-black text-text-muted tracking-[0.2em] mb-4 border-l-2 border-cyan-600 dark:border-cyan-400 pl-2">AI Security Attack Scenarios</h4>
                                {visibleScenarios.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {visibleScenarios.map(scenario => {
                                            const isEnabled = aiSelectedScenarios.includes(scenario.id);
                                            const isTesting = testing[`ai-${scenario.id}`];
                                            const lastResult = testResults.find(r =>
                                                r.testType === 'ai_security' && r.testName === scenario.name
                                            );
                                            const isVolumeTest = scenario.attack_type === 'ai_volume_traffic';

                                            return (
                                                <div
                                                    key={scenario.id}
                                                    id={`ai-item-${scenario.id}`}
                                                    className={cn(
                                                        "relative p-4 rounded-xl border transition-all",
                                                        isEnabled
                                                            ? "bg-card border-cyan-500/30 shadow-sm"
                                                            : "bg-card-secondary/30 border-border opacity-60"
                                                    )}
                                                >
                                                    {/* Header */}
                                                    <div className="flex items-start justify-between gap-2 mb-2">
                                                        <div className="flex items-start gap-2 flex-1 min-w-0">
                                                            <input
                                                                type="checkbox"
                                                                checked={isEnabled}
                                                                onChange={() => {
                                                                    if (isEnabled) setAISelectedScenarios(prev => prev.filter(id => id !== scenario.id));
                                                                    else setAISelectedScenarios(prev => [...prev, scenario.id]);
                                                                }}
                                                                className="mt-0.5 w-3.5 h-3.5 rounded border-border bg-card-secondary text-cyan-600 focus:ring-1 focus:ring-cyan-500 outline-none flex-shrink-0"
                                                            />
                                                            <div className="min-w-0">
                                                                <p className="text-[11px] font-black text-text-primary leading-tight truncate">{scenario.name}</p>
                                                                <p className="text-[9px] text-cyan-600 dark:text-cyan-400 font-bold tracking-widest uppercase mt-0.5">{scenario.policy_engine}</p>
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={() => runAITest(scenario)}
                                                            disabled={isTesting}
                                                            className={cn(
                                                                "flex-shrink-0 p-1.5 rounded-lg transition-all",
                                                                isTesting
                                                                    ? "bg-card-secondary text-text-muted"
                                                                    : "bg-cyan-600/10 hover:bg-cyan-600/20 text-cyan-600 dark:text-cyan-400"
                                                            )}
                                                            title="Run this scenario"
                                                        >
                                                            {isTesting ? <RefreshCcw size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
                                                        </button>
                                                    </div>

                                                    {/* Description */}
                                                    <p className="text-[9px] text-text-muted leading-relaxed mb-2 line-clamp-2">{scenario.description}</p>

                                                    {/* Targets */}
                                                    <div className="text-[8px] text-text-muted font-mono mb-2 opacity-70 truncate">
                                                        {isVolumeTest
                                                            ? `${scenario.targets.length} AI apps`
                                                            : scenario.targets.slice(0, 2).join(', ') + (scenario.targets.length > 2 ? ` +${scenario.targets.length - 2}` : '')
                                                        }
                                                    </div>

                                                    {/* Last result badge */}
                                                    {lastResult && (
                                                        <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between">
                                                            <span className="text-[8px] text-text-muted">Last result:</span>
                                                            <div className="scale-75 origin-right">{getStatusBadge(lastResult.result)}</div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-10 px-4 bg-card-secondary/20 rounded-xl border border-dashed border-border/60">
                                        <ShieldAlert className="text-text-muted opacity-40 mb-2" size={24} />
                                        <p className="text-xs font-bold text-text-muted tracking-wide text-center">No AI scenarios found matching "{aiSearchQuery}"</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })()}
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
                                                            <span className="text-text-muted opacity-60 font-medium">Allowed</span>
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
                                        <option value="all">All Types</option>
                                        <option value="url">URL Filtering</option>
                                        <option value="dns">DNS Security</option>
                                        <option value="threat">Threat Prevention</option>
                                        <option value="c2_scenario">C2 Scenario</option>
                                        <option value="ai_security">AI Security</option>

                                    </select>
                                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                                </div>
                                <button
                                    onClick={() => setShowChangesOnly(v => !v)}
                                    className={`px-4 py-3 border rounded-xl text-[10px] font-black tracking-widest transition-all flex items-center gap-2 shadow-sm ${
                                        showChangesOnly
                                            ? 'bg-orange-500/10 border-orange-500/30 text-orange-400'
                                            : 'bg-card-secondary hover:bg-card-hover border-border text-text-primary'
                                    }`}
                                >
                                    ⚡ Changes Only
                                </button>
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
                                                <th className="text-left px-4 py-4 text-[9px] font-black text-text-muted tracking-widest">Test ID</th>
                                                <th className="text-left px-4 py-4 text-[9px] font-black text-text-muted tracking-widest">Timeline</th>
                                                <th className="text-left px-4 py-4 text-[9px] font-black text-text-muted tracking-widest">Type</th>
                                                <th className="text-left px-4 py-4 text-[9px] font-black text-text-muted tracking-widest">Target</th>
                                                <th className="text-left px-4 py-4 text-[9px] font-black text-text-muted tracking-widest">Delta</th>
                                                <th className="text-right px-4 py-4 text-[9px] font-black text-text-muted tracking-widest">Result</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/50">
                                            {testResults
                                                .filter(r => !showChangesOnly || (r.previousStatus !== null && r.previousStatus !== undefined && r.previousStatus !== r.status))
                                                .map((result, index) => {
                                                const hasChange = result.previousStatus !== null && result.previousStatus !== undefined && result.previousStatus !== result.status;
                                                const isRegression = hasChange && (
                                                    (result.previousStatus === 'blocked' || result.previousStatus === 'sinkholed') &&
                                                    result.status !== 'blocked' && result.status !== 'sinkholed'
                                                );
                                                const isImprovement = hasChange && (
                                                    (result.status === 'blocked' || result.status === 'sinkholed') &&
                                                    result.previousStatus !== 'blocked' && result.previousStatus !== 'sinkholed'
                                                );
                                                return (
                                                    <tr
                                                        key={result.testId || index}
                                                        onClick={() => result.testId && viewTestDetails(result.testId)}
                                                        className={`hover:bg-card-secondary/50 transition-all cursor-pointer group ${
                                                            isRegression ? 'bg-red-500/5' : isImprovement ? 'bg-green-500/5' : ''
                                                        }`}
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
                                                                        result.testType === 'c2_scenario' ? 'bg-red-900/10 text-red-400 border-red-500/20' :
                                                                            result.testType === 'ai_security' ? 'bg-cyan-600/10 text-cyan-500 dark:text-cyan-400 border-cyan-500/20' :
                                                                                'bg-red-600/5 text-red-600 dark:text-red-400 border-red-500/20'
                                                            )}>
                                                                {result.testType === 'url_filtering' || result.testType === 'url' ? 'URL' :
                                                                    result.testType === 'dns_security' || result.testType === 'dns' ? 'DNS' :
                                                                        result.testType === 'c2_scenario' ? 'C2S' :
                                                                            result.testType === 'ai_security' ? 'AIS' :
                                                                                'Threat'}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-4 text-[11px] text-text-primary font-bold tracking-tight truncate max-w-xs group-hover:text-blue-500 transition-colors">
                                                            <div className="flex items-center gap-2">
                                                                <span className="truncate">{result.testName}</span>
                                                                {result.result?.mcp_source === 'mcp' && (
                                                                    <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-violet-600/15 text-violet-400 border border-violet-500/30">
                                                                        MCP
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-4">
                                                            {hasChange ? (
                                                                <div className="flex items-center gap-1 text-[10px] font-black">
                                                                    <span className={result.previousStatus === 'blocked' || result.previousStatus === 'sinkholed' ? 'text-green-500' : 'text-red-400'}>
                                                                        {result.previousStatus}
                                                                    </span>
                                                                    <span className="text-text-muted opacity-40">→</span>
                                                                    <span className={result.status === 'blocked' || result.status === 'sinkholed' ? 'text-green-500' : 'text-red-400'}>
                                                                        {result.status}
                                                                    </span>
                                                                    <span className={`ml-1 px-1 py-0.5 rounded text-[8px] font-black border ${
                                                                        isRegression ? 'text-red-500 bg-red-500/10 border-red-500/20' :
                                                                        isImprovement ? 'text-green-500 bg-green-500/10 border-green-500/20' :
                                                                        'text-text-muted border-border'
                                                                    }`}>
                                                                        {isRegression ? '↓ GAP' : isImprovement ? '↑ FIXED' : 'CHG'}
                                                                    </span>
                                                                </div>
                                                            ) : (
                                                                <span className="text-text-muted opacity-20 text-[10px]">—</span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-4 text-right">
                                                            <div className="flex justify-end">
                                                                {getStatusBadge(result.result)}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
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
                                            selectedTest.type === 'c2_scenario' ? "bg-purple-900 text-white shadow-purple-900/20 border-purple-700/20" :
                                                "bg-red-600 text-white shadow-red-900/20 border-red-500/20"
                                )}>
                                    <ShieldAlert size={24} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-black text-text-primary tracking-tight">Security Test Details</h3>
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
                                        {selectedTest.type === 'url' ? 'URL Filtering' : selectedTest.type === 'dns' ? 'DNS Security' : selectedTest.type === 'c2_scenario' ? 'C2 Simulation' : 'Threat Prevention'}
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
                                <label className="text-[9px] font-black text-text-muted tracking-[0.2em] mb-3 block opacity-60">Test ID</label>
                                <p className="text-lg font-black text-text-primary leading-tight tracking-tight">{selectedTest.name}</p>
                            </div>

                            {/* Detailed Telemetry Data */}
                            {selectedTest.details && (
                                <div className="space-y-6">
                                    <div className="flex items-center gap-2">
                                        <div className="h-4 w-1 bg-blue-500 rounded-full" />
                                        <h4 className="text-sm font-semibold text-text-primary tracking-normal">Detailed execution log</h4>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4">
                                        {selectedTest.details.url && (
                                            <div className="bg-card-secondary/30 rounded-xl p-4 border border-border/50 group">
                                                <span className="text-[9px] font-black text-text-muted uppercase tracking-widest block mb-2 opacity-60">Target Resource</span>
                                                <span className="text-xs font-mono text-text-primary break-all group-hover:text-blue-500 transition-colors">{selectedTest.details.url}</span>
                                            </div>
                                        )}

                                        {/* URL Filtering Verdict Panel — shown for URL tests with a HTTP result */}
                                        {selectedTest.type === 'url' && selectedTest.details.url && !selectedTest.details.errorType && (() => {
                                            const httpCode = selectedTest.details.http_code ?? selectedTest.details.httpCode ?? selectedTest.result?.httpCode;
                                            const isAllowed = selectedTest.status === 'allowed';
                                            const isTestPage = selectedTest.details.testPageDetected ?? selectedTest.result?.testPageDetected;
                                            const isBlockPage = selectedTest.details.blockPageDetected ?? selectedTest.result?.blockPageDetected;
                                            const reason = selectedTest.details.reason ?? selectedTest.result?.reason;

                                            return (
                                                <div className={`rounded-2xl border overflow-hidden shadow-sm ${isAllowed ? 'border-green-500/30' : 'border-red-500/30'}`}>
                                                    {/* Header */}
                                                    <div className={`px-4 py-3 flex items-center justify-between ${isAllowed ? 'bg-green-500/8 border-b border-green-500/20' : 'bg-red-500/8 border-b border-red-500/20'}`}>
                                                        <div className="flex items-center gap-2">
                                                            {isAllowed
                                                                ? <CheckCircle size={14} className="text-green-500" />
                                                                : <Shield size={14} className="text-red-500" />}
                                                            <span className="text-[10px] font-black tracking-widest uppercase text-text-primary">
                                                                {isAllowed ? 'URL Filtering — Allowed' : 'URL Filtering — Blocked'}
                                                            </span>
                                                        </div>
                                                        <span className={`px-2 py-0.5 rounded-md text-[9px] font-black tracking-widest border font-mono ${
                                                            isAllowed
                                                                ? 'bg-green-500/10 border-green-500/30 text-green-500'
                                                                : 'bg-red-500/10 border-red-500/30 text-red-500'
                                                        }`}>
                                                            HTTP {httpCode || '—'}
                                                        </span>
                                                    </div>
                                                    {/* Body */}
                                                    <div className="bg-card-secondary/30 border border-t-0 border-border/50 divide-y divide-border/30">
                                                        {isAllowed && isTestPage && (
                                                            <div className="px-4 py-3 grid grid-cols-[160px_1fr] gap-3 items-start">
                                                                <span className="text-[9px] font-black text-text-muted uppercase tracking-widest pt-0.5">Page Served</span>
                                                                <span className="text-[11px] text-green-500 font-black">✅ Palo Alto PANDB Test Page</span>
                                                            </div>
                                                        )}
                                                        {isAllowed && !isTestPage && (
                                                            <div className="px-4 py-3 grid grid-cols-[160px_1fr] gap-3 items-start">
                                                                <span className="text-[9px] font-black text-text-muted uppercase tracking-widest pt-0.5">Response</span>
                                                                <span className="text-[11px] text-green-400 font-black">HTTP {httpCode} — Request passed through</span>
                                                            </div>
                                                        )}
                                                        {!isAllowed && isBlockPage && (
                                                            <div className="px-4 py-3 grid grid-cols-[160px_1fr] gap-3 items-start">
                                                                <span className="text-[9px] font-black text-text-muted uppercase tracking-widest pt-0.5">Block Mechanism</span>
                                                                <span className="text-[11px] text-red-400 font-black">🛡 In-band redirect — Palo Alto block page in HTTP body</span>
                                                            </div>
                                                        )}
                                                        {!isAllowed && !isBlockPage && (
                                                            <div className="px-4 py-3 grid grid-cols-[160px_1fr] gap-3 items-start">
                                                                <span className="text-[9px] font-black text-text-muted uppercase tracking-widest pt-0.5">Block Mechanism</span>
                                                                <span className="text-[11px] text-red-400 font-black">HTTP {httpCode} — Request blocked at policy level</span>
                                                            </div>
                                                        )}
                                                        <div className="px-4 py-3 grid grid-cols-[160px_1fr] gap-3 items-start">
                                                            <span className="text-[9px] font-black text-text-muted uppercase tracking-widest pt-0.5">
                                                                {isAllowed ? 'Conclusion' : 'Intercepted by'}
                                                            </span>
                                                            <span className="text-[11px] text-text-primary leading-relaxed">
                                                                {isAllowed
                                                                    ? isTestPage
                                                                        ? 'This URL category is NOT blocked — the Palo Alto test page was successfully served.'
                                                                        : 'Request was forwarded. This category may not be in your URL filtering policy.'
                                                                    : 'Palo Alto NGFW URL Filtering Policy'}
                                                            </span>
                                                        </div>
                                                        {!isAllowed && (
                                                            <div className="px-4 py-3 grid grid-cols-[160px_1fr] gap-3 items-start bg-card/50">
                                                                <span className="text-[9px] font-black text-text-muted uppercase tracking-widest pt-0.5">Next Step</span>
                                                                <span className="text-[10px] text-text-muted leading-relaxed italic">
                                                                    Check your NGFW URL Filtering logs for category "{selectedTest.name}" around this timestamp.
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                        {selectedTest.details.domain && (
                                            <div className="bg-card-secondary/30 rounded-xl p-4 border border-border/50 group">
                                                <span className="text-[9px] font-black text-text-muted uppercase tracking-widest block mb-2 opacity-60">Destination Host</span>
                                                <span className="text-xs font-mono text-text-primary break-all group-hover:text-purple-500 transition-colors">{selectedTest.details.domain}</span>
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

                                        {/* Threat Prevention Allowed Verdict Panel */}
                                        {selectedTest.type === 'threat' && selectedTest.status === 'allowed' && (selectedTest.details.http_code || selectedTest.details.output || selectedTest.details.url) && (() => {
                                            const httpCode = selectedTest.details.http_code;
                                            const targetUrl = selectedTest.details.url || selectedTest.details.endpoint;
                                            const outputText = selectedTest.details.output;
                                            const reasonText = selectedTest.details.reason;
                                            return (
                                                <div className="rounded-2xl border border-orange-500/30 overflow-hidden shadow-sm">
                                                    {/* Header */}
                                                    <div className="px-4 py-3 flex items-center justify-between bg-orange-500/8 border-b border-orange-500/20">
                                                        <div className="flex items-center gap-2">
                                                            <Activity size={14} className="text-orange-400" />
                                                            <span className="text-[10px] font-black tracking-widest uppercase text-text-primary">Threat Prevention — Allowed (⚠️ Not blocked)</span>
                                                        </div>
                                                        {httpCode && (
                                                            <span className="px-2 py-0.5 rounded-md text-[9px] font-black tracking-widest border font-mono bg-orange-500/10 border-orange-500/30 text-orange-400">
                                                                HTTP {httpCode}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {/* Body */}
                                                    <div className="bg-card-secondary/30 border border-t-0 border-border/50 divide-y divide-border/30">
                                                        {targetUrl && (
                                                            <div className="px-4 py-3 grid grid-cols-[160px_1fr] gap-3 items-start">
                                                                <span className="text-[9px] font-black text-text-muted uppercase tracking-widest pt-0.5">Target URL</span>
                                                                <span className="text-[11px] font-mono text-text-primary break-all">{targetUrl}</span>
                                                            </div>
                                                        )}
                                                        {httpCode && (
                                                            <div className="px-4 py-3 grid grid-cols-[160px_1fr] gap-3 items-start">
                                                                <span className="text-[9px] font-black text-text-muted uppercase tracking-widest pt-0.5">HTTP Response</span>
                                                                <span className="text-[11px] font-mono font-black text-orange-400">
                                                                    {httpCode}
                                                                    <span className="text-text-muted font-normal ml-2 text-[10px]">
                                                                        {httpCode === 200 ? '(OK — file served)' : httpCode === 206 ? '(Partial Content)' : httpCode === 301 || httpCode === 302 ? '(Redirect)' : httpCode >= 400 ? '(Client/Server Error)' : ''}
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        )}
                                                        {outputText && (
                                                            <div className="px-4 py-3 grid grid-cols-[160px_1fr] gap-3 items-start">
                                                                <span className="text-[9px] font-black text-text-muted uppercase tracking-widest pt-0.5">Execution Output</span>
                                                                <pre className="text-[10px] font-mono text-orange-300 bg-black/20 p-2 rounded-lg border border-orange-500/10 whitespace-pre-wrap break-all">{outputText}</pre>
                                                            </div>
                                                        )}
                                                        <div className="px-4 py-3 grid grid-cols-[160px_1fr] gap-3 items-start">
                                                            <span className="text-[9px] font-black text-text-muted uppercase tracking-widest pt-0.5">Conclusion</span>
                                                            <span className="text-[11px] text-orange-400 font-black">EICAR file was NOT intercepted by the firewall</span>
                                                        </div>
                                                        {reasonText && (
                                                            <div className="px-4 py-3 grid grid-cols-[160px_1fr] gap-3 items-start bg-card/50">
                                                                <span className="text-[9px] font-black text-text-muted uppercase tracking-widest pt-0.5">Next Step</span>
                                                                <span className="text-[10px] text-text-muted leading-relaxed italic">{reasonText}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {selectedTest.details.output && !(selectedTest.type === 'threat' && selectedTest.status === 'allowed') && (
                                            <div className="bg-card-secondary/30 rounded-xl p-4 border border-border/50">
                                                <span className="text-[9px] font-black text-text-muted uppercase tracking-widest block mb-2 opacity-60">System Raw Output</span>
                                                <pre className="text-[10px] font-mono text-text-secondary bg-black/20 dark:bg-black/40 p-3 rounded-lg overflow-x-auto max-h-48 border border-border/30 custom-scrollbar">{selectedTest.details.output}</pre>
                                            </div>
                                        )}

                                        {selectedTest.details.error && (
                                            <div className="bg-red-500/5 rounded-xl p-4 border border-red-500/20">
                                                <span className="text-[9px] font-semibold text-red-500 uppercase tracking-widest block mb-2">Test error signature</span>
                                                <pre className="text-[10px] font-mono text-red-400 bg-black/20 p-3 rounded-lg overflow-x-auto border border-red-500/10 tracking-tight whitespace-pre-wrap">{selectedTest.details.error}</pre>
                                            </div>
                                        )}

                                        {/* Network Diagnostic Block — shown when we have curl error info */}
                                        {selectedTest.details.errorType && (
                                            <div className="rounded-2xl border overflow-hidden shadow-sm">
                                                {/* Header */}
                                                <div className={`px-4 py-3 flex items-center justify-between ${
                                                    selectedTest.details.errorType === 'DNS_RESOLUTION_FAILURE' ? 'bg-orange-500/10 border-b border-orange-500/20' :
                                                    selectedTest.details.errorType === 'CONNECTION_TIMEOUT'     ? 'bg-amber-500/10 border-b border-amber-500/20' :
                                                    selectedTest.details.errorType.includes('SSL')              ? 'bg-yellow-500/10 border-b border-yellow-500/20' :
                                                    selectedTest.details.likelyFirewallBlock                    ? 'bg-red-500/10 border-b border-red-500/20' :
                                                    'bg-slate-500/10 border-b border-slate-500/20'
                                                }`}>
                                                    <div className="flex items-center gap-2">
                                                        <Activity size={14} className={
                                                            selectedTest.details.errorType === 'DNS_RESOLUTION_FAILURE' ? 'text-orange-500' :
                                                            selectedTest.details.errorType === 'CONNECTION_TIMEOUT'     ? 'text-amber-500' :
                                                            selectedTest.details.errorType.includes('SSL')              ? 'text-yellow-500' :
                                                            selectedTest.details.likelyFirewallBlock                    ? 'text-red-500' :
                                                            'text-slate-400'
                                                        } />
                                                        <span className="text-[10px] font-black tracking-widest uppercase text-text-primary">Network Diagnostic</span>
                                                    </div>
                                                    <span className={`px-2 py-0.5 rounded-md text-[9px] font-black tracking-widest border ${
                                                        selectedTest.details.likelyFirewallBlock
                                                            ? 'bg-red-500/10 border-red-500/30 text-red-500'
                                                            : 'bg-slate-500/10 border-slate-500/30 text-slate-400'
                                                    }`}>
                                                        {selectedTest.details.likelyFirewallBlock ? '🔥 Likely Firewall' : '⚠️ Not a Firewall Block'}
                                                    </span>
                                                </div>
                                                {/* Body */}
                                                <div className="bg-card-secondary/30 border border-border/50 divide-y divide-border/30">
                                                    {/* Error type row */}
                                                    <div className="px-4 py-3 grid grid-cols-[140px_1fr] gap-3 items-start">
                                                        <span className="text-[9px] font-black text-text-muted uppercase tracking-widest pt-0.5">Error Type</span>
                                                        <span className={`text-[11px] font-black font-mono tracking-wide ${
                                                            selectedTest.details.errorType === 'DNS_RESOLUTION_FAILURE' ? 'text-orange-500' :
                                                            selectedTest.details.errorType === 'CONNECTION_TIMEOUT'     ? 'text-amber-500' :
                                                            selectedTest.details.errorType.includes('SSL')              ? 'text-yellow-500' :
                                                            'text-red-400'
                                                        }`}>{selectedTest.details.errorType}</span>
                                                    </div>
                                                    {/* Curl exit code */}
                                                    {selectedTest.details.curlExitCode !== undefined && (
                                                        <div className="px-4 py-3 grid grid-cols-[140px_1fr] gap-3 items-start">
                                                            <span className="text-[9px] font-black text-text-muted uppercase tracking-widest pt-0.5">Curl Exit Code</span>
                                                            <span className="text-[11px] font-mono text-text-primary">
                                                                <span className="text-red-400 font-black">{selectedTest.details.curlExitCode}</span>
                                                                <span className="text-text-muted ml-2 text-[10px]">
                                                                    {selectedTest.details.curlExitCode === 6  ? '(CURLE_COULDNT_RESOLVE_HOST)' :
                                                                     selectedTest.details.curlExitCode === 7  ? '(CURLE_COULDNT_CONNECT)' :
                                                                     selectedTest.details.curlExitCode === 28 ? '(CURLE_OPERATION_TIMEDOUT)' :
                                                                     selectedTest.details.curlExitCode === 35 ? '(CURLE_SSL_CONNECT_ERROR)' :
                                                                     selectedTest.details.curlExitCode === 51 ? '(CURLE_PEER_FAILED_VERIFICATION)' :
                                                                     selectedTest.details.curlExitCode === 52 ? '(CURLE_GOT_NOTHING)' :
                                                                     selectedTest.details.curlExitCode === 56 ? '(CURLE_RECV_ERROR)' :
                                                                     '(CURLE_UNKNOWN)'}
                                                                </span>
                                                            </span>
                                                        </div>
                                                    )}
                                                    {/* HTTP Code */}
                                                    <div className="px-4 py-3 grid grid-cols-[140px_1fr] gap-3 items-start">
                                                        <span className="text-[9px] font-black text-text-muted uppercase tracking-widest pt-0.5">HTTP Response</span>
                                                        <span className="text-[11px] font-mono text-text-muted">000 (no response — connection failed before HTTP)</span>
                                                    </div>
                                                    {/* Human-readable explanation */}
                                                    {selectedTest.details.errorDescription && (
                                                        <div className="px-4 py-3 grid grid-cols-[140px_1fr] gap-3 items-start">
                                                            <span className="text-[9px] font-black text-text-muted uppercase tracking-widest pt-0.5">What Happened</span>
                                                            <span className="text-[11px] text-text-primary leading-relaxed">{selectedTest.details.errorDescription}</span>
                                                        </div>
                                                    )}
                                                    {/* Recommendation */}
                                                    <div className="px-4 py-3 grid grid-cols-[140px_1fr] gap-3 items-start bg-card/50">
                                                        <span className="text-[9px] font-black text-text-muted uppercase tracking-widest pt-0.5">Next Step</span>
                                                        <span className="text-[10px] text-text-muted leading-relaxed italic">
                                                            {selectedTest.details.errorType === 'DNS_RESOLUTION_FAILURE'
                                                                ? 'Verify the URL in your security profile is correct. Run: nslookup <hostname> to confirm DNS resolution.'
                                                            : selectedTest.details.errorType === 'CONNECTION_TIMEOUT'
                                                                ? 'This pattern is consistent with a firewall silent-drop rule. Check your NGFW URL filtering policy logs.'
                                                            : selectedTest.details.errorType === 'CONNECTION_REFUSED'
                                                                ? 'The firewall sent a TCP RST. Check if a "block-and-reset" action is configured in the URL filtering policy.'
                                                            : selectedTest.details.errorType.includes('SSL')
                                                                ? 'Check SSL Inspection settings. If SSL decryption is enabled, ensure the CA certificate is trusted on this node.'
                                                            : 'Check NGFW security logs for the source IP of this node around the test timestamp.'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}


                                        {selectedTest.details.isBatch && selectedTest.details.results && (
                                            <div className="space-y-4 pt-4">
                                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                                    <div className="flex items-center gap-2">
                                                        <div className="h-4 w-1 bg-orange-500 rounded-full" />
                                                        <h4 className="text-[10px] font-semibold text-text-primary tracking-wide">Batch analysis manifest</h4>
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
                                                                            <td className="py-3 px-4 text-text-primary font-mono text-[10px] break-all group-hover:text-blue-500 transition-colors tracking-wide">{r.value}</td>
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
                                                                            <td className="py-3 px-4 text-text-muted text-[10px] font-medium break-words max-w-[200px] opacity-60 group-hover:opacity-100">{r.details || '-'}</td>
                                                                        </tr>
                                                                    ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {selectedTest.details.reason && !selectedTest.details.errorType && (
                                            <div className="mt-8 p-6 bg-blue-600/5 border border-blue-500/20 rounded-2xl relative overflow-hidden group">
                                                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform duration-500">
                                                    <Info size={40} className="text-blue-600" />
                                                </div>
                                                <span className="text-blue-600 dark:text-blue-400 font-black uppercase text-[10px] tracking-widest block mb-2">Disposition Reasoning</span>
                                                <p className="text-sm text-text-primary font-medium leading-relaxed">{selectedTest.details.reason}</p>
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
                                                        <span className="text-blue-500 font-black uppercase text-[10px] tracking-widest block">Cloud Execution Context</span>
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
                                Close Details
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
