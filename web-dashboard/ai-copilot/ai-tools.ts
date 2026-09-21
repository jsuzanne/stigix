/**
 * Stigix In-App AI Copilot — Tool Catalog & Execution Handlers
 * 100% Feature & Signature Parity with the Python MCP Server (mcp-server/src/server.py).
 */

import { AnthropicToolDefinition } from './types.js';
import { URL_CATEGORIES, DNS_TEST_DOMAINS } from '../shared/security-categories.js';

export interface ToolExecutionContext {
    registryManager?: any;
    targetsManager?: any;
    vyosManager?: any;
    tcpAppManager?: any;
    xfrManager?: any;
    provisioningManager?: any;
    getSystemSettings?: () => any;
    getTrafficStats?: () => any;
    getSecurityStats?: () => any;
    getRecentApiLogs?: (limit?: number) => any[];
    testLogger?: any;
    connectivityLogger?: any;
    discoveryManager?: any;
    getEnvProbes?: () => any[];
    getCustomProbes?: () => any[];
    getAllProbes?: () => any[];
    saveCustomProbes?: (probes: any[]) => Promise<boolean> | boolean;
    performConnectivityCheck?: (probe: any) => Promise<any>;
    systemToken?: string;
    serverPort?: number;
    runCommand?: (cmd: string) => Promise<string>;
}

export function resolveNodeContext(
    nodeNameOrIp: string | undefined,
    ctx: ToolExecutionContext
): { baseUrl: string; headers: Record<string, string>; siteName: string; isLocal: boolean } {
    const defaultPort = ctx.serverPort || process.env.PORT || 8080;
    const defaultHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ctx.systemToken) defaultHeaders['Authorization'] = `Bearer ${ctx.systemToken}`;

    const localSite = ctx.registryManager?.getSiteName?.() || 'LOCAL';

    if (!nodeNameOrIp || ['local', 'self', 'current', localSite.toLowerCase()].includes(String(nodeNameOrIp).toLowerCase().trim())) {
        return { baseUrl: `http://127.0.0.1:${defaultPort}`, headers: defaultHeaders, siteName: localSite, isLocal: true };
    }

    const query = String(nodeNameOrIp).toLowerCase().trim();

    if (query.startsWith('http://') || query.startsWith('https://')) {
        return {
            baseUrl: query.replace(/\/+$/, ''),
            headers: defaultHeaders,
            siteName: query,
            isLocal: false
        };
    }

    if (/^[0-9.]+:[0-9]+$/.test(query) || /^[a-zA-Z0-9.-]+:[0-9]+$/.test(query)) {
        return {
            baseUrl: `http://${query}`,
            headers: defaultHeaders,
            siteName: query,
            isLocal: false
        };
    }

    // 1. Search in peer registry
    const peers = typeof ctx.registryManager?.getPeers === 'function' ? ctx.registryManager.getPeers() : [];
    const matchedPeer = peers.find((p: any) => {
        const sName = (p.site_name || '').toLowerCase();
        const instId = (p.instance_id || '').toLowerCase();
        return (sName && (sName === query || sName.includes(query) || query.includes(sName))) ||
            (instId && (instId === query || instId.includes(query) || query.includes(instId))) ||
            (p.ip_private && (p.ip_private === query || query.includes(p.ip_private))) ||
            (p.ip_public && (p.ip_public === query || query.includes(p.ip_public)));
    });

    if (matchedPeer) {
        const ip = matchedPeer.ip_private || matchedPeer.ip_public;
        const port = matchedPeer.port || 8080;
        return {
            baseUrl: `http://${ip}:${port}`,
            headers: defaultHeaders,
            siteName: matchedPeer.site_name || matchedPeer.instance_id || ip,
            isLocal: false
        };
    }

    // 2. Search in targets manager
    const targets = typeof ctx.targetsManager?.getMergedTargets === 'function' ? ctx.targetsManager.getMergedTargets() : [];
    const matchedTarget = targets.find((t: any) => {
        const tName = (t.name || '').toLowerCase();
        const tId = (t.id || '').toLowerCase();
        return (tName && (tName === query || tName.includes(query) || query.includes(tName))) ||
            (tId && (tId === query || tId.includes(query) || query.includes(tId))) ||
            (t.host && (t.host === query || query.includes(t.host)));
    });

    if (matchedTarget) {
        const host = matchedTarget.host;
        const port = matchedTarget.port || 8080;
        return {
            baseUrl: `http://${host}:${port}`,
            headers: defaultHeaders,
            siteName: matchedTarget.name || host,
            isLocal: false
        };
    }

    // 3. Direct IP or hostname
    if (/^[0-9.]+$|^[a-zA-Z0-9.-]+$/.test(query)) {
        return {
            baseUrl: `http://${query}:8080`,
            headers: defaultHeaders,
            siteName: query,
            isLocal: false
        };
    }

    return { baseUrl: `http://127.0.0.1:${defaultPort}`, headers: defaultHeaders, siteName: localSite, isLocal: true };
}

export function resolveTargetEndpoint(targetQuery: string | undefined, ctx: ToolExecutionContext): { host: string; port: number; name: string } {
    const raw = String(targetQuery || '').trim();
    if (!raw) return { host: '127.0.0.1', port: 9000, name: 'Localhost' };

    const query = raw.toLowerCase();

    // Check targets manager
    const targets = typeof ctx.targetsManager?.getMergedTargets === 'function' ? ctx.targetsManager.getMergedTargets() : [];
    const target = targets.find((t: any) => {
        const tName = (t.name || '').toLowerCase();
        const tId = (t.id || '').toLowerCase();
        return (tName && (tName === query || tName.includes(query) || query.includes(tName))) ||
            (tId && (tId === query || tId.includes(query) || query.includes(tId))) ||
            (t.host && (t.host === query || query.includes(t.host)));
    });

    if (target) {
        return { host: target.host, port: target.port || 9000, name: target.name || target.host };
    }

    // Check peer registry
    const peers = typeof ctx.registryManager?.getPeers === 'function' ? ctx.registryManager.getPeers() : [];
    const peer = peers.find((p: any) => {
        const sName = (p.site_name || '').toLowerCase();
        const instId = (p.instance_id || '').toLowerCase();
        return (sName && (sName === query || sName.includes(query) || query.includes(sName))) ||
            (instId && (instId === query || instId.includes(query) || query.includes(instId))) ||
            (p.ip_private && (p.ip_private === query || query.includes(p.ip_private))) ||
            (p.ip_public && (p.ip_public === query || query.includes(p.ip_public)));
    });

    if (peer) {
        return { host: peer.ip_private || peer.ip_public, port: 9000, name: peer.site_name || peer.instance_id };
    }

    // Check if raw contains host:port
    if (raw.includes(':') && !raw.startsWith('http')) {
        const [h, p] = raw.split(':');
        return { host: h, port: parseInt(p) || 9000, name: raw };
    }

    return { host: raw, port: 9000, name: raw };
}

async function fetchApi(nodeCtx: { baseUrl: string; headers: Record<string, string> }, path: string, options: RequestInit = {}): Promise<any> {
    const url = `${nodeCtx.baseUrl}${path}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            ...nodeCtx.headers,
            ...(options.headers || {})
        }
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status} on ${path}: ${text}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
        return res.json();
    }
    return res.text();
}

export const COPILOT_TOOLS: AnthropicToolDefinition[] = [
    // -----------------------------------------------------------------------------
    // Core Endpoints & Tests (Parity with MCP server.py)
    // -----------------------------------------------------------------------------
    {
        name: 'list_endpoints',
        description: 'List available Stigix endpoints (Fabric nodes and Internet targets) discovered across the SD-WAN mesh.',
        input_schema: {
            type: 'object',
            properties: {
                kind: {
                    type: 'string',
                    enum: ['fabric', 'internet'],
                    description: 'Optional filter ("fabric" or "internet").'
                }
            }
        }
    },
    {
        name: 'run_test',
        description: 'Start a coordinated traffic test between Stigix endpoints. Source initiates (client) and target receives (server). For "conv" (convergence failover), does NOT stop automatically — inform user of test ID and wait for "stop" before calling stop_test.',
        input_schema: {
            type: 'object',
            properties: {
                source_id: {
                    type: 'string',
                    description: 'Node ID initiating the test (e.g. "BR8-Ubuntu", "Raspi4", "LOCAL").'
                },
                target_id: {
                    type: 'string',
                    description: 'Node ID(s) receiving traffic. Use comma-separated list for multi-target: "BR2,DC1".'
                },
                profile: {
                    type: 'string',
                    description: 'Test type profile: "xfr" / "speedtest" (throughput), "conv" (convergence continuous probe), "voice" (RTP), "iot".'
                },
                duration: {
                    type: 'string',
                    description: '[XFR ONLY] Duration (e.g. "10s", "30s"). Ignored for "conv".'
                },
                bitrate: {
                    type: 'string',
                    description: '[XFR ONLY] (e.g. "200M", "0" for max).'
                },
                label: {
                    type: 'string',
                    description: '[CONV ONLY] Custom label for correlation.'
                },
                protocol: {
                    type: 'string',
                    enum: ['tcp', 'udp', 'quic'],
                    description: '[XFR ONLY] Protocol ("tcp", "udp", "quic").'
                },
                direction: {
                    type: 'string',
                    enum: ['client-to-server', 'server-to-client', 'bidirectional'],
                    description: '[XFR ONLY] Transfer direction.'
                },
                pps: {
                    type: 'number',
                    description: '[CONV ONLY] Probe rate in packets/sec (e.g. 50, 100).'
                }
            },
            required: ['source_id', 'target_id']
        }
    },
    {
        name: 'get_test_status',
        description: 'Get the status and metrics of a specific test (e.g. CONV-XXXX or XFR-XXXX) or all currently running tests on a node.',
        input_schema: {
            type: 'object',
            properties: {
                test_id: {
                    type: 'string',
                    description: 'Optional test ID (e.g. CONV-0001, XFR-0001). If omitted, returns active tests.'
                },
                agent_id: {
                    type: 'string',
                    description: 'Optional Stigix node ID to check on.'
                }
            }
        }
    },
    {
        name: 'stop_test',
        description: 'Stop an active traffic test (primary for convergence continuous probes) and retrieve final metrics (packets sent/received, loss %, latency, jitter).',
        input_schema: {
            type: 'object',
            properties: {
                test_id: {
                    type: 'string',
                    description: 'The test ID or label to stop (e.g. CONV-0001).'
                },
                agent_id: {
                    type: 'string',
                    description: 'Optional Stigix node ID executing the test.'
                }
            },
            required: ['test_id']
        }
    },
    {
        name: 'set_traffic_status',
        description: 'Starts or stops the application traffic generation on a specific node.',
        input_schema: {
            type: 'object',
            properties: {
                source_id: {
                    type: 'string',
                    description: 'ID of the node (e.g. "BR8", "Raspi4", "LOCAL").'
                },
                enabled: {
                    type: 'boolean',
                    description: 'True to start traffic generator, False to stop.'
                }
            },
            required: ['source_id', 'enabled']
        }
    },
    {
        name: 'set_traffic_rate',
        description: 'Adjust the traffic generation speed (sleep interval in seconds between requests). Lower is faster (0.1 = Turbo, 10.0 = Slow).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the node.'
                },
                rate: {
                    type: 'number',
                    description: 'Delay in seconds between requests (0.1 to 10.0).'
                }
            },
            required: ['agent_id', 'rate']
        }
    },
    {
        name: 'set_voice_status',
        description: 'Start or stop voice simulation on a specific node.',
        input_schema: {
            type: 'object',
            properties: {
                source_id: {
                    type: 'string',
                    description: 'ID of the node.'
                },
                enabled: {
                    type: 'boolean',
                    description: 'True to start voice simulation, False to stop.'
                }
            },
            required: ['source_id', 'enabled']
        }
    },
    {
        name: 'get_diagnostics',
        description: 'Fetch the full diagnostic dashboard for a node (CPU, Bitrate, App Stats, Voice, Peers).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'get_app_score',
        description: 'Calculate the success/error rate for a specific application on a node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the node.'
                },
                app_name: {
                    type: 'string',
                    description: 'Name of the application (e.g. "teams", "zoom", "salesforce").'
                }
            },
            required: ['agent_id', 'app_name']
        }
    },
    {
        name: 'get_security_test_options',
        description: 'Get the LIVE list of security test targets/categories for a specific probe type, fetched directly from the node security profile.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                probe_type: {
                    type: 'string',
                    enum: ['dns', 'url', 'threat'],
                    description: '"dns", "url", or "threat".'
                }
            },
            required: ['agent_id', 'probe_type']
        }
    },
    {
        name: 'run_security_probe',
        description: 'Launch a security test to check for SASE policy enforcement (DNS sinkholing, URL Filtering, or Threat/EICAR).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the node.'
                },
                probe_type: {
                    type: 'string',
                    enum: ['dns', 'url', 'threat'],
                    description: '"dns", "url", or "threat".'
                },
                target: {
                    type: 'string',
                    description: 'The domain, URL, or Scenario ID to test (e.g. "dating", "phishing.test", "STIGIX-EICAR-01").'
                }
            },
            required: ['agent_id', 'probe_type', 'target']
        }
    },

    // -----------------------------------------------------------------------------
    // VyOS Underlay & Chaos Management
    // -----------------------------------------------------------------------------
    {
        name: 'list_vyos_routers',
        description: 'List all VyOS routers managed by a specific Stigix node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'list_vyos_scenarios',
        description: 'List available VyOS configuration sequences (scenarios) on a specific Stigix node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'run_vyos_scenario',
        description: 'Execute a VyOS configuration sequence (scenario) on a specific Stigix node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                scenario_id: {
                    type: 'string',
                    description: 'ID of the sequence to run (e.g. "failover-paris").'
                }
            },
            required: ['agent_id', 'scenario_id']
        }
    },
    {
        name: 'get_vyos_timeline',
        description: 'Get the history of recent VyOS configuration changes on a specific Stigix node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                limit: {
                    type: 'number',
                    description: 'Number of recent actions to fetch (default: 20).'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'set_vyos_scenario_status',
        description: 'Enable or disable a specific VyOS configuration sequence (scenario) on a node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                scenario_id: {
                    type: 'string',
                    description: 'The ID of the sequence/scenario.'
                },
                enabled: {
                    type: 'boolean',
                    description: 'True to enable/start, False to disable/stop.'
                }
            },
            required: ['agent_id', 'scenario_id', 'enabled']
        }
    },
    {
        name: 'get_vyos_interfaces',
        description: 'List VyOS routers and their CHAOS-ELIGIBLE interfaces managed by a Stigix node. Filters out management interfaces and provides admin status.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node managing the VyOS router.'
                },
                router_id: {
                    type: 'string',
                    description: 'Optional router ID filter.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'get_vyos_router_state',
        description: 'Fetch the live state of a specific VyOS router (interfaces, admin UP/DOWN state, active QoS latency/loss rules, tag-999 blackhole IP blocks).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                router_id: {
                    type: 'string',
                    description: 'ID of the VyOS router (e.g. "vyosrouter", "vyoslandc1").'
                }
            },
            required: ['agent_id', 'router_id']
        }
    },
    {
        name: 'vyos_bulk_reset',
        description: 'Execute a bulk reset action on a VyOS router ("all-qos", "all-blocks", "unshut-all", "full-reset").',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                router_id: {
                    type: 'string',
                    description: 'ID of the VyOS router to reset.'
                },
                scope: {
                    type: 'string',
                    enum: ['all-qos', 'all-blocks', 'unshut-all', 'full-reset'],
                    description: 'Reset scope.'
                }
            },
            required: ['agent_id', 'router_id', 'scope']
        }
    },
    {
        name: 'vyos_execute_action',
        description: 'Execute an ad-hoc VyOS network action on a router interface ("interface-down", "interface-up", "set-impairment", "clear-qos", "deny-traffic", "allow-traffic", "clear-all-blocks").',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                router_id: {
                    type: 'string',
                    description: 'ID of the VyOS router.'
                },
                command: {
                    type: 'string',
                    enum: ['interface-down', 'interface-up', 'set-impairment', 'clear-qos', 'deny-traffic', 'allow-traffic', 'clear-all-blocks', 'show-denied'],
                    description: 'Action command.'
                },
                interface: {
                    type: 'string',
                    description: 'Interface name (e.g. "eth1").'
                },
                latency_ms: {
                    type: 'number',
                    description: 'Latency in milliseconds.'
                },
                loss_pct: {
                    type: 'number',
                    description: 'Packet loss % (0-100).'
                },
                corruption_pct: {
                    type: 'number',
                    description: 'Corruption % (0-100).'
                },
                rate: {
                    type: 'string',
                    description: 'Bandwidth limit (e.g. "10mbit").'
                },
                ip: {
                    type: 'string',
                    description: 'IP address for firewall block/allow.'
                }
            },
            required: ['agent_id', 'router_id', 'command']
        }
    },

    // -----------------------------------------------------------------------------
    // Node Status, DEM, Traffic & Security Analytics
    // -----------------------------------------------------------------------------
    {
        name: 'get_node_status',
        description: 'Get a comprehensive status summary for a specific Stigix node (health, version, traffic status, site info, convergence).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node (e.g. "BR8", "Hetzner", "LOCAL").'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'get_traffic_stats',
        description: 'Get live traffic generation statistics for a specific node (per-app request counts, error rates, client count, running status).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'get_traffic_logs',
        description: 'Fetch recent traffic generation logs from a specific node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum log entries (default: 50).'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'get_security_results_stats',
        description: 'Get the authoritative SASE security posture scorecard and 24-run trend for a Stigix node (URL Filtering %, DNS Security %, Threat Prevention %).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'get_security_config',
        description: 'Get the security policy configuration and dynamic test target profile configured on a node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'get_security_test_options_dynamic',
        description: 'Get dynamic list of security test targets/categories for a probe type directly from the node profile.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                probe_type: {
                    type: 'string',
                    enum: ['dns', 'url', 'threat'],
                    description: '"dns", "url", or "threat".'
                }
            },
            required: ['agent_id', 'probe_type']
        }
    },
    {
        name: 'get_dem_summary',
        description: 'Get a summary of Digital Experience Monitoring (DEM) health score and probe statuses on a node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'get_probe_details',
        description: 'Get detailed performance metrics for a specific DEM probe (score, RTT, reachability).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                probe_name: {
                    type: 'string',
                    description: 'Name or ID of the probe (e.g. "Google DNS", "SaaS App").'
                }
            },
            required: ['agent_id', 'probe_name']
        }
    },
    {
        name: 'list_dem_probes',
        description: 'List all configured DEM synthetic probes on a specific node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'run_dem_probes_now',
        description: 'Trigger an immediate on-demand run of all DEM experience probes on a node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'get_dem_probe_stats',
        description: 'Get historical DEM probe statistics and health score over the last hour on a node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'add_dem_probe',
        description: 'Add a new Digital Experience Monitoring (DEM) probe to a specific node (appended to existing probes and auto-published if Leader).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                name: {
                    type: 'string',
                    description: 'Display name for probe (e.g. "Office 365", "Google DNS").'
                },
                target: {
                    type: 'string',
                    description: 'Target URL, hostname, or IP (e.g. "https://portal.office.com", "8.8.8.8").'
                },
                probe_type: {
                    type: 'string',
                    enum: ['HTTP', 'HTTPS', 'PING', 'TCP', 'UDP', 'DNS'],
                    description: 'Probe protocol (default: "HTTP").'
                },
                timeout_ms: {
                    type: 'number',
                    description: 'Timeout in ms (default: 5000).'
                }
            },
            required: ['agent_id', 'name', 'target']
        }
    },
    {
        name: 'remove_dem_probe',
        description: 'Remove a DEM experience probe by name from a specific node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                probe_name: {
                    type: 'string',
                    description: 'Exact or partial name of the probe to remove.'
                }
            },
            required: ['agent_id', 'probe_name']
        }
    },
    {
        name: 'list_fabric_targets',
        description: 'List all manually configured Stigix peer/fabric targets on a specific node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'add_fabric_target',
        description: 'Add a new Stigix fabric peer/target to a specific node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                name: {
                    type: 'string',
                    description: 'Display name for the target (e.g. "Branch-Paris").'
                },
                host: {
                    type: 'string',
                    description: 'IP address or FQDN.'
                },
                voice: { type: 'boolean', description: 'Enable voice (default: true).' },
                convergence: { type: 'boolean', description: 'Enable convergence (default: true).' },
                xfr: { type: 'boolean', description: 'Enable XFR speedtest (default: true).' },
                security: { type: 'boolean', description: 'Enable security (default: true).' },
                connectivity: { type: 'boolean', description: 'Enable connectivity (default: true).' }
            },
            required: ['agent_id', 'name', 'host']
        }
    },
    {
        name: 'remove_fabric_target',
        description: 'Remove a Stigix fabric peer/target by name or IP from a specific node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                target_name_or_host: {
                    type: 'string',
                    description: 'Name, IP address, or ID of target to remove.'
                }
            },
            required: ['agent_id', 'target_name_or_host']
        }
    },
    {
        name: 'set_fabric_target_enabled',
        description: 'Enable or disable a Stigix fabric peer/target on a specific node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                target_name_or_host: {
                    type: 'string',
                    description: 'Name or IP of target.'
                },
                enabled: {
                    type: 'boolean',
                    description: 'True to enable, False to disable.'
                }
            },
            required: ['agent_id', 'target_name_or_host', 'enabled']
        }
    },
    {
        name: 'list_speedtest_history',
        description: 'Get the speedtest (XFR) history for a specific node (throughput Mbps, latency RTT, status).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results (default: 20).'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'get_convergence_history',
        description: 'Get the convergence/failover test history for a specific node (target peer, blackout ms, verdict).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results (default: 10).'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'run_security_url_batch',
        description: 'Run a FULL batch URL filtering audit testing all enabled categories on a node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'run_security_dns_batch',
        description: 'Run a FULL batch DNS security audit testing all enabled domains on a node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'run_full_security_audit',
        description: 'Run the COMPLETE security suite (URL batch + DNS batch + EICAR malware) in one command on a node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'run_eicar_test',
        description: 'Run an EICAR malware / threat prevention test on a node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                custom_url: {
                    type: 'string',
                    description: 'Optional custom threat URL.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'list_security_results',
        description: 'Get the last N individual security test results from a specific node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum results (default: 20).'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'set_traffic_client_count',
        description: 'Set the number of parallel traffic worker clients on a specific node (1 to 20).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                client_count: {
                    type: 'number',
                    description: 'Number of parallel workers (1 to 20).'
                }
            },
            required: ['agent_id', 'client_count']
        }
    },
    {
        name: 'get_public_ip',
        description: 'Get the public (WAN) exit IP address of a specific node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'list_apps',
        description: 'List all applications configured in the traffic simulation profile of a node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'export_app_config',
        description: 'Export the full application traffic configuration from a specific node as JSON.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'import_app_config',
        description: 'Import and overwrite an application traffic configuration to a specific node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                config: {
                    type: 'object',
                    description: 'Application configuration JSON object.'
                }
            },
            required: ['agent_id', 'config']
        }
    },
    {
        name: 'compare_nodes',
        description: 'Compare two Stigix nodes side-by-side across key dimensions (health, traffic, DEM, security %, peers).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id_a: {
                    type: 'string',
                    description: 'ID of first Stigix node.'
                },
                agent_id_b: {
                    type: 'string',
                    description: 'ID of second Stigix node.'
                }
            },
            required: ['agent_id_a', 'agent_id_b']
        }
    },
    {
        name: 'generate_report',
        description: 'Generate a fabric-wide summary report across all (or specified) Stigix nodes in the SD-WAN mesh.',
        input_schema: {
            type: 'object',
            properties: {
                agent_ids: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional list of agent IDs. If omitted, reports on all registered nodes.'
                }
            }
        }
    },
    {
        name: 'clone_node_config',
        description: 'Clone configuration from one Stigix node to another (apps, dem_probes, security_profile, vyos_scenarios).',
        input_schema: {
            type: 'object',
            properties: {
                source_id: {
                    type: 'string',
                    description: 'Source node ID.'
                },
                target_id: {
                    type: 'string',
                    description: 'Destination node ID.'
                },
                scope: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Components to clone ("apps", "dem_probes", "security_profile", "vyos_scenarios"). Defaults to all.'
                }
            },
            required: ['source_id', 'target_id']
        }
    },
    {
        name: 'get_prisma_flows',
        description: 'Query the Prisma SD-WAN Flow Browser to retrieve paths, metrics, and chronological path transitions (path_history / failover switches) for network flows.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                site_name: {
                    type: 'string',
                    description: 'Site name (e.g. "BR8", "BR2").'
                },
                protocol: {
                    type: 'number',
                    description: 'Protocol number (6=TCP, 17=UDP, 1=ICMP).'
                },
                src_ip: { type: 'string', description: 'Source IP.' },
                dst_ip: { type: 'string', description: 'Destination IP.' },
                minutes: { type: 'number', description: 'Lookback minutes (default: 15).' },
                page_size: { type: 'number', description: 'Max flow records (default: 10).' }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'get_health_matrix',
        description: 'Get the 360° System Health Matrix of a Stigix node across all 9 subsystems (Prisma SD-WAN, Mesh, Cloudflare, Custom TCP, DEM, Voice, Events, VyOS, Hardware).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'run_system_diagnostics',
        description: 'Run live round-trip latency self-diagnostics across all 6 core engines of a Stigix node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'get_voice_stats',
        description: 'Get detailed outbound VoIP simulation statistics and quality metrics (MOS score, jitter, loss %, RTT).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'get_voice_ingress_calls',
        description: 'Inspect incoming VoIP calls received on UDP port 6100 with caller site tags, active calls, codecs, and real-time MOS metrics.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'create_custom_tcp_app',
        description: 'Create and deploy a new Custom TCP Application on a Stigix node for realistic SD-WAN traffic simulation (POS, ERP, SQL, Backup, Telemetry).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: { type: 'string', description: 'ID of the Stigix node (e.g. "BR8").' },
                name: { type: 'string', description: 'Name of the application (e.g. "app-pos", "app-erp", "app-backup").' },
                port: { type: 'integer', description: 'TCP port to bind and listen on (1024-65535).' },
                description: { type: 'string', description: 'Description of the application purpose.' },
                protocol: { type: 'string', enum: ['stigix_tcp', 'http_1_1'], description: 'Wire protocol ("stigix_tcp" or "http_1_1").' },
                server_behavior: { type: 'string', enum: ['echo', 'acknowledge', 'fixed_delay', 'random_delay', 'drop_response', 'error_response'], description: 'Server responder behavior.' },
                client_mode: { type: 'string', enum: ['heartbeat', 'transactional', 'persistent_request_reply', 'bulk_burst', 'continuous_stream'], description: 'Client traffic generation mode.' },
                payload_bytes: { type: 'integer', description: 'Payload size in bytes per transaction (default: 1024).' },
                interval_ms: { type: 'integer', description: 'Request interval in ms (default: 1000).' },
                connections_per_peer: { type: 'integer', description: 'Concurrent sessions per peer (default: 2).' },
                target_peers: { type: 'string', description: 'Comma-separated target node IDs or "all" to automatically attach all mesh peers (default: "all").' },
                auto_start_listener: { type: 'boolean', description: 'Automatically start TCP listener immediately (default: true).' },
                auto_start_workload: { type: 'boolean', description: 'Automatically start client workload on all peers (default: true).' }
            },
            required: ['agent_id', 'name', 'port']
        }
    },
    {
        name: 'add_tcp_app_peer',
        description: 'Add or attach a peer target endpoint to an existing Custom TCP Application.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: { type: 'string', description: 'ID of the Stigix node (e.g. "DC1", "BR8").' },
                app_id: { type: 'string', description: 'Application ID or name (e.g. "app-erp", "app-pos").' },
                peer_name_or_host: { type: 'string', description: 'Peer node ID, site name, or IP address (e.g. "DC1", "192.168.123.100").' },
                port: { type: 'integer', description: 'Optional target port (defaults to application listener port).' },
                site_name: { type: 'string', description: 'Optional display site name for the peer.' },
                role: { type: 'string', description: 'Peer network role ("branch", "hub", "cloud").' }
            },
            required: ['agent_id', 'app_id', 'peer_name_or_host']
        }
    },
    {
        name: 'delete_custom_tcp_app',
        description: 'Delete a Custom TCP Application and stop its listener and workloads.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: { type: 'string', description: 'ID of the Stigix node.' },
                app_id: { type: 'string', description: 'Identifier or name of the application to delete (e.g. "app-pos").' }
            },
            required: ['agent_id', 'app_id']
        }
    },
    {
        name: 'list_custom_tcp_apps',
        description: 'List all configured Custom TCP Applications on a node and their live operational status (listeners, workloads, latencies).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'start_tcp_app_listener',
        description: 'Start the local TCP server listener for a specific Custom TCP Application.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: { type: 'string', description: 'ID of node.' },
                app_id: { type: 'string', description: 'Application ID (e.g. "app-erp", "app-pos").' }
            },
            required: ['agent_id', 'app_id']
        }
    },
    {
        name: 'stop_tcp_app_listener',
        description: 'Stop the local TCP server listener for a specific Custom TCP Application.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: { type: 'string', description: 'ID of node.' },
                app_id: { type: 'string', description: 'Application ID.' }
            },
            required: ['agent_id', 'app_id']
        }
    },
    {
        name: 'start_tcp_app_workload',
        description: 'Start outbound client synthetic workload generator for a Custom TCP Application.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: { type: 'string', description: 'ID of node.' },
                app_id: { type: 'string', description: 'Application ID.' }
            },
            required: ['agent_id', 'app_id']
        }
    },
    {
        name: 'stop_tcp_app_workload',
        description: 'Stop outbound client synthetic workload generator for a Custom TCP Application.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: { type: 'string', description: 'ID of node.' },
                app_id: { type: 'string', description: 'Application ID.' }
            },
            required: ['agent_id', 'app_id']
        }
    },
    {
        name: 'test_tcp_app_handshake',
        description: 'Execute an instant single-shot TCP 3-way handshake latency test to a target peer.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: { type: 'string', description: 'Initiating node ID.' },
                app_id: { type: 'string', description: 'Application ID.' },
                peer_id: { type: 'string', description: 'Optional target peer ID.' }
            },
            required: ['agent_id', 'app_id']
        }
    },
    {
        name: 'get_tcp_app_sessions',
        description: 'Inspect active incoming and outgoing TCP sessions for a Custom TCP Application.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: { type: 'string', description: 'ID of node.' },
                app_id: { type: 'string', description: 'Application ID.' }
            },
            required: ['agent_id', 'app_id']
        }
    },
    {
        name: 'reset_tcp_app_metrics',
        description: 'Reset operational latency and bandwidth counters for a Custom TCP Application.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: { type: 'string', description: 'ID of node.' },
                app_id: { type: 'string', description: 'Application ID.' }
            },
            required: ['agent_id', 'app_id']
        }
    },
    {
        name: 'get_controller_status',
        description: 'Get Target Controller and Mesh status on a Stigix node (Leader vs Branch, active Leader IP, connected peers).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'list_controller_peers',
        description: 'List all remote branch nodes registered with the Leader node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Leader node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'set_controller_leader',
        description: 'Configure the central Leader for a branch node, or revert to dynamic autodiscovery.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: { type: 'string', description: 'ID of node.' },
                leader_url: { type: 'string', description: 'IP or URL of central leader, or null for dynamic autodiscovery.' }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'generate_peer_onboard_command',
        description: 'Generate a ready-to-run curl one-liner command to onboard and connect a new remote branch node to this Leader.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Leader node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'get_provisioning_status',
        description: 'Get Global Configuration Provisioning status across the SD-WAN fabric (bundle revisions, pull mode status).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'set_provisioning_mode',
        description: 'Enable or disable the Global Provisioning pull daemon on a node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: { type: 'string', description: 'ID of node.' },
                enabled: { type: 'boolean', description: 'True to enable, False to disable.' }
            },
            required: ['agent_id', 'enabled']
        }
    },
    {
        name: 'publish_configuration_bundle',
        description: 'Publish local configuration bundle(s) across the entire SD-WAN mesh ("all", "applications", "connectivity-probes", "security-config", etc.).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: { type: 'string', description: 'ID of Leader node.' },
                bundle_type: { type: 'string', description: 'Bundle to publish (default: "all").' }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'rollback_configuration_bundle',
        description: 'Rollback a configuration bundle to a prior revision hash across the mesh.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: { type: 'string', description: 'ID of Leader node.' },
                bundle_type: { type: 'string', description: 'Bundle name.' },
                revision: { type: 'string', description: 'Revision hash to restore.' }
            },
            required: ['agent_id', 'bundle_type', 'revision']
        }
    },
    {
        name: 'get_provisioning_history',
        description: 'Get the audit trail of published configuration bundles and rollbacks on a node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: { type: 'string', description: 'ID of node.' },
                limit: { type: 'number', description: 'Max history records (default: 15).' }
            },
            required: ['agent_id']
        }
    }
];

/**
 * Executes a tool locally inside the Stigix Node.js process.
 */
export async function executeCopilotTool(
    toolName: string,
    args: Record<string, any>,
    ctx: ToolExecutionContext
): Promise<any> {
    const startTime = Date.now();

    // Map legacy tool names to standard names
    let normalizedTool = toolName;
    if (toolName === 'get_mesh_status') normalizedTool = 'list_endpoints';
    if (toolName === 'get_traffic_status') normalizedTool = 'get_traffic_stats';
    if (toolName === 'get_security_posture') normalizedTool = 'get_security_results_stats';
    if (toolName === 'get_digital_experience') normalizedTool = 'get_dem_summary';
    if (toolName === 'trigger_bandwidth_test') normalizedTool = 'run_test';
    if (toolName === 'get_bandwidth_results') normalizedTool = 'list_speedtest_history';
    if (toolName === 'get_convergence_results') normalizedTool = 'get_convergence_history';
    if (toolName === 'get_voice_metrics') normalizedTool = 'get_voice_stats';
    if (toolName === 'control_traffic') {
        normalizedTool = 'set_traffic_status';
        args.enabled = args.action === 'start' || args.action === 'resume';
        args.source_id = args.node || 'LOCAL';
    }
    if (toolName === 'vyos_chaos') {
        normalizedTool = 'vyos_execute_action';
        args.agent_id = args.node || 'LOCAL';
        args.router_id = args.router_ip || 'default';
        args.command = args.action?.replace('_', '-') || 'set-impairment';
        args.interface = args.interface_name;
        args.loss_pct = args.loss_percent;
    }
    if (toolName === 'vyos_list_routers') {
        normalizedTool = 'list_vyos_routers';
        args.agent_id = args.node || 'LOCAL';
    }
    if (toolName === 'get_custom_apps') {
        normalizedTool = 'list_custom_tcp_apps';
        args.agent_id = args.node || 'LOCAL';
    }
    if (toolName === 'get_recent_logs') {
        normalizedTool = 'get_traffic_logs';
        args.agent_id = args.node || 'LOCAL';
    }

    try {
        switch (normalizedTool) {
            case 'list_endpoints': {
                const kind = args.kind;
                const peers = typeof ctx.registryManager?.getPeers === 'function' ? ctx.registryManager.getPeers() : [];
                const managedTargets = typeof ctx.targetsManager?.getMergedTargets === 'function' ? ctx.targetsManager.getMergedTargets() : [];

                const fabricEndpoints = [
                    {
                        id: ctx.registryManager?.getSiteName?.() || 'LOCAL',
                        kind: 'fabric',
                        site_name: ctx.registryManager?.getSiteName?.() || 'LOCAL',
                        ip: '127.0.0.1',
                        role: 'local',
                        capabilities: ['voice', 'convergence', 'xfr', 'security', 'connectivity', 'tcp-apps']
                    },
                    ...peers.map((p: any) => ({
                        id: p.site_name || p.instance_id,
                        kind: 'fabric',
                        site_name: p.site_name,
                        ip: p.ip_private || p.ip_public,
                        role: p.role || 'peer',
                        capabilities: p.capabilities || ['voice', 'convergence', 'xfr', 'security', 'connectivity']
                    })),
                    ...managedTargets.map((t: any) => ({
                        id: t.id || t.name,
                        kind: 'fabric',
                        site_name: t.name,
                        ip: t.host,
                        role: 'managed-target',
                        capabilities: t.capabilities || ['voice', 'convergence', 'xfr']
                    }))
                ];

                const internetEndpoints = [
                    { id: 'Google-DNS', kind: 'internet', host: '8.8.8.8', type: 'DNS/ICMP' },
                    { id: 'Cloudflare-DNS', kind: 'internet', host: '1.1.1.1', type: 'DNS/ICMP' },
                    { id: 'Microsoft-Office365', kind: 'internet', host: 'https://portal.office.com', type: 'HTTPS' },
                    { id: 'AWS-Global', kind: 'internet', host: 'https://aws.amazon.com', type: 'HTTPS' }
                ];

                if (kind === 'fabric') return { endpoints: fabricEndpoints };
                if (kind === 'internet') return { endpoints: internetEndpoints };
                return { fabric_endpoints: fabricEndpoints, internet_endpoints: internetEndpoints };
            }

            case 'run_test': {
                const sourceId = args.source_id || args.source_node || 'LOCAL';
                const targetIdsStr = args.target_id || args.target;
                if (!targetIdsStr) return { error: 'Target ID is required.' };

                const sourceNodeContext = resolveNodeContext(sourceId, ctx);
                const profile = String(args.profile || 'xfr').toLowerCase();
                const isConvergence = profile.includes('conv') || profile.includes('failover') || profile.includes('probe');
                const isVoice = profile.includes('voice');
                const isIot = profile.includes('iot');
                const isXfr = !isConvergence && !isVoice && !isIot;

                const targetList = targetIdsStr.split(',').map((t: string) => t.trim()).filter(Boolean);
                const results: any[] = [];

                for (const targetQuery of targetList) {
                    const targetEndpoint = resolveTargetEndpoint(targetQuery, ctx);

                    if (isXfr) {
                        const durationSec = typeof args.duration === 'string'
                            ? parseInt(args.duration.replace('s', '').replace('m', '0')) || 10
                            : (args.duration_sec || 10);
                        const payload = {
                            mode: 'custom',
                            target: { host: targetEndpoint.host, port: targetEndpoint.port || 9000 },
                            protocol: (args.protocol || 'tcp').toLowerCase(),
                            direction: (args.direction || 'client-to-server').toLowerCase(),
                            duration_sec: durationSec,
                            bitrate: args.bitrate || '0',
                            parallel_streams: 4
                        };

                        if (sourceNodeContext.isLocal && ctx.xfrManager) {
                            const { id, sequence_id } = ctx.xfrManager.createJob({
                                mode: payload.mode,
                                host: targetEndpoint.host,
                                port: targetEndpoint.port || 9000,
                                protocol: payload.protocol,
                                direction: payload.direction,
                                duration_sec: payload.duration_sec,
                                bitrate: payload.bitrate,
                                parallel_streams: payload.parallel_streams
                            });
                            ctx.xfrManager.startJob(id);
                            const job = ctx.xfrManager.getJob(id);
                            results.push({
                                test_id: id,
                                sequence_id: sequence_id,
                                profile: 'xfr',
                                status: job?.status || 'running',
                                source: sourceNodeContext.siteName,
                                target: targetEndpoint.name,
                                host: targetEndpoint.host,
                                duration: `${durationSec}s`
                            });
                        } else {
                            const res = await fetch(`${sourceNodeContext.baseUrl}/api/tests/xfr`, {
                                method: 'POST',
                                headers: sourceNodeContext.headers,
                                body: JSON.stringify(payload)
                            });
                            const data = await res.json().catch(() => ({}));
                            if (!res.ok) {
                                results.push({
                                    error: data?.error || `HTTP ${res.status}`,
                                    source: sourceNodeContext.siteName,
                                    target: targetEndpoint.name,
                                    host: targetEndpoint.host
                                });
                            } else {
                                results.push({
                                    test_id: data.id || data.jobId,
                                    sequence_id: data.sequence_id,
                                    profile: 'xfr',
                                    status: data.status || 'running',
                                    source: sourceNodeContext.siteName,
                                    target: targetEndpoint.name,
                                    host: targetEndpoint.host,
                                    duration: `${durationSec}s`
                                });
                            }
                        }
                    } else if (isConvergence) {
                        const pps = typeof args.pps === 'number' ? args.pps : 50;
                        const effectiveLabel = args.label || targetEndpoint.name;
                        const convergencePort = 6200;

                        const payload = {
                            target: targetEndpoint.host,
                            port: convergencePort,
                            rate: pps,
                            label: effectiveLabel
                        };

                        const res = await fetch(`${sourceNodeContext.baseUrl}/api/convergence/start`, {
                            method: 'POST',
                            headers: sourceNodeContext.headers,
                            body: JSON.stringify(payload)
                        });

                        if (res.ok) {
                            const data = await res.json().catch(() => ({}));
                            results.push({
                                test_id: data.testId || data.sequence_id || 'CONV-ACTIVE',
                                profile: 'convergence',
                                status: 'running',
                                running: true,
                                source: sourceNodeContext.siteName,
                                target: targetEndpoint.name,
                                host: targetEndpoint.host,
                                port: convergencePort,
                                rate_pps: pps,
                                label: effectiveLabel,
                                note: 'Continuous probe running. Say "stop" or call stop_test when ready.'
                            });
                        } else {
                            const errTxt = await res.text();
                            results.push({ error: `Convergence probe failed: ${errTxt}`, target: targetEndpoint.name });
                        }
                    } else if (isVoice) {
                        await fetch(`${sourceNodeContext.baseUrl}/api/voice/control`, {
                            method: 'POST',
                            headers: sourceNodeContext.headers,
                            body: JSON.stringify({ enabled: true })
                        });
                        results.push({
                            profile: 'voice',
                            status: 'running',
                            source: sourceNodeContext.siteName,
                            target: targetEndpoint.name,
                            port: 6100
                        });
                    } else if (isIot) {
                        await fetch(`${sourceNodeContext.baseUrl}/api/iot/control`, {
                            method: 'POST',
                            headers: sourceNodeContext.headers,
                            body: JSON.stringify({ enabled: true })
                        });
                        results.push({
                            profile: 'iot',
                            status: 'running',
                            source: sourceNodeContext.siteName,
                            target: targetEndpoint.name
                        });
                    } else {
                        results.push({
                            error: `Unknown profile "${profile}". Supported: "xfr" (port 9000/5201), "conv" (port 6200), "voice" (port 6100), "iot".`,
                            target: targetEndpoint.name
                        });
                    }
                }

                return { tests: results };
            }

            case 'get_test_status': {
                const nodeCtx = resolveNodeContext(args.agent_id || args.node, ctx);
                const testIdFilter = String(args.test_id || '').toLowerCase().trim();

                try {
                    const [xfrData, convData] = await Promise.all([
                        (nodeCtx.isLocal && ctx.xfrManager)
                            ? ctx.xfrManager.getAllJobs()
                            : fetch(`${nodeCtx.baseUrl}/api/tests/xfr`, { headers: nodeCtx.headers }).then(r => r.json()).catch(() => []),
                        fetch(`${nodeCtx.baseUrl}/api/convergence/status`, { headers: nodeCtx.headers }).then(r => r.json()).catch(() => [])
                    ]);

                    const xfrJobs = Array.isArray(xfrData) ? xfrData : [];
                    const convProbes = Array.isArray(convData) ? convData : [];

                    const runningXfr = xfrJobs.filter((j: any) => j.status === 'running' || j.status === 'queued');
                    const runningConv = convProbes.filter((c: any) => c.running !== false);

                    if (testIdFilter) {
                        const matchedXfr = xfrJobs.find((j: any) =>
                            (j.id && j.id.toLowerCase().includes(testIdFilter)) ||
                            (j.sequence_id && j.sequence_id.toLowerCase().includes(testIdFilter))
                        );
                        if (matchedXfr) {
                            const sum = matchedXfr.summary;
                            return {
                                node: nodeCtx.siteName,
                                test_type: 'xfr_speedtest',
                                test_id: matchedXfr.id,
                                sequence_id: matchedXfr.sequence_id,
                                status: matchedXfr.status,
                                target: matchedXfr.params?.host || matchedXfr.params?.target?.host,
                                protocol: matchedXfr.params?.protocol || 'tcp',
                                direction: matchedXfr.params?.direction || 'bidirectional',
                                duration: matchedXfr.params?.duration_sec ? `${matchedXfr.params.duration_sec}s` : undefined,
                                started_at: matchedXfr.started_at,
                                finished_at: matchedXfr.finished_at,
                                throughput_mbps: sum?.throughput_mbps ?? sum?.avg_bandwidth_mbps ?? sum?.received_mbps ?? sum?.sent_mbps,
                                upload_mbps: sum?.sent_mbps,
                                download_mbps: sum?.received_mbps,
                                rtt_ms: sum?.rtt_ms_avg ?? sum?.rtt_ms,
                                retransmits: sum?.retransmits,
                                loss_pct: sum?.loss_percent ?? 0,
                                total_bytes: sum?.bytes_total,
                                summary: sum,
                                error: matchedXfr.error
                            };
                        }

                        const matchedConv = convProbes.find((c: any) =>
                            (c.testId && c.testId.toLowerCase().includes(testIdFilter)) ||
                            (c.label && c.label.toLowerCase().includes(testIdFilter))
                        );
                        if (matchedConv) {
                            return {
                                node: nodeCtx.siteName,
                                test_type: 'convergence_probe',
                                test_id: matchedConv.testId,
                                label: matchedConv.label,
                                running: Boolean(matchedConv.running),
                                status: matchedConv.running ? 'RUNNING' : 'COMPLETED',
                                target: matchedConv.target,
                                current_rtt_ms: matchedConv.current_rtt_ms,
                                live_loss_pct: matchedConv.live_loss_pct,
                                duration_s: matchedConv.duration_s
                            };
                        }
                    }

                    return {
                        node: nodeCtx.siteName,
                        is_any_test_running: (runningXfr.length + runningConv.length) > 0,
                        running_tests_count: runningXfr.length + runningConv.length,
                        running_xfr_speedtests: runningXfr.map((j: any) => ({
                            test_id: j.id,
                            sequence_id: j.sequence_id,
                            target: j.params?.target?.host || j.params?.host,
                            duration: j.params?.duration_sec ? `${j.params.duration_sec}s` : undefined,
                            started_at: j.started_at
                        })),
                        running_convergence_probes: runningConv.map((c: any) => ({
                            test_id: c.testId,
                            label: c.label,
                            target: c.target,
                            pps: c.pps,
                            started_at: c.started_at
                        }))
                    };
                } catch (e: any) {
                    return { error: `Failed to retrieve test status: ${e.message}` };
                }
            }

            case 'stop_test': {
                const nodeCtx = resolveNodeContext(args.agent_id || args.node, ctx);
                const testId = String(args.test_id || '').trim();

                try {
                    const convStatus = await fetch(`${nodeCtx.baseUrl}/api/convergence/status`, { headers: nodeCtx.headers }).then(r => r.json()).catch(() => []);
                    const activeConv = Array.isArray(convStatus) ? convStatus : [];
                    const matched = activeConv.find((c: any) =>
                        !testId ||
                        (c.testId && (c.testId === testId || c.testId.includes(testId) || testId.includes(c.testId))) ||
                        (c.label && c.label.toLowerCase().includes(testId.toLowerCase()))
                    );

                    const targetId = matched?.testId || testId;
                    const stopRes = await fetch(`${nodeCtx.baseUrl}/api/convergence/stop`, {
                        method: 'POST',
                        headers: nodeCtx.headers,
                        headers: nodeCtx.headers,
                        body: JSON.stringify({ enabled: false })
                    }).catch(() => {});

                    // 2. Wait up to 3 seconds for backend to flush and write the final stats to history
                    let finalMetrics: any = null;
                    for (let attempt = 0; attempt < 6; attempt++) {
                        await new Promise(r => setTimeout(r, 500));
                        try {
                            const historyRes = await fetch(`${nodeCtx.baseUrl}/api/convergence/history?limit=5`, {
                                headers: nodeCtx.headers
                            });
                            if (historyRes.ok) {
                                const history = await historyRes.json();
                                if (Array.isArray(history) && history.length > 0) {
                                    const match = testId
                                        ? history.find((h: any) => String(h.testId || '').toLowerCase().includes(testId.toLowerCase()) || testId.toLowerCase().includes(String(h.testId || '').toLowerCase()))
                                        : history[0];
                                    if (match) {
                                        finalMetrics = match;
                                        break;
                                    }
                                }
                            }
                        } catch {}
                    }

                    if (finalMetrics) {
                        return {
                            success: true,
                            node: nodeCtx.siteName,
                            test_id: finalMetrics.testId || testId,
                            label: finalMetrics.label || finalMetrics.target,
                            status: 'STOPPED',
                            duration_s: finalMetrics.duration_s || finalMetrics.duration || finalMetrics.duration_seconds,
                            packets_sent: finalMetrics.sent || finalMetrics.packets_sent || finalMetrics.tx_count,
                            packets_received: finalMetrics.received || finalMetrics.packets_received || finalMetrics.rx_count,
                            packets_lost: finalMetrics.lost || finalMetrics.loss_count || 0,
                            loss_percent: `${finalMetrics.loss_pct ?? finalMetrics.loss_percent ?? 0}%`,
                            avg_rtt_ms: finalMetrics.avg_rtt_ms ?? finalMetrics.latency_ms ?? finalMetrics.rtt_ms,
                            jitter_ms: finalMetrics.jitter_ms ?? 0,
                            max_blackout_ms: finalMetrics.max_blackout_ms ?? finalMetrics.blackout_ms ?? 0,
                            verdict: finalMetrics.verdict || (finalMetrics.loss_pct > 1 ? 'DEGRADED' : 'PERFECT'),
                            raw_metrics: finalMetrics
                        };
                    }

                    return {
                        success: true,
                        node: nodeCtx.siteName,
                        test_id: testId,
                        status: 'STOPPED',
                        message: 'Convergence test stop signal processed successfully.',
                        details: stopData
                    };
                } catch (e: any) {
                    return { error: `Failed to stop test on ${nodeCtx.siteName}: ${e?.message || e}` };
                }
            }

            case 'set_traffic_status': {
                const nodeCtx = resolveNodeContext(args.source_id || args.node, ctx);
                const action = args.enabled ? 'start' : 'stop';
                const res = await fetch(`${nodeCtx.baseUrl}/api/traffic/${action}`, {
                    method: 'POST',
                    headers: nodeCtx.headers,
                    body: JSON.stringify({})
                });
                return res.json().catch(() => ({ success: res.ok, status: action }));
            }

            case 'set_traffic_rate': {
                const nodeCtx = resolveNodeContext(args.agent_id || args.node, ctx);
                const rate = Math.max(0.1, Math.min(10.0, Number(args.rate) || 1.0));
                const res = await fetch(`${nodeCtx.baseUrl}/api/traffic/settings`, {
                    method: 'POST',
                    headers: nodeCtx.headers,
                    body: JSON.stringify({ sleep_interval: rate })
                });
                return res.json().catch(() => ({ success: res.ok, sleep_interval: rate }));
            }

            case 'set_traffic_client_count': {
                const nodeCtx = resolveNodeContext(args.agent_id || args.node, ctx);
                const count = Math.max(1, Math.min(20, Number(args.client_count) || 1));
                const res = await fetch(`${nodeCtx.baseUrl}/api/traffic/settings`, {
                    method: 'POST',
                    headers: nodeCtx.headers,
                    body: JSON.stringify({ client_count: count })
                });
                return res.json().catch(() => ({ success: res.ok, client_count: count }));
            }

            case 'set_voice_status': {
                const nodeCtx = resolveNodeContext(args.source_id || args.node, ctx);
                const res = await fetch(`${nodeCtx.baseUrl}/api/voice/control`, {
                    method: 'POST',
                    headers: nodeCtx.headers,
                    body: JSON.stringify({ enabled: Boolean(args.enabled) })
                });
                return res.json().catch(() => ({ success: res.ok, enabled: Boolean(args.enabled) }));
            }

            case 'get_diagnostics': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/admin/system/dashboard-data');
            }

            case 'get_app_score': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const data = await fetchApi(nodeCtx, '/api/admin/system/dashboard-data');
                const stats = data?.stats || {};
                const reqByApp = stats.requests_by_app || {};
                const errByApp = stats.errors_by_app || {};

                const appName = String(args.app_name || '').toLowerCase();
                let targetKey = Object.keys(reqByApp).find(k => k.toLowerCase().includes(appName));
                if (!targetKey) {
                    return { error: `App "${args.app_name}" not found. Available: ${Object.keys(reqByApp).slice(0, 5).join(', ')}` };
                }

                const requests = reqByApp[targetKey] || 0;
                const errors = errByApp[targetKey] || 0;
                const success = Math.max(0, requests - errors);
                const rate = requests > 0 ? (success / requests) * 100 : 100;

                return {
                    agent: nodeCtx.siteName,
                    app: targetKey,
                    total_requests: requests,
                    errors,
                    success_rate: `${rate.toFixed(2)}%`,
                    status: rate > 95 ? 'Healthy' : rate > 50 ? 'Degraded' : 'Critical'
                };
            }

            case 'get_security_test_options':
            case 'get_security_test_options_dynamic': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const pType = String(args.probe_type || '').toLowerCase();
                try {
                    const profile = await fetchApi(nodeCtx, '/api/security/profile');
                    if (pType === 'dns') return { options: profile?.dns_security?.items || DNS_TEST_DOMAINS };
                    if (pType === 'url') return { options: profile?.url_filtering?.items || URL_CATEGORIES };
                    if (pType === 'threat') return { options: profile?.threat_prevention || [{ id: 'STIGIX-EICAR-01', name: 'Standard EICAR' }] };
                    return profile;
                } catch {
                    if (pType === 'dns') return { options: DNS_TEST_DOMAINS };
                    if (pType === 'url') return { options: URL_CATEGORIES };
                    return { options: [{ id: 'STIGIX-EICAR-01', name: 'Standard EICAR' }] };
                }
            }

            case 'run_security_probe': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const pType = String(args.probe_type || '').toLowerCase();
                const target = args.target;

                if (pType === 'dns') {
                    return await fetchApi(nodeCtx, '/api/security/dns-test', {
                        method: 'POST',
                        body: JSON.stringify({ domain: target, testName: target, mcp_source: 'copilot' })
                    });
                } else if (pType === 'url') {
                    return await fetchApi(nodeCtx, '/api/security/url-test', {
                        method: 'POST',
                        body: JSON.stringify({ url: target, category: target, mcp_source: 'copilot' })
                    });
                } else if (pType === 'threat') {
                    return await fetchApi(nodeCtx, '/api/security/threat-test', {
                        method: 'POST',
                        body: JSON.stringify({ endpoint: target, testName: `EICAR Test (${target})`, mcp_source: 'copilot' })
                    });
                }
                return { error: `Invalid probe_type: ${pType}` };
            }

            case 'list_vyos_routers': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/vyos/routers');
            }

            case 'list_vyos_scenarios': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/vyos/sequences');
            }

            case 'run_vyos_scenario': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, `/api/vyos/sequences/run/${args.scenario_id}`, { method: 'POST' });
            }

            case 'get_vyos_timeline': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, `/api/vyos/history?limit=${args.limit || 20}`);
            }

            case 'set_vyos_scenario_status': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, `/api/vyos/sequences/${args.scenario_id}/status`, {
                    method: 'POST',
                    body: JSON.stringify({ enabled: Boolean(args.enabled) })
                });
            }

            case 'get_vyos_interfaces': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const routers = await fetchApi(nodeCtx, '/api/vyos/routers');
                if (!Array.isArray(routers)) return routers;

                const results: any[] = [];
                for (const r of routers) {
                    if (args.router_id && r.id !== args.router_id && r.name !== args.router_id) continue;
                    try {
                        const state = await fetchApi(nodeCtx, `/api/vyos/state?router_id=${r.id}`);
                        const ifaces = (state.interfaces || []).filter((i: any) => i.description && i.description.trim() !== '');
                        results.push({
                            router_id: r.id,
                            router_name: r.name,
                            host: r.host,
                            online: r.online !== false,
                            chaos_eligible_count: ifaces.length,
                            interfaces: ifaces
                        });
                    } catch {
                        results.push({ router_id: r.id, router_name: r.name, interfaces: [] });
                    }
                }
                return results;
            }

            case 'get_vyos_router_state': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, `/api/vyos/state?router_id=${args.router_id}`);
            }

            case 'vyos_bulk_reset': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const state = await fetchApi(nodeCtx, `/api/vyos/state?router_id=${args.router_id}`);
                const scope = args.scope;
                const actionsTaken: string[] = [];

                if (scope === 'all-qos' || scope === 'full-reset') {
                    for (const iface of (state.interfaces || []).filter((i: any) => i.qos_active)) {
                        await fetchApi(nodeCtx, '/api/vyos/adhoc', {
                            method: 'POST',
                            body: JSON.stringify({ router_id: args.router_id, command: 'clear-qos', interface: iface.name })
                        });
                        actionsTaken.push(`clear-qos on ${iface.name}`);
                    }
                }
                if (scope === 'all-blocks' || scope === 'full-reset') {
                    await fetchApi(nodeCtx, '/api/vyos/adhoc', {
                        method: 'POST',
                        body: JSON.stringify({ router_id: args.router_id, command: 'clear-all-blocks' })
                    });
                    actionsTaken.push('clear-all-blocks');
                }
                if (scope === 'unshut-all' || scope === 'full-reset') {
                    for (const iface of (state.interfaces || []).filter((i: any) => i.admin_state === 'down')) {
                        await fetchApi(nodeCtx, '/api/vyos/adhoc', {
                            method: 'POST',
                            body: JSON.stringify({ router_id: args.router_id, command: 'interface-up', interface: iface.name })
                        });
                        actionsTaken.push(`interface-up on ${iface.name}`);
                    }
                }
                return { success: true, scope, actions_taken: actionsTaken };
            }

            case 'vyos_execute_action': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/vyos/adhoc', {
                    method: 'POST',
                    body: JSON.stringify({
                        router_id: args.router_id,
                        command: args.command,
                        interface: args.interface,
                        latency_ms: args.latency_ms,
                        loss_pct: args.loss_pct,
                        corruption_pct: args.corruption_pct,
                        rate: args.rate,
                        ip: args.ip
                    })
                });
            }

            case 'get_node_status': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/health').catch(async () => {
                    return await fetchApi(nodeCtx, '/api/system/status');
                });
            }

            case 'get_traffic_stats': {
                const nodeCtx = resolveNodeContext(args.agent_id || args.node, ctx);
                if (nodeCtx.isLocal && ctx.getTrafficStats) {
                    return await ctx.getTrafficStats();
                }
                return await fetchApi(nodeCtx, '/api/traffic/status');
            }

            case 'get_traffic_logs': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                if (nodeCtx.isLocal && ctx.getRecentApiLogs) {
                    return ctx.getRecentApiLogs(args.limit || 50);
                }
                return await fetchApi(nodeCtx, `/api/traffic/logs?limit=${args.limit || 50}`);
            }

            case 'get_security_results_stats': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                if (nodeCtx.isLocal && ctx.getSecurityStats) {
                    return ctx.getSecurityStats();
                }
                return await fetchApi(nodeCtx, '/api/security/results/stats').catch(async () => {
                    return await fetchApi(nodeCtx, '/api/security/results');
                });
            }

            case 'get_security_config': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/security/config');
            }

            case 'get_dem_summary': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                let arr: any[] = [];
                if (nodeCtx.isLocal && ctx.getAllProbes) {
                    arr = ctx.getAllProbes();
                } else {
                    const probes = await fetchApi(nodeCtx, '/api/connectivity/active-probes').catch(async () => {
                        return await fetchApi(nodeCtx, '/api/connectivity/custom');
                    });
                    arr = Array.isArray(probes) ? probes : (probes?.probes || []);
                }
                return {
                    node: nodeCtx.siteName,
                    total_probes: arr.length,
                    active_probes: arr.filter((p: any) => p.enabled !== false).length,
                    probes: arr
                };
            }

            case 'get_probe_details': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                let probes: any[] = [];
                if (nodeCtx.isLocal && ctx.getAllProbes) {
                    probes = ctx.getAllProbes();
                } else {
                    const res = await fetchApi(nodeCtx, '/api/connectivity/custom').catch(async () => {
                        return await fetchApi(nodeCtx, '/api/connectivity/active-probes');
                    });
                    probes = Array.isArray(res) ? res : (res?.probes || []);
                }
                const pName = String(args.probe_name || '').toLowerCase();
                const matched = probes.find((p: any) => {
                    const name = (p.name || '').toLowerCase();
                    return name === pName || name.includes(pName) || pName.includes(name);
                });
                return matched || { error: `Probe "${args.probe_name}" not found.` };
            }

            case 'list_dem_probes': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                if (nodeCtx.isLocal && ctx.getAllProbes) {
                    return ctx.getAllProbes();
                }
                const res = await fetchApi(nodeCtx, '/api/connectivity/custom').catch(async () => {
                    return await fetchApi(nodeCtx, '/api/connectivity/active-probes');
                });
                return Array.isArray(res) ? res : (res?.probes || []);
            }

            case 'run_dem_probes_now': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/connectivity/test');
            }

            case 'get_dem_probe_stats': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                if (nodeCtx.isLocal && ctx.connectivityLogger) {
                    return await ctx.connectivityLogger.getStats({ timeRange: args.range || '1h' });
                }
                return await fetchApi(nodeCtx, `/api/connectivity/stats?range=${args.range || '1h'}`);
            }

            case 'add_dem_probe': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const newProbe = {
                    id: `probe-${Date.now()}`,
                    name: args.name,
                    target: args.target,
                    type: (args.probe_type || 'HTTP').toUpperCase(),
                    timeout_ms: args.timeout_ms || 5000,
                    enabled: true,
                    interval: args.interval || 60
                };

                let existingProbes: any[] = [];
                if (nodeCtx.isLocal && ctx.getAllProbes) {
                    existingProbes = ctx.getAllProbes();
                } else {
                    const current = await fetchApi(nodeCtx, '/api/connectivity/custom').catch(async () => {
                        return await fetchApi(nodeCtx, '/api/connectivity/active-probes');
                    });
                    existingProbes = Array.isArray(current) ? current : (current?.probes || []);
                }

                const existingIndex = existingProbes.findIndex((p: any) =>
                    p.name?.toLowerCase() === args.name?.toLowerCase()
                );

                let updatedProbes: any[];
                if (existingIndex >= 0) {
                    updatedProbes = [...existingProbes];
                    updatedProbes[existingIndex] = { ...updatedProbes[existingIndex], ...newProbe };
                } else {
                    updatedProbes = [...existingProbes, newProbe];
                }

                if (nodeCtx.isLocal && ctx.saveCustomProbes) {
                    await ctx.saveCustomProbes(updatedProbes);
                    return { success: true, probe: newProbe, message: `Probe "${args.name}" added successfully on ${nodeCtx.siteName}.` };
                }

                const saveRes = await fetchApi(nodeCtx, '/api/connectivity/custom', {
                    method: 'POST',
                    body: JSON.stringify({ endpoints: updatedProbes })
                });
                return { success: true, probe: newProbe, result: saveRes, message: `Probe "${args.name}" added successfully on ${nodeCtx.siteName}.` };
            }

            case 'remove_dem_probe': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                let existingProbes: any[] = [];
                if (nodeCtx.isLocal && ctx.getAllProbes) {
                    existingProbes = ctx.getAllProbes();
                } else {
                    const current = await fetchApi(nodeCtx, '/api/connectivity/custom').catch(async () => {
                        return await fetchApi(nodeCtx, '/api/connectivity/active-probes');
                    });
                    existingProbes = Array.isArray(current) ? current : (current?.probes || []);
                }

                const targetName = String(args.probe_name || '').toLowerCase();
                const filtered = existingProbes.filter((p: any) =>
                    p.name?.toLowerCase() !== targetName && p.id?.toLowerCase() !== targetName
                );

                if (nodeCtx.isLocal && ctx.saveCustomProbes) {
                    await ctx.saveCustomProbes(filtered);
                    return { success: true, message: `Probe "${args.probe_name}" removed successfully on ${nodeCtx.siteName}.` };
                }

                const saveRes = await fetchApi(nodeCtx, '/api/connectivity/custom', {
                    method: 'POST',
                    body: JSON.stringify({ endpoints: filtered })
                });
                return { success: true, result: saveRes, message: `Probe "${args.probe_name}" removed successfully on ${nodeCtx.siteName}.` };
            }

            case 'list_fabric_targets': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/admin/targets');
            }

            case 'add_fabric_target': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/admin/targets', {
                    method: 'POST',
                    body: JSON.stringify({
                        name: args.name,
                        host: args.host,
                        capabilities: {
                            voice: args.voice !== false,
                            convergence: args.convergence !== false,
                            xfr: args.xfr !== false,
                            security: args.security !== false,
                            connectivity: args.connectivity !== false
                        }
                    })
                });
            }

            case 'remove_fabric_target': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, `/api/admin/targets/${encodeURIComponent(args.target_name_or_host)}`, {
                    method: 'DELETE'
                });
            }

            case 'set_fabric_target_enabled': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, `/api/admin/targets/${encodeURIComponent(args.target_name_or_host)}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ enabled: Boolean(args.enabled) })
                });
            }

            case 'list_speedtest_history': {
                const nodeCtx = resolveNodeContext(args.agent_id || args.node, ctx);
                const limit = Number(args.limit) || 20;
                let jobs = [];
                if (nodeCtx.isLocal && ctx.xfrManager) {
                    jobs = ctx.xfrManager.getAllJobs();
                } else {
                    jobs = await fetchApi(nodeCtx, `/api/tests/xfr`).catch(() => []);
                }
                const arr = Array.isArray(jobs) ? jobs : [];
                // Sort strictly newest first (descending sequence_id or timestamp)
                const sorted = [...arr].sort((a: any, b: any) => {
                    const seqA = a.sequence_id || a.id || '';
                    const seqB = b.sequence_id || b.id || '';
                    if (seqA && seqB) return seqB.localeCompare(seqA, undefined, { numeric: true });
                    const dateA = new Date(a.started_at || a.finished_at || a.timestamp || 0).getTime();
                    const dateB = new Date(b.started_at || b.finished_at || b.timestamp || 0).getTime();
                    return dateB - dateA;
                }).slice(0, limit);
                return {
                    node: nodeCtx.siteName,
                    total_records: arr.length,
                    recent_tests: sorted.map((j: any) => ({
                        id: j.id,
                        sequence_id: j.sequence_id,
                        status: j.status,
                        started_at: j.started_at,
                        finished_at: j.finished_at,
                        target: j.params?.target?.host || j.params?.host,
                        protocol: j.params?.protocol || 'tcp',
                        direction: j.params?.direction || 'bidirectional',
                        duration: j.params?.duration_sec ? `${j.params.duration_sec}s` : undefined,
                        throughput_mbps: j.summary?.throughput_mbps ?? j.summary?.avg_bandwidth_mbps ?? j.summary?.received_mbps ?? j.summary?.sent_mbps,
                        upload_mbps: j.summary?.sent_mbps,
                        download_mbps: j.summary?.received_mbps,
                        rtt_ms: j.summary?.rtt_ms_avg ?? j.summary?.rtt_ms ?? j.summary?.avg_rtt_ms,
                        loss_pct: j.summary?.loss_percent ?? j.summary?.loss_pct ?? 0,
                        retransmits: j.summary?.retransmits ?? j.summary?.retransmissions,
                        total_bytes: j.summary?.bytes_total ?? j.summary?.total_bytes ?? j.summary?.bytes_transferred,
                        summary: j.summary
                    }))
                };
            }

            case 'get_convergence_history': {
                const nodeCtx = resolveNodeContext(args.agent_id || args.node, ctx);
                const limit = Number(args.limit) || 10;
                const history = await fetchApi(nodeCtx, `/api/convergence/history`).catch(() => []);
                const arr = Array.isArray(history) ? history : [];
                // Sort strictly newest first (descending sequence_id or timestamp)
                const sorted = [...arr].sort((a: any, b: any) => {
                    const idA = a.testId || a.id || a.sequence_id || '';
                    const idB = b.testId || b.id || b.sequence_id || '';
                    if (idA && idB) return idB.localeCompare(idA, undefined, { numeric: true });
                    const dateA = new Date(a.timestamp || a.started_at || 0).getTime();
                    const dateB = new Date(b.timestamp || b.started_at || 0).getTime();
                    return dateB - dateA;
                }).slice(0, limit);
                return {
                    node: nodeCtx.siteName,
                    total_records: arr.length,
                    recent_history: sorted
                };
            }

            case 'run_security_url_batch': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/security/url-batch', { method: 'POST' });
            }

            case 'run_security_dns_batch': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/security/dns-batch', { method: 'POST' });
            }

            case 'run_full_security_audit': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const [urlBatch, dnsBatch, eicar] = await Promise.all([
                    fetchApi(nodeCtx, '/api/security/url-batch', { method: 'POST' }).catch(e => ({ error: e.message })),
                    fetchApi(nodeCtx, '/api/security/dns-batch', { method: 'POST' }).catch(e => ({ error: e.message })),
                    fetchApi(nodeCtx, '/api/security/threat-test', {
                        method: 'POST',
                        body: JSON.stringify({ scenarioId: 'STIGIX-EICAR-01', testName: 'EICAR Audit' })
                    }).catch(e => ({ error: e.message }))
                ]);
                return { url_batch: urlBatch, dns_batch: dnsBatch, threat_eicar: eicar };
            }

            case 'run_eicar_test': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/security/threat-test', {
                    method: 'POST',
                    body: JSON.stringify({
                        endpoint: args.custom_url || 'https://target.stigix.io/eicar.com.txt',
                        testName: 'EICAR Test'
                    })
                });
            }

            case 'list_security_results': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, `/api/security/results?limit=${args.limit || 20}`);
            }

            case 'get_public_ip': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/system/public-ip');
            }

            case 'list_apps': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/traffic/apps');
            }

            case 'export_app_config': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/traffic/config');
            }

            case 'import_app_config': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/traffic/config', {
                    method: 'POST',
                    body: JSON.stringify(args.config)
                });
            }

            case 'compare_nodes': {
                const nodeA = resolveNodeContext(args.agent_id_a, ctx);
                const nodeB = resolveNodeContext(args.agent_id_b, ctx);
                const [statsA, statsB] = await Promise.all([
                    fetchApi(nodeA, '/api/health').catch(e => ({ error: e.message })),
                    fetchApi(nodeB, '/api/health').catch(e => ({ error: e.message }))
                ]);
                return { node_a: { name: nodeA.siteName, stats: statsA }, node_b: { name: nodeB.siteName, stats: statsB } };
            }

            case 'generate_report': {
                const peers = typeof ctx.registryManager?.getPeers === 'function' ? ctx.registryManager.getPeers() : [];
                return {
                    total_mesh_nodes: peers.length + 1,
                    local_site: ctx.registryManager?.getSiteName?.() || 'LOCAL',
                    peers: peers.map((p: any) => ({ name: p.site_name, ip: p.ip_private, status: 'ONLINE' }))
                };
            }

            case 'clone_node_config': {
                const sourceCtx = resolveNodeContext(args.source_id, ctx);
                const targetCtx = resolveNodeContext(args.target_id, ctx);
                const scope = args.scope || ['apps', 'dem_probes', 'security_profile', 'vyos_scenarios'];
                const results: Record<string, string> = {};

                if (scope.includes('apps')) {
                    const apps = await fetchApi(sourceCtx, '/api/traffic/config');
                    await fetchApi(targetCtx, '/api/traffic/config', { method: 'POST', body: JSON.stringify(apps) });
                    results['apps'] = 'Cloned successfully';
                }
                if (scope.includes('dem_probes')) {
                    const probes = await fetchApi(sourceCtx, '/api/probes');
                    await fetchApi(targetCtx, '/api/probes/batch', { method: 'POST', body: JSON.stringify({ probes }) });
                    results['dem_probes'] = 'Cloned successfully';
                }
                return { source: sourceCtx.siteName, target: targetCtx.siteName, results };
            }

            case 'get_prisma_flows': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/prisma/flows', {
                    method: 'POST',
                    body: JSON.stringify(args)
                });
            }

            case 'get_health_matrix': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/system/health-matrix').catch(async () => {
                    return await fetchApi(nodeCtx, '/api/admin/system/dashboard-data');
                });
            }

            case 'run_system_diagnostics': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/system/health-matrix/diagnostics', { method: 'POST' });
            }

            case 'get_voice_stats': {
                const nodeCtx = resolveNodeContext(args.agent_id || args.node, ctx);
                return await fetchApi(nodeCtx, '/api/voice/stats');
            }

            case 'get_voice_ingress_calls': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/voice/ingress');
            }

            case 'create_custom_tcp_app': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const port = Number(args.port);
                
                let resolvedPeers = Array.isArray(args.peers) ? args.peers : [];
                if (resolvedPeers.length === 0 && args.target_peers !== 'none') {
                    const endpoints = (ctx.fabricEndpoints && ctx.fabricEndpoints.length > 0) ? ctx.fabricEndpoints : (ctx.targets || []);
                    const targetFilter = (args.target_peers && args.target_peers !== 'all' && args.target_peers !== '*')
                        ? args.target_peers.split(',').map((s: string) => s.trim().toLowerCase())
                        : null;

                    for (const ep of endpoints) {
                        const host = ep.test_ip || ep.host || (ep.api_base_url ? ep.api_base_url.replace(/https?:\/\//, '').split(':')[0] : null);
                        if (!host) continue;
                        const siteName = ep.meta?.site_name || ep.name || ep.id;
                        if (targetFilter && !targetFilter.includes(ep.id?.toLowerCase()) && !targetFilter.includes(siteName?.toLowerCase()) && !targetFilter.includes(host?.toLowerCase())) {
                            continue;
                        }
                        resolvedPeers.push({
                            id: `peer-${ep.id || host}`.toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
                            name: siteName,
                            siteName: siteName,
                            host: host,
                            port: port,
                            enabled: true,
                            role: ep.role || 'branch'
                        });
                    }
                }

                const appPayload = {
                    name: args.name,
                    description: args.description || `Custom TCP App ${args.name}`,
                    enabled: true,
                    protocol: args.protocol || 'stigix_tcp',
                    listener: {
                        bindAddress: '0.0.0.0',
                        port: port,
                        maxConnections: 100,
                        idleTimeoutMs: 60000,
                        maxPayloadBytes: 1048576,
                        tcpKeepalive: true,
                        allowCidrs: [],
                        auth: { enabled: false }
                    },
                    serverBehavior: {
                        mode: args.server_behavior || 'echo',
                        fixedDelayMs: 0,
                        randomDelayMinMs: 0,
                        randomDelayMaxMs: 0,
                        loopingNormalSec: 10,
                        loopingSlowSec: 5,
                        loopingSlowDelayMs: 200,
                        dropProbability: 0,
                        errorProbability: 0
                    },
                    clientDefaults: {
                        mode: args.client_mode || 'transactional',
                        connectionsPerPeer: args.connections_per_peer || 2,
                        intervalMs: args.interval_ms || 1000,
                        payloadBytes: args.payload_bytes || 1024,
                        requestTimeoutMs: 5000,
                        connectTimeoutMs: 5000,
                        autoReconnect: true,
                        reconnectInitialMs: 1000,
                        reconnectMaxMs: 30000,
                        tcpKeepalive: true,
                        sourceInterface: 'auto'
                    },
                    peers: resolvedPeers,
                    startup: {
                        startListener: args.auto_start_listener !== false,
                        startClientWorkload: args.auto_start_workload !== false
                    }
                };

                if (nodeCtx.isLocal && ctx.tcpAppManager) {
                    await ctx.tcpAppManager.saveApplication(appPayload);
                    if (args.auto_start_listener !== false) {
                        try {
                            const appId = appPayload.name;
                            await ctx.tcpAppManager.startListener(appId);
                        } catch {}
                    }
                    if (args.auto_start_workload !== false) {
                        try {
                            const appId = appPayload.name;
                            await ctx.tcpAppManager.startClient(appId);
                        } catch {}
                    }
                    return { success: true, application: appPayload, message: `Custom TCP App "${args.name}" created on ${nodeCtx.siteName}.` };
                }

                const res = await fetchApi(nodeCtx, '/api/custom-tcp-apps', {
                    method: 'POST',
                    body: JSON.stringify(appPayload)
                });
                const appId = res?.application?.id || args.name;
                if (args.auto_start_listener !== false && appId) {
                    try {
                        await fetchApi(nodeCtx, `/api/custom-tcp-apps/${appId}/listener/start`, { method: 'POST' });
                    } catch {}
                }
                if (args.auto_start_workload !== false && appId) {
                    try {
                        await fetchApi(nodeCtx, `/api/custom-tcp-apps/${appId}/client/start`, { method: 'POST' });
                    } catch {}
                }
                return { success: true, application: res?.application || appPayload, message: `Custom TCP App "${args.name}" created on ${nodeCtx.siteName}.` };
            }

            case 'add_tcp_app_peer': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const appId = String(args.app_id || '').trim();
                const peerTarget = String(args.peer_name_or_host || '').trim();

                const endpoints = (ctx.fabricEndpoints && ctx.fabricEndpoints.length > 0) ? ctx.fabricEndpoints : (ctx.targets || []);
                const matchedEp = endpoints.find((ep: any) =>
                    ep.id?.toLowerCase() === peerTarget.toLowerCase() ||
                    ep.name?.toLowerCase() === peerTarget.toLowerCase() ||
                    ep.meta?.site_name?.toLowerCase() === peerTarget.toLowerCase() ||
                    ep.test_ip === peerTarget || ep.host === peerTarget
                );

                const host = matchedEp ? (matchedEp.test_ip || matchedEp.host || (matchedEp.api_base_url ? matchedEp.api_base_url.replace(/https?:\/\//, '').split(':')[0] : peerTarget)) : peerTarget;
                const siteName = args.site_name || matchedEp?.meta?.site_name || matchedEp?.name || peerTarget;

                const peerPayload = {
                    name: siteName,
                    siteName: siteName,
                    host: host,
                    port: args.port ? Number(args.port) : undefined,
                    role: args.role || 'branch',
                    enabled: true
                };

                if (nodeCtx.isLocal && ctx.tcpAppManager) {
                    const file = ctx.tcpAppManager.getConfig();
                    const app = file.applications.find((a: any) => a.id === appId || a.name?.toLowerCase() === appId.toLowerCase());
                    if (!app) return { success: false, error: `Application "${appId}" not found.` };
                    if (!app.peers) app.peers = [];
                    const pId = `peer-${siteName}`.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
                    const fullPeer = { id: pId, port: app.listener?.port || 8100, ...peerPayload };
                    const idx = app.peers.findIndex((p: any) => p.id === pId || p.host === host);
                    if (idx >= 0) app.peers[idx] = { ...app.peers[idx], ...fullPeer };
                    else app.peers.push(fullPeer);
                    await ctx.tcpAppManager.saveApplication(app);
                    return { success: true, application: app, peer: fullPeer };
                }

                return await fetchApi(nodeCtx, `/api/custom-tcp-apps/${appId}/peers`, {
                    method: 'POST',
                    body: JSON.stringify(peerPayload)
                });
            }

            case 'delete_custom_tcp_app': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const appId = String(args.app_id || '').trim();

                if (nodeCtx.isLocal && ctx.tcpAppManager) {
                    await ctx.tcpAppManager.deleteApplication(appId);
                    return { success: true, message: `Custom TCP App "${appId}" deleted on ${nodeCtx.siteName}.` };
                }

                // Retrieve real ID if app name passed
                let realId = appId;
                try {
                    const listData = await fetchApi(nodeCtx, '/api/custom-tcp-apps');
                    const apps = listData?.applications || (Array.isArray(listData) ? listData : []);
                    const matched = apps.find((a: any) => a.id === appId || a.name?.toLowerCase() === appId.toLowerCase());
                    if (matched) realId = matched.id;
                } catch {}

                return await fetchApi(nodeCtx, `/api/custom-tcp-apps/${realId}`, { method: 'DELETE' });
            }

            case 'list_custom_tcp_apps': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                if (nodeCtx.isLocal && ctx.tcpAppManager) {
                    return ctx.tcpAppManager.getApplications();
                }
                return await fetchApi(nodeCtx, '/api/custom-tcp-apps');
            }

            case 'start_tcp_app_listener': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, `/api/custom-tcp-apps/${args.app_id}/listener/start`, { method: 'POST' });
            }

            case 'stop_tcp_app_listener': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, `/api/custom-tcp-apps/${args.app_id}/listener/stop`, { method: 'POST' });
            }

            case 'start_tcp_app_workload': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, `/api/custom-tcp-apps/${args.app_id}/client/start`, { method: 'POST' });
            }

            case 'stop_tcp_app_workload': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, `/api/custom-tcp-apps/${args.app_id}/client/stop`, { method: 'POST' });
            }

            case 'test_tcp_app_handshake': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const url = args.peer_id ? `/api/custom-tcp-apps/${args.app_id}/peers/${args.peer_id}/test` : `/api/custom-tcp-apps/${args.app_id}/test`;
                return await fetchApi(nodeCtx, url, {
                    method: 'POST',
                    body: JSON.stringify({ peerId: args.peer_id })
                });
            }

            case 'get_tcp_app_sessions': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, `/api/custom-tcp-apps/${args.app_id}/sessions`);
            }

            case 'reset_tcp_app_metrics': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, `/api/custom-tcp-apps/${args.app_id}/metrics/reset`, { method: 'POST' });
            }

            case 'get_controller_status': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/mesh/status');
            }

            case 'list_controller_peers': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/discovery/peers');
            }

            case 'set_controller_leader': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/mesh/leader', {
                    method: 'POST',
                    body: JSON.stringify({ leader_url: args.leader_url })
                });
            }

            case 'generate_peer_onboard_command': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/mesh/onboard-command');
            }

            case 'get_provisioning_status': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/provisioning/status');
            }

            case 'set_provisioning_mode': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/provisioning/mode', {
                    method: 'POST',
                    body: JSON.stringify({ enabled: Boolean(args.enabled) })
                });
            }

            case 'publish_configuration_bundle': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const bType = args.bundle_type || 'all';
                if (bType !== 'all') {
                    return await fetchApi(nodeCtx, `/api/provisioning/publish/${bType}`, {
                        method: 'POST'
                    });
                } else {
                    const validTypes = [
                        'applications', 'connectivity-probes', 'convergence-sla',
                        'prisma-sase', 'security-config', 'voice-config', 'iot-config',
                        'custom-tcp-apps', 'cloud-config'
                    ];
                    const results: any[] = [];
                    for (const t of validTypes) {
                        const res = await fetchApi(nodeCtx, `/api/provisioning/publish/${t}`, { method: 'POST' }).catch(() => null);
                        if (res) results.push(res);
                    }
                    return { success: true, published_bundles: results };
                }
            }

            case 'rollback_configuration_bundle': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, `/api/provisioning/rollback/${args.bundle_type}/${args.revision}`, {
                    method: 'POST'
                });
            }

            case 'get_provisioning_history': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, `/api/provisioning/history?limit=${args.limit || 15}`);
            }

            default:
                return { error: `Tool "${toolName}" is not implemented.` };
        }
    } catch (err: any) {
        return {
            error: `Execution error in "${toolName}": ${err?.message || err}`,
            execution_time_ms: Date.now() - startTime
        };
    }
}
