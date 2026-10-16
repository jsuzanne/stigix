import React, { useEffect, useState, useRef, useMemo } from 'react';
import { AreaChart, LineChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import Statistics from './Statistics';
import Security from './Security';
import Voice from './Voice';
import SettingsComponent from './Settings';
import Login from './Login';
import ConnectivityPerformance from './ConnectivityPerformance';
import Failover from './Failover';
import Iot from './Iot';
import Vyos from './Vyos';
import Speedtest from './Speedtest';
import Topology from './Topology';
import LiveEvents from './LiveEvents';
import { CustomApps } from './CustomApps';
import { MulticastOverlayTab } from './components/custom-tcp/MulticastOverlayTab';
import { PcapReplay } from './PcapReplay';
import PacketCapture from './PacketCapture';
import Copilot from './Copilot';
import Fleet from './Fleet';
import { PeerContextProvider, GatewayDropdown, RemoteViewBanner, RemoteViewChip, usePeerContext } from './PeerContext';
import { SystemHealthBadge } from './components/health/SystemHealthBadge';
import { SystemHealthModal } from './components/health/SystemHealthModal';
import { TopLoadingBar } from './components/common/TopLoadingBar';
import { MagicJoinModal } from './components/MagicJoinModal';
import { NodeRoleModal } from './components/NodeRoleModal';
import { SidebarRail } from './components/navigation/SidebarRail';
import { SearchPaletteModal } from './components/navigation/SearchPaletteModal';
import { HomeOverview } from './components/navigation/HomeOverview';
import { Activity, Server, AlertCircle, LayoutDashboard, Settings, LogOut, Key, UserPlus, BarChart3, Wifi, Shield, ChevronDown, ChevronUp, Clock, CheckCircle, XCircle, Play, Pause, Phone, Gauge, Network, Plus, Zap, Monitor, Cpu, Sun, Moon, Globe, Terminal, Sliders, Layers, Code, Bot, Sparkles, Binary, Radio } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Toaster } from 'react-hot-toast';

/**
 * PeerStatusSync — lives INSIDE PeerContextProvider so it can call usePeerContext().
 * When a remote peer is selected:
 *  - fast loop (500ms failover / 3s otherwise): polls live-status (voice + convergence)
 *    + traffic/status (running, rate, client_count) from remote peer.
 *  - slow loop (10s): polls dashboard-data for stats + status so the Traffic Generator
 *    panel shows BR5's real metrics instead of DC1 zeros.
 * All state patches go via callbacks; DC1 fetch functions skip those state updates when
 * isRemoteViewRef.current is set (to prevent flapping).
 */
function PeerStatusSync({
  token,
  view,
  onConvStatus,
  onVoiceStatus,
  onStats,
  onStatus,
  onTrafficStatus,
  onHistory,
  onGatewayIp,
  onLocalIp,
  onPublicIp,
  onSiteInfo,
  onConnectivity,
  onIperfServer,
  onHealthMatrix,
}: {
  token: string | null;
  view: string;
  onConvStatus: (v: any[]) => void;
  onVoiceStatus: (v: any) => void;
  onStats?: (v: any) => void;
  onStatus?: (v: 'running' | 'stopped' | 'unknown') => void;
  onTrafficStatus?: (running: boolean, rate?: number, count?: number) => void;
  onHistory?: (history: any[]) => void;
  onGatewayIp?: (gw: string | null, info?: any) => void;
  onLocalIp?: (ip: string | null) => void;
  onPublicIp?: (ip: string | null, country?: string | null, info?: any) => void;
  onSiteInfo?: (info: any) => void;
  onConnectivity?: (conn: any) => void;
  onIperfServer?: (info: any) => void;
  onHealthMatrix?: (data: any) => void;
}) {
  const { gFetch, activePeerId } = usePeerContext();

  // ── Network loop: gateway, public ip, siteinfo, connectivity, health-matrix (15s & immediate on peer change) ──
  useEffect(() => {
    if (!token || !activePeerId) return;

    const pollNetwork = async () => {
      try {
        const [gwRes, ipRes, siteRes, connRes, iperfRes, healthRes] = await Promise.allSettled([
          gFetch('/api/system/gateway-ip', { headers: { 'Authorization': `Bearer ${token}` } }),
          gFetch('/api/connectivity/public-ip', { headers: { 'Authorization': `Bearer ${token}` } }),
          gFetch('/api/siteinfo', { headers: { 'Authorization': `Bearer ${token}` } }),
          gFetch('/api/connectivity/test', { headers: { 'Authorization': `Bearer ${token}` } }),
          gFetch('/api/connectivity/iperf/server', { headers: { 'Authorization': `Bearer ${token}` } }),
          gFetch('/api/system/health-matrix', { headers: { 'Authorization': `Bearer ${token}` } })
        ]);
        if (gwRes.status === 'fulfilled' && gwRes.value.ok) {
          const data = await gwRes.value.json();
          onGatewayIp?.(data.ip || null, data);
          if (data.local_ip) onLocalIp?.(data.local_ip);
        }
        if (ipRes.status === 'fulfilled' && ipRes.value.ok) {
          const data = await ipRes.value.json();
          onPublicIp?.(data.ip || null, data.countryCode || null, data);
        }
        if (siteRes.status === 'fulfilled' && siteRes.value.ok) {
          const data = await siteRes.value.json();
          onSiteInfo?.(data);
        }
        if (connRes.status === 'fulfilled' && connRes.value.ok) {
          const data = await connRes.value.json();
          onConnectivity?.(data);
        }
        if (iperfRes.status === 'fulfilled' && iperfRes.value.ok) {
          const data = await iperfRes.value.json();
          onIperfServer?.(data);
        }
        if (healthRes.status === 'fulfilled' && healthRes.value.ok) {
          const data = await healthRes.value.json();
          if (data.success) onHealthMatrix?.(data);
        }
      } catch { }
    };

    pollNetwork();
    const interval = setInterval(pollNetwork, 30_000);
    return () => clearInterval(interval);
  }, [token, activePeerId]);

  // ── Fast loop: live-status (voice/conv) + traffic/status ──────────────────
  useEffect(() => {
    if (!token || !activePeerId) return;

    const poll = async () => {
      try {
        const [liveRes, trafficRes] = await Promise.allSettled([
          gFetch('/api/admin/system/live-status', { headers: { 'Authorization': `Bearer ${token}` } }),
          gFetch('/api/traffic/status', { headers: { 'Authorization': `Bearer ${token}` } }),
        ]);
        if (liveRes.status === 'fulfilled' && liveRes.value.ok) {
          const data = await liveRes.value.json();
          if (data.convergenceTests) onConvStatus(data.convergenceTests);
          if (data.voice) onVoiceStatus(data.voice);
        }
        if (trafficRes.status === 'fulfilled' && trafficRes.value.ok) {
          const td = await trafficRes.value.json();
          onTrafficStatus?.(td.running ?? false, td.sleep_interval, td.client_count);
        }
      } catch { }
    };

    poll();
    const ms = (view === 'failover' || view === 'convergence') ? 500 : 3000;
    const interval = setInterval(poll, ms);
    return () => clearInterval(interval);
  }, [token, activePeerId, view]);

  // ── Slow loop: dashboard-data for stats + status & health matrix (10s) ───────
  useEffect(() => {
    if (!token || !activePeerId) return;

    const pollDash = async () => {
      try {
        const [dashRes, healthRes] = await Promise.allSettled([
          gFetch('/api/admin/system/dashboard-data', { headers: { 'Authorization': `Bearer ${token}` } }),
          gFetch('/api/system/health-matrix', { headers: { 'Authorization': `Bearer ${token}` } })
        ]);
        if (dashRes.status === 'fulfilled' && dashRes.value.ok) {
          const data = await dashRes.value.json();
          if (data.stats) onStats?.(data.stats);
          if (data.status) onStatus?.(data.status);
        }
        if (healthRes.status === 'fulfilled' && healthRes.value.ok) {
          const data = await healthRes.value.json();
          if (data.success) onHealthMatrix?.(data);
        }
      } catch { }
    };

    pollDash();
    const interval = setInterval(pollDash, 5_000);
    return () => clearInterval(interval);
  }, [token, activePeerId]);

  // ── History loop: traffic history for Traffic Volume chart (60s) ───────────
  useEffect(() => {
    if (!token || !activePeerId || !onHistory) return;

    const pollHistory = async () => {
      try {
        const res = await gFetch('/api/traffic/history?range=1h', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        const formatted = data.map((item: any) => ({
          time: new Date(item.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          rawTimestamp: item.timestamp,
          requests: item.rpm,
          total: item.total_requests,
          ...item.requests_by_app
        }));
        onHistory(formatted);
      } catch { }
    };

    pollHistory();
    const interval = setInterval(pollHistory, 60_000);
    return () => clearInterval(interval);
  }, [token, activePeerId]);

  return null;
}

function formatBitrate(mbpsStr: string) {
  const mbps = parseFloat(mbpsStr);
  if (isNaN(mbps)) return '0.00 Mbps';
  if (mbps < 1 && mbps > 0) {
    return `${(mbps * 1000).toFixed(0)} Kbps`;
  }
  return `${mbps.toFixed(2)} Mbps`;
}

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

// Types
interface Stats {
  timestamp: number;
  total_requests: number;
  requests_by_app: Record<string, number>;
  errors_by_app: Record<string, number>;
  telemetry_by_app?: Record<string, any>;
}

interface SiteInfo {
  success: boolean;
  detected_site_name?: string;
  detected_site_id?: string;
  local_ip?: string;
  matched_network?: string;
  error?: string;
  last_attempt: number;
}




export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [username, setUsername] = useState<string | null>(localStorage.getItem('username'));
  const [view, setView] = useState<'dashboard' | 'settings' | 'statistics' | 'security' | 'voice' | 'performance' | 'failover' | 'srt' | 'iot' | 'vyos' | 'speedtest' | 'topology' | 'convergence' | 'events' | 'custom_apps' | 'multicast' | 'pcap_replay' | 'packet_capture' | 'api_studio' | 'copilot' | 'fleet' | 'home'>(
    () => {
      const saved = localStorage.getItem('activeView');
      if (saved && saved !== 'settings') {
        return saved as any;
      }
      return 'home';
    }
  );

  const handleNavigate = (viewId: string, subTab?: string) => {
    if (subTab) {
      setInitialSettingsTab(subTab);
    }
    setView(viewId as any);
    try {
      localStorage.setItem('activeView', viewId);
    } catch { }
  };

  const [features, setFeatures] = useState<{ xfr_enabled: boolean }>({ xfr_enabled: false });
  const [initialSettingsTab, setInitialSettingsTab] = useState<any>(null);
  const [copilotDrawerOpen, setCopilotDrawerOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [copilotConfig, setCopilotConfig] = useState<{ enabled: boolean; featureEnabled?: boolean; hasKey: boolean } | null>(null);
  const [isLeader, setIsLeader] = useState<boolean>(false);
  // Tracks whether a remote peer is active (set via PeerContextProvider callback).
  // isRemoteViewRef: used in async fetchDashboardData (avoids stale closure).
  // isRemoteView state: used for reactive UI (disable buttons, hide live sections).
  const isRemoteViewRef = React.useRef<boolean>(false);
  // activePeerIdRef: the current peer ID for gateway routing in action handlers.
  // App is rendered OUTSIDE PeerContextProvider so it cannot call usePeerContext().
  // This ref is populated via the onActivePeerChange callback and is the only way
  // for App-level handlers (handleTrafficToggle, etc.) to route to the active peer.
  const activePeerIdRef = React.useRef<string | null>(null);
  const [isRemoteView, setIsRemoteView] = React.useState<boolean>(false);
  const [activePeerLabel, setActivePeerLabel] = React.useState<string | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  useEffect(() => {
    setIsNavigating(true);
    const t = setTimeout(() => setIsNavigating(false), 600);
    return () => clearTimeout(t);
  }, [view, activePeerLabel]);

  // apiFetch — App-level gateway-aware fetch. Routes to /api/gateway/:peerId/* when
  // a remote peer is active, otherwise falls back to a direct local fetch.
  // Must stay in sync with gFetch logic in PeerContext.tsx.
  const apiFetch = React.useCallback((url: string, options?: RequestInit): Promise<Response> => {
    const peerId = activePeerIdRef.current;
    if (!peerId || !url.startsWith('/')) return fetch(url, options);
    return fetch(`/api/gateway/${peerId}${url}`, options);
  }, []);

  const fetchRegistryLeaderStatus = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/registry/status', { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setRegistryStatus(data);
        setIsLeader(data.mode === 'leader' || data.current_mode === 'leader' || data.local_registry_active === true);
      }
    } catch (e) { }
  };

  const fetchCopilotConfig = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/copilot/config', { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setCopilotConfig(data);
      }
    } catch (e) { }
  };

  // Global shortcuts: Cmd+K / Ctrl+K for Search Palette, Cmd+J / Ctrl+J for AI Copilot
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setIsSearchOpen(prev => !prev);
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === 'J')) {
        if (!copilotConfig?.featureEnabled || !copilotConfig?.hasKey) return; // Only toggle if feature is enabled and key is configured
        e.preventDefault();
        setCopilotDrawerOpen(prev => !prev);
      } else if (e.key === 'Escape') {
        if (isSearchOpen) {
          setIsSearchOpen(false);
        } else if (copilotDrawerOpen) {
          setCopilotDrawerOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen, copilotDrawerOpen, copilotConfig?.featureEnabled, copilotConfig?.hasKey]);

  // --- Theme Management ---
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', saved);
      document.documentElement.classList.toggle('dark', saved === 'dark');
      document.documentElement.classList.toggle('light', saved === 'light');
      document.documentElement.style.colorScheme = saved;
      document.documentElement.style.backgroundColor = saved === 'light' ? '#eef2f7' : '#020617';
    }
    return saved;
  });

  React.useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.classList.toggle('light', theme === 'light');
    document.documentElement.style.colorScheme = theme;
    document.documentElement.style.backgroundColor = theme === 'light' ? '#eef2f7' : '#020617';
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };
  const [stats, setStats] = useState<Stats | null>(() => {
    try {
      const cached = localStorage.getItem('stigix_stats_cache');
      return cached ? JSON.parse(cached) : null;
    } catch { return null; }
  });
  const [history, setHistory] = useState<any[]>(() => {
    try {
      const cached = localStorage.getItem('stigix_history_1h');
      return cached ? JSON.parse(cached) : [];
    } catch { return []; }
  });
  const [status, setStatus] = useState<'running' | 'stopped' | 'unknown'>('unknown');
  const [logs, setLogs] = useState<string[]>([]);
  const [globalConvStatus, setGlobalConvStatus] = useState<any[]>([]);
  const [globalVoiceStatus, setGlobalVoiceStatus] = useState<any>(null);
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  // Add User State
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');

  // Traffic Control State
  const [trafficRunning, setTrafficRunning] = useState(false);
  const [trafficRate, setTrafficRate] = useState(1.0);
  const [trafficClientCount, setTrafficClientCount] = useState(1);
  const [updatingRate, setUpdatingRate] = useState(false);
  const [configValid, setConfigValid] = useState(false);

  // Version State
  const [version, setVersion] = useState<string>('');

  // Network Monitoring State
  const [connectivity, setConnectivity] = useState<any>(null);
  const [dockerStats, setDockerStats] = useState<any>(null);
  const [networkExpanded, setNetworkExpanded] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(1000);
  const [appConfig, setAppConfig] = useState<any[]>([]);
  const [speedtestResult, setSpeedtestResult] = useState<any>(null);
  const [runningSpeedtest, setRunningSpeedtest] = useState(false);
  const [iperfResult, setIperfResult] = useState<any>(null);
  const [runningIperf, setRunningIperf] = useState(false);
  const [showIperfModal, setShowIperfModal] = useState(false);
  const [iperfTarget, setIperfTarget] = useState('');
  const [iperfServerInfo, setIperfServerInfo] = useState<any>(null);
  const [publicIp, setPublicIp] = useState<string | null>(null);
  const [publicIpCountry, setPublicIpCountry] = useState<string | null>(null);
  const [publicIpInfo, setPublicIpInfo] = useState<any>(null);
  const [gatewayIp, setGatewayIp] = useState<string | null>(null);
  const [localIp, setLocalIp] = useState<string | null>(null);
  const [gatewayInfo, setGatewayInfo] = useState<any>(null);

  // Maintenance State
  const [maintenance, setMaintenance] = useState<{ updateAvailable: boolean } | null>(null);

  // Site Info State
  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null);

  // Traffic History State
  const [timeRange, setTimeRange] = useState<'1h' | '6h' | '24h'>('1h');
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [registryStatus, setRegistryStatus] = useState<any>(null);
  const [uiConfig, setUiConfig] = useState<{ refreshInterval: number, maxCaptures: number, globalScoreTypes?: string[], enablePcapReplay?: boolean }>({ refreshInterval: 1000, maxCaptures: 10 });
  const isPcapEnabled = Boolean(uiConfig?.enablePcapReplay);
  const [healthData, setHealthData] = useState<any | null>(null);
  const [isHealthLoading, setIsHealthLoading] = useState(false);
  const [showHealthModal, setShowHealthModal] = useState(false);
  const [showMagicJoinModal, setShowMagicJoinModal] = useState(false);
  const [showNodeRoleModal, setShowNodeRoleModal] = useState(false);


  // Rate Calculation State - Use Refs to avoid stale closures in setInterval
  const prevTotalRequestsRef = useRef<number | null>(null);
  const prevTimestampRef = useRef<number | null>(null);
  const [currentRpm, setCurrentRpm] = useState<number>(() => {
    try {
      // Seed from last history point (most reliable) or from dedicated cache
      const histCached = localStorage.getItem('stigix_history_1h');
      if (histCached) {
        const hist = JSON.parse(histCached);
        if (hist.length > 0) return hist[hist.length - 1].requests || 0;
      }
      return parseFloat(localStorage.getItem('stigix_rpm_cache') || '0');
    } catch { return 0; }
  });

  const trafficMetrics = useMemo(() => {
    if (!history || history.length === 0) {
      return { avg: 0, peak: 0, current: Math.round(currentRpm) || 0 };
    }
    const values = history.map((h: any) => Number(h.requests) || 0);
    const peak = values.length > 0 ? Math.max(...values) : 0;
    const nonZero = values.filter((v: number) => v > 0);
    const avg = nonZero.length > 0 ? Math.round(nonZero.reduce((a: number, b: number) => a + b, 0) / nonZero.length) : 0;
    return { avg, peak, current: Math.round(currentRpm) || 0 };
  }, [history, currentRpm]);

  const activeTasks = useMemo(() => ({
    traffic: Boolean(trafficRunning),
    voice: Boolean(
      (globalVoiceStatus?.control?.enabled) ||
      (healthData?.subsystems?.voice?.active) ||
      (globalVoiceStatus && (globalVoiceStatus.activeCalls > 0 || globalVoiceStatus.running))
    ),
    failover: Boolean(
      globalConvStatus && (
        Array.isArray(globalConvStatus)
          ? globalConvStatus.some((t: any) => t.running)
          : (globalConvStatus as any)?.running
      )
    ),
    custom_apps: Boolean(
      healthData?.subsystems?.custom_apps?.running ||
      (healthData?.subsystems?.custom_apps?.active_streams > 0) ||
      (healthData?.subsystems?.custom_apps?.active_workloads > 0)
    ),
    multicast: Boolean(
      healthData?.subsystems?.multicast?.running ||
      (healthData?.subsystems?.multicast?.activeStreamsCount > 0)
    ),
    iot: Boolean(
      healthData?.subsystems?.iot?.running ||
      (healthData?.subsystems?.iot?.running_devices > 0)
    )
  }), [trafficRunning, globalVoiceStatus, globalConvStatus, healthData]);

  const totalConfiguredSaasApps = useMemo(() => {
    if (!Array.isArray(appConfig) || appConfig.length === 0) return 67;
    const count = appConfig.reduce((sum: number, item: any) => {
      if (Array.isArray(item?.apps)) return sum + item.apps.length;
      return sum + 1;
    }, 0);
    return count > 0 ? count : 67;
  }, [appConfig]);

  const activeSaasAppsCount = useMemo(() => {
    return stats?.requests_by_app ? Object.keys(stats.requests_by_app).length : 0;
  }, [stats]);

  const addUser = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/auth/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ username: newUsername, password: newUserPassword })
      });
      const data = await res.json();
      if (res.ok) {
        alert('User created successfully');
        setShowAddUserModal(false);
        setNewUsername('');
        setNewUserPassword('');
      } else {
        alert(data.error || 'Failed to create user');
      }
    } catch (e) { alert('Error creating user'); }
  };
  //...
  // Inside JSX, after Logout button:
  /* 
      {username === 'admin' && (
          <button onClick={() => setShowAddUserModal(true)} title="Add User" className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-green-400 transition-colors">
              <UserPlus size={18} />
          </button>
      )}
  */
  // And the Modal


  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    setToken(null);
    setUsername(null);
  };

  const handleLogin = (t: string, u: string) => {
    localStorage.setItem('token', t);
    localStorage.setItem('username', u);
    setToken(t);
    setUsername(u);
    setView('home');
    try {
      localStorage.setItem('activeView', 'home');
    } catch { }
  };

  const changePassword = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ newPassword })
      });
      if (res.ok) {
        alert('Password changed successfully');
        setShowPwdModal(false);
        setNewPassword('');
      } else {
        alert('Failed to change password');
      }
    } catch (e) { alert('Error changing password'); }
  };

  useEffect(() => {
    localStorage.setItem('activeView', view);
  }, [view]);

  const authHeaders = () => ({ 'Authorization': `Bearer ${token}` });

  const resetTrafficStats = async () => {
    if (!token) return;
    if (!confirm('Are you sure you want to reset all traffic statistics?')) return;
    try {
      const res = await apiFetch('/api/stats', {
        method: 'DELETE',
        headers: authHeaders()
      });
      if (res.ok) {
        fetchStats();
      } else {
        alert('Failed to reset statistics');
      }
    } catch (e) {
      alert('Error resetting statistics');
    }
  };

   const processStats = (data: Stats) => {
    if (data.timestamp) {
      setStats(data);
      // Persist stats across browser refresh
      try { localStorage.setItem('stigix_stats_cache', JSON.stringify(data)); } catch {}
      // Calculate RPM
      let calculatedRpm = currentRpm;
      if (prevTotalRequestsRef.current !== null && prevTimestampRef.current !== null) {
        const deltaReq = data.total_requests - prevTotalRequestsRef.current;
        const deltaTime = data.timestamp - prevTimestampRef.current;
        if (deltaTime > 0) {
          const rpm = (deltaReq / deltaTime) * 60;
          if (deltaReq > 0) {
            calculatedRpm = rpm;
            setCurrentRpm(rpm);
            try { localStorage.setItem('stigix_rpm_cache', String(rpm)); } catch {}
          } else if (deltaTime > 15) {
            calculatedRpm = 0;
            setCurrentRpm(0);
            try { localStorage.setItem('stigix_rpm_cache', '0'); } catch {}
          }
        }
      }

      if (data.total_requests !== prevTotalRequestsRef.current) {
        prevTotalRequestsRef.current = data.total_requests;
        prevTimestampRef.current = data.timestamp;

        // Only append live data to history if we're not loading historical snapshots
        // and if the timestamp is newer than our last entry.
        setHistory(prev => {
          if (prev.length > 0 && prev[prev.length - 1].rawTimestamp >= data.timestamp) return prev;

          const newEntry = {
            time: new Date(data.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            rawTimestamp: data.timestamp,
            requests: Math.round(calculatedRpm),
            total: data.total_requests,
            ...data.requests_by_app
          };

          const newHistory = [...prev, newEntry];

          // Max points based on time range (1 point per minute usually, but live is 1s)
          // For simplicity, let's keep the last few hundred points if live.
          // But if we just loaded 1440 points (24h), we don't want to prune too much.
          const maxPoints = timeRange === '1h' ? 3600 : (timeRange === '6h' ? 21600 : 86400);
          if (newHistory.length > maxPoints) newHistory.shift();

          // Persist updated history to localStorage
          try { localStorage.setItem(`stigix_history_${timeRange}`, JSON.stringify(newHistory.slice(-300))); } catch {}

          return newHistory;
        });
      }
    }
  };

   const fetchHistory = async (silent = false) => {
    if (!token || isRemoteViewRef.current) return; // owned by PeerStatusSync in remote view
    if (!silent) setIsHistoryLoading(true);
    try {
      const res = await fetch(`/api/traffic/history?range=${timeRange}`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        const formatted = data.map((item: any) => ({
          time: new Date(item.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          rawTimestamp: item.timestamp,
          requests: item.rpm,
          total: item.total_requests,
          ...item.requests_by_app
        }));
        setHistory(formatted);
        // Persist loaded history so it survives browser refresh
        try { localStorage.setItem(`stigix_history_${timeRange}`, JSON.stringify(formatted.slice(-300))); } catch {}
      }
    } catch (e) {
      console.error('Failed to fetch traffic history');
    } finally {
      if (!silent) setIsHistoryLoading(false);
    }
  };

  const fetchDashboardData = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/admin/system/dashboard-data', { headers: authHeaders() });
      if (res.status === 403 || res.status === 401) logout();
      const data = await res.json();

      if (data.stats && !isRemoteViewRef.current) processStats(data.stats);
      if (data.status && !isRemoteViewRef.current) setStatus(data.status);
      if (data.logs) setLogs(data.logs);
      if (data.dockerStats) setDockerStats(data.dockerStats);
      // In remote view, voice/conv/stats/status are owned by PeerStatusSync.
      if (!isRemoteViewRef.current) {
        if (data.convergenceTests) setGlobalConvStatus(data.convergenceTests);
        if (data.voice) setGlobalVoiceStatus(data.voice);
      }
      if (data.registry) setRegistryStatus(data.registry);
    } catch (e) {
      console.error('Consolidated fetch failed');
    }
  };

  const fetchStats = async () => {
    if (!token || isRemoteViewRef.current) return; // owned by PeerStatusSync in remote view
    try {
      const res = await fetch('/api/stats', { headers: authHeaders() });
      if (res.status === 403 || res.status === 401) logout();
      const data = await res.json();
      processStats(data);
    } catch (e) { }
  };

  const fetchStatus = async () => {
    if (!token || isRemoteViewRef.current) return; // owned by PeerStatusSync in remote view
    try {
      const res = await fetch('/api/status', { headers: authHeaders() });
      const data = await res.json();
      setStatus(data.status);
    } catch (e) {
      setStatus('unknown');
    }
  };

  const fetchTrafficStatus = async () => {
    if (!token || isRemoteViewRef.current) return; // owned by PeerStatusSync in remote view
    try {
      const res = await fetch('/api/traffic/status', { headers: authHeaders() });
      const data = await res.json();
      setTrafficRunning(data.running || false);
      if (data.sleep_interval) setTrafficRate(data.sleep_interval);
      if (data.client_count) setTrafficClientCount(data.client_count);
    } catch (e) {
      console.error('Failed to fetch traffic status');
    }
  };

  const checkConfigValid = async () => {
    if (!token) return;
    try {
      const res = await apiFetch('/api/config/interfaces', { headers: authHeaders() });
      const interfaces = await res.json();
      setConfigValid(interfaces && interfaces.length > 0);
    } catch (e) {
      setConfigValid(false);
    }
  };

  const handleTrafficToggle = async () => {
    if (!token) return;
    const endpoint = trafficRunning ? '/api/traffic/stop' : '/api/traffic/start';
    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (res.ok) {
        setTrafficRunning(data.running);
        if (data.sleep_interval) setTrafficRate(data.sleep_interval);
        if (data.client_count) setTrafficClientCount(data.client_count);
      }
    } catch (e) {
      console.error('Failed to toggle traffic');
    }
  };

  const updateTrafficSettings = async (rate?: number, clients?: number) => {
    if (!token) return;
    setUpdatingRate(true);
    try {
      const res = await apiFetch('/api/traffic/rate', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate, client_count: clients })
      });
      if (res.ok) {
        if (rate !== undefined) setTrafficRate(rate);
        if (clients !== undefined) setTrafficClientCount(clients);
      }
    } catch (e) {
      console.error('Failed to update traffic settings');
    } finally {
      setUpdatingRate(false);
    }
  };

  const fetchLogs = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/logs', { headers: authHeaders() });
      const data = await res.json();
      if (data.logs) setLogs(data.logs);
    } catch (e) {
      console.error("Failed to fetch logs");
    }
  }

  const fetchVersion = async () => {
    try {
      const res = await fetch('/api/version');
      const data = await res.json();
      if (data.version) setVersion(data.version);
    } catch (e) {
      console.error("Failed to fetch version");
    }
  }

  const fetchConnectivity = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/connectivity/test', { headers: authHeaders() });
      const data = await res.json();
      setConnectivity(data);
    } catch (e) {
      console.error("Failed to fetch connectivity");
    }
  }

  const fetchDockerStats = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/connectivity/docker-stats', { headers: authHeaders() });
      const data = await res.json();
      setDockerStats(data);
    } catch (e) {
      console.error("Failed to fetch Docker stats");
    }
  }

  const fetchConfigUi = async () => {
    try {
      const res = await fetch('/api/config/ui');
      const data = await res.json();
      if (data.refreshInterval) setRefreshInterval(data.refreshInterval);
      setUiConfig(data);
    } catch (e) {
      console.error("Failed to fetch UI config");
    }
  }

  const fetchFeatures = async () => {
    try {
      const res = await fetch('/api/features');
      const data = await res.json();
      setFeatures(data);
    } catch (e) {
      console.error("Failed to fetch features");
    }
  };

  const fetchAppConfig = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/config/apps', { headers: authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setAppConfig(data);
    } catch (e) {
      console.error("Failed to fetch app config");
    }
  };

  const runSpeedtest = async () => {
    if (!token || runningSpeedtest) return;
    setRunningSpeedtest(true);
    setSpeedtestResult(null);
    try {
      const res = await fetch('/api/connectivity/speedtest', { headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setSpeedtestResult(data);
      }
    } catch (e) {
      console.error("Speedtest failed");
    } finally {
      setRunningSpeedtest(false);
    }
  };

  const runIperf = async () => {
    if (!token || runningIperf) return;
    setRunningIperf(true);
    setIperfResult(null);
    try {
      const res = await fetch('/api/connectivity/iperf/client', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: iperfTarget })
      });
      const data = await res.json();
      if (data.success) {
        setIperfResult(data.result);
        setShowIperfModal(false);
      } else {
        alert(data.error || 'Iperf test failed');
      }
    } catch (e) {
      console.error("Iperf failed");
    } finally {
      setRunningIperf(false);
    }
  };

  const fetchIperfStatus = async () => {
    if (!token) return;
    try {
      const res = await apiFetch('/api/connectivity/iperf/server', { headers: authHeaders() });
      const data = await res.json();
      setIperfServerInfo(data);
    } catch (e) { }
  };

  const fetchPublicIp = async () => {
    try {
      const res = await apiFetch('/api/connectivity/public-ip', { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setPublicIp(data.ip);
        if (data.countryCode) setPublicIpCountry(data.countryCode);
        setPublicIpInfo(data);
      }
    } catch (e) {
      console.error('Failed to fetch public IP');
    }
  };

  const fetchGatewayIp = async () => {
    try {
      const res = await apiFetch('/api/system/gateway-ip', { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setGatewayIp(data.ip);
        if (data.local_ip) setLocalIp(data.local_ip);
        setGatewayInfo(data);
      }
    } catch (e) {
      console.error('Failed to fetch gateway IP');
    }
  };

  const fetchMaintenance = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/admin/maintenance/version', { headers: authHeaders() });
      const data = await res.json();
      setMaintenance(data);
    } catch (e) { }
  };

  const fetchSiteInfo = async () => {
    if (!token) return;
    try {
      const res = await apiFetch('/api/siteinfo', { headers: authHeaders() });
      const data = await res.json();
      setSiteInfo(data);
    } catch (e) { }
  };

  const fetchHealthMatrix = async () => {
    if (!token) return;
    try {
      const res = await apiFetch('/api/system/health-matrix', { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setHealthData(data);
        }
      }
    } catch (e) { }
  };



  // One-time initialization on login — does NOT re-run on tab changes
  useEffect(() => {
    if (!token) return;
    fetchDashboardData();
    checkConfigValid();
    fetchVersion();
    fetchConfigUi();
    fetchAppConfig();
    fetchMaintenance();
    fetchPublicIp();
    fetchGatewayIp();
    fetchSiteInfo();
    fetchHistory();
    fetchFeatures();
    fetchHealthMatrix();
    fetchCopilotConfig();
    fetchRegistryLeaderStatus();

    // Core 3s polling — always on, not restarted on tab changes
    const interval = setInterval(() => {
      fetchDashboardData();
      fetchTrafficStatus();
    }, 3000);

    // Health Matrix polling every 5s
    const healthInterval = setInterval(() => {
      fetchHealthMatrix();
      fetchRegistryLeaderStatus();
    }, 5000);

    // History refresh every 60s silently (no spinner, no chart flash)
    const historyInterval = setInterval(() => {
      fetchHistory(true);
    }, 60000);

    const connectivityInterval = setInterval(() => {
      fetchConnectivity();
      fetchIperfStatus();
      fetchPublicIp();
      fetchGatewayIp();
      fetchSiteInfo();
    }, 15000);

    const maintenanceInterval = setInterval(() => {
      fetchMaintenance();
    }, 3600000);

    return () => {
      clearInterval(interval);
      clearInterval(healthInterval);
      clearInterval(historyInterval);
      clearInterval(connectivityInterval);
      clearInterval(maintenanceInterval);
    };
  }, [token]); // Only re-run when token changes (login/logout), NOT on tab changes

  // Failover fast polling — separate effect so it doesn't disrupt other intervals
  useEffect(() => {
    if (!token || (view !== 'failover' && view !== 'convergence')) return;
    const fastInterval = setInterval(async () => {
      if (isRemoteViewRef.current) return;
      try {
        const res = await fetch('/api/convergence/status', { headers: authHeaders() });
        if (res.ok) {
          const data = await res.json();
          setGlobalConvStatus(data);
        }
      } catch {}
    }, 500);
    return () => clearInterval(fastInterval);
  }, [token, view]);

  useEffect(() => {
    if (token) {
      // Immediately show cached history for this range while API loads
      try {
        const cached = localStorage.getItem(`stigix_history_${timeRange}`);
        if (cached) setHistory(JSON.parse(cached));
      } catch {}
      fetchHistory();
    }
  }, [timeRange]);

  // Guard PCAP Replay view: if flag is not enabled, silently redirect to dashboard
  useEffect(() => {
    if (view === 'pcap_replay' && !isPcapEnabled) {
      setView('dashboard');
    }
  }, [view, isPcapEnabled]);

  const totalErrors = stats ? Object.values(stats.errors_by_app).reduce((a, b) => a + b, 0) : 0;
  const successRate = stats ? ((stats.total_requests - totalErrors) / stats.total_requests * 100).toFixed(1) : '100';

  if (!token) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <PeerContextProvider
      token={token}
      isLeader={isLeader}
      onActivePeerChange={(peerId, peerLabel) => {
        activePeerIdRef.current = peerId;
        isRemoteViewRef.current = peerId !== null;
        setIsRemoteView(peerId !== null);
        setActivePeerLabel(peerLabel);

        // Immediately refetch all system and network metrics for the active node (remote peer or local Leader)
        fetchHealthMatrix();
        fetchSiteInfo();
        fetchGatewayIp();
        fetchPublicIp();
        fetchConnectivity();
        fetchDashboardData();
        fetchTrafficStatus();
        fetchIperfStatus();
      }}
    >
      {/* Peer-aware live status sync — patches globalConvStatus/globalVoiceStatus/Network Status from remote peer */}
      <PeerStatusSync
        token={token}
        view={view}
        onConvStatus={setGlobalConvStatus}
        onVoiceStatus={setGlobalVoiceStatus}
        onStats={processStats}
        onStatus={setStatus}
        onTrafficStatus={(running, rate, count) => {
          setTrafficRunning(running);
          if (rate !== undefined) setTrafficRate(rate);
          if (count !== undefined) setTrafficClientCount(count);
        }}
        onHistory={setHistory}
        onGatewayIp={(gw, info) => {
          setGatewayIp(gw);
          if (info) setGatewayInfo(info);
        }}
        onLocalIp={setLocalIp}
        onPublicIp={(ip, country, info) => {
          setPublicIp(ip);
          if (country !== undefined) setPublicIpCountry(country);
          if (info) setPublicIpInfo(info);
        }}
        onSiteInfo={setSiteInfo}
        onConnectivity={setConnectivity}
        onIperfServer={setIperfServerInfo}
        onHealthMatrix={setHealthData}
      />
    <div className="min-h-screen bg-background text-foreground pt-4 pb-8 pr-8 pl-20">
      <SidebarRail
        activeView={view}
        activeSubTab={initialSettingsTab}
        onNavigate={handleNavigate}
        isLeader={isLeader}
        features={{
          xfr_enabled: features.xfr_enabled,
          pcap_enabled: isPcapEnabled,
          copilot_enabled: Boolean(copilotConfig?.featureEnabled && copilotConfig?.hasKey)
        }}
        activeTasks={activeTasks}
        copilotDrawerOpen={copilotDrawerOpen}
        onToggleCopilot={() => setCopilotDrawerOpen(prev => !prev)}
        onOpenSearch={() => setIsSearchOpen(true)}
        isSearchOpen={isSearchOpen}
        username={username}
        theme={theme}
        onToggleTheme={toggleTheme}
        onAddUser={() => setShowAddUserModal(true)}
        onChangePassword={() => setShowPwdModal(true)}
        onLogout={logout}
      />
      <TopLoadingBar isLoading={isNavigating} />
      <Toaster position="top-right" />

      {/* Remote-view inset frame — amber border on all 4 edges.
          Light mode: stronger opacity + thicker border because contrast is lower on light backgrounds.
          position:fixed + pointer-events:none = zero layout impact, never shifts content. */}
      {isRemoteView && (
        <div
          className="fixed inset-0 z-[9998] pointer-events-none"
          style={{
            boxShadow: theme === 'light'
              ? 'inset 0 0 0 3px rgba(217,119,6,0.75)'   /* amber-600 at 75% — clearly visible on #eef2f7 */
              : 'inset 0 0 0 2px rgba(251,191,36,0.40)'   /* amber-300 at 40% — subtle on dark */
          }}
          aria-hidden="true"
        />
      )}


      <header className="mb-6 flex justify-between items-center gap-4">
        {/* Left: Brand Identity Logo & Single-Line Platform Title */}
        <div className="flex items-center gap-4 min-w-0">
          {/* Fluo Pulse Gem Icon (Scaled for bold brand presence) */}
          <div className="relative flex-shrink-0 neon-squircle">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 p-[2.5px] shadow-lg shadow-blue-500/20 dark:shadow-xl dark:shadow-blue-500/30">
              <div className="w-full h-full bg-white dark:bg-[#0a0f1d] rounded-[13px] flex items-center justify-center transition-colors">
                <svg className="w-6 h-6 pulse-path" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
              </div>
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white dark:border-[#0a0f1d] shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
          </div>

          {/* Wordmark Stigix & Single-Line Metadata (Full Light & Dark Theme Support) */}
          <div className="flex items-baseline gap-3.5 flex-wrap sm:flex-nowrap">
            <h1 className="text-4xl sm:text-[40px] font-black tracking-[-0.035em] leading-none text-slate-900 dark:text-text-primary flex items-baseline select-none font-sans">
              St
              <span className="relative inline-block mx-[1px]">
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 w-[7px] h-[7px] rounded-full bg-blue-600 dark:bg-cyan-400 neon-dot border border-blue-400/80 dark:border-cyan-300/80 shadow-[0_0_8px_rgba(37,99,235,0.6)] dark:shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                ı
              </span>
              g
              <span className="relative inline-block mx-[1px]">
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 w-[7px] h-[7px] rounded-full bg-blue-600 dark:bg-cyan-400 neon-dot-delay border border-blue-400/80 dark:border-cyan-300/80 shadow-[0_0_8px_rgba(37,99,235,0.6)] dark:shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                ı
              </span>
              x
            </h1>

            {/* Divider */}
            <span className="text-slate-300 dark:text-slate-700 font-light text-lg hidden sm:inline">|</span>

            {/* Single-line Metadata (Significantly Enlarged & Prominent) */}
            <div className="flex items-center gap-2.5 sm:gap-3 text-sm sm:text-[15px] font-medium">
              <span className="hidden md:inline text-slate-700 dark:text-slate-200 font-semibold tracking-tight">
                SASE Validation Engine
              </span>
              {isRemoteView && activePeerLabel ? (
                <>
                  <span className="text-slate-400 dark:text-slate-600 hidden md:inline">•</span>
                  <span className="text-sm sm:text-base font-black tracking-tight text-amber-500 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/30">
                    {activePeerLabel}
                  </span>
                </>
              ) : (
                (siteInfo?.detected_site_name || registryStatus?.site_name || (isLeader ? 'DC1' : 'BR8')) && (
                  <>
                    <span className="text-slate-400 dark:text-slate-600 hidden md:inline">•</span>
                    <span className="text-sm sm:text-base font-black tracking-tight text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-lg border border-blue-500/30">
                      {siteInfo?.detected_site_name || registryStatus?.site_name || (isLeader ? 'DC1' : 'BR8')}
                    </span>
                  </>
                )
              )}
              {version && (
                <>
                  <span className="text-slate-400 dark:text-slate-600">•</span>
                  <span className="font-mono font-bold text-cyan-600 dark:text-cyan-400 text-xs sm:text-[13px] bg-cyan-500/10 px-2 py-0.5 rounded-md border border-cyan-500/20">
                    {version}
                  </span>
                </>
              )}
              {/* Discrete Node Mode Badge (Leader / Peer / Standalone) */}
              {(() => {
                const isLeaderNode = isLeader || registryStatus?.mode === 'leader' || registryStatus?.current_mode === 'leader';
                const isEnrolledPeer = !isLeaderNode && Boolean(registryStatus?.is_cluster_enrolled || registryStatus?.static_leader_url);
                const isStandalone = !isLeaderNode && !isEnrolledPeer;

                return (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setShowNodeRoleModal(true)}
                      title={
                        isLeaderNode
                          ? "Cluster Leader — Orchestrating mesh fleet (Click to manage)"
                          : isEnrolledPeer
                          ? `Enrolled Spoke Peer (Connected to ${registryStatus?.enrolled_leader_url || registryStatus?.static_leader_url || 'Leader'}) — Click to manage`
                          : "Standalone Autonomous Node (Click to join fleet or promote)"
                      }
                      className={cn(
                        "px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border shadow-sm inline-flex items-center gap-1.5 transition-all hover:scale-105 cursor-pointer select-none",
                        isLeaderNode
                          ? "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30 hover:border-purple-500/60"
                          : isEnrolledPeer
                          ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30 hover:border-blue-500/60"
                          : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:border-emerald-500/60"
                      )}
                    >
                      <span className={cn("w-2 h-2 rounded-full", isLeaderNode ? "bg-purple-500 animate-pulse" : isEnrolledPeer ? "bg-blue-500" : "bg-emerald-400")} />
                      {isLeaderNode ? 'Leader' : isEnrolledPeer ? 'Peer' : 'Standalone'}
                    </button>
                    {isStandalone && (
                      <button
                        onClick={() => setShowNodeRoleModal(true)}
                        title="Connect this standalone node to a Stigix Leader"
                        className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 dark:text-blue-400 border border-blue-500/30 transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <Sparkles size={10} className="text-blue-400" />
                        <span className="hidden sm:inline">Join Fleet</span>
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>



        <div className="flex gap-3 items-center">
          {/* Remote peer indicator — inline chip, no layout shift */}
          {isLeader && <RemoteViewChip />}
          {/* Gateway Context Switcher (Leader only) */}
          {isLeader && <GatewayDropdown isLeader={isLeader} />}

          {/* Magic Join Quick Onboarding Button (Leader only) */}
          {isLeader && (
            <button
              id="magic-join-btn"
              onClick={() => setShowMagicJoinModal(true)}
              title="Add Node via Magic Join (Zero-Touch Onboarding)"
              className="px-3 py-1.5 rounded-xl border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 flex items-center gap-1.5 text-xs font-bold transition-all shadow-sm select-none"
            >
              <Sparkles size={14} className="text-blue-400 animate-pulse" />
              <span className="hidden sm:inline">Add Node</span>
            </button>
          )}

          {/* Quick Copilot Trigger Button (only visible if feature enabled and Anthropic API key is configured) */}
          {copilotConfig?.featureEnabled && copilotConfig?.hasKey && (
            <button
              onClick={() => setCopilotDrawerOpen(prev => !prev)}
              title="Toggle Stigix AI Copilot (⌘J)"
              className={cn(
                "px-3 py-1.5 rounded-xl border flex items-center gap-2 text-xs font-black transition-all shadow-sm",
                copilotDrawerOpen
                  ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white border-transparent shadow-blue-500/20"
                  : "bg-card-secondary hover:bg-card-hover text-text-secondary hover:text-text-primary border-border"
              )}
            >
              <Bot size={15} className={copilotDrawerOpen ? "text-white" : "text-indigo-500 dark:text-indigo-400"} />
              <span className="hidden md:inline">AI Copilot</span>
              <span className={cn(
                "px-1 py-0.2 rounded text-[8px] font-mono border",
                copilotDrawerOpen
                  ? "bg-white/20 text-white border-white/20"
                  : "bg-slate-200/70 dark:bg-black/20 text-slate-600 dark:text-text-muted border-slate-300/60 dark:border-white/10"
              )}>⌘J</span>
            </button>
          )}

          <SystemHealthBadge
            healthData={healthData}
            isLoading={isHealthLoading}
            onClick={() => setShowHealthModal(true)}
          />

          {/* Quick Light / Dark Theme Switcher Button */}
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}
            className="p-1.5 sm:p-2 rounded-xl border border-slate-200 dark:border-border bg-slate-100 hover:bg-slate-200 dark:bg-card-secondary dark:hover:bg-card-hover text-slate-700 dark:text-text-muted hover:text-slate-900 dark:hover:text-white transition-all shadow-xs cursor-pointer active:scale-95 flex items-center justify-center"
          >
            {theme === 'dark' ? (
              <Sun size={15} className="text-amber-400 hover:rotate-45 transition-transform" />
            ) : (
              <Moon size={15} className="text-indigo-600 hover:-rotate-12 transition-transform" />
            )}
          </button>
        </div>
      </header >

      {/* Add User Modal */}
      {
        showAddUserModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-card border border-border p-6 rounded-xl w-full max-w-sm shadow-2xl">
              <h3 className="text-lg font-bold text-text-primary mb-4">Add New User</h3>
              <input
                type="text"
                placeholder="Username"
                value={newUsername}
                onChange={e => setNewUsername(e.target.value)}
                className="w-full bg-card-secondary border border-border rounded-lg px-4 py-2 mb-2 focus:border-blue-500 outline-none text-text-primary"
              />
              <input
                type="password"
                placeholder="Password (min 5 chars)"
                value={newUserPassword}
                onChange={e => setNewUserPassword(e.target.value)}
                className="w-full bg-card-secondary border border-border rounded-lg px-4 py-2 mb-4 focus:border-blue-500 outline-none text-text-primary"
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowAddUserModal(false)} className="px-4 py-2 text-text-muted hover:text-text-primary transition-colors">Cancel</button>
                <button onClick={addUser} className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg shadow-md transition-colors">Create</button>
              </div>
            </div>
          </div>
        )
      }

      {/* Password Modal */}
      {
        showPwdModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-card border border-border p-6 rounded-xl w-full max-w-sm shadow-2xl">
              <h3 className="text-lg font-bold text-text-primary mb-4">Change Password</h3>
              <input
                type="password"
                placeholder="New Password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full bg-card-secondary border border-border rounded-lg px-4 py-2 mb-4 focus:border-blue-500 outline-none text-text-primary"
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowPwdModal(false)} className="px-4 py-2 text-text-muted hover:text-text-primary transition-colors">Cancel</button>
                <button onClick={changePassword} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-md transition-colors">Save</button>
              </div>
            </div>
          </div>
        )
      }

      {/* Iperf Client Modal */}
      {/* Iperf Client Modal */}
      {
        showIperfModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-300">
            <div className="bg-card border border-border p-6 rounded-xl w-full max-w-md shadow-2xl">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-purple-600/10 rounded-lg text-purple-600 dark:text-purple-400 border border-purple-500/20">
                  <Activity size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-text-primary tracking-tight">Iperf Client Test</h3>
                  <p className="text-text-muted text-xs mt-0.5">Test bandwidth against an iperf3 server.</p>
                </div>
              </div>

              <div className="space-y-4 mb-8">
                <div className="space-y-1.5">
                  <label className="text-[10px] text-text-muted font-black tracking-widest">Target Ip / Hostname</label>
                  <input
                    type="text"
                    placeholder="e.g. 192.168.1.100"
                    value={iperfTarget}
                    onChange={e => setIperfTarget(e.target.value)}
                    className="w-full bg-card-secondary border border-border rounded-lg px-4 py-3 text-text-primary focus:ring-1 focus:ring-purple-500 outline-none transition-all"
                  />
                </div>

                {/* Show last result if exists */}
                {iperfResult && (
                  <div className="p-3 bg-purple-600/5 rounded-lg border border-purple-500/20 flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-2">
                      <Activity size={14} className="text-purple-600 dark:text-purple-400" />
                      <span className="text-xs text-text-muted font-bold tracking-tight">Last Test ({iperfResult.target}):</span>
                    </div>
                    <span className="text-sm font-black text-purple-600 dark:text-purple-400">
                      {Math.round(iperfResult.received_mbps || iperfResult.sent_mbps)} Mbps
                    </span>
                  </div>
                )}

                <div className="p-3 bg-card-secondary/20 rounded-lg border border-border shadow-inner">
                  <p className="text-[10px] text-text-muted leading-relaxed italic opacity-80">
                    Note: The test will run for 5 seconds using TCP. Results will also appear in the top Network Status bar.
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowIperfModal(false)}
                  className="px-6 py-2.5 text-text-muted hover:text-text-primary font-bold transition-colors tracking-wider text-xs"
                >
                  Cancel
                </button>
                <button
                  onClick={runIperf}
                  disabled={runningIperf || !iperfTarget}
                  className={cn(
                    "px-8 py-2.5 rounded-lg font-black flex items-center gap-2 transition-all shadow-lg tracking-widest text-xs",
                    runningIperf
                      ? "bg-card-secondary text-text-muted border border-border cursor-not-allowed opacity-50"
                      : "bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/40"
                  )}
                >
                  {runningIperf ? <><Gauge size={18} className="animate-spin" /> Running...</> : 'Launch Test'}
                </button>
              </div>
            </div>
          </div>
        )
      }



      {/* Remote Peer View Banner — shown when a remote peer context is active */}
      <RemoteViewBanner />

      {/* Home Command Center & Overview */}
      {view === 'home' && (
        <HomeOverview
          token={token}
          healthData={healthData}
          isLoadingHealth={isHealthLoading}
          onRefreshHealth={() => {
            fetchHealthMatrix();
            fetchGatewayIp();
            fetchPublicIp();
          }}
          registryStatus={registryStatus}
          siteInfo={siteInfo}
          version={version || 'v3.0.0'}
          trafficRunning={trafficRunning}
          currentRpm={currentRpm}
          saasAppsCount={trafficRunning && activeSaasAppsCount > 0 ? activeSaasAppsCount : totalConfiguredSaasApps}
          globalVoiceStatus={globalVoiceStatus}
          globalConvStatus={globalConvStatus}
          isLeader={isLeader}
          publicIp={publicIp}
          publicIpCountry={publicIpCountry}
          publicIpInfo={publicIpInfo}
          gatewayIp={gatewayIp}
          localIp={localIp}
          gatewayInfo={gatewayInfo}
          updateAvailable={Boolean(maintenance?.updateAvailable)}
          speedtestResult={speedtestResult}
          onRunSpeedtest={runSpeedtest}
          runningSpeedtest={runningSpeedtest}
          onNavigate={handleNavigate}
          onOpenDiagnostics={() => setShowHealthModal(true)}
          onOpenNodeRoleModal={() => setShowNodeRoleModal(true)}
        />
      )}

      {/* Traffic Control — always mounted so chart never re-animates on tab return */}
      <div className={view !== 'dashboard' ? 'hidden' : ''}>
        <>
            {/* Traffic Control Panel */}
            <div className="bg-card border border-border rounded-xl p-5 mb-8 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                {/* Part 1: Status */}
                <div className="min-w-[200px]">
                  <h3 className="text-lg font-black text-text-primary flex items-center gap-2 tracking-tight">
                    <Activity size={20} className={trafficRunning ? "text-green-600 dark:text-green-400 animate-pulse" : "text-text-muted opacity-50"} />
                    Traffic Generation
                  </h3>
                  <p className="text-text-muted text-[10px] font-bold uppercase tracking-widest mt-1">
                    Status: <span className={trafficRunning ? "text-green-600 dark:text-green-400" : "text-text-muted opacity-60"}>{trafficRunning ? 'Active' : 'Paused'}</span>
                    {' • '}
                    Config: <span className={configValid ? "text-green-600 dark:text-green-400" : "text-amber-500"}>{configValid ? 'Valid' : 'Required'}</span>
                  </p>
                  <button
                    onClick={() => { setInitialSettingsTab('distribution'); setView('settings'); }}
                    className="mt-2 flex items-center gap-1.5 text-[9px] font-black text-blue-500 hover:text-blue-400 uppercase tracking-widest transition-colors group"
                  >
                    <Sliders size={10} className="group-hover:rotate-90 transition-transform duration-200" />
                    Configure Distribution
                  </button>
                </div>

                {/* Unified Load & Intensity segmented control */}
                <div className="flex-1 flex flex-col items-center justify-center gap-1.5 bg-card-secondary/50 px-4 py-2.5 rounded-lg border border-border/50 shadow-inner">
                  <div className="w-full flex items-center justify-between">
                    <span className="text-[9px] font-black text-text-muted tracking-widest uppercase">Traffic Load & Intensity</span>
                    <span className="text-[9px] font-mono text-text-muted/80">
                      {trafficRate < 1 ? `${Math.round(trafficRate * 1000)}ms` : `${trafficRate}s`} delay · x{trafficClientCount} parallel
                    </span>
                  </div>
                  <div className="w-full grid grid-cols-4 gap-1.5 bg-card/60 rounded-xl border border-border p-1.5 backdrop-blur-sm">
                    {([
                      { id: 'minimal', label: 'Minimal', sub: '~1 req/s', rate: 1.0, clients: 1, activeClass: 'bg-blue-600 text-white shadow-md shadow-blue-500/30 ring-1 ring-blue-400', hoverClass: 'hover:bg-blue-500/10 hover:text-blue-400' },
                      { id: 'moderate', label: 'Moderate', sub: '~7 req/s', rate: 0.3, clients: 2, activeClass: 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30 ring-1 ring-indigo-400', hoverClass: 'hover:bg-indigo-500/10 hover:text-indigo-400' },
                      { id: 'high', label: 'High Load', sub: '~40 req/s', rate: 0.1, clients: 4, activeClass: 'bg-amber-600 text-white shadow-md shadow-amber-500/30 ring-1 ring-amber-400', hoverClass: 'hover:bg-amber-500/10 hover:text-amber-400' },
                      { id: 'stress', label: 'Stress ⚡', sub: '~160 req/s', rate: 0.05, clients: 8, activeClass: 'bg-gradient-to-r from-rose-600 to-red-600 text-white shadow-lg shadow-rose-500/40 ring-1 ring-rose-400 animate-pulse', hoverClass: 'hover:bg-rose-500/10 hover:text-rose-400' },
                    ] as const).map((preset) => {
                      const presets = [
                        { id: 'minimal', rate: 1.0, clients: 1 },
                        { id: 'moderate', rate: 0.3, clients: 2 },
                        { id: 'high', rate: 0.1, clients: 4 },
                        { id: 'stress', rate: 0.05, clients: 8 },
                      ];
                      const currentScore = trafficClientCount / Math.max(0.01, trafficRate);
                      const isClosest = presets.reduce((prev, curr) => {
                        const prevDiff = Math.abs((prev.clients / prev.rate) - currentScore);
                        const currDiff = Math.abs((curr.clients / curr.rate) - currentScore);
                        return currDiff < prevDiff ? curr : prev;
                      }).id === preset.id;

                      return (
                        <button
                          key={preset.id}
                          disabled={updatingRate}
                          onClick={() => updateTrafficSettings(preset.rate, preset.clients)}
                          className={cn(
                            'flex flex-col items-center justify-center py-2 px-2.5 rounded-lg text-center transition-all disabled:cursor-not-allowed border border-transparent',
                            isClosest
                              ? preset.activeClass
                              : cn('text-text-muted hover:text-text-primary hover:bg-card-secondary/60', preset.hoverClass)
                          )}
                        >
                          <span className="text-[10px] font-black tracking-tight leading-tight">{preset.label}</span>
                          <span className={cn('text-[8px] font-mono leading-tight mt-0.5', isClosest ? 'text-white/80' : 'text-text-muted/70')}>
                            {preset.sub}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Part 3: Action Button */}
                <button
                  onClick={handleTrafficToggle}
                  disabled={!configValid}
                  className={cn(
                    "px-6 py-3 rounded-xl font-black tracking-widest text-xs transition-all shadow-lg flex items-center gap-2.5 min-w-[170px] justify-center group",
                    trafficRunning
                      ? 'bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white shadow-red-500/30 ring-2 ring-red-500/40 ring-offset-2 ring-offset-card'
                      : 'bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white shadow-emerald-500/20 disabled:from-card-secondary disabled:to-card-secondary disabled:text-text-muted disabled:border-border disabled:shadow-none disabled:cursor-not-allowed opacity-90 disabled:opacity-50'
                  )}
                >
                  {trafficRunning ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-white animate-ping mr-1" />
                      <Pause size={16} fill="currentColor" />
                      Stop Traffic
                    </>
                  ) : (
                    <>
                      <Play size={16} fill="currentColor" className="group-hover:translate-x-0.5 transition-transform" />
                      Start Traffic
                    </>
                  )}
                </button>
              </div>

              {!configValid && (
                <div className="mt-4 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                  <p className="text-amber-600 dark:text-amber-400 text-[10px] font-bold tracking-wide flex items-center gap-2">
                    <AlertCircle size={14} />
                    Configure an interface in <button onClick={() => setView('settings')} className="underline font-black hover:text-amber-500 ml-1">Settings</button> to enable traffic.
                  </p>
                </div>
              )}
            </div>

            {/* Main Chart with Consolidated Live KPIs Ribbon */}
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-blue-500/10 rounded-lg text-blue-500">
                      <BarChart3 size={20} />
                    </div>
                    <div>
                      <h3 className="text-lg font-black text-text-primary tracking-tight">Traffic Volume</h3>
                      <p className="text-[10px] text-text-muted font-bold uppercase tracking-wider">SaaS & WAN Real-Time Monitor</p>
                    </div>
                  </div>

                  {/* Consolidated Telemetry Ribbon (Supports Light & Dark Modes) */}
                  <div className="flex flex-wrap items-center gap-2 sm:ml-2 sm:pl-3 sm:border-l sm:border-border/60">
                    {/* Live Rate */}
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                      <span className="text-[10px] uppercase font-black text-blue-600 dark:text-blue-400 tracking-wider">Rate:</span>
                      <span className="font-mono font-black text-blue-700 dark:text-blue-300">{Math.round(currentRpm)} <span className="text-[9px] font-normal text-text-muted">req/min</span></span>
                    </div>

                    {/* Success Rate */}
                    <div className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs",
                      parseFloat(successRate) >= 95
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                        : parseFloat(successRate) >= 85
                          ? "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400"
                          : "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400"
                    )}>
                      <CheckCircle size={11} />
                      <span className="text-[10px] uppercase font-black tracking-wider">Success:</span>
                      <span className="font-mono font-black">{successRate}%</span>
                    </div>

                    {/* Active Apps */}
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-500/10 border border-purple-500/20 text-xs">
                      <LayoutDashboard size={11} className="text-purple-600 dark:text-purple-400" />
                      <span className="text-[10px] uppercase font-black text-purple-600 dark:text-purple-400 tracking-wider">Apps:</span>
                      <span className="font-mono font-black text-purple-700 dark:text-purple-300">{stats ? Object.keys(stats.requests_by_app).length : 0}</span>
                    </div>

                    {/* Total Requests */}
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-card-secondary/50 border border-slate-200 dark:border-border text-xs">
                      <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-text-muted tracking-wider">Total:</span>
                      <span className="font-mono font-bold text-slate-900 dark:text-text-primary">{stats?.total_requests?.toLocaleString() || 0}</span>
                    </div>

                    {/* Total Errors */}
                    <div className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs",
                      totalErrors > 0
                        ? "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400"
                        : "bg-slate-100 dark:bg-card-secondary/50 border-slate-200 dark:border-border text-slate-500 dark:text-text-muted"
                    )}>
                      <AlertCircle size={11} className={totalErrors > 0 ? "text-rose-500 dark:text-rose-400 animate-pulse" : "text-slate-400 dark:text-text-muted"} />
                      <span className="text-[10px] uppercase font-bold tracking-wider">Errors:</span>
                      <span className="font-mono font-black">{totalErrors.toLocaleString()}</span>
                    </div>

                    {/* Avg & Peak */}
                    <div className="hidden xl:flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-border/40 text-[11px] font-mono text-slate-500 dark:text-text-muted">
                      <span>Avg: <strong className="text-slate-900 dark:text-text-primary">{trafficMetrics.avg}</strong></span>
                      <span>Peak: <strong className="text-amber-500 dark:text-amber-400">{trafficMetrics.peak}</strong></span>
                    </div>
                  </div>
                </div>

                <div className="flex bg-slate-100 dark:bg-card-secondary/20 p-1 rounded-xl border border-slate-200 dark:border-border self-end lg:self-auto">
                  {(['1h', '6h', '24h'] as const).map((range) => (
                    <button
                      key={range}
                      onClick={() => setTimeRange(range)}
                      className={cn(
                        "px-4 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all",
                        timeRange === range
                          ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20"
                          : "text-text-muted hover:text-text-primary hover:bg-card-secondary"
                      )}
                    >
                      {range}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-[300px] w-full relative">
                {isHistoryLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-10 rounded-xl">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
                      <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Synchronizing History...</span>
                    </div>
                  </div>
                )}
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history}>
                    <defs>
                      <linearGradient id="colorRequestsGlow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.38} />
                        <stop offset="60%" stopColor="#3b82f6" stopOpacity={0.08} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis
                      dataKey="time"
                      tick={{ fill: '#64748b', fontSize: 10, fontWeight: 600 }}
                      tickLine={false}
                      axisLine={{ stroke: 'rgba(100,116,139,0.2)' }}
                      minTickGap={timeRange === '1h' ? 60 : timeRange === '6h' ? 40 : 80}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fill: '#64748b', fontSize: 10, fontWeight: 600 }}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                      tickFormatter={(value) => `${value}`}
                      label={{
                        value: 'req/min',
                        angle: -90,
                        position: 'insideLeft',
                        offset: 14,
                        style: { fill: '#94a3b8', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }
                      }}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          const reqs = payload[0].value;
                          return (
                            <div className="bg-slate-950/95 border border-blue-500/30 backdrop-blur-xl rounded-xl p-3 shadow-2xl shadow-blue-950/50 text-xs min-w-[170px]">
                              <div className="flex items-center justify-between gap-3 pb-2 mb-2 border-b border-white/10">
                                <span className="text-slate-400 font-mono text-[11px] font-semibold">{label || data.time}</span>
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-500/20 text-blue-400 text-[9px] font-black uppercase tracking-wider">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                                  Live
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-4 py-1">
                                <span className="text-slate-300 font-medium text-[11px]">Traffic Rate:</span>
                                <span className="text-blue-400 font-mono font-black text-sm">{reqs} <span className="text-[10px] text-slate-400 font-normal">req/min</span></span>
                              </div>
                              {data.total !== undefined && (
                                <div className="flex items-center justify-between gap-4 pt-1 border-t border-white/5 text-[11px] text-slate-400">
                                  <span>Cumulative:</span>
                                  <span className="font-mono font-bold text-slate-200">{Number(data.total).toLocaleString()} reqs</span>
                                </div>
                              )}
                            </div>
                          );
                        }
                        return null;
                      }}
                      cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeDasharray: '4 4' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="requests"
                      stroke="#3b82f6"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#colorRequestsGlow)"
                      activeDot={{ r: 5, stroke: '#93c5fd', strokeWidth: 2, fill: '#1d4ed8' }}
                      name="Traffic Rate"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>


            {/* Statistics Table */}
            <div className="mb-8 mt-4">
              <Statistics stats={stats} appConfig={appConfig} onReset={resetTrafficStats} token={token} />
            </div>

            {/* Logs Terminal */}
            <div className="bg-card border border-border rounded-xl overflow-hidden font-mono text-sm leading-6 shadow-md shadow-black/10">
              <div className="bg-card-secondary/80 backdrop-blur-md px-4 py-2.5 border-b border-border flex items-center gap-2 text-text-muted">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
                </div>
                <span className="ml-2 text-[10px] font-black uppercase tracking-widest opacity-70">Live Streaming Logs</span>
              </div>
              <div className="p-4 h-[300px] overflow-y-auto text-text-primary font-bold scrollbar-thin scrollbar-thumb-border bg-card-secondary/50 dark:bg-black/20">
                {logs.map((log, i) => (
                  <div key={i} className="border-b border-border/10 dark:border-white/5 py-1.5 flex gap-3 text-[11px]">
                    <span className="text-text-muted opacity-40 select-none">{(i + 1).toString().padStart(3, '0')}</span>
                    <span className="break-all">{log}</span>
                  </div>
                ))}
                {logs.length === 0 && <div className="text-text-muted italic opacity-50 flex flex-col items-center justify-center h-full gap-2">
                  <Activity size={32} className="opacity-20" />
                  <p className="uppercase tracking-[0.2em] font-black text-[10px]">Waiting for traffic logs...</p>
                </div>}
              </div>
            </div>
          </>
      </div>

      {/* Other views — conditionally mounted */}
      {view === 'performance' && (
        <ConnectivityPerformance token={token!} uiConfig={uiConfig} isLeader={isLeader} onManage={() => {
          setInitialSettingsTab('probes');
          setView('settings');
        }} />
      )}
      {view === 'topology' && <Topology token={token!} />}
      {view === 'security' && <Security token={token!} onGoToCloudSettings={() => {
        setView('settings');
        setTimeout(() => {
          document.getElementById('cloud-target-security')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 150);
      }} />}
      {view === 'vyos' && <Vyos token={token!} />}
      {view === 'iot' && <Iot token={token!} />}
      {view === 'voice' && <Voice token={token!} externalStatus={globalVoiceStatus} />}
      {(view === 'failover' || view === 'convergence') && <Failover token={token!} externalStatus={globalConvStatus} />}
      {view === 'settings' && <SettingsComponent token={token!} uiConfig={uiConfig} onUpdateUIConfig={fetchConfigUi} onUpdateCopilotConfig={fetchCopilotConfig} initialTab={initialSettingsTab} onOpenNodeRoleModal={() => setShowNodeRoleModal(true)} />}
      {view === 'custom_apps' && <CustomApps token={token!} />}
      {view === 'multicast' && (
        <MulticastOverlayTab
          token={token!}
          localSiteName={siteInfo?.detected_site_name || registryStatus?.site_name || (isLeader ? 'DC1' : 'BR8')}
          isStandalone={true}
        />
      )}
      {view === 'pcap_replay' && isPcapEnabled && <PcapReplay token={token!} />}
      {view === 'packet_capture' && <PacketCapture token={token!} onNavigateToReplay={() => setView('pcap_replay')} />}
      {view === 'speedtest' && features.xfr_enabled && <Speedtest token={token!} />}
      {view === 'events' && <LiveEvents token={token!} />}
      {copilotConfig?.featureEnabled && copilotConfig?.hasKey && view === 'copilot' && <Copilot token={token!} onOpenSettings={() => { setInitialSettingsTab('mcp'); setView('settings'); }} />}
      {view === 'fleet' && isLeader && <Fleet token={token!} onNavigate={setView} />}

      {/* ── Global Floating Copilot Trigger Button (Visible on all tabs only when feature enabled & API key configured) ── */}
      {copilotConfig?.featureEnabled && copilotConfig?.hasKey && view !== 'copilot' && !copilotDrawerOpen && (
        <button
          onClick={() => setCopilotDrawerOpen(true)}
          title="Open Stigix AI Copilot Assistant (⌘J)"
          className="fixed bottom-4 right-4 z-20 bg-white/95 dark:bg-slate-900/90 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-white border border-slate-200/90 dark:border-slate-700/70 hover:border-indigo-400 dark:hover:border-indigo-500/50 rounded-full px-3 py-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-tight transition-all duration-150 hover:scale-105 active:scale-95 group backdrop-blur-md shadow-lg shadow-slate-300/60 dark:shadow-black/40"
        >
          <div className="relative flex items-center justify-center">
            <Bot size={14} className="text-indigo-600 dark:text-indigo-400 group-hover:text-indigo-500 dark:group-hover:text-indigo-300 transition-colors" />
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-emerald-500 dark:bg-emerald-400 rounded-full" />
          </div>
          <span>Copilot</span>
          <span className="px-1 py-0.2 rounded text-[8px] font-mono bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-white border border-slate-200 dark:border-white/10">⌘J</span>
        </button>
      )}

      {/* ── Slide-Over AI Copilot Drawer (Side Panel) ── */}
      {copilotConfig?.featureEnabled && copilotConfig?.hasKey && copilotDrawerOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          {/* Semi-transparent Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={() => setCopilotDrawerOpen(false)}
          />
          {/* Slide-Over Side Panel */}
          <div className="absolute inset-y-0 right-0 max-w-full flex pl-4 sm:pl-10">
            <div className="w-screen max-w-3xl md:max-w-4xl lg:max-w-5xl bg-card border-l border-border shadow-2xl flex flex-col">
              <Copilot
                token={token!}
                isDrawer={true}
                onClose={() => setCopilotDrawerOpen(false)}
                onExpandFullscreen={() => {
                  setCopilotDrawerOpen(false);
                  setView('copilot');
                }}
                onOpenSettings={() => {
                  setCopilotDrawerOpen(false);
                  setInitialSettingsTab('mcp');
                  setView('settings');
                }}
              />
            </div>
          </div>
        </div>
      )}

      <SystemHealthModal
        isOpen={showHealthModal}
        onClose={() => setShowHealthModal(false)}
        token={token}
        healthData={healthData}
        onRefresh={fetchHealthMatrix}
        onOpenSettings={() => {
          setView('settings');
          setInitialSettingsTab('system');
        }}
      />

      <MagicJoinModal
        isOpen={showMagicJoinModal}
        onClose={() => setShowMagicJoinModal(false)}
        token={token}
      />

      <NodeRoleModal
        isOpen={showNodeRoleModal}
        onClose={() => setShowNodeRoleModal(false)}
        token={token}
        registryStatus={registryStatus}
        onRefreshStatus={fetchRegistryLeaderStatus}
        onOpenMagicJoin={() => setShowMagicJoinModal(true)}
      />

      <SearchPaletteModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onNavigate={handleNavigate}
        isLeader={isLeader}
        features={{
          xfr_enabled: features.xfr_enabled,
          pcap_enabled: isPcapEnabled,
          copilot_enabled: Boolean(copilotConfig?.featureEnabled && copilotConfig?.hasKey)
        }}
        onOpenMagicJoin={() => setShowMagicJoinModal(true)}
        onToggleCopilot={() => setCopilotDrawerOpen(prev => !prev)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    </div>
    </PeerContextProvider>
  );
}

function Card({
  title,
  value,
  icon,
  subValue,
  accentColor = 'blue',
  progress
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  subValue?: string;
  accentColor?: 'blue' | 'emerald' | 'amber' | 'rose' | 'purple' | 'cyan';
  progress?: number;
}) {
  const colorMap = {
    blue: {
      border: 'hover:border-blue-500/40',
      iconBg: 'bg-blue-500/10 text-blue-400',
      glow: 'from-blue-500/5',
      text: 'text-blue-400',
      bar: 'bg-blue-500'
    },
    cyan: {
      border: 'hover:border-cyan-500/40',
      iconBg: 'bg-cyan-500/10 text-cyan-400',
      glow: 'from-cyan-500/5',
      text: 'text-cyan-400',
      bar: 'bg-cyan-500'
    },
    emerald: {
      border: 'hover:border-emerald-500/40',
      iconBg: 'bg-emerald-500/10 text-emerald-400',
      glow: 'from-emerald-500/5',
      text: 'text-emerald-400',
      bar: 'bg-emerald-500'
    },
    amber: {
      border: 'hover:border-amber-500/40',
      iconBg: 'bg-amber-500/10 text-amber-400',
      glow: 'from-amber-500/5',
      text: 'text-amber-400',
      bar: 'bg-amber-500'
    },
    rose: {
      border: 'hover:border-rose-500/40',
      iconBg: 'bg-rose-500/10 text-rose-400',
      glow: 'from-rose-500/5',
      text: 'text-rose-400',
      bar: 'bg-rose-500'
    },
    purple: {
      border: 'hover:border-purple-500/40',
      iconBg: 'bg-purple-500/10 text-purple-400',
      glow: 'from-purple-500/5',
      text: 'text-purple-400',
      bar: 'bg-purple-500'
    }
  };

  const theme = colorMap[accentColor] || colorMap.blue;

  return (
    <div className={cn(
      "bg-card border border-border p-5 rounded-2xl relative overflow-hidden group shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col justify-between",
      theme.border
    )}>
      {/* Background Top Gradient Glow */}
      <div className={cn("absolute inset-0 bg-gradient-to-b to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none", theme.glow)} />

      {/* Large Background Watermark Icon */}
      <div className="absolute -top-1 -right-1 p-4 opacity-5 group-hover:opacity-15 transition-all duration-500 transform group-hover:scale-110 pointer-events-none text-text-primary">
        {/* @ts-ignore */}
        {React.cloneElement(icon as React.ReactElement, { size: 64 })}
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <div className={cn("p-1.5 rounded-lg transition-colors duration-300", theme.iconBg)}>
              {/* @ts-ignore */}
              {React.cloneElement(icon as React.ReactElement, { size: 16 })}
            </div>
            <span className="font-bold text-xs uppercase tracking-wider text-text-muted">{title}</span>
          </div>
        </div>

        <div className="text-3xl font-black text-text-primary tracking-tight font-mono">
          {value}
        </div>
      </div>

      <div className="mt-3 pt-2 border-t border-border/40 flex items-center justify-between text-xs">
        {subValue && (
          <span className="text-[11px] font-semibold text-text-muted">{subValue}</span>
        )}
        {progress !== undefined && (
          <div className="w-20 h-1.5 bg-card-secondary rounded-full overflow-hidden ml-auto border border-border/40">
            <div
              className={cn("h-full transition-all duration-500 rounded-full", theme.bar)}
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
