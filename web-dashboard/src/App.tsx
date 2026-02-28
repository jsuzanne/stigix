import React, { useEffect, useState, useRef } from 'react';
import { LineChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
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
import { Activity, Server, AlertCircle, LayoutDashboard, Settings, LogOut, Key, UserPlus, BarChart3, Wifi, Shield, ChevronDown, ChevronUp, Clock, CheckCircle, XCircle, Play, Pause, Phone, Gauge, Network, Plus, Zap, Monitor, Cpu, Sun, Moon, Globe } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Toaster } from 'react-hot-toast';

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
  const [view, setView] = useState<'dashboard' | 'settings' | 'statistics' | 'security' | 'voice' | 'performance' | 'failover' | 'srt' | 'iot' | 'vyos' | 'speedtest'>(
    (localStorage.getItem('activeView') as any) || 'performance'
  );

  const [features, setFeatures] = useState<{ xfr_enabled: boolean }>({ xfr_enabled: false });

  // --- Theme Management ---
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };
  const [stats, setStats] = useState<Stats | null>(null);
  const [history, setHistory] = useState<any[]>([]);
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
  const [iperfTarget, setIperfTarget] = useState('192.168.203.100');
  const [iperfServerInfo, setIperfServerInfo] = useState<any>(null);
  const [publicIp, setPublicIp] = useState<string | null>(null);

  // Maintenance State
  const [maintenance, setMaintenance] = useState<{ updateAvailable: boolean } | null>(null);

  // Site Info State
  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null);

  // Traffic History State
  const [timeRange, setTimeRange] = useState<'1h' | '6h' | '24h'>('1h');
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);


  // Rate Calculation State - Use Refs to avoid stale closures in setInterval
  const prevTotalRequestsRef = useRef<number | null>(null);
  const prevTimestampRef = useRef<number | null>(null);
  const [currentRpm, setCurrentRpm] = useState<number>(0);

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
      const res = await fetch('/api/stats', {
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
          } else if (deltaTime > 15) {
            calculatedRpm = 0;
            setCurrentRpm(0);
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

          return newHistory;
        });
      }
    }
  };

  const fetchHistory = async () => {
    if (!token) return;
    setIsHistoryLoading(true);
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
      }
    } catch (e) {
      console.error('Failed to fetch traffic history');
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const fetchDashboardData = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/admin/system/dashboard-data', { headers: authHeaders() });
      if (res.status === 403 || res.status === 401) logout();
      const data = await res.json();

      if (data.stats) processStats(data.stats);
      if (data.status) setStatus(data.status);
      if (data.logs) setLogs(data.logs);
      if (data.dockerStats) setDockerStats(data.dockerStats);
      if (data.convergenceTests) setGlobalConvStatus(data.convergenceTests);
      if (data.voice) setGlobalVoiceStatus(data.voice);
    } catch (e) {
      console.error('Consolidated fetch failed');
    }
  };

  const fetchStats = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/stats', { headers: authHeaders() });
      if (res.status === 403 || res.status === 401) logout();
      const data = await res.json();
      processStats(data);
    } catch (e) { }
  };

  const fetchStatus = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/status', { headers: authHeaders() });
      const data = await res.json();
      setStatus(data.status);
    } catch (e) {
      setStatus('unknown');
    }
  };

  const fetchTrafficStatus = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/traffic/status', { headers: authHeaders() });
      const data = await res.json();
      setTrafficRunning(data.running || false);
      if (data.sleep_interval) setTrafficRate(data.sleep_interval);
    } catch (e) {
      console.error('Failed to fetch traffic status');
    }
  };

  const checkConfigValid = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/config/interfaces', { headers: authHeaders() });
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
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (res.ok) {
        setTrafficRunning(data.running);
        if (data.sleep_interval) setTrafficRate(data.sleep_interval);
      }
    } catch (e) {
      console.error('Failed to toggle traffic');
    }
  };

  const updateTrafficRate = async (val: number) => {
    if (!token) return;
    setUpdatingRate(true);
    try {
      const res = await fetch('/api/traffic/settings', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ sleep_interval: val })
      });
      if (res.ok) {
        setTrafficRate(val);
      }
    } catch (e) {
      console.error('Failed to update traffic rate');
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
      const res = await fetch('/api/connectivity/iperf/server', { headers: authHeaders() });
      const data = await res.json();
      setIperfServerInfo(data);
    } catch (e) { }
  };

  const fetchPublicIp = async () => {
    try {
      const res = await fetch('/api/connectivity/public-ip', { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setPublicIp(data.ip);
      }
    } catch (e) {
      console.error('Failed to fetch public IP');
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
      const res = await fetch('/api/siteinfo', { headers: authHeaders() });
      const data = await res.json();
      setSiteInfo(data);
    } catch (e) { }
  };



  useEffect(() => {
    if (!token) return;
    // Initial fetch for everything
    fetchDashboardData();
    checkConfigValid();
    fetchVersion();
    fetchConfigUi();
    fetchAppConfig();
    fetchMaintenance();
    fetchPublicIp();
    fetchSiteInfo();
    fetchHistory();
    fetchFeatures();


    // The "Single Clock" - Everything high-freq (1s baseline)
    const interval = setInterval(() => {
      fetchDashboardData();
      fetchTrafficStatus();
    }, 1000);

    // RESTORE FAST POLLING (500ms) for Failover specifically when on that tab
    let fastInterval: any = null;
    if (view === 'failover') {
      fastInterval = setInterval(() => {
        fetchDashboardData();
      }, 500);
    }

    // Poll slow connectivity every 30s
    const connectivityInterval = setInterval(() => {
      fetchConnectivity();
      fetchIperfStatus();
      fetchPublicIp();
      fetchSiteInfo();
    }, 30000);


    const maintenanceInterval = setInterval(() => {
      fetchMaintenance();
    }, 3600000);

    return () => {
      clearInterval(interval);
      if (fastInterval) clearInterval(fastInterval);
      clearInterval(connectivityInterval);
      clearInterval(maintenanceInterval);
    };
  }, [token, view]); // Re-run when view changes to start/stop fast polling

  useEffect(() => {
    if (token) fetchHistory();
  }, [timeRange]);


  const totalErrors = stats ? Object.values(stats.errors_by_app).reduce((a, b) => a + b, 0) : 0;
  const successRate = stats ? ((stats.total_requests - totalErrors) / stats.total_requests * 100).toFixed(1) : '100';

  if (!token) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <Toaster position="top-right" />
      <header className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
            SD-WAN Traffic Generator
          </h1>
          <p className="text-text-muted mt-1">
            Real-time Control Center
            {siteInfo?.success && siteInfo.detected_site_name && (
              <span className="text-text-muted/60"> • <span className="text-blue-400 font-bold">{siteInfo.detected_site_name}</span></span>
            )}
            {version && <span className="text-text-muted/60"> • {version}</span>}
          </p>

        </div>



        <div className="flex gap-4 items-center">
          <span className="text-sm font-medium text-text-secondary">{username}</span>

          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            className="p-2 hover:bg-card-secondary rounded-lg text-text-muted hover:text-yellow-400 transition-colors"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {username === 'admin' && (
            <button onClick={() => setShowAddUserModal(true)} title="Add User" className="p-2 hover:bg-card-secondary rounded-lg text-text-muted hover:text-green-400 transition-colors">
              <UserPlus size={18} />
            </button>
          )}

          <button onClick={() => setShowPwdModal(true)} title="Change Password" className="p-2 hover:bg-card-secondary rounded-lg text-text-muted hover:text-blue-400 transition-colors">
            <Key size={18} />
          </button>
          <button onClick={logout} title="Sign Out" className="p-2 hover:bg-card-secondary rounded-lg text-text-muted hover:text-red-400 transition-colors">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Add User Modal */}
      {showAddUserModal && (
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
      )}

      {/* Password Modal */}
      {showPwdModal && (
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
      )}

      {/* Iperf Client Modal */}
      {/* Iperf Client Modal */}
      {showIperfModal && (
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
                className="px-6 py-2.5 text-text-muted hover:text-text-primary font-bold transition-colors tracking-widest text-[10px]"
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
      )}



      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-2 mb-8 border-b border-border">
        <button
          onClick={() => setView('dashboard')}
          className={cn(
            "px-4 py-3 flex items-center gap-2 font-bold tracking-widest text-[10px] border-b-2 transition-all",
            view === 'dashboard' ? "border-blue-600 text-blue-600 dark:text-blue-400" : "border-transparent text-text-muted hover:text-text-primary"
          )}
        >
          <LayoutDashboard size={18} /> Dashboard
        </button>
        <button
          onClick={() => setView('performance')}
          className={cn(
            "px-4 py-3 flex items-center gap-2 font-bold tracking-widest text-[10px] border-b-2 transition-all",
            view === 'performance' ? "border-blue-600 text-blue-600 dark:text-blue-400" : "border-transparent text-text-muted hover:text-text-primary"
          )}
        >
          <Gauge size={18} /> Digital Experience
        </button>
        {features.xfr_enabled && (
          <button
            onClick={() => setView('speedtest')}
            className={cn(
              "px-4 py-3 flex items-center gap-2 font-bold tracking-widest text-[10px] border-b-2 transition-all",
              view === 'speedtest' ? "border-blue-600 text-blue-600 dark:text-blue-400" : "border-transparent text-text-muted hover:text-text-primary"
            )}
          >
            <Activity size={18} /> Bandwidth Test <span className="px-1 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter bg-blue-600/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 ml-1">Beta</span>
          </button>
        )}
        <button
          onClick={() => setView('security')}
          className={cn(
            "px-4 py-3 flex items-center gap-2 font-bold tracking-widest text-[10px] border-b-2 transition-all",
            view === 'security' ? "border-blue-600 text-blue-600 dark:text-blue-400" : "border-transparent text-text-muted hover:text-text-primary"
          )}
        >
          <Shield size={18} /> Security
        </button>
        <button
          onClick={() => setView('iot')}
          className={cn(
            "px-4 py-3 flex items-center gap-2 font-bold tracking-widest text-[10px] border-b-2 transition-all",
            view === 'iot' ? "border-blue-600 text-blue-600 dark:text-blue-400" : "border-transparent text-text-muted hover:text-text-primary"
          )}
        >
          <Cpu size={18} /> IoT Simulation
        </button>
        <button
          onClick={() => setView('voice')}
          className={cn(
            "px-4 py-3 flex items-center gap-2 font-bold tracking-widest text-[10px] border-b-2 transition-all",
            view === 'voice' ? "border-blue-600 text-blue-600 dark:text-blue-400" : "border-transparent text-text-muted hover:text-text-primary"
          )}
        >
          <Phone size={18} /> VoIP
        </button>
        <button
          onClick={() => setView('failover')}
          className={cn(
            "px-4 py-3 flex items-center gap-2 font-bold tracking-widest text-[10px] border-b-2 transition-all",
            view === 'failover' ? "border-blue-600 text-blue-600 dark:text-blue-400" : "border-transparent text-text-muted hover:text-text-primary"
          )}
        >
          <Zap size={18} /> Convergence
        </button>
        <button
          onClick={() => setView('vyos')}
          className={cn(
            "px-4 py-3 flex items-center gap-2 font-bold tracking-widest text-[10px] border-b-2 transition-all",
            view === 'vyos' ? "border-blue-600 text-blue-600 dark:text-blue-400" : "border-transparent text-text-muted hover:text-text-primary"
          )}
        >
          <Monitor size={18} /> Vyos Control <span className="px-1 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter bg-blue-600/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 ml-1">Beta</span>
        </button>
        {/* SRT Tab hidden in v1.1.2-patch.28 */}
        {username === 'admin' && (
          <button
            onClick={() => setView('settings')}
            className={cn(
              "px-4 py-3 flex items-center gap-2 font-bold tracking-widest text-[10px] border-b-2 transition-all relative",
              view === 'settings' ? "border-blue-600 text-blue-600 dark:text-blue-400" : "border-transparent text-text-muted hover:text-text-primary"
            )}
          >
            <Settings size={18} /> System & Settings <span className="px-1 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter bg-blue-600/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 ml-1">Beta</span>
            {maintenance?.updateAvailable && (
              <span className="absolute top-2 right-1 w-2 h-2 bg-blue-600 rounded-full animate-pulse border border-background" />
            )}
          </button>
        )}
      </div>

      {view === 'dashboard' ? (
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
              </div>

              {/* Part 2: Integrated Slider */}
              <div className="flex-1 max-w-md bg-card-secondary/50 p-3 rounded-lg border border-border/50 shadow-inner">
                <div className="flex items-center justify-between mb-2 px-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-black text-text-muted tracking-widest">Speed Control</span>
                    <span className="text-[10px] font-black text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 uppercase tracking-tighter">
                      {trafficRate <= 0.5 ? '🚀 Turbo' : trafficRate <= 2 ? '⚡ Fast' : trafficRate <= 5 ? '📱 Normal' : '🐢 Slow'}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono font-bold text-text-muted uppercase">{trafficRate}s delay</span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-lg">🚀</span>
                  <input
                    type="range"
                    min="0.1"
                    max="10"
                    step="0.5"
                    value={trafficRate}
                    disabled={updatingRate}
                    onChange={(e) => updateTrafficRate(parseFloat(e.target.value))}
                    className="flex-1 h-1.5 bg-card border border-border rounded-lg appearance-none cursor-pointer accent-blue-600 dark:accent-blue-500 hover:accent-blue-500 transition-all"
                  />
                  <span className="text-lg">🐢</span>
                </div>
              </div>

              {/* Part 3: Action Button */}
              <button
                onClick={handleTrafficToggle}
                disabled={!configValid}
                className={cn(
                  "px-6 py-3 rounded-lg font-black tracking-widest text-xs transition-all shadow-lg flex items-center gap-2 min-w-[170px] justify-center",
                  trafficRunning
                    ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-500/20'
                    : 'bg-green-600 hover:bg-green-500 text-white shadow-green-500/20 border-transparent disabled:bg-card-secondary disabled:text-text-muted disabled:border-border disabled:shadow-none disabled:cursor-not-allowed opacity-80 disabled:opacity-50'
                )}
              >
                {trafficRunning ? <><Pause size={18} fill="currentColor" /> Stop Traffic</> : <><Play size={18} fill="currentColor" /> Start Traffic</>}
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

          {/* Network Monitoring */}
          <div className="bg-card border border-border rounded-xl p-4 mb-8 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-black text-text-primary flex items-center gap-2 tracking-tight">
                <Wifi size={20} className="text-blue-600 dark:text-blue-400" />
                Network Status

                {/* Public IP Badge */}
                {publicIp && (
                  <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded text-[10px] font-black text-blue-600 dark:text-blue-400 tracking-widest">
                    <Globe size={10} /> Public IP: {publicIp}
                  </div>
                )}

                {/* Iperf Status Badge */}
                {iperfServerInfo?.running && (
                  <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-green-500/10 border border-green-500/20 rounded text-[10px] font-black text-green-600 dark:text-green-400 tracking-widest">
                    <Server size={10} /> Iperf Server Up (5201)
                  </div>
                )}
              </h3>
              <div className="flex items-center gap-3">
                <button
                  onClick={runSpeedtest}
                  disabled={runningSpeedtest}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black tracking-widest transition-all shadow-sm border",
                    runningSpeedtest
                      ? "bg-blue-500/5 text-blue-400 border-blue-500/20 cursor-not-allowed"
                      : "bg-card-secondary hover:bg-card-hover text-text-muted hover:text-text-primary border-border"
                  )}
                >
                  <Gauge size={14} className={runningSpeedtest ? "animate-spin" : ""} />
                  {runningSpeedtest ? 'Testing...' : 'Speedtest'}
                </button>

                <button
                  onClick={() => setShowIperfModal(true)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black tracking-widest bg-card-secondary hover:bg-card-hover text-text-muted hover:text-text-primary border border-border transition-all shadow-sm"
                >
                  <Activity size={14} />
                  Iperf Client
                </button>

                <button
                  onClick={() => setView('settings')}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black tracking-widest bg-blue-600/10 hover:bg-blue-600/20 text-blue-600 dark:text-blue-400 border border-blue-500/20 transition-all shadow-sm"
                >
                  <Plus size={14} />
                  Manage
                </button>

                <button
                  onClick={() => setNetworkExpanded(!networkExpanded)}
                  className="text-text-muted hover:text-text-primary transition-colors ml-2"
                >
                  <ChevronDown size={18} className={`transform transition-transform ${networkExpanded ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>

            {/* Compact Summary */}
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-6">
                {/* Connectivity Status */}
                {connectivity && (
                  <div className="flex items-center gap-2">
                    {connectivity.connected ? (
                      <>
                        <CheckCircle size={14} className="text-green-600 dark:text-green-400" />
                        <span className="text-text-primary font-bold">
                          {connectivity.results?.filter((r: any) => r.status === 'connected').length || 0}/{connectivity.results?.length || 0} <span className="text-[10px] text-text-muted uppercase tracking-widest ml-1">Endpoints</span>
                        </span>
                      </>
                    ) : (
                      <>
                        <XCircle size={14} className="text-orange-500" />
                        <span className="text-orange-600 dark:text-orange-400 font-black">
                          {connectivity.results?.filter((r: any) => r.status !== 'connected').length || 0} <span className="text-[10px] uppercase tracking-widest ml-1 opacity-70">Offline</span>
                        </span>
                      </>
                    )}
                  </div>
                )}

                {/* Speedtest Result */}
                {speedtestResult && (
                  <div className="flex items-center gap-2 bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20">
                    <Gauge size={12} className="text-blue-400" />
                    <span className="text-blue-300 font-bold">{speedtestResult.download_mbps} <span className="text-[10px] opacity-70">Mbps</span></span>
                  </div>
                )}

                {/* Iperf Result */}
                {iperfResult && (
                  <div className="flex items-center gap-2 bg-purple-500/10 px-3 py-1 rounded-full border border-purple-500/20">
                    <Activity size={12} className="text-purple-400" />
                    <span className="text-purple-300 font-bold">{Math.round(iperfResult.received_mbps || iperfResult.sent_mbps)} <span className="text-[10px] opacity-70">Mbps (iperf)</span></span>
                  </div>
                )}

                {/* Docker Stats: Network Bitrate */}
                {dockerStats?.success && dockerStats.stats.network && (
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-3 bg-card-secondary/50 px-3 py-1 rounded-full border border-border shadow-inner">
                      <span className="flex items-center gap-1.5 font-mono text-[11px] font-black">
                        <ChevronDown size={14} className={cn("transition-colors", parseFloat(dockerStats.stats.network.rx_mbps) > 5 ? "text-green-600 dark:text-green-400" : "text-blue-600 dark:text-blue-400")} />
                        <span className="text-text-primary min-w-[60px]">{formatBitrate(dockerStats.stats.network.rx_mbps)}</span>
                      </span>
                      <div className="w-px h-3 bg-border" />
                      <span className="flex items-center gap-1.5 font-mono text-[11px] font-black">
                        <ChevronUp size={14} className={cn("transition-colors", parseFloat(dockerStats.stats.network.tx_mbps) > 5 ? "text-green-600 dark:text-green-400" : "text-purple-600 dark:text-purple-400")} />
                        <span className="text-text-primary min-w-[60px]">{formatBitrate(dockerStats.stats.network.tx_mbps)}</span>
                      </span>
                    </div>
                    <div className="hidden lg:flex items-center gap-3 text-[9px] text-text-muted font-bold uppercase tracking-widest">
                      <span>TOT: {dockerStats.stats.network.rx_mb || dockerStats.stats.network.received_mb} MB</span>
                      <span className="opacity-30">/</span>
                      <span>{dockerStats.stats.network.tx_mb || dockerStats.stats.network.transmitted_mb} MB</span>
                    </div>
                  </div>
                )}

                {/* Docker Stats: Resource Monitoring */}
                {dockerStats?.success && (
                  <div className="hidden md:flex items-center gap-6">
                    {/* CPU */}
                    <div className="flex items-center gap-2 min-w-[100px]">
                      <span className="text-[9px] text-text-muted uppercase font-black tracking-widest w-8">CPU</span>
                      <div className="flex-1 h-1 bg-card rounded-full overflow-hidden border border-border shadow-inner">
                        <div
                          className={cn("h-full transition-all duration-500",
                            parseFloat(dockerStats.stats.cpu.percent) > 80 ? "bg-red-500" : "bg-blue-600 dark:bg-blue-500")}
                          style={{ width: `${dockerStats.stats.cpu.percent}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-text-muted font-mono font-bold w-8 text-right">{dockerStats.stats.cpu.percent}%</span>
                    </div>

                    {/* RAM */}
                    <div className="flex items-center gap-2 min-w-[100px]">
                      <span className="text-[9px] text-text-muted uppercase font-black tracking-widest w-8">RAM</span>
                      <div className="flex-1 h-1 bg-card rounded-full overflow-hidden border border-border shadow-inner">
                        <div
                          className={cn("h-full transition-all duration-500",
                            parseFloat(dockerStats.stats.memory.percent) > 80 ? "bg-red-500" : "bg-purple-600 dark:bg-purple-500")}
                          style={{ width: `${dockerStats.stats.memory.percent}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-text-muted font-mono font-bold w-8 text-right">{dockerStats.stats.memory.percent}%</span>
                    </div>

                    {/* DISK (Host) */}
                    {dockerStats.host?.disk && (
                      <div className="flex items-center gap-2 min-w-[100px]">
                        <span className="text-[9px] text-text-muted uppercase font-black tracking-widest w-8">DISK</span>
                        <div className="flex-1 h-1 bg-card rounded-full overflow-hidden border border-border shadow-inner">
                          <div
                            className={cn("h-full transition-all duration-500",
                              dockerStats.host.disk.percent > 85 ? "bg-red-500" : "bg-orange-600 dark:bg-orange-500")}
                            style={{ width: `${dockerStats.host.disk.percent}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-text-muted font-mono font-bold w-8 text-right">{dockerStats.host.disk.percent}%</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Container Breakdown (Expanded) */}
            {networkExpanded && dockerStats?.containers && (
              <div className="mt-4 pt-4 border-t border-border animate-in slide-in-from-top-4 duration-300">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {dockerStats.containers.map((c: any) => (
                    <div key={c.name} className="bg-card-secondary/40 border border-border/60 p-4 rounded-xl flex flex-col gap-3 group hover:border-blue-500/30 transition-all shadow-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={cn("w-2 h-2 rounded-full", c.fallback ? "bg-orange-500" : "bg-green-500")} />
                          <span className="text-xs font-bold text-text-primary uppercase tracking-wider">{c.name.replace('sdwan-', '')}</span>
                        </div>
                        <span className="text-[10px] text-text-muted font-mono">{c.id || 'LOCAL'}</span>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <span className="text-[10px] text-text-muted uppercase font-bold block">Bitrate</span>
                          <div className="flex flex-col text-[11px] font-mono whitespace-nowrap">
                            <span className="text-blue-400">↓ {formatBitrate(c.network.rx_mbps)}</span>
                            <span className="text-purple-400">↑ {formatBitrate(c.network.tx_mbps)}</span>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[10px] text-text-muted uppercase font-bold block">CPU / RAM</span>
                          <div className="flex flex-col text-[11px] font-mono text-text-secondary">
                            <span>{c.cpu.percent}% CPU</span>
                            <span>{c.memory.percent}% RAM</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-1 h-1 bg-card rounded-full overflow-hidden border border-border/30">
                        <div
                          className="h-full bg-blue-500/50 transition-all duration-500"
                          style={{ width: `${Math.min(100, (parseFloat(c.network.rx_mbps) + parseFloat(c.network.tx_mbps)) * 5)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Expanded Details */}
            {networkExpanded && connectivity?.results && (
              <div className="mt-4 pt-4 border-t border-border space-y-1">
                {connectivity.results.map((result: any, idx: number) => (
                  <div key={idx} className="flex items-center gap-2 text-xs py-1">
                    {result.status === 'connected' ? (
                      <CheckCircle size={12} className="text-green-400 flex-shrink-0" />
                    ) : (
                      <XCircle size={12} className="text-red-400 flex-shrink-0" />
                    )}
                    <span className="text-text-primary font-medium">{result.name}</span>
                    <span className="text-text-muted uppercase text-[10px] px-1.5 py-0.5 bg-card-secondary border border-border rounded">
                      {result.type || 'http'}
                    </span>
                    {result.status === 'connected' && result.latency && (
                      <div className="flex items-center gap-3 ml-auto">
                        {result.score !== undefined && (
                          <span className={cn(
                            "px-1.5 py-0.5 rounded-[4px] text-[10px] font-bold border flex items-center gap-1",
                            result.score >= 80 ? "text-green-400 bg-green-400/10 border-green-400/20" :
                              result.score >= 50 ? "text-orange-400 bg-orange-400/10 border-orange-400/20" :
                                "text-red-400 bg-red-400/10 border-red-400/20"
                          )}>
                            <Gauge size={10} /> {result.score}
                          </span>
                        )}
                        <span className="text-text-muted font-mono">{Math.round(result.latency)}ms</span>
                      </div>
                    )}
                    {result.status !== 'connected' && result.error && (
                      <span className="text-red-400 ml-auto text-[10px]">{result.error}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 mb-8">
            <Card
              title="Traffic Rate"
              value={`${Math.round(currentRpm)}`}
              icon={<Activity />}
              subValue="req/min"
            />
            <Card
              title="Success Rate"
              value={`${successRate}%`}
              icon={<CheckCircle />}
              subValue={`${totalErrors} errors`}
            />
            <Card
              title="Active Apps"
              value={stats ? Object.keys(stats.requests_by_app).length : 0}
              icon={<LayoutDashboard />}
            />
            <Card
              title="Total Requests"
              value={stats?.total_requests?.toLocaleString() || 0}
              icon={<Server />}
            />
            <Card
              title="Total Errors"
              value={totalErrors.toLocaleString()}
              icon={<AlertCircle />}
            />
          </div>

          {/* Main Chart */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-500/10 rounded-lg text-blue-500">
                  <BarChart3 size={20} />
                </div>
                <h3 className="text-lg font-black text-text-primary tracking-tight">Traffic Volume</h3>
              </div>
              <div className="flex bg-card-secondary/20 p-1 rounded-xl border border-border">
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
                <LineChart data={history}>
                  <defs>
                    <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                  <XAxis
                    dataKey="time"
                    stroke="rgba(255,255,255,0.3)"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={30}
                  />
                  <YAxis
                    stroke="rgba(255,255,255,0.3)"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `${value}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(15, 23, 42, 0.9)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '12px',
                      fontSize: '11px',
                      color: '#fff',
                      backdropFilter: 'blur(8px)',
                      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)'
                    }}
                    itemStyle={{ color: '#3b82f6', fontWeight: 'bold' }}
                    cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeDasharray: '4 4' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="requests"
                    stroke="#3b82f6"
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2, fill: '#3b82f6' }}
                    name="Requests/Min"
                    animationDuration={1500}
                  />
                  <Area
                    type="monotone"
                    dataKey="requests"
                    stroke="none"
                    fill="url(#colorRequests)"
                    fillOpacity={1}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>


          {/* Statistics Table */}
          <div className="mb-8 mt-4">
            <Statistics stats={stats} appConfig={appConfig} onReset={resetTrafficStats} />
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
      ) : view === 'performance' ? (
        <ConnectivityPerformance token={token!} onManage={() => setView('settings')} />
      ) : view === 'security' ? (
        <Security token={token!} />
      ) : view === 'vyos' ? (
        <Vyos token={token!} />
      ) : view === 'iot' ? (
        <Iot token={token!} />
      ) : view === 'voice' ? (
        <Voice token={token!} externalStatus={globalVoiceStatus} />
      ) : view === 'failover' ? (
        <Failover token={token!} externalStatus={globalConvStatus} />
      ) : view === 'settings' ? (
        <SettingsComponent token={token!} />
      ) : view === 'speedtest' && features.xfr_enabled ? (
        <Speedtest token={token!} />
      ) : (
        <div className="p-8 text-center text-text-muted font-bold uppercase tracking-widest">Select a module to begin</div>
      )}
    </div>
  );
}

function Card({ title, value, icon, subValue }: { title: string, value: string | number, icon: React.ReactNode, subValue?: string }) {
  return (
    <div className="bg-card border border-border p-6 rounded-xl relative overflow-hidden group shadow-sm hover:shadow-md transition-shadow">
      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity transform scale-150">
        {/* @ts-ignore */}
        {React.cloneElement(icon as React.ReactElement, { size: 48 })}
      </div>
      <div className="flex items-center gap-3 mb-2 text-text-muted">
        {icon}
        <span className="font-medium text-sm text-text-muted">{title}</span>
      </div>
      <div className="text-3xl font-bold text-text-primary">
        {value}
      </div>
      {subValue && (
        <div className="text-sm text-text-muted mt-1">{subValue}</div>
      )}
    </div>
  );
}
