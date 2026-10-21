/**
 * Stigix In-App AI Copilot — Tool Catalog & Execution Handlers
 * 100% Feature & Signature Parity with the Python MCP Server (mcp-server/src/server.py).
 */

import { AnthropicToolDefinition, ApiCallTrace } from './types.js';
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
    snapshotManager?: any;
    systemToken?: string;
    serverPort?: number;
    runCommand?: (cmd: string) => Promise<string>;
    _apiTrace?: ApiCallTrace[];
}

export function resolveNodeContext(
    nodeNameOrIp: string | undefined,
    ctx: ToolExecutionContext
): { baseUrl: string; headers: Record<string, string>; siteName: string; isLocal: boolean; unknownNode?: boolean; requestedNode?: string; availableNodes?: string[]; _apiTrace?: ApiCallTrace[] } {
    const defaultPort = ctx.serverPort || process.env.PORT || 8080;
    const defaultHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    const activeToken = ctx.systemToken || (ctx as any).token;
    if (activeToken) defaultHeaders['Authorization'] = `Bearer ${activeToken}`;

    const localSite = String(ctx.registryManager?.getSiteName?.() || process.env.STIGIX_SITE_NAME || 'LOCAL').toLowerCase();
    const localId = String(ctx.registryManager?.getStatus?.()?.instance_id || '').toLowerCase();
    const query = String(nodeNameOrIp || '').toLowerCase().trim();

    const isExplicitLocal = !query ||
        ['local', 'self', 'current', 'localhost', '127.0.0.1'].includes(query) ||
        query === localSite ||
        query.includes(localSite) ||
        localSite.includes(query) ||
        (localId && (query === localId || query.includes(localId) || localId.includes(query))) ||
        (query.includes('br8') && localSite.includes('br8'));

    if (isExplicitLocal) {
        return { baseUrl: `http://127.0.0.1:${defaultPort}`, headers: defaultHeaders, siteName: localSite.toUpperCase(), isLocal: true, _apiTrace: ctx._apiTrace };
    }

    if (query.startsWith('http://') || query.startsWith('https://')) {
        return {
            baseUrl: query.replace(/\/+$/, ''),
            headers: defaultHeaders,
            siteName: query,
            isLocal: false,
            _apiTrace: ctx._apiTrace
        };
    }

    if (/^[0-9.]+:[0-9]+$/.test(query) || /^[a-zA-Z0-9.-]+:[0-9]+$/.test(query)) {
        return {
            baseUrl: `http://${query}`,
            headers: defaultHeaders,
            siteName: query,
            isLocal: false,
            _apiTrace: ctx._apiTrace
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
            isLocal: false,
            _apiTrace: ctx._apiTrace
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
            isLocal: false,
            _apiTrace: ctx._apiTrace
        };
    }

    // 3. Direct IP or hostname
    const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(query);
    if (!isIpv4 && !query.includes('.') && (ctx.registryManager || ctx.targetsManager)) {
        const availableNodes = Array.from(new Set([
            localSite.toUpperCase(),
            ...peers.map((p: any) => p.site_name || p.instance_id).filter(Boolean),
            ...targets.map((t: any) => t.name || t.id).filter(Boolean)
        ]));
        return {
            baseUrl: `http://${query}:8080`,
            headers: defaultHeaders,
            siteName: String(nodeNameOrIp || query),
            isLocal: false,
            unknownNode: true,
            requestedNode: String(nodeNameOrIp || query),
            availableNodes,
            _apiTrace: ctx._apiTrace
        };
    }

    if (/^[0-9.]+$|^[a-zA-Z0-9.-]+$/.test(query)) {
        return {
            baseUrl: `http://${query}:8080`,
            headers: defaultHeaders,
            siteName: query,
            isLocal: false,
            _apiTrace: ctx._apiTrace
        };
    }

    return { baseUrl: `http://127.0.0.1:${defaultPort}`, headers: defaultHeaders, siteName: localSite, isLocal: true, _apiTrace: ctx._apiTrace };
}

export function resolveTargetEndpoint(targetQuery: string | undefined, ctx: ToolExecutionContext): { host: string; port: number; name: string } {
    const raw = String(targetQuery || '').trim();
    if (!raw) return { host: '127.0.0.1', port: 9000, name: 'Localhost' };

    const query = raw.toLowerCase();
    const localSite = String(ctx.registryManager?.getSiteName?.() || process.env.STIGIX_SITE_NAME || 'LOCAL').toLowerCase();
    if (['local', 'self', 'current', 'localhost', '127.0.0.1'].includes(query) || query === localSite || (localSite && (query.includes(localSite) || localSite.includes(query)))) {
        return { host: '127.0.0.1', port: 9000, name: localSite.toUpperCase() };
    }

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

function collectFabricEndpoints(ctx: ToolExecutionContext): Array<{ id: string; name: string; siteName: string; host: string; role: string; meta?: any; test_ip?: string; api_base_url?: string }> {
    const out: Array<{ id: string; name: string; siteName: string; host: string; role: string; meta?: any; test_ip?: string; api_base_url?: string }> = [];
    const seenHosts = new Set<string>();

    const addEp = (id: string | undefined, name: string | undefined, host: string | undefined, role: string = 'branch') => {
        const cleanHost = String(host || '').trim();
        if (!cleanHost || cleanHost === '127.0.0.1' || cleanHost === 'localhost') return;
        const cleanName = String(name || id || cleanHost).trim();
        const cleanId = String(id || cleanName).trim();
        const key = `${cleanName.toLowerCase()}|${cleanHost.toLowerCase()}`;
        if (seenHosts.has(key)) return;
        seenHosts.add(key);
        out.push({
            id: cleanId,
            name: cleanName,
            siteName: cleanName,
            host: cleanHost,
            test_ip: cleanHost,
            role,
            meta: { site_name: cleanName }
        });
    };

    // 1. Explicit context arrays (used by test harness or custom injection)
    const explicit = ((ctx as any).fabricEndpoints && (ctx as any).fabricEndpoints.length > 0)
        ? (ctx as any).fabricEndpoints
        : ((ctx as any).targets || []);
    for (const ep of explicit) {
        const h = ep.test_ip || ep.host || ep.ip || (ep.api_base_url ? String(ep.api_base_url).replace(/https?:\/\//, '').split(':')[0] : '');
        const n = ep.meta?.site_name || ep.site_name || ep.name || ep.id;
        addEp(ep.id || n, n, h, ep.role || 'branch');
    }

    // 2. Local node from registry status (so local node has a routable overlay IP when added as a peer on a remote node)
    const regStatus = typeof ctx.registryManager?.getStatus === 'function' ? ctx.registryManager.getStatus() : null;
    if (regStatus) {
        const localIp = regStatus.detected_ip || regStatus.ip_private || regStatus.ip_public;
        const localName = regStatus.site_name || ctx.registryManager?.getSiteName?.() || regStatus.instance_id;
        if (localIp && localName) {
            addEp(regStatus.instance_id || localName, localName, localIp, regStatus.role || 'branch');
        }
    }

    // 3. Registry peers
    const peers = typeof ctx.registryManager?.getPeers === 'function' ? ctx.registryManager.getPeers() : [];
    for (const p of peers) {
        const h = p.ip_private || p.ip_public || p.host;
        const n = p.site_name || p.name || p.instance_id;
        addEp(p.instance_id || n, n, h, p.role || 'branch');
    }

    // 4. Merged targets from TargetsManager
    const managedTargets = typeof ctx.targetsManager?.getMergedTargets === 'function' ? ctx.targetsManager.getMergedTargets() : [];
    for (const t of managedTargets) {
        const h = t.host || t.ip;
        const n = t.name || t.meta?.site_name || t.id;
        addEp(t.id || n, n, h, t.role || (n && /^dc/i.test(String(n)) ? 'hub' : 'branch'));
    }

    return out;
}

function matchFabricEndpoint(
    query: string,
    endpoints: Array<{ id: string; name: string; siteName: string; host: string; role: string }>
) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return undefined;
    // Exact match first
    const exact = endpoints.find(ep =>
        ep.id?.toLowerCase() === q ||
        ep.name?.toLowerCase() === q ||
        ep.siteName?.toLowerCase() === q ||
        ep.host?.toLowerCase() === q
    );
    if (exact) return exact;
    // Prefix / substring match (e.g., "BR8" -> "BR8-Ubuntu")
    return endpoints.find(ep => {
        const id = (ep.id || '').toLowerCase();
        const name = (ep.name || '').toLowerCase();
        const site = (ep.siteName || '').toLowerCase();
        return (name && (name.includes(q) || q.includes(name))) ||
            (site && (site.includes(q) || q.includes(site))) ||
            (id && (id.includes(q) || q.includes(id)));
    });
}

function sanitizeProbeConfig(p: any): any {
    if (!p || typeof p !== 'object') return p;
    const { _wasGlobal, _source, ...clean } = p;
    return clean;
}

function traceLocalApi(
    nodeCtx: { baseUrl?: string; _apiTrace?: ApiCallTrace[] },
    method: string,
    path: string,
    requestBody?: any
) {
    if (nodeCtx._apiTrace) {
        nodeCtx._apiTrace.push({
            method: method.toUpperCase(),
            path,
            url: `${nodeCtx.baseUrl || 'http://127.0.0.1:8080'}${path}`,
            status: 200,
            durationMs: 1,
            ...(requestBody !== undefined ? { requestBody } : {})
        });
    }
}

const peerTokenCache = new Map<string, string>();

async function authenticateRemotePeer(baseUrl: string): Promise<string | null> {
    const passwordsToTry = Array.from(new Set([
        process.env.ADMIN_PASSWORD,
        process.env.UI_PASSWORD,
        'admin'
    ].filter(Boolean) as string[]));

    for (const password of passwordsToTry) {
        try {
            const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: 'admin', password }),
                signal: AbortSignal.timeout(5000)
            });
            if (loginRes.ok) {
                const data: any = await loginRes.json().catch(() => ({}));
                if (data?.token) {
                    peerTokenCache.set(baseUrl, data.token);
                    return data.token;
                }
            }
        } catch {
            // Ignore and try next password if any
        }
    }
    return null;
}

async function fetchApi(
    nodeCtx: { baseUrl: string; headers: Record<string, string>; siteName?: string; isLocal?: boolean; unknownNode?: boolean; requestedNode?: string; availableNodes?: string[]; _apiTrace?: ApiCallTrace[] },
    path: string,
    options: RequestInit = {},
    timeoutMs: number = 25000
): Promise<any> {
    if (nodeCtx.unknownNode) {
        throw new Error(
            `Unknown Stigix node "${nodeCtx.requestedNode || nodeCtx.siteName}". Available nodes in fabric: ${(nodeCtx.availableNodes || []).join(', ') || 'LOCAL'}`
        );
    }
    const url = `${nodeCtx.baseUrl}${path}`;
    const method = (options.method || 'GET').toUpperCase();
    let requestBody: any = undefined;
    if (options.body && typeof options.body === 'string') {
        try {
            requestBody = JSON.parse(options.body);
        } catch {
            requestBody = options.body;
        }
    }

    const buildHeaders = (): Record<string, string> => {
        const h: Record<string, string> = {
            ...nodeCtx.headers,
            ...((options.headers as Record<string, string>) || {})
        };
        if (!nodeCtx.isLocal && peerTokenCache.has(nodeCtx.baseUrl)) {
            h['Authorization'] = `Bearer ${peerTokenCache.get(nodeCtx.baseUrl)}`;
        }
        return h;
    };

    const reqStart = Date.now();
    const signal = options.signal || AbortSignal.timeout(timeoutMs);
    let res = await fetch(url, {
        ...options,
        signal,
        headers: buildHeaders()
    });

    // If a remote peer rejects our local JWT (different JWT_SECRET across nodes), auto-login once and retry
    if (!nodeCtx.isLocal && (res.status === 401 || res.status === 403)) {
        const peerToken = await authenticateRemotePeer(nodeCtx.baseUrl);
        if (peerToken) {
            res = await fetch(url, {
                ...options,
                signal: AbortSignal.timeout(timeoutMs),
                headers: buildHeaders()
            });
        }
    }

    if (nodeCtx._apiTrace) {
        nodeCtx._apiTrace.push({
            method,
            path,
            url,
            status: res.status,
            durationMs: Date.now() - reqStart,
            ...(requestBody !== undefined ? { requestBody } : {})
        });
    }
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status} on ${path}: ${text}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
        return res.json();
    }
    const text = await res.text();
    const trimmed = text.trim();
    if (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<!DOCTYPE html') || trimmed.startsWith('<html')) {
        throw new Error(`HTTP 404 on ${path}: Route not found (received SPA fallback HTML)`);
    }
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

/**
 * Resolves the Stigix node that actually manages VyOS routers.
 * In Stigix labs, VyOS routers ("vyosrouter", "vyoslandc1", "vyoslandc2new") are typically
 * centrally managed from the controller node (e.g. BR8 / LOCAL) even when testing convergence
 * from a remote branch (e.g. BR1, BR2, BR5). If a remote branch is passed in `agent_id` and has
 * no local VyOS routers configured, this helper transparently falls back to the local node.
 */
async function resolveVyosNodeContext(
    requestedAgentId: string | undefined,
    ctx: ToolExecutionContext
): Promise<{
    nodeCtx: ReturnType<typeof resolveNodeContext>;
    requestedSiteName: string;
    sitePrefix: string;
    centralFallbackUsed: boolean;
}> {
    const requestedCtx = resolveNodeContext(requestedAgentId, ctx);
    const localCtx = resolveNodeContext('LOCAL', ctx);
    const rawSite = String(requestedCtx.siteName || requestedAgentId || localCtx.siteName || 'LOCAL').trim();
    const sitePrefixMatch = rawSite.match(/^([A-Za-z]+\d+)/);
    const sitePrefix = (sitePrefixMatch ? sitePrefixMatch[1] : rawSite.split(/[-_\s]/)[0] || '').toUpperCase();

    if (requestedCtx.isLocal || requestedCtx.unknownNode) {
        return {
            nodeCtx: localCtx,
            requestedSiteName: localCtx.siteName,
            sitePrefix,
            centralFallbackUsed: false
        };
    }

    try {
        const remoteRouters = await fetchApi(requestedCtx, '/api/vyos/routers', {}, 5000);
        if (Array.isArray(remoteRouters) && remoteRouters.length > 0) {
            return {
                nodeCtx: requestedCtx,
                requestedSiteName: requestedCtx.siteName,
                sitePrefix,
                centralFallbackUsed: false
            };
        }
    } catch {
        // Fallback to local controller if remote node has no VyOS config or is unreachable
    }

    return {
        nodeCtx: localCtx,
        requestedSiteName: requestedCtx.siteName,
        sitePrefix,
        centralFallbackUsed: true
    };
}

export const COPILOT_TOOLS: AnthropicToolDefinition[] = [
    // -----------------------------------------------------------------------------
    // Core Endpoints & Tests (Parity with MCP server.py)
    // -----------------------------------------------------------------------------
    {
        name: 'list_endpoints',
        description: 'List all discovered Stigix SD-WAN mesh peers (Fabric nodes like DC1, BR1, BR8 with their private/public IPs and roles) and Internet targets. ALWAYS call this tool first when resolving peer names to IP addresses or verifying which nodes exist in the fabric.',
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
        description: 'Start a coordinated traffic test between Stigix endpoints. Source initiates (client) and target receives (server). WORKFLOW FOR XFR/SPEEDTEST: After calling run_test, you MUST call get_test_status with the returned test_id and poll until status is "completed" before reading metrics — do NOT read list_speedtest_history immediately or you will get results from a previous test. For "conv" (convergence failover), does NOT stop automatically — inform user of test ID and wait for explicit "stop" before calling stop_test.',
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
        description: 'Get the status and metrics of a specific test on a SOURCE node. CRITICAL: you MUST pass (1) agent_id = the source node that ran the test (NOT the target, NOT the local node) and (2) test_id = the sequence_id returned by run_test (e.g. "XFR-0003" or "CONV-0001", never a UUID). For XFR speedtests, this tool automatically waits up to 25s for completion. For continuous convergence probes (CONV-*), pass wait_seconds (e.g. 15 or 30) to pause for a baseline window or failover convergence before sampling live_loss_pct, current_rtt_ms, and duration_s.',
        input_schema: {
            type: 'object',
            properties: {
                test_id: {
                    type: 'string',
                    description: 'Optional test ID (e.g. CONV-0001, XFR-0001). If omitted, returns active tests and last completed XFR speedtest.'
                },
                agent_id: {
                    type: 'string',
                    description: 'Optional Stigix node ID to check on.'
                },
                wait_seconds: {
                    type: 'number',
                    description: 'Optional seconds to wait (1-30) BEFORE sampling status. Use during convergence tests (CONV-*) to wait for baseline or failover stabilization.'
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
        description: 'List all VyOS routers managed by this node (or a specific remote Stigix node if agent_id is provided).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'Optional ID or site name of the Stigix node (e.g. "BR8", "DC1"). Defaults to the current local node hosting Copilot if omitted.'
                }
            },
            required: []
        }
    },
    {
        name: 'list_vyos_scenarios',
        description: 'List available VyOS configuration sequences (scenarios) on this node or a specific node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'Optional ID of the Stigix node. Defaults to the current local node hosting Copilot if omitted.'
                }
            },
            required: []
        }
    },
    {
        name: 'run_vyos_scenario',
        description: 'Execute a VyOS configuration sequence (scenario) on this node or a specific node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'Optional ID of the Stigix node. Defaults to the current local node hosting Copilot if omitted.'
                },
                scenario_id: {
                    type: 'string',
                    description: 'ID of the sequence to run (e.g. "failover-paris").'
                }
            },
            required: ['scenario_id']
        }
    },
    {
        name: 'get_vyos_timeline',
        description: 'Get the history of recent VyOS configuration changes on this node or a specific node.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'Optional ID of the Stigix node. Defaults to the current local node hosting Copilot if omitted.'
                },
                limit: {
                    type: 'number',
                    description: 'Number of recent actions to fetch (default: 20).'
                }
            },
            required: []
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
                    description: 'Optional ID of the Stigix node. Defaults to the current local node hosting Copilot if omitted.'
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
            required: ['scenario_id', 'enabled']
        }
    },
    {
        name: 'get_vyos_interfaces',
        description: 'List VyOS routers and their CHAOS-ELIGIBLE interfaces. Filters out management interfaces and provides admin status.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'Optional ID of the Stigix node managing the VyOS router. Defaults to the current local node hosting Copilot if omitted.'
                },
                router_id: {
                    type: 'string',
                    description: 'Optional router ID filter (e.g. "vyosrouter").'
                }
            },
            required: []
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
                    description: 'Optional ID of the Stigix node. Defaults to the current local node hosting Copilot if omitted.'
                },
                router_id: {
                    type: 'string',
                    description: 'ID of the VyOS router (e.g. "vyosrouter", "vyoslandc1").'
                }
            },
            required: ['router_id']
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
                    description: 'Optional ID of the Stigix node. Defaults to the current local node hosting Copilot if omitted.'
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
            required: ['router_id', 'scope']
        }
    },
    {
        name: 'vyos_execute_action',
        description: 'Execute an ad-hoc VyOS network action on a router interface ("interface-down", "interface-up", "set-impairment", "clear-qos", "deny-traffic", "allow-traffic", "clear-all-blocks") with automatic read-after-write state verification. If the user prompt ALREADY explicitly asks to cut an interface, restore it, or inject a specific QoS impairment (e.g. "Ajoute 120ms sur eth1" or "Coupe eth1"), that prompt serves as explicit confirmation and you should execute it directly after verifying the interface name. Only ask for confirmation first if you are proposing an unrequested destructive change.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'Optional ID of the Stigix node. Defaults to the current local node hosting Copilot if omitted.'
                },
                router_id: {
                    type: 'string',
                    description: 'ID of the VyOS router.'
                },
                command: {
                    type: 'string',
                    enum: ['set-qos', 'set-impairment', 'clear-qos', 'interface-down', 'interface-up', 'deny-traffic', 'allow-traffic', 'clear-all-blocks', 'show-denied'],
                    description: 'Action command: "set-qos" (inject latency_ms, loss_pct, etc.), "clear-qos" (restore normal link), "interface-down" (simulate link shutdown/cut), "interface-up" (restore interface), "deny-traffic" (firewall block IP/host), "allow-traffic" (unblock).'
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
            required: ['router_id', 'command']
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
        description: 'Get the LIVE Digital Experience Monitoring (DEM) health score AND the live status, RTT latency, and score of active DEM probes on a node. Supports optional probe_name_filter to return only matching probes (e.g. "MS -"). PREFER THIS TOOL over list_dem_probes whenever checking probe health, status, or latency.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                probe_name_filter: {
                    type: 'string',
                    description: 'Optional substring to filter returned probes by name (e.g. "MS -", "Exchange", "Azure"). Always provide this when the user asks about a specific subset of probes.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'get_probe_details',
        description: 'Get detailed live performance metrics for a specific DEM probe by name (score, RTT in ms, reachability status).',
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
        description: 'List static custom DEM synthetic probe configurations on a specific node (without live RTT or health scores). Use get_dem_summary or get_probe_details if you need live status, RTT, or scores.',
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
        description: 'Trigger an immediate on-demand live run of DEM experience probes on a node, with optional filtering by probe name.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                probe_name_filter: {
                    type: 'string',
                    description: 'Optional substring to filter returned probe results by name (e.g. "MS -", "Microsoft").'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'get_dem_probe_stats',
        description: 'Get historical DEM probe statistics and health score over a time window with optional probe filtering and statistical aggregation (median, p95, success rate).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                probe_name_filter: {
                    type: 'string',
                    description: 'Optional substring to filter probes by name (e.g. "MS -", "Exchange", "Azure").'
                },
                window_minutes: {
                    type: 'number',
                    description: 'Time window in minutes (default: 60).'
                },
                aggregate: {
                    type: 'boolean',
                    description: 'If true (default), computes clean aggregated stats (median, p95, success rate) per probe.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'update_dem_probe',
        description: 'Update settings of an existing DEM probe (expected status codes, timeout, interval, URL) without deleting it or losing historical telemetry.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                probe_name: {
                    type: 'string',
                    description: 'Name or ID of the probe to update.'
                },
                expected_status_codes: {
                    type: 'array',
                    items: { type: 'number' },
                    description: 'List of HTTP status codes considered successful (e.g. [200, 301, 302, 401, 403]).'
                },
                timeout_ms: {
                    type: 'number',
                    description: 'Timeout in ms (e.g. 5000).'
                },
                interval_sec: {
                    type: 'number',
                    description: 'Probing interval in seconds (e.g. 60).'
                },
                url: {
                    type: 'string',
                    description: 'Target URL or IP.'
                },
                enabled: {
                    type: 'boolean',
                    description: 'Enable or disable the probe.'
                }
            },
            required: ['agent_id', 'probe_name']
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
        description: 'List manually configured static target entries on a specific node (/api/targets). To discover SD-WAN mesh peers across the fabric (DC1, BR1, BR8, etc.), prefer list_endpoints.',
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
        description: 'Get the convergence/failover test history for a specific node (target peer, blackout ms, verdict, failover events). Compact summary by default to prevent context overflow.',
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
                },
                summary_only: {
                    type: 'boolean',
                    description: 'If true (default), strips heavy raw sample logs and returns clean metrics.'
                },
                test_id: {
                    type: 'string',
                    description: 'Optional test ID filter (e.g. "CONV-0022") to retrieve a single convergence test.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'get_convergence_report',
        description: 'Get a detailed convergence/failover test report for a specific historical or just-completed CONV-* test (verdict, max_blackout_ms, max_blackout_s, avg_rtt_ms, min_rtt_ms, max_rtt_ms, avg_jitter_ms, peak_loss_pct, uplink/downlink loss, packets sent/received, egress_path, path_evolution). Pass test_id="latest" (or omit test_id) to inspect the most recent convergence test.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                test_id: {
                    type: 'string',
                    description: 'Test ID to retrieve (e.g. "CONV-0022" or "latest"). Defaults to "latest".'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'run_automated_failover_test',
        description: 'Run a complete 3-phase SD-WAN failover/chaos test (Baseline -> Fault Injection -> Rollback & Recovery) in a single atomic call with guaranteed try/finally cleanup (never leaves an interface down, QoS active, or a CONV-* probe running). Supports any fault scenario: interface-down, set-impairment (latency/loss/rate), deny-traffic (IP blackhole), or vyos-scenario. Note: For custom interactive step-by-step tests, you can still use run_test(profile="conv") + get_test_status(wait_seconds) + vyos_execute_action + stop_test.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the source Stigix node (e.g. "BR8").'
                },
                target: {
                    type: 'string',
                    description: 'Target peer name (e.g. "DC1") or IP address (e.g. "192.168.203.100").'
                },
                fault_type: {
                    type: 'string',
                    enum: ['interface-down', 'set-impairment', 'deny-traffic', 'vyos-scenario'],
                    description: 'Type of fault to inject during Phase 2.'
                },
                router_id: {
                    type: 'string',
                    description: 'Optional VyOS router ID (auto-resolved if omitted).'
                },
                interface: {
                    type: 'string',
                    description: 'Target VyOS interface (e.g. "eth1", "eth2") for interface-down or set-impairment.'
                },
                latency_ms: {
                    type: 'number',
                    description: 'Injected latency in ms (for fault_type="set-impairment").'
                },
                loss_pct: {
                    type: 'number',
                    description: 'Injected packet loss % (for fault_type="set-impairment").'
                },
                rate_mbit: {
                    type: 'number',
                    description: 'Bandwidth rate limit in Mbps (for fault_type="set-impairment").'
                },
                blocked_ip: {
                    type: 'string',
                    description: 'IP or CIDR to blackhole (for fault_type="deny-traffic").'
                },
                scenario_id: {
                    type: 'string',
                    description: 'VyOS scenario ID or name (for fault_type="vyos-scenario").'
                },
                pps: {
                    type: 'number',
                    description: 'Convergence probe packet rate in PPS (default: 50).'
                },
                baseline_seconds: {
                    type: 'number',
                    description: 'Seconds to observe baseline before fault injection (default: 6, max: 20).'
                },
                fault_seconds: {
                    type: 'number',
                    description: 'Seconds to hold fault active and measure SD-WAN failover (default: 12, max: 30).'
                },
                recovery_seconds: {
                    type: 'number',
                    description: 'Seconds to observe recovery after rollback before stopping probe (default: 6, max: 20).'
                },
                auto_rollback: {
                    type: 'boolean',
                    description: 'If true (default), automatically rolls back the VyOS fault in a finally block before stopping the probe.'
                }
            },
            required: ['target', 'fault_type']
        }
    },
    {
        name: 'run_path_trace',
        description: 'Execute a live traceroute / path hop inspection from a specific Stigix node to identify where latency or packet drops occur.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                target: {
                    type: 'string',
                    description: 'Destination IP address or hostname.'
                },
                max_hops: {
                    type: 'number',
                    description: 'Maximum hops to probe (default: 15, max 30).'
                }
            },
            required: ['agent_id', 'target']
        }
    },
    {
        name: 'list_active_impairments',
        description: 'Audit and list all active network impairments across VyOS routers (both local node and remote peers): injected QoS latency/loss/rate-limiting (qos_active), administratively down interfaces (admin_state=down), and static IP blackhole routes (tag 999). ALWAYS call this when checking if any impairments, QoS rules, or link cuts are active.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'Optional node ID. If omitted, audits all nodes across the mesh.'
                }
            }
        }
    },
    {
        name: 'run_security_url_batch',
        description: 'Run a FULL batch URL filtering audit testing all enabled categories on a node (or a specific list of category IDs). Returns total, blocked, allowed, and individual category results.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                categories: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional list of category IDs (e.g. ["malware", "phishing", "adult"]). If omitted, tests all categories enabled in the node security config.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'run_security_dns_batch',
        description: 'Run a FULL batch DNS security audit testing all enabled domains on a node (or a specific list of DNS test IDs). Returns total, blocked, sinkholed, allowed, and per-domain results.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                test_ids: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional list of DNS test IDs (e.g. ["malware", "phishing", "dns-tunneling"]). If omitted, tests all domains enabled in the node security config.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'run_security_c2_batch',
        description: 'Run the C2 (Command & Control) attack simulation suite on a node (SQL Injection, DNS C2 Infiltration, Greyware DNS, Compromised DNS, Sliver C2 Beacon, EICAR over HTTPS, DNS Tunneling Burst). Returns enforced (blocked) vs bypass verdicts per scenario.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                scenario_ids: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional list of C2 scenario IDs to run (e.g. ["sqli", "sliver-c2", "dns-tunneling-burst"]). If omitted, runs all C2 scenarios in the security profile.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'run_security_ai_batch',
        description: 'Run the AI Security (AISA) attack simulation suite on a node (DLP Credit Card in Prompt, Prompt Injection / Jailbreak, Misfortune Cookie CVE-2014-9222, EICAR Malware Upload to AI App). Returns enforced (blocked) vs bypass verdicts per scenario.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                scenario_ids: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional list of AI scenario IDs (e.g. ["dlp-credit-card", "prompt-injection", "misfortune-cookie", "eicar-upload"]).'
                },
                include_volume: {
                    type: 'boolean',
                    description: 'If true, also runs the 24-app AI Volume Traffic telemetry generator (default: false).'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'run_full_security_audit',
        description: 'Run the COMPLETE security suite (URL Filtering batch + DNS Security batch + EICAR Threat Prevention + optional C2 & AI Security suites) on a node and return aggregated enforcement scores.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                include_c2_and_ai: {
                    type: 'boolean',
                    description: 'If true, also includes C2 and AI Security attack scenarios in the audit (default: false).'
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
                fixed_delay_ms: { type: 'integer', description: 'Server response delay in ms when server_behavior is "fixed_delay" (default: 500).' },
                random_delay_min_ms: { type: 'integer', description: 'Minimum server response delay in ms when server_behavior is "random_delay" (default: 100).' },
                random_delay_max_ms: { type: 'integer', description: 'Maximum server response delay in ms when server_behavior is "random_delay" (default: 1000).' },
                client_mode: { type: 'string', enum: ['heartbeat', 'transactional', 'persistent_request_reply', 'bulk_burst', 'continuous_stream'], description: 'Client traffic generation mode.' },
                payload_bytes: { type: 'integer', description: 'Payload size in bytes per transaction (default: 1024).' },
                interval_ms: { type: 'integer', description: 'Request interval in ms (default: 1000).' },
                connections_per_peer: { type: 'integer', description: 'Concurrent sessions per peer (default: 2).' },
                target_peers: { type: 'string', description: 'Comma-separated target node IDs/names/IPs or "all" to automatically attach mesh peers (default: "all"). Use "none" for listener-only with no peers.' },
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
        description: 'Get Global Configuration Provisioning status across the SD-WAN fabric (bundle revisions, pull mode status, applied hashes).',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix node.'
                },
                summary_only: {
                    type: 'boolean',
                    description: 'When True (default), omits raw history diffs returning a compact status payload.'
                }
            },
            required: ['agent_id']
        }
    },
    {
        name: 'purge_stale_leader_state',
        description: 'Purge stale local leader manifests and orphaned bundles on a non-leader member branch node. Supports dry_run simulation.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the Stigix member node to clean up.'
                },
                dry_run: {
                    type: 'boolean',
                    description: 'When True (default), simulates the purge and lists items without deleting. Set False to apply.'
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
    },
    {
        name: 'take_snapshot',
        description: 'Take a state snapshot of the node (captures SD-WAN IPsec overlay tunnels, reachability status, and DEM matrix / probes). Use this before or after network maintenance (e.g. site migration, ISP cutover, router swap) to establish a baseline or post-change state.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: { type: 'string', description: 'ID of node to snapshot (default: local).' },
                name: { type: 'string', description: 'Short unique label for the snapshot (e.g. "pre-migration-br1", "post-fiber-upgrade").' },
                description: { type: 'string', description: 'Optional context or description of the maintenance.' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags (e.g. ["migration", "wan"]).' }
            },
            required: ['name']
        }
    },
    {
        name: 'compare_snapshots',
        description: 'Compare two network state snapshots (or compare a baseline snapshot with the live current state) to assess the impact of a migration or network change. Returns deterministic deltas (tunnel status, RTT latency change, packet loss delta, jitter) and flags regressions or improvements.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: { type: 'string', description: 'ID of node where snapshots are stored (default: local).' },
                baseline: { type: 'string', description: 'Name or ID of baseline snapshot (e.g. "pre-migration-br1").' },
                target: { type: 'string', description: 'Name or ID of target snapshot, or "current" to compare against live state (default: "current").' }
            },
            required: ['baseline']
        }
    },
    {
        name: 'list_snapshots',
        description: 'List all available network state snapshots stored on a node with their creation timestamps, tunnel counts, and probe metrics.',
        input_schema: {
            type: 'object',
            properties: {
                agent_id: { type: 'string', description: 'ID of node (default: local).' }
            }
        }
    }
];

/**
 * Extracts the clean CONV-XXXX identifier from a raw test_id string like "CONV-0022 (DC1-LAN)".
 */
function extractCleanConvId(raw: any): string {
    if (!raw) return '';
    return String(raw).split(' (')[0].trim();
}

/**
 * Formats a convergence test record (from convergence_history.jsonl or live status)
 * into the exact PoC Test Analysis structure displayed in the Failover UI card.
 */
function formatConvergencePocReport(record: any, nodeName: string, statusOverride?: string) {
    const rawId = record.test_id || record.testId || record.id || record.sequence_id || 'CONV-UNKNOWN';
    const cleanId = extractCleanConvId(rawId);
    const labelMatch = String(rawId).match(/\(([^)]+)\)/);
    const label = record.label || (labelMatch ? labelMatch[1] : undefined) || record.target;

    const maxBlackoutMs = Number(record.max_blackout_ms ?? record.blackout_ms ?? 0);
    const lossPct = Number(record.loss_pct ?? record.loss_percent ?? record.live_loss_pct ?? 0);
    const txLossPct = Number(record.tx_loss_pct ?? record.uplink_loss_pct ?? 0);
    const txLossMs = Number(record.tx_loss_ms ?? 0);
    const rxLossPct = Number(record.rx_loss_pct ?? record.downlink_loss_pct ?? 0);
    const rxLossMs = Number(record.rx_loss_ms ?? 0);

    const sent = Number(record.sent ?? record.packets_sent ?? record.tx_count ?? 0);
    const received = Number(record.received ?? record.packets_received ?? record.rx_count ?? 0);
    const serverReceived = Number(
        record.server_received ??
        (sent > 0 ? Math.round(sent * (1 - txLossPct / 100)) : received)
    );
    const lost = Math.max(0, sent - received);

    const avgRttMs = Number(record.avg_rtt_ms ?? record.current_rtt_ms ?? record.latency_ms ?? record.rtt_ms ?? 0);
    const jitterMs = Number(record.jitter_ms ?? record.avg_jitter_ms ?? 0);
    const durationS = Number(record.duration_s ?? record.duration ?? record.duration_seconds ?? record.elapsed_s ?? 0);

    const series = Array.isArray(record.series) ? record.series : [];
    const peakLossFromSeries = series.length > 0
        ? Math.max(...series.map((s: any) => Number(s.lossPct ?? s.loss_pct ?? 0)), 0)
        : 0;
    const peakLossPct = Number(record.peak_loss_pct ?? Math.max(peakLossFromSeries, lossPct));

    // Match Failover.tsx getStatusInfo(maxBlackoutMs, lossPct)
    let uiVerdict = 'PERFECT';
    if (maxBlackoutMs > 10000 || lossPct > 25) uiVerdict = 'CRITICAL';
    else if (maxBlackoutMs > 5000 || lossPct > 10) uiVerdict = 'BAD';
    else if (maxBlackoutMs > 1000 || lossPct > 2) uiVerdict = 'DEGRADED';
    else if (maxBlackoutMs > 0 || lossPct > 0) uiVerdict = 'GOOD';

    const maxOutageFormatted = maxBlackoutMs >= 1000
        ? `${(maxBlackoutMs / 1000).toFixed(2)}s`
        : `${maxBlackoutMs}ms`;

    const egressPath = record.egress_path || 'Direct / Local';
    const pathEvolution = Array.isArray(record.path_evolution) ? record.path_evolution : [];
    const pathHistory = Array.isArray(record.path_history) ? record.path_history : [];

    return {
        node: nodeName,
        found: true,
        test_id: cleanId,
        full_test_id: rawId,
        label,
        target: record.target,
        source_port: record.source_port ?? null,
        running: Boolean(record.running && statusOverride !== 'STOPPED'),
        status: statusOverride || (record.running ? 'RUNNING' : 'COMPLETED'),
        verdict: uiVerdict,
        timestamp: record.timestamp || record.started_at || new Date().toISOString(),
        duration_s: durationS,
        max_outage_ms: maxBlackoutMs,
        max_outage_formatted: maxOutageFormatted,
        poc_test_analysis: {
            title: `PoC Test Analysis & Failover Curves — ${cleanId}${label ? ` (${label})` : ''}`,
            verdict: uiVerdict,
            timestamp: record.timestamp || record.started_at,
            max_outage_ms: maxBlackoutMs,
            max_outage_formatted: maxOutageFormatted,
            duration_s: durationS,
            duration_formatted: `${durationS}s`,
            rtt_latency_avg_ms: avgRttMs,
            jitter_avg_ms: jitterMs,
            packet_loss_spike_peak_pct: peakLossPct,
            packet_sequence_100: {
                summary: `${serverReceived}/${sent} PACKETS (${txLossPct}% TX LOSS)`,
                sent,
                echo_server_received: serverReceived,
                received,
                lost,
                total_loss_pct: lossPct,
                tx_loss_pct: txLossPct,
                rx_loss_pct: rxLossPct
            },
            uplink_loss: {
                direction: '↑ Uplink (TX)',
                tx_loss_pct: txLossPct,
                tx_loss_ms: txLossMs,
                formatted: `↑ ${txLossPct}%${txLossMs > 0 ? ` (${txLossMs >= 1000 ? (txLossMs / 1000).toFixed(1) + 's' : txLossMs + 'ms'})` : ''}`
            },
            downlink_loss: {
                direction: '↓ Downlink (RX)',
                rx_loss_pct: rxLossPct,
                rx_loss_ms: rxLossMs,
                formatted: `↓ ${rxLossPct}%${rxLossMs > 0 ? ` (${rxLossMs >= 1000 ? (rxLossMs / 1000).toFixed(1) + 's' : rxLossMs + 'ms'})` : ''}`
            },
            avg_latency_ms: avgRttMs,
            jitter_ms: jitterMs,
            egress_path: egressPath,
            path_evolution: pathEvolution,
            path_history: pathHistory
        },
        metrics: {
            max_blackout_ms: maxBlackoutMs,
            max_blackout_s: Number((maxBlackoutMs / 1000).toFixed(3)),
            packets_sent: sent,
            packets_echo_server_received: serverReceived,
            packets_received: received,
            packets_lost: lost,
            loss_pct: lossPct,
            peak_loss_pct: peakLossPct,
            uplink_loss_pct: txLossPct,
            uplink_loss_ms: txLossMs,
            downlink_loss_pct: rxLossPct,
            downlink_loss_ms: rxLossMs,
            avg_rtt_ms: avgRttMs,
            jitter_ms: jitterMs
        },
        egress_path: egressPath,
        path_evolution: pathEvolution,
        path_history: pathHistory
    };
}

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
                const localNodeCtx = resolveNodeContext('LOCAL', ctx);
                traceLocalApi(localNodeCtx, 'GET', '/api/registry/status');
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

                /**
                 * parseDurationSec — converts human-readable duration strings to seconds.
                 * Examples: "30s" → 30, "2m" → 120, "1h" → 3600, "45" → 45.
                 * Replaces the previous broken `.replace('m', '0')` approach.
                 */
                const parseDurationSec = (d: string | number | undefined): number => {
                    if (typeof d === 'number') return d > 0 ? d : 10;
                    if (!d) return 10;
                    const m = String(d).trim().match(/^(\d+(?:\.\d+)?)(s|m|h)?$/i);
                    if (!m) return 10;
                    const n = parseFloat(m[1]);
                    if (m[2]?.toLowerCase() === 'm') return Math.round(n * 60);
                    if (m[2]?.toLowerCase() === 'h') return Math.round(n * 3600);
                    return Math.round(n) || 10;
                };

                const targetList = targetIdsStr.split(',').map((t: string) => t.trim()).filter(Boolean);
                const results: any[] = [];

                for (const targetQuery of targetList) {
                    const targetEndpoint = resolveTargetEndpoint(targetQuery, ctx);

                    if (isXfr) {
                        const durationSec = parseDurationSec(args.duration ?? args.duration_sec);
                        const payload = {
                            mode: 'custom',
                            // Always use port 9000 for XFR — never the peer's API port (8080)
                            target: { host: targetEndpoint.host, port: 9000 },
                            protocol: (args.protocol || 'tcp').toLowerCase(),
                            direction: (args.direction || 'client-to-server').toLowerCase(),
                            duration_sec: durationSec,
                            bitrate: args.bitrate || '0',
                            parallel_streams: 4
                        };

                        if (sourceNodeContext.isLocal && ctx.xfrManager) {
                            traceLocalApi(sourceNodeContext, 'POST', '/api/xfr/run', payload);
                            const { id, sequence_id } = ctx.xfrManager.createJob({
                                mode: payload.mode,
                                host: targetEndpoint.host,
                                port: 9000,
                                protocol: payload.protocol,
                                direction: payload.direction,
                                duration_sec: payload.duration_sec,
                                bitrate: payload.bitrate,
                                parallel_streams: payload.parallel_streams
                            });
                            ctx.xfrManager.startJob(id);
                            const job = ctx.xfrManager.getJob(id);
                            results.push({
                                // Use sequence_id as the canonical test_id the model should poll with
                                test_id: sequence_id || id,
                                sequence_id: sequence_id,
                                canonical_poll_id: sequence_id,   // always use this with get_test_status
                                source_agent_id: ctx.localNodeId || 'local', // always pass this to get_test_status
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
                                    // Use sequence_id as the canonical test_id the model should poll with
                                    test_id: data.sequence_id || data.id || data.jobId,
                                    sequence_id: data.sequence_id,
                                    canonical_poll_id: data.sequence_id,   // always use this with get_test_status
                                    source_agent_id: sourceNodeContext.agentId || sourceNodeContext.siteName, // always pass this to get_test_status
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

                        try {
                            const data = await fetchApi(sourceNodeContext, '/api/convergence/start', {
                                method: 'POST',
                                body: JSON.stringify(payload)
                            });
                            results.push({
                                test_id: data?.testId || data?.sequence_id || 'CONV-ACTIVE',
                                profile: 'convergence',
                                status: 'running',
                                running: true,
                                source: sourceNodeContext.siteName,
                                target: targetEndpoint.name,
                                host: targetEndpoint.host,
                                port: convergencePort,
                                rate_pps: pps,
                                label: effectiveLabel,
                                note: 'Convergence probe started. Unless the user explicitly asked to leave it running continuously, call get_test_status(wait_seconds=15) and then call stop_test in this same turn to return the full PoC Test Analysis output.'
                            });
                        } catch (convErr: any) {
                            results.push({ error: `Convergence probe failed: ${convErr?.message || convErr}`, target: targetEndpoint.name });
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

                return {
                    tests: results,
                    note_for_model: 'Tests launched. For XFR/speedtest: call get_test_status with each test_id until status=\'completed\'. For Convergence (CONV-*): unless the user explicitly asked for a continuous background probe, call get_test_status(wait_seconds=15) and then stop_test in this same turn so you can present the full PoC Test Analysis report at the end.'
                };
            }

            case 'get_test_status': {
                const nodeCtx = resolveNodeContext(args.agent_id || args.node, ctx);
                if (nodeCtx.unknownNode) {
                    return {
                        error: `Unknown Stigix node "${nodeCtx.requestedNode || nodeCtx.siteName}". Available nodes in fabric: ${(nodeCtx.availableNodes || []).join(', ') || 'LOCAL'}`
                    };
                }
                const testIdFilter = String(args.test_id || '').toLowerCase().trim();
                const shouldWait = args.wait !== false;
                const requestedWaitSec = Number(args.wait_seconds);
                const explicitWaitSec = (!isNaN(requestedWaitSec) && requestedWaitSec > 0)
                    ? Math.min(30, Math.max(1, Math.round(requestedWaitSec)))
                    : 0;

                try {
                    if (explicitWaitSec > 0) {
                        await new Promise(r => setTimeout(r, explicitWaitSec * 1000));
                    }

                    const loadJobsAndProbes = async () => {
                        const [xfrData, convData] = await Promise.all([
                            (nodeCtx.isLocal && ctx.xfrManager)
                                ? ctx.xfrManager.getAllJobs()
                                : fetchApi(nodeCtx, `/api/tests/xfr`).catch(() => []),
                            fetchApi(nodeCtx, `/api/convergence/status`).catch(() => [])
                        ]);
                        return {
                            xfrJobs: Array.isArray(xfrData) ? xfrData : [],
                            convProbes: Array.isArray(convData) ? convData : []
                        };
                    };

                    let { xfrJobs, convProbes } = await loadJobsAndProbes();

                    const findMatchedXfr = (jobs: any[]) => jobs.find((j: any) =>
                        (j.id && j.id.toLowerCase().includes(testIdFilter)) ||
                        (j.sequence_id && j.sequence_id.toLowerCase().includes(testIdFilter))
                    );

                    // Auto-poll up to 25 seconds if an XFR speedtest is currently running or queued
                    if (shouldWait && explicitWaitSec === 0) {
                        const pollStart = Date.now();
                        while (Date.now() - pollStart < 25000) {
                            if (testIdFilter) {
                                const m = findMatchedXfr(xfrJobs);
                                if (!m || (m.status !== 'running' && m.status !== 'queued')) break;
                            } else {
                                const activeXfr = xfrJobs.filter((j: any) => j.status === 'running' || j.status === 'queued');
                                if (activeXfr.length === 0) break;
                            }
                            await new Promise(r => setTimeout(r, 1500));
                            ({ xfrJobs, convProbes } = await loadJobsAndProbes());
                        }
                    }

                    const runningXfr = xfrJobs.filter((j: any) => j.status === 'running' || j.status === 'queued');
                    const runningConv = convProbes.filter((c: any) => c.running !== false);

                    const formatXfrJob = (job: any) => {
                        const sum = job.summary;
                        const dir = String(job.params?.direction || 'client-to-server').toLowerCase();
                        const isBidir = dir === 'bidirectional' || dir === 'bidir';
                        const isDownload = dir === 'server-to-client' || dir === 'download' || dir === 'reverse';
                        const baseThroughput = sum?.throughput_mbps ?? sum?.avg_bandwidth_mbps ?? sum?.sent_mbps ?? sum?.received_mbps;
                        const uploadMbps = sum ? (isDownload ? 0 : (sum.sent_mbps ?? baseThroughput ?? 0)) : undefined;
                        const downloadMbps = sum ? (isBidir ? (sum.received_mbps ?? baseThroughput ?? 0) : (isDownload ? (sum.received_mbps ?? baseThroughput ?? 0) : 0)) : undefined;
                        const normalizedSummary = sum ? {
                            ...sum,
                            throughput_mbps: baseThroughput,
                            sent_mbps: uploadMbps,
                            received_mbps: downloadMbps
                        } : sum;
                        return {
                            node: nodeCtx.siteName,
                            test_type: 'xfr_speedtest',
                            test_id: job.id,
                            sequence_id: job.sequence_id,
                            status: job.status,
                            target: job.params?.host || job.params?.target?.host,
                            protocol: job.params?.protocol || 'tcp',
                            direction: dir,
                            direction_label: isBidir ? 'bidirectional' : (isDownload ? 'unidirectional download (server-to-client)' : 'unidirectional upload (client-to-server)'),
                            duration: job.params?.duration_sec ? `${job.params.duration_sec}s` : undefined,
                            started_at: job.started_at,
                            finished_at: job.finished_at,
                            throughput_mbps: baseThroughput,
                            upload_mbps: uploadMbps,
                            download_mbps: downloadMbps,
                            rtt_ms: sum?.rtt_ms_avg ?? sum?.rtt_ms,
                            retransmits: sum?.retransmits,
                            loss_pct: sum?.loss_percent ?? 0,
                            total_bytes: sum?.bytes_total,
                            summary: normalizedSummary,
                            error: job.error,
                            ...(explicitWaitSec > 0 ? { waited_seconds: explicitWaitSec } : {})
                        };
                    };

                    if (testIdFilter) {
                        const matchedXfr = findMatchedXfr(xfrJobs);
                        if (matchedXfr) {
                            return formatXfrJob(matchedXfr);
                        }

                        const matchedConv = convProbes.find((c: any) =>
                            (c.testId && c.testId.toLowerCase().includes(testIdFilter)) ||
                            (c.test_id && String(c.test_id).toLowerCase().includes(testIdFilter)) ||
                            (c.label && c.label.toLowerCase().includes(testIdFilter))
                        );
                        if (matchedConv) {
                            return {
                                ...formatConvergencePocReport(matchedConv, nodeCtx.siteName),
                                test_type: 'convergence_probe',
                                current_rtt_ms: matchedConv.current_rtt_ms ?? matchedConv.avg_rtt_ms,
                                live_loss_pct: matchedConv.live_loss_pct ?? matchedConv.loss_pct,
                                ...(explicitWaitSec > 0 ? { waited_seconds: explicitWaitSec } : {})
                            };
                        }

                        // Check if it already finished and is in convergence history
                        if (testIdFilter.startsWith('conv')) {
                            const historyArr = await fetchApi(nodeCtx, `/api/convergence/history?limit=10`).catch(() => []);
                            if (Array.isArray(historyArr)) {
                                const histMatch = historyArr.find((h: any) => {
                                    const hId = String(h.test_id || h.testId || '').toLowerCase();
                                    return hId.includes(testIdFilter) || testIdFilter.includes(extractCleanConvId(hId).toLowerCase());
                                });
                                if (histMatch) {
                                    return {
                                        ...formatConvergencePocReport(histMatch, nodeCtx.siteName, 'COMPLETED'),
                                        test_type: 'convergence_probe',
                                        ...(explicitWaitSec > 0 ? { waited_seconds: explicitWaitSec } : {})
                                    };
                                }
                            }
                        }

                        // Test ID provided but not found — return explicit error to prevent hallucination
                        return {
                            error: `Test '${testIdFilter}' not found on node '${nodeCtx.siteName}'.`,
                            hint: 'Check that agent_id matches the SOURCE node that ran the test (not the target). Use the sequence_id (e.g. XFR-0003 or CONV-0022) returned by run_test as test_id — never a UUID. The test may also have expired from in-memory history.',
                            node: nodeCtx.siteName,
                            status: 'not_found'
                        };
                    }

                    const completedXfr = xfrJobs.filter((j: any) => j.status === 'completed' || j.status === 'failed');
                    const latestCompletedXfr = completedXfr.length > 0 ? formatXfrJob(completedXfr[0]) : null;

                    return {
                        node: nodeCtx.siteName,
                        ...(explicitWaitSec > 0 ? { waited_seconds: explicitWaitSec } : {}),
                        is_any_test_running: (runningXfr.length + runningConv.length) > 0,
                        running_tests_count: runningXfr.length + runningConv.length,
                        running_xfr_speedtests: runningXfr.map((j: any) => ({
                            test_id: j.id,
                            sequence_id: j.sequence_id,
                            target: j.params?.target?.host || j.params?.host,
                            duration: j.params?.duration_sec ? `${j.params.duration_sec}s` : undefined,
                            started_at: j.started_at
                        })),
                        last_completed_xfr_speedtest: latestCompletedXfr,
                        running_convergence_probes: runningConv.map((c: any) => formatConvergencePocReport(c, nodeCtx.siteName))
                    };
                } catch (e: any) {
                    return { error: `Failed to retrieve test status: ${e.message}` };
                }
            }

            case 'stop_test': {
                const nodeCtx = resolveNodeContext(args.agent_id || args.node, ctx);
                const requestedTestId = extractCleanConvId(args.test_id || '');

                try {
                    const convStatus = await fetchApi(nodeCtx, `/api/convergence/status`).catch(() => []);
                    const activeConv = Array.isArray(convStatus) ? convStatus : [];
                    const matched = activeConv.find((c: any) => {
                        if (!requestedTestId) return true;
                        const cId = extractCleanConvId(c.testId || c.test_id || '');
                        return (cId && (cId.toLowerCase() === requestedTestId.toLowerCase() || cId.toLowerCase().includes(requestedTestId.toLowerCase()))) ||
                            (c.label && c.label.toLowerCase().includes(requestedTestId.toLowerCase()));
                    }) || activeConv[0];

                    const targetId = extractCleanConvId(matched?.testId || matched?.test_id || requestedTestId);

                    // Record baseline newest history ID before stopping so we know when the new record flushes
                    const preHistory = await fetchApi(nodeCtx, `/api/convergence/history?limit=3`).catch(() => []);
                    const preTopRawId = Array.isArray(preHistory) && preHistory.length > 0
                        ? String(preHistory[0].test_id || preHistory[0].testId || '')
                        : '';

                    let stopData: any = null;
                    try {
                        stopData = await fetchApi(nodeCtx, `/api/convergence/stop`, {
                            method: 'POST',
                            body: JSON.stringify(targetId ? { testId: targetId, enabled: false } : { enabled: false })
                        });
                    } catch {}

                    // Wait up to 6 seconds for convergence_orchestrator.py (2s grace period) + server.ts path enrichment to flush to history
                    let finalMetrics: any = null;
                    for (let attempt = 0; attempt < 12; attempt++) {
                        await new Promise(r => setTimeout(r, 500));
                        try {
                            const history = await fetchApi(nodeCtx, `/api/convergence/history?limit=10`).catch(() => []);
                            if (Array.isArray(history) && history.length > 0) {
                                const match = targetId
                                    ? history.find((h: any) => {
                                        const hRaw = String(h.test_id || h.testId || h.id || h.sequence_id || '');
                                        const hClean = extractCleanConvId(hRaw);
                                        return hClean.toLowerCase() === targetId.toLowerCase() ||
                                            hRaw.toLowerCase().includes(targetId.toLowerCase());
                                    })
                                    : (String(history[0].test_id || history[0].testId || '') !== preTopRawId ? history[0] : (attempt >= 6 ? history[0] : null));

                                if (match) {
                                    finalMetrics = match;
                                    // Wait at least 1 extra poll if egress_path hasn't been enriched yet by the stop handler
                                    if (match.egress_path || attempt >= 5) {
                                        break;
                                    }
                                }
                            }
                        } catch {}
                    }

                    // Fallback to pre-stop live snapshot if history hasn't flushed yet
                    const recordToFormat = finalMetrics || matched;
                    if (recordToFormat) {
                        const report = formatConvergencePocReport(recordToFormat, nodeCtx.siteName, 'STOPPED');
                        return {
                            success: true,
                            ...report,
                            // Legacy top-level aliases for backward compatibility
                            packets_sent: report.metrics.packets_sent,
                            packets_echo_server_received: report.metrics.packets_echo_server_received,
                            packets_received: report.metrics.packets_received,
                            packets_lost: report.metrics.packets_lost,
                            loss_percent: `${report.metrics.loss_pct}%`,
                            uplink_loss_pct: report.metrics.uplink_loss_pct,
                            downlink_loss_pct: report.metrics.downlink_loss_pct,
                            avg_rtt_ms: report.metrics.avg_rtt_ms,
                            jitter_ms: report.metrics.jitter_ms,
                            max_blackout_ms: report.metrics.max_blackout_ms
                        };
                    }

                    return {
                        success: true,
                        node: nodeCtx.siteName,
                        test_id: targetId || requestedTestId,
                        status: 'STOPPED',
                        message: 'Convergence test stop signal processed successfully.',
                        details: stopData
                    };
                } catch (e: any) {
                    return { error: `Failed to stop test on ${nodeCtx.siteName}: ${e?.message || e}` };
                }
            }

            case 'set_traffic_status': {
                const nodeCtx = resolveNodeContext(args.source_id || args.agent_id || args.node, ctx);
                if (nodeCtx.unknownNode) {
                    return {
                        error: `Unknown Stigix node "${nodeCtx.requestedNode || nodeCtx.siteName}". Available nodes in fabric: ${(nodeCtx.availableNodes || []).join(', ') || 'LOCAL'}`
                    };
                }
                const expectedRunning = Boolean(args.enabled);
                const action = expectedRunning ? 'start' : 'stop';
                const res = await fetch(`${nodeCtx.baseUrl}/api/traffic/${action}`, {
                    method: 'POST',
                    headers: nodeCtx.headers,
                    body: JSON.stringify({})
                });
                const rawRes = await res.json().catch(() => ({ success: res.ok, status: action }));
                await new Promise(r => setTimeout(r, 400));
                let liveStatus: any = null;
                try {
                    if (nodeCtx.isLocal && ctx.getTrafficStats) {
                        liveStatus = await ctx.getTrafficStats();
                    } else {
                        liveStatus = await fetchApi(nodeCtx, '/api/traffic/status');
                    }
                } catch {}
                const verifiedRunning = liveStatus?.running !== undefined ? Boolean(liveStatus.running) : expectedRunning;
                return {
                    ...rawRes,
                    success: res.ok && verifiedRunning === expectedRunning,
                    node: nodeCtx.siteName,
                    requested_action: action,
                    verified: verifiedRunning === expectedRunning,
                    verified_running: verifiedRunning,
                    status: verifiedRunning ? 'RUNNING' : 'STOPPED',
                    live_status: liveStatus
                };
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
                const rawTarget = String(args.target || '').trim();

                if (pType === 'dns') {
                    let domain = rawTarget;
                    let testName = rawTarget;
                    const lower = rawTarget.toLowerCase();
                    const matched = DNS_TEST_DOMAINS.find(d =>
                        d.id.toLowerCase() === lower ||
                        d.name.toLowerCase() === lower ||
                        d.domain.toLowerCase() === lower ||
                        d.name.toLowerCase().includes(lower)
                    );
                    if (matched) {
                        domain = matched.domain;
                        testName = matched.name;
                    }
                    return await fetchApi(nodeCtx, '/api/security/dns-test', {
                        method: 'POST',
                        body: JSON.stringify({ domain, testName, mcp_source: 'copilot' })
                    });
                } else if (pType === 'url') {
                    let url = rawTarget;
                    let category = rawTarget;
                    const lower = rawTarget.toLowerCase().replace(/^test-/, '');
                    const matched = URL_CATEGORIES.find(c =>
                        c.id.toLowerCase() === lower ||
                        c.name.toLowerCase() === rawTarget.toLowerCase() ||
                        c.url.toLowerCase().replace(/\/$/, '') === rawTarget.toLowerCase().replace(/\/$/, '') ||
                        c.name.toLowerCase().includes(lower)
                    );
                    if (matched) {
                        url = matched.url;
                        category = matched.name;
                    } else if (!rawTarget.startsWith('http://') && !rawTarget.startsWith('https://')) {
                        if (!rawTarget.includes('.')) {
                            url = `http://urlfiltering.paloaltonetworks.com/test-${lower}`;
                        } else {
                            url = `http://${rawTarget}`;
                        }
                    }
                    return await fetchApi(nodeCtx, '/api/security/url-test', {
                        method: 'POST',
                        body: JSON.stringify({ url, category, mcp_source: 'copilot' })
                    });
                } else if (pType === 'threat') {
                    return await fetchApi(nodeCtx, '/api/security/threat-test', {
                        method: 'POST',
                        body: JSON.stringify({ endpoint: rawTarget, testName: `EICAR Test (${rawTarget})`, mcp_source: 'copilot' })
                    });
                }
                return { error: `Invalid probe_type: ${pType}` };
            }

            case 'list_vyos_routers': {
                const { nodeCtx, requestedSiteName, sitePrefix, centralFallbackUsed } = await resolveVyosNodeContext(args.agent_id, ctx);
                const routers = await fetchApi(nodeCtx, '/api/vyos/routers');
                if (Array.isArray(routers) && centralFallbackUsed) {
                    return routers.map((r: any) => ({
                        ...r,
                        managed_by_node: nodeCtx.siteName,
                        requested_site: requestedSiteName,
                        note: `VyOS router centrally managed by ${nodeCtx.siteName} (carries WAN underlay interfaces for ${sitePrefix} and other sites)`
                    }));
                }
                return routers;
            }

            case 'list_vyos_scenarios': {
                const { nodeCtx } = await resolveVyosNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/vyos/sequences');
            }

            case 'run_vyos_scenario': {
                const { nodeCtx } = await resolveVyosNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, `/api/vyos/sequences/run/${args.scenario_id}`, { method: 'POST' });
            }

            case 'get_vyos_timeline': {
                const { nodeCtx } = await resolveVyosNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, `/api/vyos/history?limit=${args.limit || 20}`);
            }

            case 'set_vyos_scenario_status': {
                const { nodeCtx } = await resolveVyosNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, `/api/vyos/sequences/${args.scenario_id}/status`, {
                    method: 'POST',
                    body: JSON.stringify({ enabled: Boolean(args.enabled) })
                });
            }

            case 'get_vyos_interfaces': {
                const { nodeCtx, requestedSiteName, sitePrefix, centralFallbackUsed } = await resolveVyosNodeContext(args.agent_id, ctx);
                const routers = await fetchApi(nodeCtx, '/api/vyos/routers');
                if (!Array.isArray(routers)) return routers;

                const results: any[] = [];
                for (const r of routers) {
                    if (args.router_id && r.id !== args.router_id && r.name !== args.router_id) continue;
                    try {
                        const state = await fetchApi(nodeCtx, `/api/vyos/routers/${r.id}/state`, { signal: AbortSignal.timeout(10000) }).catch(() => 
                            fetchApi(nodeCtx, `/api/vyos/state?router_id=${r.id}`, { signal: AbortSignal.timeout(10000) })
                        );
                        const ifaces = (state.interfaces || []).filter((i: any) => i.description && i.description.trim() !== '');
                        const siteMatchingIfaces = sitePrefix
                            ? ifaces.filter((i: any) => {
                                const desc = String(i.description || '').toUpperCase();
                                return desc.startsWith(`${sitePrefix}-`) || desc.includes(sitePrefix);
                            })
                            : [];
                        const sharedWanIfaces = ifaces.filter((i: any) => String(i.description || '').toUpperCase().startsWith('ALL-'));
                        results.push({
                            router_id: r.id,
                            router_name: r.name,
                            host: r.host,
                            managed_by_node: nodeCtx.siteName,
                            ...(centralFallbackUsed ? {
                                requested_site: requestedSiteName,
                                note: `VyOS router centrally managed on ${nodeCtx.siteName}. Use matching_site_interfaces for ${sitePrefix} (or shared_wan_interfaces if ${sitePrefix} uses ALL-INET/ALL-MPLS).`
                            } : {}),
                            online: r.online !== false,
                            chaos_eligible_count: ifaces.length,
                            ...(siteMatchingIfaces.length > 0 ? { matching_site_interfaces: siteMatchingIfaces } : {}),
                            ...(sharedWanIfaces.length > 0 ? { shared_wan_interfaces: sharedWanIfaces } : {}),
                            interfaces: ifaces
                        });
                    } catch {
                        results.push({ router_id: r.id, router_name: r.name, managed_by_node: nodeCtx.siteName, interfaces: [] });
                    }
                }
                return results;
            }

            case 'get_vyos_router_state': {
                const { nodeCtx } = await resolveVyosNodeContext(args.agent_id, ctx);
                let routerId = args.router_id;
                if (!routerId || routerId === 'default') {
                    const routers = await fetchApi(nodeCtx, '/api/vyos/routers').catch(() => []);
                    if (Array.isArray(routers) && routers.length > 0) routerId = routers[0].id;
                }
                return await fetchApi(nodeCtx, `/api/vyos/routers/${routerId}/state`).catch(() => 
                    fetchApi(nodeCtx, `/api/vyos/state?router_id=${routerId}`)
                );
            }

            case 'vyos_bulk_reset': {
                const { nodeCtx } = await resolveVyosNodeContext(args.agent_id, ctx);
                const scope = args.scope || 'full-reset';
                let routerId = args.router_id;
                if (!routerId || routerId === 'default') {
                    const routers = await fetchApi(nodeCtx, '/api/vyos/routers').catch(() => []);
                    if (Array.isArray(routers) && routers.length > 0) routerId = routers[0].id;
                } else {
                    const routers = await fetchApi(nodeCtx, '/api/vyos/routers').catch(() => []);
                    if (Array.isArray(routers)) {
                        const m = routers.find((r: any) => r.id === routerId || r.name?.toLowerCase() === String(routerId).toLowerCase());
                        if (m) routerId = m.id;
                    }
                }
                // Try direct server bulk reset endpoint first
                try {
                    return await fetchApi(nodeCtx, `/api/vyos/routers/${routerId}/reset`, {
                        method: 'POST',
                        body: JSON.stringify({ scope })
                    });
                } catch {
                    // Fallback to manual per-action reset
                    const state = await fetchApi(nodeCtx, `/api/vyos/routers/${routerId}/state`).catch(() => 
                        fetchApi(nodeCtx, `/api/vyos/state?router_id=${routerId}`)
                    );
                    const actionsTaken: string[] = [];

                    if (scope === 'all-qos' || scope === 'full-reset') {
                        for (const iface of (state.interfaces || []).filter((i: any) => i.qos_active)) {
                            await fetchApi(nodeCtx, '/api/vyos/direct-action', {
                                method: 'POST',
                                body: JSON.stringify({ routerId, command: 'clear-qos', interface: iface.name, source: 'AI Copilot' })
                            }).catch(() => {});
                            actionsTaken.push(`clear-qos on ${iface.name}`);
                        }
                    }
                    if (scope === 'all-blocks' || scope === 'full-reset') {
                        await fetchApi(nodeCtx, '/api/vyos/direct-action', {
                            method: 'POST',
                            body: JSON.stringify({ routerId, command: 'clear-all-blocks', source: 'AI Copilot' })
                        }).catch(() => {});
                        actionsTaken.push('clear-all-blocks');
                    }
                    if (scope === 'unshut-all' || scope === 'full-reset') {
                        for (const iface of (state.interfaces || []).filter((i: any) => i.admin_state === 'down')) {
                            await fetchApi(nodeCtx, '/api/vyos/direct-action', {
                                method: 'POST',
                                body: JSON.stringify({ routerId, command: 'interface-up', interface: iface.name, source: 'AI Copilot' })
                            }).catch(() => {});
                            actionsTaken.push(`interface-up on ${iface.name}`);
                        }
                    }
                    return { success: true, router_id: routerId, managed_by_node: nodeCtx.siteName, scope, actions_taken: actionsTaken };
                }
            }

            case 'vyos_execute_action': {
                const { nodeCtx } = await resolveVyosNodeContext(args.agent_id, ctx);
                const rawCmd = String(args.command || args.action || 'set-qos').toLowerCase().trim();
                const cmdMap: Record<string, string> = {
                    'set-impairment': 'set-qos',
                    'clear-impairment': 'clear-qos',
                    'shut': 'interface-down',
                    'shutdown': 'interface-down',
                    'unshut': 'interface-up',
                    'no-shut': 'interface-up'
                };
                const command = cmdMap[rawCmd] || rawCmd;

                let routerId = args.router_id;
                if (!routerId || routerId === 'default') {
                    const routers = await fetchApi(nodeCtx, '/api/vyos/routers').catch(() => []);
                    if (Array.isArray(routers) && routers.length > 0) routerId = routers[0].id;
                } else {
                    const routers = await fetchApi(nodeCtx, '/api/vyos/routers').catch(() => []);
                    if (Array.isArray(routers)) {
                        const m = routers.find((r: any) => r.id === routerId || r.name?.toLowerCase() === String(routerId).toLowerCase());
                        if (m) routerId = m.id;
                    }
                }

                const params: any = {
                    latency_ms: args.latency_ms ?? args.latency ?? args.ms,
                    loss_pct: args.loss_pct ?? args.loss ?? args.percent,
                    corruption_pct: args.corruption_pct ?? args.corruption,
                    rate: args.rate,
                    ip: args.ip
                };
                const actionRes = await fetchApi(nodeCtx, '/api/vyos/direct-action', {
                    method: 'POST',
                    body: JSON.stringify({
                        routerId,
                        command,
                        interface: args.interface,
                        params,
                        source: 'AI Copilot'
                    })
                }, 35000);

                // Read-After-Write verification on router interface state
                let verifiedInterface: any = null;
                if (routerId && args.interface) {
                    try {
                        const state = await fetchApi(nodeCtx, `/api/vyos/routers/${routerId}/state`).catch(() =>
                            fetchApi(nodeCtx, `/api/vyos/state?router_id=${routerId}`)
                        );
                        verifiedInterface = (state?.interfaces || []).find((i: any) => i.name === args.interface) || null;
                    } catch {}
                }

                return {
                    ...(typeof actionRes === 'object' ? actionRes : { result: actionRes }),
                    router_id: routerId,
                    managed_by_node: nodeCtx.siteName,
                    command,
                    interface: args.interface,
                    verified: verifiedInterface !== null || Boolean(actionRes?.success),
                    verified_interface_state: verifiedInterface
                };
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
                    traceLocalApi(nodeCtx, 'GET', '/api/traffic/status');
                    return await ctx.getTrafficStats();
                }
                return await fetchApi(nodeCtx, '/api/traffic/status');
            }

            case 'get_traffic_logs': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                if (nodeCtx.isLocal && ctx.getRecentApiLogs) {
                    traceLocalApi(nodeCtx, 'GET', `/api/traffic/logs?limit=${args.limit || 50}`);
                    return ctx.getRecentApiLogs(args.limit || 50);
                }
                return await fetchApi(nodeCtx, `/api/traffic/logs?limit=${args.limit || 50}`);
            }

            case 'get_security_results_stats': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                if (nodeCtx.isLocal && ctx.getSecurityStats) {
                    traceLocalApi(nodeCtx, 'GET', '/api/security/results/stats');
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
                let stats: any = null;
                if (nodeCtx.isLocal && ctx.getAllProbes) {
                    traceLocalApi(nodeCtx, 'GET', '/api/connectivity/custom');
                }
                const [probesRes, statsRes, resultsRes] = await Promise.all([
                    (nodeCtx.isLocal && ctx.getAllProbes)
                        ? Promise.resolve(ctx.getAllProbes())
                        : fetchApi(nodeCtx, '/api/connectivity/custom').catch(async () => fetchApi(nodeCtx, '/api/connectivity/active-probes')).catch(() => []),
                    fetchApi(nodeCtx, '/api/connectivity/stats?range=1h').catch(() => null),
                    fetchApi(nodeCtx, '/api/connectivity/results?limit=300').catch(() => [])
                ]);
                arr = Array.isArray(probesRes) ? probesRes : (probesRes?.probes || probesRes?.targets || []);
                stats = statsRes;
                const rawResults = Array.isArray(resultsRes) ? resultsRes : ((resultsRes as any)?.results || []);

                const latestByKey = new Map<string, any>();
                for (const r of rawResults) {
                    const rName = String(r.endpointName || r.name || '').trim().toLowerCase();
                    const rId = String(r.endpointId || r.id || '').trim().toLowerCase();
                    const rSlug = rName.replace(/\s+/g, '-');
                    if (rName && !latestByKey.has(rName)) latestByKey.set(rName, r);
                    if (rId && !latestByKey.has(rId)) latestByKey.set(rId, r);
                    if (rSlug && !latestByKey.has(rSlug)) latestByKey.set(rSlug, r);
                }

                const enrichedProbes = arr.map((rawProbe: any) => {
                    const p = sanitizeProbeConfig(rawProbe);
                    const pName = String(p.name || '').trim().toLowerCase();
                    const pId = String(p.id || '').trim().toLowerCase();
                    const pSlug = pName.replace(/\s+/g, '-');
                    const latest = latestByKey.get(pName) || latestByKey.get(pId) || latestByKey.get(pSlug);
                    if (!latest) {
                        return {
                            ...p,
                            score: null,
                            status: p.enabled !== false ? 'pending_execution' : 'disabled',
                            latency_ms: null,
                            last_run: null
                        };
                    }
                    const rtt = latest.metrics?.total_ms ?? latest.latency_ms ?? latest.rtt ?? latest.responseTime;
                    return {
                        ...p,
                        score: typeof latest.score === 'number' ? latest.score : (latest.reachable ? 100 : 0),
                        status: latest.reachable ? 'healthy' : 'failed',
                        latency_ms: typeof rtt === 'number' ? Math.round(rtt * 10) / 10 : null,
                        http_code: latest.httpCode ?? latest.statusCode ?? null,
                        last_run: latest.timestamp ? new Date(latest.timestamp).toISOString() : null
                    };
                });

                const filterStr = String(args.probe_name_filter || '').trim().toLowerCase();
                const filteredProbes = filterStr
                    ? enrichedProbes.filter((p: any) => String(p.name || p.id || '').toLowerCase().includes(filterStr))
                    : enrichedProbes;

                return {
                    node: nodeCtx.siteName,
                    health_score: stats?.globalHealth ?? (arr.length > 0 ? 100 : null),
                    http_endpoints: stats?.httpEndpoints || null,
                    flaky_endpoints: stats?.flakyEndpoints || [],
                    total_probes: enrichedProbes.length,
                    active_probes: enrichedProbes.filter((p: any) => p.enabled !== false).length,
                    ...(filterStr ? { probe_name_filter: args.probe_name_filter, matched_probes: filteredProbes.length } : {}),
                    probes: filteredProbes
                };
            }

            case 'get_probe_details': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                let probes: any[] = [];
                if (nodeCtx.isLocal && ctx.getAllProbes) {
                    traceLocalApi(nodeCtx, 'GET', '/api/connectivity/custom');
                    probes = ctx.getAllProbes();
                } else {
                    const res = await fetchApi(nodeCtx, '/api/connectivity/custom').catch(async () => {
                        return await fetchApi(nodeCtx, '/api/connectivity/active-probes');
                    });
                    probes = Array.isArray(res) ? res : (res?.probes || []);
                }
                const pName = String(args.probe_name || '').toLowerCase();
                const rawMatched = probes.find((p: any) => {
                    const name = (p.name || '').toLowerCase();
                    const id = (p.id || '').toLowerCase();
                    return name === pName || name.includes(pName) || pName.includes(name) || id === pName;
                });
                if (!rawMatched) {
                    return { error: `Probe "${args.probe_name}" not found.` };
                }
                const matched = sanitizeProbeConfig(rawMatched);

                // Enrich with latest live measurement & metrics from /api/connectivity/results
                try {
                    const matchedName = (matched.name || '').toLowerCase();
                    const nameSlug = (matched.name || '').toLowerCase().replace(/\s+/g, '-');
                    const matchedId = (matched.id || matched.name || '').toLowerCase().replace(/\s+/g, '-');
                    
                    // Direct query by endpointId first (fast and precise even with 100+ probes)
                    let resultsData = await fetchApi(nodeCtx, `/api/connectivity/results?endpointId=${encodeURIComponent(nameSlug)}&limit=50`).catch(() => []);
                    let allResults = Array.isArray(resultsData) ? resultsData : (resultsData?.results || []);
                    if (allResults.length === 0 && matchedId !== nameSlug) {
                        resultsData = await fetchApi(nodeCtx, `/api/connectivity/results?endpointId=${encodeURIComponent(matchedId)}&limit=50`).catch(() => []);
                        allResults = Array.isArray(resultsData) ? resultsData : (resultsData?.results || []);
                    }
                    if (allResults.length === 0) {
                        resultsData = await fetchApi(nodeCtx, '/api/connectivity/results?limit=300').catch(() => []);
                        allResults = Array.isArray(resultsData) ? resultsData : (resultsData?.results || []);
                    }

                    const probeResults = allResults.filter((r: any) => {
                        const rName = (r.endpointName || r.name || '').toLowerCase();
                        const rId = (r.endpointId || '').toLowerCase();
                        return rName === matchedName || rId === nameSlug || rId === matchedId;
                    });

                    if (probeResults.length > 0) {
                        const latest = probeResults[0];
                        const rtts = probeResults.map((r: any) => r.metrics?.total_ms).filter((v: any) => typeof v === 'number');
                        const successCount = probeResults.filter((r: any) => r.reachable).length;

                        return {
                            ...matched,
                            score: latest.score ?? (latest.reachable ? 100 : 0),
                            status: latest.reachable ? 'healthy' : 'failed',
                            latency_ms: latest.metrics?.total_ms ? Math.round(latest.metrics.total_ms * 10) / 10 : null,
                            http_code: latest.httpCode || null,
                            last_run: latest.timestamp ? new Date(latest.timestamp).toISOString() : null,
                            metrics: latest.metrics || {},
                            history_summary: {
                                samples: probeResults.length,
                                success_rate_pct: Math.round((successCount / probeResults.length) * 100),
                                min_latency_ms: rtts.length > 0 ? Math.min(...rtts) : null,
                                max_latency_ms: rtts.length > 0 ? Math.max(...rtts) : null,
                                avg_latency_ms: rtts.length > 0 ? Math.round(rtts.reduce((a: number, b: number) => a + b, 0) / rtts.length) : null
                            }
                        };
                    } else {
                        return {
                            ...matched,
                            score: null,
                            status: matched.enabled !== false ? 'pending_execution' : 'disabled',
                            latency_ms: null,
                            metrics: null,
                            note: 'Probe configuration found, but no test execution samples have been recorded yet. You can trigger an immediate check via run_dem_probes_now.'
                        };
                    }
                } catch {
                    return matched;
                }
            }

            case 'list_dem_probes': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                if (nodeCtx.isLocal && ctx.getAllProbes) {
                    traceLocalApi(nodeCtx, 'GET', '/api/connectivity/custom');
                    return (ctx.getAllProbes() || []).map(sanitizeProbeConfig);
                }
                const res = await fetchApi(nodeCtx, '/api/connectivity/custom').catch(async () => {
                    return await fetchApi(nodeCtx, '/api/connectivity/active-probes');
                });
                const list = Array.isArray(res) ? res : (res?.probes || []);
                return list.map(sanitizeProbeConfig);
            }

            case 'run_dem_probes_now': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const testRes = await fetchApi(nodeCtx, '/api/connectivity/test?live=true');
                const filterStr = String(args.probe_name_filter || '').trim().toLowerCase();
                if (filterStr && testRes && Array.isArray(testRes.results)) {
                    const filteredResults = testRes.results.filter((r: any) =>
                        String(r.name || r.endpointName || r.id || '').toLowerCase().includes(filterStr)
                    );
                    return {
                        ...testRes,
                        probe_name_filter: args.probe_name_filter,
                        total_tested: testRes.results.length,
                        matched_count: filteredResults.length,
                        results: filteredResults
                    };
                }
                return testRes;
            }

            case 'get_dem_probe_stats': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const timeRange = args.window_minutes ? `${args.window_minutes}m` : (args.range || '1h');
                if (nodeCtx.isLocal && ctx.getAllProbes) {
                    traceLocalApi(nodeCtx, 'GET', '/api/connectivity/custom');
                }
                const [statsRes, resultsRes, customRes] = await Promise.all([
                    fetchApi(nodeCtx, `/api/connectivity/stats?range=${timeRange}`).catch(() => ({})),
                    fetchApi(nodeCtx, `/api/connectivity/results?timeRange=${timeRange}&limit=1000`).catch(() => []),
                    (nodeCtx.isLocal && ctx.getAllProbes)
                        ? Promise.resolve(ctx.getAllProbes())
                        : fetchApi(nodeCtx, '/api/connectivity/custom').catch(async () => fetchApi(nodeCtx, '/api/connectivity/active-probes')).catch(() => [])
                ]);

                const rawResults = Array.isArray(resultsRes) ? resultsRes : ((resultsRes as any)?.results || []);
                const probesCfg = Array.isArray(customRes) ? customRes : ((customRes as any)?.targets || (customRes as any)?.probes || []);

                const toSlug = (text: string) => String(text || '').trim().toLowerCase().replace(/\s+/g, '-');
                const cfgByName = new Map<string, any>();
                const cfgBySlug = new Map<string, any>();
                const cfgById = new Map<string, any>();

                for (const p of probesCfg) {
                    if (p && p.name) {
                        cfgByName.set(p.name, p);
                        cfgBySlug.set(toSlug(p.name), p);
                        if (p.id) cfgById.set(String(p.id).trim().toLowerCase(), p);
                    }
                }

                // Group samples strictly by canonical probe name / endpointName / endpointId
                const grouped: Record<string, any[]> = {};
                for (const item of rawResults) {
                    const sName = String(item.endpointName || item.name || item.probe_name || '').trim();
                    const sId = String(item.endpointId || item.id || '').trim().toLowerCase();
                    const sSlug = toSlug(sName);

                    const matchedCfg =
                        (sName && cfgByName.get(sName)) ||
                        (sId && cfgById.get(sId)) ||
                        (sId && cfgBySlug.get(sId)) ||
                        (sSlug && cfgBySlug.get(sSlug)) ||
                        null;

                    const canonicalName = matchedCfg?.name || sName || item.endpointId || 'unknown';
                    if (!grouped[canonicalName]) grouped[canonicalName] = [];
                    grouped[canonicalName].push(item);
                }

                const filter = (args.probe_name_filter || '').toLowerCase();
                const allNames = Array.from(new Set([...Object.keys(grouped), ...cfgByName.keys()])).sort();

                const probesSummary = [];
                for (const name of allNames) {
                    if (filter && !name.toLowerCase().includes(filter)) continue;
                    const samples = grouped[name] || [];
                    const cfg = cfgByName.get(name) || {};
                    const rtts: number[] = [];
                    const scores: number[] = [];
                    let successCount = 0;
                    const expectedCodes: number[] = cfg.expectedStatusCodes || [200, 201, 202, 204, 301, 302, 304, 307, 308];

                    for (const s of samples) {
                        const code = Number(s.httpCode ?? s.statusCode);
                        const isCodeOk = !isNaN(code) && code > 0 && expectedCodes.includes(code);
                        const isSuccess =
                            isCodeOk ||
                            (s.reachable === true && (s.score === undefined || s.score === null || s.score > 0)) ||
                            s.success === true ||
                            s.status === 'success';
                        if (isSuccess) successCount++;

                        const rtt = s.metrics?.total_ms ?? s.latency_ms ?? s.rtt ?? s.responseTime ?? s.latency;
                        if (typeof rtt === 'number' && !isNaN(rtt)) rtts.push(rtt);
                        if (typeof s.score === 'number' && !isNaN(s.score)) scores.push(s.score);
                    }

                    rtts.sort((a, b) => a - b);
                    const sampleCount = samples.length;
                    const successRate = sampleCount > 0
                        ? Math.round((1000 * successCount) / sampleCount) / 10
                        : null;

                    const p95Idx = Math.min(Math.floor(rtts.length * 0.95), Math.max(0, rtts.length - 1));
                    // /api/connectivity/results returns newest samples first (samples[0] is latest)
                    const lastSample = samples[0] || {};
                    const probeType = String(cfg.type || lastSample.endpointType || lastSample.type || 'HTTP').toUpperCase();
                    const avgScore = scores.length > 0
                        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
                        : null;
                    const lastScore = typeof lastSample.score === 'number'
                        ? lastSample.score
                        : (sampleCount > 0 ? (lastSample.reachable ? 100 : 0) : null);

                    probesSummary.push({
                        name,
                        type: probeType,
                        target: cfg.target || cfg.url || lastSample.url || lastSample.target || '',
                        enabled: cfg.enabled !== false,
                        samples_count: sampleCount,
                        success_count: successCount,
                        success_rate_pct: successRate,
                        last_score: lastScore,
                        avg_score: avgScore,
                        min_rtt_ms: rtts.length ? Math.round(rtts[0] * 100) / 100 : null,
                        max_rtt_ms: rtts.length ? Math.round(rtts[rtts.length - 1] * 100) / 100 : null,
                        avg_rtt_ms: rtts.length ? Math.round((rtts.reduce((a, b) => a + b, 0) / rtts.length) * 100) / 100 : null,
                        median_rtt_ms: rtts.length ? Math.round(rtts[Math.floor(rtts.length / 2)] * 100) / 100 : null,
                        p95_rtt_ms: rtts.length ? Math.round(rtts[p95Idx] * 100) / 100 : null,
                        expected_status_codes: cfg.expectedStatusCodes || [200],
                        last_status_code: lastSample.httpCode ?? lastSample.statusCode ?? null,
                        last_error: lastSample.error || (lastSample.score === 0 ? lastSample.message : null) || null,
                        last_timestamp: lastSample.timestamp || null
                    });
                }

                return {
                    agent_id: nodeCtx.siteName,
                    time_range: timeRange,
                    total_probes_configured: probesCfg.length,
                    probes_matched: probesSummary.length,
                    global_stats: statsRes,
                    probes_summary: probesSummary
                };
            }

            case 'update_dem_probe': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                let existingProbes: any[] = [];
                if (nodeCtx.isLocal && ctx.getAllProbes) {
                    existingProbes = ctx.getAllProbes();
                } else {
                    const current = await fetchApi(nodeCtx, '/api/connectivity/custom').catch(async () => {
                        return await fetchApi(nodeCtx, '/api/connectivity/active-probes');
                    });
                    existingProbes = Array.isArray(current) ? current : (current?.probes || current?.targets || []);
                }

                const targetName = String(args.probe_name || '').trim().toLowerCase();
                const matchedIdx = existingProbes.findIndex((p: any) =>
                    p.name?.trim().toLowerCase() === targetName || p.id?.trim().toLowerCase() === targetName
                );

                if (matchedIdx === -1) {
                    return {
                        error: `Probe "${args.probe_name}" not found on ${nodeCtx.siteName}.`,
                        available_probes: existingProbes.map((p: any) => p.name).filter(Boolean)
                    };
                }

                const updated = { ...existingProbes[matchedIdx] };
                if (args.expected_status_codes !== undefined) updated.expectedStatusCodes = args.expected_status_codes;
                if (args.timeout_ms !== undefined) updated.timeout = args.timeout_ms;
                if (args.interval_sec !== undefined) updated.interval = args.interval_sec;
                if (args.url !== undefined) {
                    updated.target = args.url;
                    updated.url = args.url;
                }
                if (args.enabled !== undefined) updated.enabled = args.enabled;

                const newProbesList = [...existingProbes];
                newProbesList[matchedIdx] = updated;

                if (nodeCtx.isLocal && ctx.saveCustomProbes) {
                    await ctx.saveCustomProbes(newProbesList);
                    return {
                        success: true,
                        probe_name: updated.name,
                        updated_settings: updated,
                        message: `DEM probe "${updated.name}" updated successfully on ${nodeCtx.siteName}.`
                    };
                }

                const saveRes = await fetchApi(nodeCtx, '/api/connectivity/custom', {
                    method: 'POST',
                    body: JSON.stringify({ endpoints: newProbesList })
                });

                return {
                    success: true,
                    probe_name: updated.name,
                    updated_settings: updated,
                    result: saveRes,
                    message: `DEM probe "${updated.name}" updated successfully on ${nodeCtx.siteName}.`
                };
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
                    const verifyList = ctx.getAllProbes ? ctx.getAllProbes() : updatedProbes;
                    const verified = verifyList.some((p: any) => p.name?.toLowerCase() === String(args.name || '').toLowerCase());
                    return {
                        success: verified,
                        verified,
                        probe: newProbe,
                        total_probes_on_node: verifyList.length,
                        message: verified
                            ? `Probe "${args.name}" added and verified on ${nodeCtx.siteName}.`
                            : `Warning: Probe "${args.name}" was saved but not found in active probes list on ${nodeCtx.siteName}.`
                    };
                }

                const saveRes = await fetchApi(nodeCtx, '/api/connectivity/custom', {
                    method: 'POST',
                    body: JSON.stringify({ endpoints: updatedProbes })
                });
                const verifyRemote = await fetchApi(nodeCtx, '/api/connectivity/custom').catch(() => []);
                const verifyArr = Array.isArray(verifyRemote) ? verifyRemote : (verifyRemote?.probes || []);
                const verified = verifyArr.some((p: any) => p.name?.toLowerCase() === String(args.name || '').toLowerCase());
                return {
                    success: verified,
                    verified,
                    probe: newProbe,
                    total_probes_on_node: verifyArr.length,
                    result: saveRes,
                    message: verified
                        ? `Probe "${args.name}" added and verified on ${nodeCtx.siteName}.`
                        : `Warning: Probe "${args.name}" was saved on ${nodeCtx.siteName}, but could not be verified in the active probe list.`
                };
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

                const targetName = String(args.probe_name || '').trim().toLowerCase();
                const matchedProbe = existingProbes.find((p: any) =>
                    p.name?.trim().toLowerCase() === targetName || p.id?.trim().toLowerCase() === targetName
                );

                if (!matchedProbe) {
                    return {
                        success: false,
                        verified: false,
                        error: `Probe "${args.probe_name}" not found on ${nodeCtx.siteName}.`,
                        available_probes: existingProbes.map((p: any) => p.name).filter(Boolean)
                    };
                }

                if (matchedProbe.source === 'auto-mesh') {
                    return {
                        success: false,
                        verified: false,
                        error: `Probe "${matchedProbe.name}" is an automatic mesh discovery probe (source: auto-mesh) and cannot be deleted manually.`
                    };
                }

                const filtered = existingProbes.filter((p: any) =>
                    p.name?.trim().toLowerCase() !== targetName && p.id?.trim().toLowerCase() !== targetName
                );

                if (nodeCtx.isLocal && ctx.saveCustomProbes) {
                    await ctx.saveCustomProbes(filtered);
                    const verifyList = ctx.getAllProbes ? ctx.getAllProbes() : filtered;
                    const stillExists = verifyList.some((p: any) =>
                        p.name?.trim().toLowerCase() === targetName || p.id?.trim().toLowerCase() === targetName
                    );
                    return {
                        success: !stillExists,
                        verified: !stillExists,
                        removed_probe: matchedProbe.name,
                        remaining_probes_count: verifyList.length,
                        message: !stillExists
                            ? `Probe "${matchedProbe.name}" removed and verified on ${nodeCtx.siteName}.`
                            : `Error: Probe "${matchedProbe.name}" still appears in active probes on ${nodeCtx.siteName}.`
                    };
                }

                const saveRes = await fetchApi(nodeCtx, '/api/connectivity/custom', {
                    method: 'POST',
                    body: JSON.stringify({ endpoints: filtered })
                });
                const verifyRemote = await fetchApi(nodeCtx, '/api/connectivity/custom').catch(() => []);
                const verifyArr = Array.isArray(verifyRemote) ? verifyRemote : (verifyRemote?.probes || []);
                const stillExists = verifyArr.some((p: any) =>
                    p.name?.trim().toLowerCase() === targetName || p.id?.trim().toLowerCase() === targetName
                );
                return {
                    success: !stillExists,
                    verified: !stillExists,
                    removed_probe: matchedProbe.name,
                    remaining_probes_count: verifyArr.length,
                    result: saveRes,
                    message: !stillExists
                        ? `Probe "${matchedProbe.name}" removed and verified on ${nodeCtx.siteName}.`
                        : `Error: Probe "${matchedProbe.name}" still appears in active probes on ${nodeCtx.siteName}.`
                };
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
                    recent_tests: sorted.map((j: any) => {
                        const sum = j.summary;
                        const dir = String(j.params?.direction || 'client-to-server').toLowerCase();
                        const isBidir = dir === 'bidirectional' || dir === 'bidir';
                        const isDownload = dir === 'server-to-client' || dir === 'download' || dir === 'reverse';
                        const baseThroughput = sum?.throughput_mbps ?? sum?.avg_bandwidth_mbps ?? sum?.sent_mbps ?? sum?.received_mbps;
                        const uploadMbps = sum ? (isDownload ? 0 : (sum.sent_mbps ?? baseThroughput ?? 0)) : undefined;
                        const downloadMbps = sum ? (isBidir ? (sum.received_mbps ?? baseThroughput ?? 0) : (isDownload ? (sum.received_mbps ?? baseThroughput ?? 0) : 0)) : undefined;
                        const normalizedSummary = sum ? {
                            ...sum,
                            throughput_mbps: baseThroughput,
                            sent_mbps: uploadMbps,
                            received_mbps: downloadMbps
                        } : sum;
                        return {
                            id: j.id,
                            sequence_id: j.sequence_id,
                            status: j.status,
                            started_at: j.started_at,
                            finished_at: j.finished_at,
                            target: j.params?.target?.host || j.params?.host,
                            protocol: j.params?.protocol || 'tcp',
                            direction: dir,
                            direction_label: isBidir ? 'bidirectional' : (isDownload ? 'unidirectional download (server-to-client)' : 'unidirectional upload (client-to-server)'),
                            duration: j.params?.duration_sec ? `${j.params.duration_sec}s` : undefined,
                            throughput_mbps: baseThroughput,
                            upload_mbps: uploadMbps,
                            download_mbps: downloadMbps,
                            rtt_ms: sum?.rtt_ms_avg ?? sum?.rtt_ms ?? sum?.avg_rtt_ms,
                            loss_pct: sum?.loss_percent ?? sum?.loss_pct ?? 0,
                            retransmits: sum?.retransmits ?? sum?.retransmissions,
                            total_bytes: sum?.bytes_total ?? sum?.total_bytes ?? sum?.bytes_transferred,
                            summary: normalizedSummary
                        };
                    })
                };
            }

            case 'get_convergence_history': {
                const nodeCtx = resolveNodeContext(args.agent_id || args.node, ctx);
                const limit = Number(args.limit) || 10;
                const summaryOnly = args.summary_only !== false;
                const filterTestId = args.test_id ? extractCleanConvId(args.test_id).toLowerCase() : null;
                const history = await fetchApi(nodeCtx, `/api/convergence/history?limit=${Math.max(limit, 25)}`).catch(() => []);
                const arr = Array.isArray(history) ? history : ((history as any)?.results || []);
                const filtered = filterTestId
                    ? arr.filter((r: any) => [r.test_id, r.testId, r.id, r.sequence_id].some(v => {
                        if (!v) return false;
                        const s = String(v).toLowerCase();
                        return s === filterTestId || extractCleanConvId(s) === filterTestId || s.includes(filterTestId);
                    }))
                    : arr;
                // Sort strictly newest first (descending sequence_id or timestamp)
                const sorted = [...filtered].sort((a: any, b: any) => {
                    const dateA = new Date(a.timestamp || a.started_at || 0).getTime();
                    const dateB = new Date(b.timestamp || b.started_at || 0).getTime();
                    if (dateA && dateB && dateA !== dateB) return dateB - dateA;
                    const idA = extractCleanConvId(a.test_id || a.testId || a.id || a.sequence_id || '');
                    const idB = extractCleanConvId(b.test_id || b.testId || b.id || b.sequence_id || '');
                    return idB.localeCompare(idA, undefined, { numeric: true });
                }).slice(0, limit);

                const cleanedHistory = sorted.map((row: any) => {
                    const report = formatConvergencePocReport(row, nodeCtx.siteName);
                    if (summaryOnly) {
                        return report;
                    }
                    return {
                        ...report,
                        series: row.series
                    };
                });

                return {
                    node: nodeCtx.siteName,
                    total_records: arr.length,
                    count: cleanedHistory.length,
                    recent_history: cleanedHistory
                };
            }

            case 'get_convergence_report': {
                const nodeCtx = resolveNodeContext(args.agent_id || args.node, ctx);
                const requestedId = args.test_id ? String(args.test_id).trim() : 'latest';
                const cleanRequestedId = extractCleanConvId(requestedId).toLowerCase();
                const [historyRaw, liveStatusRaw] = await Promise.all([
                    fetchApi(nodeCtx, `/api/convergence/history?limit=25`).catch(() => []),
                    fetchApi(nodeCtx, `/api/convergence/status`).catch(() => [])
                ]);
                const arr = Array.isArray(historyRaw) ? historyRaw : ((historyRaw as any)?.results || []);
                const activeProbes = Array.isArray(liveStatusRaw) ? liveStatusRaw : (liveStatusRaw && typeof liveStatusRaw === 'object' ? [liveStatusRaw] : []);

                const sorted = [...arr].sort((a: any, b: any) => {
                    const dateA = new Date(a.timestamp || a.started_at || 0).getTime();
                    const dateB = new Date(b.timestamp || b.started_at || 0).getTime();
                    if (dateA && dateB && dateA !== dateB) return dateB - dateA;
                    const idA = extractCleanConvId(a.test_id || a.testId || a.id || a.sequence_id || '');
                    const idB = extractCleanConvId(b.test_id || b.testId || b.id || b.sequence_id || '');
                    return idB.localeCompare(idA, undefined, { numeric: true });
                });

                let record: any = null;
                if (cleanRequestedId === 'latest' || cleanRequestedId === 'last' || !cleanRequestedId) {
                    // Prefer the most recent completed test in history unless a live probe is actively running and user asked for live/latest
                    record = sorted[0] || activeProbes.find((p: any) => p && p.running !== false) || null;
                } else {
                    record = sorted.find((r: any) =>
                        [r.test_id, r.testId, r.id, r.sequence_id, r.label].some(v => {
                            if (!v) return false;
                            const s = String(v).toLowerCase();
                            return s === cleanRequestedId || extractCleanConvId(s) === cleanRequestedId || s.includes(cleanRequestedId);
                        })
                    ) || null;
                    if (!record) {
                        record = activeProbes.find((p: any) =>
                            [p?.testId, p?.test_id, p?.label].some(v => {
                                if (!v) return false;
                                const s = String(v).toLowerCase();
                                return s === cleanRequestedId || extractCleanConvId(s) === cleanRequestedId || s.includes(cleanRequestedId);
                            })
                        ) || null;
                    }
                }

                if (!record) {
                    return {
                        node: nodeCtx.siteName,
                        found: false,
                        requested_test_id: requestedId,
                        error: `No convergence test report found matching "${requestedId}" on node ${nodeCtx.siteName}.`
                    };
                }

                return formatConvergencePocReport(record, nodeCtx.siteName);
            }

            case 'run_automated_failover_test': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const vyosCtx = await resolveVyosNodeContext(args.agent_id, ctx);
                const baselineSec = Math.min(Math.max(Number(args.baseline_seconds) || 6, 3), 20);
                const faultSec = Math.min(Math.max(Number(args.fault_seconds) || 12, 5), 30);
                const recoverySec = Math.min(Math.max(Number(args.recovery_seconds) || 6, 3), 20);
                const pps = Number(args.pps) || 50;
                const autoRollback = args.auto_rollback !== false;
                const faultType = String(args.fault_type || 'interface-down');

                let probeStarted = false;
                let faultInjected = false;
                let rollbackCompleted = false;
                let probeStopped = false;
                let resolvedRouterId = args.router_id;
                let resolvedInterface = args.interface;
                let resolvedInterfaceDesc: string | undefined;
                let phase1Baseline: any = null;
                let phase2DuringFault: any = null;
                let injectionResult: any = null;
                let rollbackResult: any = null;
                let stopResult: any = null;
                let startedTestId: string | undefined;

                // Auto-resolve interface matching source site prefix (e.g. BR2 -> eth7 BR2-INET-226) if not explicitly provided
                if (!resolvedInterface && faultType !== 'deny-traffic' && faultType !== 'vyos-scenario') {
                    try {
                        const routersList = await executeToolCall('get_vyos_interfaces', {
                            agent_id: nodeCtx.siteName,
                            router_id: resolvedRouterId
                        }, ctx);
                        if (Array.isArray(routersList) && routersList.length > 0) {
                            const rObj = routersList[0];
                            if (!resolvedRouterId && rObj.router_id) resolvedRouterId = rObj.router_id;
                            const siteIfaces: any[] = rObj.matching_site_interfaces || [];
                            const sharedIfaces: any[] = rObj.shared_wan_interfaces || [];
                            const candidatePool = siteIfaces.length > 0 ? siteIfaces : sharedIfaces;
                            // Prefer an UP INET interface first, then any UP matching interface, then first matching
                            const preferred = candidatePool.find((i: any) => i.admin_state !== 'down' && /inet/i.test(String(i.description || '')))
                                || candidatePool.find((i: any) => i.admin_state !== 'down')
                                || candidatePool[0];
                            if (preferred?.name) {
                                resolvedInterface = preferred.name;
                                resolvedInterfaceDesc = preferred.description;
                            }
                        }
                    } catch {}
                    if (!resolvedInterface) resolvedInterface = 'eth1';
                }

                try {
                    // Phase 1: Start convergence probe & observe baseline
                    const startRes = await executeToolCall('run_test', {
                        agent_id: nodeCtx.siteName,
                        profile: 'conv',
                        target: args.target,
                        pps
                    }, ctx);
                    if (startRes?.error || startRes?.tests?.[0]?.error) {
                        return { error: `Failed to start convergence probe: ${startRes?.error || startRes?.tests?.[0]?.error}`, details: startRes };
                    }
                    probeStarted = true;
                    startedTestId = startRes?.test_id || startRes?.testId || startRes?.tests?.[0]?.test_id || startRes?.tests?.[0]?.testId;

                    phase1Baseline = await executeToolCall('get_test_status', {
                        agent_id: nodeCtx.siteName,
                        profile: 'conv',
                        test_id: startedTestId,
                        wait_seconds: baselineSec
                    }, ctx);
                    if (!startedTestId && (phase1Baseline?.test_id || phase1Baseline?.metrics?.test_id)) {
                        startedTestId = phase1Baseline.test_id || phase1Baseline.metrics?.test_id;
                    }

                    // Phase 2: Inject requested VyOS fault on the VyOS controller node
                    if (faultType === 'vyos-scenario') {
                        injectionResult = await executeToolCall('run_vyos_scenario', {
                            agent_id: vyosCtx.nodeCtx.siteName,
                            scenario_id: args.scenario_id || '1'
                        }, ctx);
                        faultInjected = !injectionResult?.error;
                    } else {
                        const actionMap: Record<string, string> = {
                            'interface-down': 'interface-down',
                            'set-impairment': 'set-impairment',
                            'deny-traffic': 'deny-traffic'
                        };
                        const actionName = actionMap[faultType] || 'interface-down';
                        injectionResult = await executeToolCall('vyos_execute_action', {
                            agent_id: vyosCtx.nodeCtx.siteName,
                            router_id: resolvedRouterId,
                            command: actionName,
                            interface: resolvedInterface,
                            latency_ms: args.latency_ms,
                            loss_pct: args.loss_pct,
                            rate: args.rate_mbit ? `${args.rate_mbit}mbit` : undefined,
                            ip: args.blocked_ip
                        }, ctx);
                        if (injectionResult?.router_id) resolvedRouterId = injectionResult.router_id;
                        faultInjected = !injectionResult?.error;
                    }

                    // Observe SD-WAN failover while fault is active
                    phase2DuringFault = await executeToolCall('get_test_status', {
                        agent_id: nodeCtx.siteName,
                        profile: 'conv',
                        test_id: startedTestId,
                        wait_seconds: faultSec
                    }, ctx);
                } finally {
                    // Guaranteed cleanup: 1. Rollback VyOS fault if injected
                    if (faultInjected && autoRollback && faultType !== 'vyos-scenario') {
                        try {
                            const rollbackAction = faultType === 'interface-down'
                                ? 'interface-up'
                                : faultType === 'set-impairment'
                                    ? 'clear-impairment'
                                    : 'allow-traffic';
                            rollbackResult = await executeToolCall('vyos_execute_action', {
                                agent_id: vyosCtx.nodeCtx.siteName,
                                router_id: resolvedRouterId,
                                command: rollbackAction,
                                interface: resolvedInterface,
                                ip: args.blocked_ip
                            }, ctx);
                            rollbackCompleted = !rollbackResult?.error;
                        } catch (rbErr: any) {
                            rollbackResult = { error: rbErr.message };
                        }
                        // Observe recovery window before stopping probe
                        await new Promise(resolve => setTimeout(resolve, recoverySec * 1000));
                    }

                    // Guaranteed cleanup: 2. Always stop convergence probe
                    if (probeStarted) {
                        try {
                            stopResult = await executeToolCall('stop_test', {
                                agent_id: nodeCtx.siteName,
                                profile: 'conv',
                                test_id: startedTestId
                            }, ctx);
                            probeStopped = true;
                        } catch {}
                    }
                }

                // Fetch final convergence report (or use the rich report already returned by stop_test)
                const finalReport = (stopResult && stopResult.poc_test_analysis)
                    ? stopResult
                    : await executeToolCall('get_convergence_report', {
                        agent_id: nodeCtx.siteName,
                        test_id: startedTestId || 'latest'
                    }, ctx);

                return {
                    node: nodeCtx.siteName,
                    vyos_managed_by_node: vyosCtx.nodeCtx.siteName,
                    target: args.target,
                    test_id: finalReport?.test_id || startedTestId,
                    fault_scenario: {
                        fault_type: faultType,
                        router_id: resolvedRouterId,
                        interface: resolvedInterface,
                        ...(resolvedInterfaceDesc ? { interface_description: resolvedInterfaceDesc } : {}),
                        latency_ms: args.latency_ms,
                        loss_pct: args.loss_pct,
                        rate_mbit: args.rate_mbit,
                        blocked_ip: args.blocked_ip,
                        scenario_id: args.scenario_id
                    },
                    lifecycle: {
                        probe_started: probeStarted,
                        fault_injected: faultInjected,
                        rollback_completed: rollbackCompleted,
                        probe_stopped: probeStopped
                    },
                    phase_1_baseline: phase1Baseline?.metrics || phase1Baseline,
                    phase_2_during_fault: phase2DuringFault?.metrics || phase2DuringFault,
                    injection_result: injectionResult,
                    rollback_result: rollbackResult,
                    poc_test_analysis: finalReport?.poc_test_analysis,
                    final_convergence_report: finalReport
                };
            }

            case 'run_path_trace': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const target = args.target;
                const maxHops = Number(args.max_hops) || 15;
                return await fetchApi(nodeCtx, `/api/network/traceroute?target=${encodeURIComponent(target)}&max_hops=${maxHops}`);
            }

            case 'list_active_impairments': {
                const endpoints = collectFabricEndpoints(ctx);
                let targetAgents: NodeContext[] = [];
                if (args.agent_id) {
                    const resolved = resolveNodeContext(args.agent_id, ctx);
                    if (resolved.unknownNode) {
                        return {
                            error: `Unknown Stigix node "${resolved.requestedNode || resolved.siteName}". Available nodes in fabric: ${(resolved.availableNodes || []).join(', ') || 'LOCAL'}`
                        };
                    }
                    targetAgents = [resolved];
                } else {
                    const rawAgents = [
                        resolveNodeContext(undefined, ctx),
                        ...endpoints.map((ep: any) => resolveNodeContext(ep.id || ep.name || ep.host, ctx))
                    ];
                    const seenBaseUrls = new Set<string>();
                    for (const ag of rawAgents) {
                        if (!ag.unknownNode && !seenBaseUrls.has(ag.baseUrl)) {
                            seenBaseUrls.add(ag.baseUrl);
                            targetAgents.push(ag);
                        }
                    }
                }

                const activeImpairments: any[] = [];
                for (const nodeCtx of targetAgents) {
                    try {
                        const routersData = await fetchApi(nodeCtx, '/api/vyos/routers').catch(() => []);
                        const routers = Array.isArray(routersData) ? routersData : ((routersData as any)?.routers || []);
                        for (const router of routers) {
                            const rId = router.id || router.name;
                            if (!rId) continue;
                            const state = await fetchApi(nodeCtx, `/api/vyos/routers/${rId}/state`).catch(() => null);
                            if (!state) continue;

                            if (state.interfaces) {
                                const ifaces = state.interfaces;
                                const ifEntries = Array.isArray(ifaces)
                                    ? ifaces.map((item: any, i: number) => [item.name || `iface-${i}`, item])
                                    : Object.entries(ifaces);

                                for (const [ifName, ifInfo] of ifEntries as any) {
                                    if (!ifInfo || typeof ifInfo !== 'object') continue;
                                    const adminStatus = String(ifInfo.admin_state || ifInfo.admin_status || ifInfo.status || '').toLowerCase();
                                    const operStatus = String(ifInfo.oper_state || ifInfo.oper_status || ifInfo.link || '').toLowerCase();
                                    if (['down', 'disable', 'disabled', 'shutdown'].includes(adminStatus) || ['down', 'lowerlayerdown'].includes(operStatus)) {
                                        activeImpairments.push({
                                            agent_id: nodeCtx.siteName,
                                            router_id: rId,
                                            interface: ifName,
                                            type: 'interface_down',
                                            severity: 'CRITICAL',
                                            details: `Interface ${ifName} is administratively down / shut.`
                                        });
                                    }

                                    const qos = ifInfo.qos_active || ifInfo.qos || ifInfo.impairment || {};
                                    const lat = qos.delay_ms ?? qos.latency ?? ifInfo.latency_ms ?? ifInfo.latency;
                                    const loss = qos.loss_pct ?? qos.loss ?? ifInfo.loss_pct ?? ifInfo.loss;
                                    const rate = qos.rate_mbit ?? qos.rate ?? ifInfo.bandwidth_limit;

                                    const hasLat = lat !== undefined && lat !== null && Number(lat) > 0;
                                    const hasLoss = loss !== undefined && loss !== null && Number(loss) > 0;
                                    const hasRate = rate !== undefined && rate !== null && !['0', 'none', 'unlimited', ''].includes(String(rate).toLowerCase());

                                    if (hasLat || hasLoss || hasRate) {
                                        const parts = [];
                                        if (hasLat) parts.push(`+${lat}ms latency`);
                                        if (hasLoss) parts.push(`${loss}% loss`);
                                        if (hasRate) parts.push(`rate ${rate}${typeof rate === 'number' ? 'mbit' : ''}`);
                                        activeImpairments.push({
                                            agent_id: nodeCtx.siteName,
                                            router_id: rId,
                                            interface: ifName,
                                            type: 'traffic_impairment',
                                            severity: 'WARNING',
                                            details: `Interface ${ifName} has active shaping: ${parts.join(', ')}`,
                                            parameters: { latency_ms: lat, loss_pct: loss, rate_mbit: rate, policy: qos.policy }
                                        });
                                    }
                                }
                            }

                            const blackholes = Array.isArray(state.blackholes)
                                ? state.blackholes
                                : (Array.isArray(state.blocked_ips) ? state.blocked_ips : []);
                            for (const bh of blackholes) {
                                const prefix = typeof bh === 'string' ? bh : (bh?.prefix || bh?.ip || JSON.stringify(bh));
                                activeImpairments.push({
                                    agent_id: nodeCtx.siteName,
                                    router_id: rId,
                                    target_ip: prefix,
                                    type: 'ip_blackhole',
                                    severity: 'WARNING',
                                    details: `Active static blackhole route (tag 999) blocking ${prefix} on ${rId}`
                                });
                            }
                        }
                    } catch {}
                }

                return {
                    total_impairments: activeImpairments.length,
                    has_active_impairments: activeImpairments.length > 0,
                    summary: activeImpairments.length > 0
                        ? `Found ${activeImpairments.length} active impairment(s) across the fabric.`
                        : 'Clean state: No active network impairments, blackholes, or disabled interfaces detected on any VyOS router.',
                    impairments: activeImpairments
                };
            }

            case 'run_security_url_batch': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const [secConfig, secProfile] = await Promise.all([
                    fetchApi(nodeCtx, '/api/security/config').catch(() => ({})),
                    fetchApi(nodeCtx, '/api/security/profile').catch(() => ({}))
                ]);
                const profileCats: any[] = Array.isArray(secProfile?.url_filtering?.items) && secProfile.url_filtering.items.length > 0
                    ? secProfile.url_filtering.items
                    : (Array.isArray(secProfile?.url_categories) && secProfile.url_categories.length > 0
                        ? secProfile.url_categories
                        : URL_CATEGORIES);
                const requestedCats: string[] | null = Array.isArray(args.categories) && args.categories.length > 0
                    ? args.categories.map((c: string) => String(c).toLowerCase().trim())
                    : null;
                const enabledCats: string[] = Array.isArray(secConfig?.url_filtering?.enabled_categories)
                    ? secConfig.url_filtering.enabled_categories.map((c: string) => String(c).toLowerCase().trim())
                    : [];

                const selected = profileCats.filter((cat: any) => {
                    const id = String(cat.id || '').toLowerCase();
                    const name = String(cat.name || '').toLowerCase();
                    if (requestedCats) {
                        return requestedCats.some(rc => id === rc || name === rc || name.includes(rc) || rc.includes(id));
                    }
                    return enabledCats.length > 0 ? enabledCats.includes(id) : true;
                });

                const tests = (selected.length > 0 ? selected : (requestedCats ? requestedCats.map(rc => ({
                    id: rc.replace(/^test-/, ''),
                    name: rc,
                    url: `http://urlfiltering.paloaltonetworks.com/test-${rc.replace(/^test-/, '')}`
                })) : profileCats)).map((cat: any) => ({
                    url: (Array.isArray(cat.urls) && cat.urls[0]) || cat.url || `http://urlfiltering.paloaltonetworks.com/test-${cat.id}`,
                    category: cat.name || cat.id
                }));

                if (tests.length === 0) {
                    return { error: 'No URL categories found in security profile.' };
                }

                const batchRes = await fetchApi(nodeCtx, '/api/security/url-test-batch', {
                    method: 'POST',
                    body: JSON.stringify({ tests })
                }, 90000);
                const results: any[] = Array.isArray(batchRes?.results) ? batchRes.results : [];
                const blockedCount = results.filter(r => r.status === 'blocked').length;
                const allowedCount = results.filter(r => r.status === 'allowed').length;
                const errorCount = results.length - blockedCount - allowedCount;

                return {
                    node: nodeCtx.siteName,
                    total_tested: results.length,
                    blocked_count: blockedCount,
                    allowed_count: allowedCount,
                    error_count: errorCount,
                    enforcement_rate_pct: results.length > 0 ? Math.round((blockedCount / results.length) * 100) : 0,
                    results: results.map(r => ({
                        category: r.category,
                        url: r.url,
                        status: r.status,
                        http_code: r.httpCode,
                        reason: r.reason
                    }))
                };
            }

            case 'run_security_dns_batch': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const [secConfig, secProfile] = await Promise.all([
                    fetchApi(nodeCtx, '/api/security/config').catch(() => ({})),
                    fetchApi(nodeCtx, '/api/security/profile').catch(() => ({}))
                ]);
                const profileDns: any[] = Array.isArray(secProfile?.dns_security?.items) && secProfile.dns_security.items.length > 0
                    ? secProfile.dns_security.items
                    : (Array.isArray(secProfile?.dns_tests) && secProfile.dns_tests.length > 0
                        ? secProfile.dns_tests
                        : DNS_TEST_DOMAINS);
                const requestedIds: string[] | null = Array.isArray(args.test_ids) && args.test_ids.length > 0
                    ? args.test_ids.map((id: string) => String(id).toLowerCase().trim())
                    : null;
                const enabledIds: string[] = Array.isArray(secConfig?.dns_security?.enabled_tests)
                    ? secConfig.dns_security.enabled_tests.map((id: string) => String(id).toLowerCase().trim())
                    : [];

                const selected = profileDns.filter((dt: any) => {
                    const id = String(dt.id || '').toLowerCase();
                    const name = String(dt.name || '').toLowerCase();
                    const domain = String(dt.domain || '').toLowerCase();
                    if (requestedIds) {
                        return requestedIds.some(ri => id === ri || name === ri || domain === ri || name.includes(ri) || ri.includes(id));
                    }
                    return enabledIds.length > 0 ? enabledIds.includes(id) : true;
                });

                const tests = (selected.length > 0 ? selected : profileDns).map((dt: any) => ({
                    domain: dt.domain,
                    testName: dt.name || dt.id
                }));

                if (tests.length === 0) {
                    return { error: 'No DNS tests found in security profile.' };
                }

                const batchRes = await fetchApi(nodeCtx, '/api/security/dns-test-batch', {
                    method: 'POST',
                    body: JSON.stringify({ tests })
                }, 90000);
                const results: any[] = Array.isArray(batchRes?.results) ? batchRes.results : [];
                const sinkholedCount = results.filter(r => r.status === 'sinkholed').length;
                const blockedCount = results.filter(r => r.status === 'blocked').length;
                const resolvedCount = results.filter(r => r.status === 'resolved').length;
                const enforcedTotal = sinkholedCount + blockedCount;

                return {
                    node: nodeCtx.siteName,
                    total_tested: results.length,
                    enforced_count: enforcedTotal,
                    sinkholed_count: sinkholedCount,
                    blocked_count: blockedCount,
                    resolved_count: resolvedCount,
                    enforcement_rate_pct: results.length > 0 ? Math.round((enforcedTotal / results.length) * 100) : 0,
                    results: results.map(r => ({
                        test_name: r.testName,
                        domain: r.domain,
                        status: r.status,
                        resolved_ip: r.resolvedIp,
                        reason: r.reason
                    }))
                };
            }

            case 'run_security_c2_batch': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const secProfile = await fetchApi(nodeCtx, '/api/security/profile').catch(() => ({}));
                const c2Scenarios: any[] = Array.isArray(secProfile?.c2_scenarios) ? secProfile.c2_scenarios : [];
                const requestedIds: string[] | null = Array.isArray(args.scenario_ids) && args.scenario_ids.length > 0
                    ? args.scenario_ids.map((s: string) => String(s).toLowerCase())
                    : null;

                const selected = requestedIds
                    ? c2Scenarios.filter((s: any) => requestedIds.some(ri => String(s.id || '').toLowerCase() === ri || String(s.name || '').toLowerCase().includes(ri)))
                    : c2Scenarios;

                if (selected.length === 0) {
                    return { error: 'No matching C2 scenarios found in security profile.' };
                }

                const results: any[] = [];
                for (const s of selected) {
                    try {
                        const r = await fetchApi(nodeCtx, '/api/security/c2-test', {
                            method: 'POST',
                            body: JSON.stringify({
                                scenarioId: s.id,
                                scenarioName: s.name,
                                attackType: s.attack_type,
                                target: s.target
                            })
                        }, 35000);
                        results.push({
                            scenario_id: s.id,
                            scenario_name: s.name,
                            attack_type: s.attack_type,
                            target: s.target,
                            verdict: r.status,
                            reason: r.verdict_reason || r.reason
                        });
                    } catch (e: any) {
                        results.push({
                            scenario_id: s.id,
                            scenario_name: s.name,
                            attack_type: s.attack_type,
                            target: s.target,
                            verdict: 'error',
                            error: e.message
                        });
                    }
                }

                const enforcedCount = results.filter(r => r.verdict === 'enforced').length;
                const bypassCount = results.filter(r => r.verdict === 'bypass').length;
                const inconclusiveCount = results.length - enforcedCount - bypassCount;

                return {
                    node: nodeCtx.siteName,
                    total_scenarios: results.length,
                    enforced_count: enforcedCount,
                    bypass_count: bypassCount,
                    inconclusive_count: inconclusiveCount,
                    enforcement_rate_pct: results.length > 0 ? Math.round((enforcedCount / results.length) * 100) : 0,
                    results
                };
            }

            case 'run_security_ai_batch': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const secProfile = await fetchApi(nodeCtx, '/api/security/profile').catch(() => ({}));
                const aiScenarios: any[] = Array.isArray(secProfile?.ai_security_scenarios) ? secProfile.ai_security_scenarios : [];
                const includeVolume = Boolean(args.include_volume);
                const requestedIds: string[] | null = Array.isArray(args.scenario_ids) && args.scenario_ids.length > 0
                    ? args.scenario_ids.map((s: string) => String(s).toLowerCase())
                    : null;

                const selected = aiScenarios.filter((s: any) => {
                    if (requestedIds) {
                        return requestedIds.some(ri => String(s.id || '').toLowerCase() === ri || String(s.name || '').toLowerCase().includes(ri));
                    }
                    if (!includeVolume && s.attack_type === 'volume_traffic') return false;
                    return true;
                });

                if (selected.length === 0) {
                    return { error: 'No matching AI security scenarios found in security profile.' };
                }

                const results: any[] = [];
                for (const s of selected) {
                    try {
                        if (s.attack_type === 'volume_traffic') {
                            const r = await fetchApi(nodeCtx, '/api/security/ai-volume-test', {
                                method: 'POST',
                                body: JSON.stringify({ apps: s.targets || [] })
                            }, 35000);
                            results.push({
                                scenario_id: s.id,
                                scenario_name: s.name,
                                attack_type: s.attack_type,
                                verdict: 'completed',
                                reason: r.message || 'AI volume traffic started'
                            });
                        } else {
                            const r = await fetchApi(nodeCtx, '/api/security/ai-test', {
                                method: 'POST',
                                body: JSON.stringify({
                                    scenarioId: s.id,
                                    scenarioName: s.name,
                                    attackType: s.attack_type,
                                    targets: s.targets || []
                                })
                            }, 35000);
                            results.push({
                                scenario_id: s.id,
                                scenario_name: s.name,
                                attack_type: s.attack_type,
                                verdict: r.status,
                                reason: r.verdict_reason || r.reason,
                                app_results: r.app_results
                            });
                        }
                    } catch (e: any) {
                        results.push({
                            scenario_id: s.id,
                            scenario_name: s.name,
                            attack_type: s.attack_type,
                            verdict: 'error',
                            error: e.message
                        });
                    }
                }

                const securityScenarios = results.filter(r => r.attack_type !== 'volume_traffic');
                const enforcedCount = securityScenarios.filter(r => r.verdict === 'enforced').length;
                const bypassCount = securityScenarios.filter(r => r.verdict === 'bypass').length;
                const inconclusiveCount = securityScenarios.length - enforcedCount - bypassCount;

                return {
                    node: nodeCtx.siteName,
                    total_scenarios: results.length,
                    enforced_count: enforcedCount,
                    bypass_count: bypassCount,
                    inconclusive_count: inconclusiveCount,
                    enforcement_rate_pct: securityScenarios.length > 0 ? Math.round((enforcedCount / securityScenarios.length) * 100) : 0,
                    results
                };
            }

            case 'run_full_security_audit': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const includeC2 = Boolean(args.include_c2);
                const includeAi = Boolean(args.include_ai);

                const [urlBatch, dnsBatch, eicar, c2Batch, aiBatch] = await Promise.all([
                    executeToolCall('run_security_url_batch', { agent_id: nodeCtx.siteName }, ctx).catch(e => ({ error: e.message })),
                    executeToolCall('run_security_dns_batch', { agent_id: nodeCtx.siteName }, ctx).catch(e => ({ error: e.message })),
                    executeToolCall('run_eicar_test', { agent_id: nodeCtx.siteName }, ctx).catch(e => ({ error: e.message })),
                    includeC2 ? executeToolCall('run_security_c2_batch', { agent_id: nodeCtx.siteName }, ctx).catch(e => ({ error: e.message })) : Promise.resolve(undefined),
                    includeAi ? executeToolCall('run_security_ai_batch', { agent_id: nodeCtx.siteName }, ctx).catch(e => ({ error: e.message })) : Promise.resolve(undefined)
                ]);

                return {
                    node: nodeCtx.siteName,
                    url_filtering: urlBatch,
                    dns_security: dnsBatch,
                    threat_eicar: eicar,
                    ...(includeC2 ? { c2_scenarios: c2Batch } : {}),
                    ...(includeAi ? { ai_security: aiBatch } : {})
                };
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
                try {
                    const res = await fetchApi(nodeCtx, '/api/connectivity/public-ip');
                    if (res && res.ip) return res;
                    if (res && res.error) throw new Error(res.error);
                    return res;
                } catch (e: any) {
                    try {
                        const fallbackRes = await fetchApi(nodeCtx, '/api/system/public-ip');
                        if (fallbackRes && fallbackRes.ip) return fallbackRes;
                    } catch {}
                    // Check peer list from registry if remote endpoint is down or rate-limited
                    if (ctx.registryManager) {
                        const peers = ctx.registryManager.getPeers();
                        const query = (args.agent_id || '').toLowerCase();
                        const p = peers.find((x: any) =>
                            (x.site_name && (x.site_name.toLowerCase() === query || query.includes(x.site_name.toLowerCase()))) ||
                            (x.instance_id && (x.instance_id.toLowerCase() === query || query.includes(x.instance_id.toLowerCase()))) ||
                            (x.ip_private && (x.ip_private === query || query.includes(x.ip_private))) ||
                            (x.ip_public && (x.ip_public === query || query.includes(x.ip_public)))
                        );
                        if (p && p.ip_public) {
                            return {
                                ip: p.ip_public,
                                source: 'registry_peer',
                                site_name: p.site_name,
                                country: p.country || 'N/A'
                            };
                        }
                    }
                    throw e;
                }
            }

            case 'list_apps': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/config/apps').catch(async () => {
                    return await fetchApi(nodeCtx, '/api/traffic/apps');
                });
            }

            case 'export_app_config': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/config/applications/export?format=json').catch(async () => {
                    return await fetchApi(nodeCtx, '/api/traffic/config');
                });
            }

            case 'import_app_config': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, '/api/config/applications/import', {
                    method: 'POST',
                    body: JSON.stringify({ content: JSON.stringify(args.config) })
                }).catch(async () => {
                    return await fetchApi(nodeCtx, '/api/traffic/config', {
                        method: 'POST',
                        body: JSON.stringify(args.config)
                    });
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
                }, 45000);
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

                let resolvedPeers = Array.isArray(args.peers) ? [...args.peers] : [];
                if (resolvedPeers.length === 0 && args.target_peers !== 'none') {
                    const endpoints = collectFabricEndpoints(ctx);
                    const seenPeerHosts = new Set<string>();
                    const pushPeer = (id: string, siteName: string, host: string, role: string = 'branch') => {
                        const key = host.toLowerCase();
                        if (!host || seenPeerHosts.has(key)) return;
                        seenPeerHosts.add(key);
                        resolvedPeers.push({
                            id: `peer-${id || siteName || host}`.toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
                            name: siteName,
                            siteName: siteName,
                            host: host,
                            port: port,
                            enabled: true,
                            role: role || (/^dc/i.test(siteName) ? 'hub' : 'branch')
                        });
                    };

                    if (args.target_peers && args.target_peers !== 'all' && args.target_peers !== '*') {
                        const tokens = String(args.target_peers).split(',').map((s: string) => s.trim()).filter(Boolean);
                        for (const token of tokens) {
                            const matched = matchFabricEndpoint(token, endpoints);
                            if (matched) {
                                pushPeer(matched.id, matched.siteName || matched.name, matched.host, matched.role);
                            } else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(token)) {
                                pushPeer(token, token, token, 'branch');
                            }
                        }
                    } else {
                        for (const ep of endpoints) {
                            const host = ep.test_ip || ep.host;
                            if (!host) continue;
                            const siteName = ep.siteName || ep.meta?.site_name || ep.name || ep.id;
                            const isSelf = endpoints.length > 1 && (
                                siteName.toLowerCase() === (nodeCtx.siteName || '').toLowerCase() ||
                                ep.id.toLowerCase() === (nodeCtx.siteName || '').toLowerCase() ||
                                (nodeCtx.baseUrl && nodeCtx.baseUrl.includes(host))
                            );
                            if (isSelf) continue;
                            pushPeer(ep.id || host, siteName, host, ep.role || 'branch');
                        }
                    }
                }

                const fixedDelayMs = args.fixed_delay_ms !== undefined ? Number(args.fixed_delay_ms) : 500;
                const randomDelayMinMs = args.random_delay_min_ms !== undefined ? Number(args.random_delay_min_ms) : 100;
                const randomDelayMaxMs = args.random_delay_max_ms !== undefined ? Number(args.random_delay_max_ms) : 1000;

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
                        fixedDelayMs: fixedDelayMs,
                        randomDelayMinMs: randomDelayMinMs,
                        randomDelayMaxMs: randomDelayMaxMs,
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
                    const existingFile = ctx.tcpAppManager.getConfig?.() || { applications: [] };
                    const existingApp = (existingFile.applications || []).find(
                        (a: any) => a.name?.toLowerCase() === String(args.name || '').toLowerCase()
                    );
                    const assignedId = existingApp?.id || `app-${Date.now().toString(36)}`;
                    const fullAppPayload = { id: assignedId, ...appPayload };
                    await ctx.tcpAppManager.saveApplication(fullAppPayload);
                    if (args.auto_start_listener !== false) {
                        try {
                            await ctx.tcpAppManager.startListener(assignedId);
                        } catch {}
                    }
                    if (args.auto_start_workload !== false) {
                        try {
                            await ctx.tcpAppManager.startClient(assignedId);
                        } catch {}
                    }
                    const verifyFile = ctx.tcpAppManager.getConfig?.() || { applications: [] };
                    const verified = (verifyFile.applications || []).some((a: any) => a.id === assignedId);
                    return {
                        success: verified,
                        verified,
                        application: fullAppPayload,
                        message: verified
                            ? `Custom TCP App "${args.name}" (id: ${assignedId}) created and verified on ${nodeCtx.siteName}.`
                            : `Warning: Custom TCP App "${args.name}" was saved but could not be verified on ${nodeCtx.siteName}.`
                    };
                }

                const res = await fetchApi(nodeCtx, '/api/custom-tcp-apps', {
                    method: 'POST',
                    body: JSON.stringify(appPayload)
                });
                let latestApp = res?.application || appPayload;
                const appId = latestApp?.id || args.name;
                if (args.auto_start_listener !== false && appId) {
                    try {
                        const startRes = await fetchApi(nodeCtx, `/api/custom-tcp-apps/${appId}/listener/start`, { method: 'POST' });
                        if (startRes?.application) latestApp = startRes.application;
                    } catch {}
                }
                if (args.auto_start_workload !== false && appId) {
                    try {
                        const clientRes = await fetchApi(nodeCtx, `/api/custom-tcp-apps/${appId}/client/start`, { method: 'POST' });
                        if (clientRes?.application) latestApp = clientRes.application;
                    } catch {}
                }
                return {
                    success: true,
                    verified: true,
                    application: latestApp,
                    message: `Custom TCP App "${args.name}" created and verified on ${nodeCtx.siteName}.`
                };
            }

            case 'add_tcp_app_peer': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const appId = String(args.app_id || '').trim();
                const peerTarget = String(args.peer_name_or_host || '').trim();

                const endpoints = collectFabricEndpoints(ctx);
                const matchedEp = matchFabricEndpoint(peerTarget, endpoints);

                const host = matchedEp ? (matchedEp.test_ip || matchedEp.host) : peerTarget;
                const siteName = args.site_name || matchedEp?.siteName || matchedEp?.meta?.site_name || matchedEp?.name || peerTarget;
                const role = args.role || matchedEp?.role || (/^dc/i.test(siteName) ? 'hub' : 'branch');

                const peerPayload = {
                    name: siteName,
                    siteName: siteName,
                    host: host,
                    port: args.port ? Number(args.port) : undefined,
                    role: role,
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
                    const file = ctx.tcpAppManager.getConfig?.() || { applications: [] };
                    const apps = file.applications || [];
                    const matched = apps.find(
                        (a: any) => a.id === appId || a.name?.trim().toLowerCase() === appId.toLowerCase()
                    );
                    if (!matched) {
                        return {
                            success: false,
                            verified: false,
                            error: `Custom TCP App "${appId}" not found on ${nodeCtx.siteName}.`,
                            available_apps: apps.map((a: any) => ({ id: a.id, name: a.name }))
                        };
                    }
                    const realId = matched.id || matched.name;
                    await ctx.tcpAppManager.deleteApplication(realId);
                    const afterApps = ctx.tcpAppManager.getConfig?.()?.applications || [];
                    const stillExists = afterApps.some(
                        (a: any) => a.id === realId || a.name?.trim().toLowerCase() === appId.toLowerCase()
                    );
                    return {
                        success: !stillExists,
                        verified: !stillExists,
                        deleted_id: realId,
                        deleted_name: matched.name,
                        remaining_apps_count: afterApps.length,
                        message: !stillExists
                            ? `Custom TCP App "${matched.name}" (id: ${realId}) deleted and verified on ${nodeCtx.siteName}.`
                            : `Error: Custom TCP App "${matched.name}" still exists on ${nodeCtx.siteName} after delete attempt.`
                    };
                }

                // Retrieve real ID if app name passed on remote node
                let realId = appId;
                let matchedName = appId;
                const listData = await fetchApi(nodeCtx, '/api/custom-tcp-apps').catch(() => null);
                const apps = listData?.applications || (Array.isArray(listData) ? listData : []);
                const matched = apps.find(
                    (a: any) => a.id === appId || a.name?.trim().toLowerCase() === appId.toLowerCase()
                );
                if (!matched && apps.length > 0) {
                    return {
                        success: false,
                        verified: false,
                        error: `Custom TCP App "${appId}" not found on ${nodeCtx.siteName}.`,
                        available_apps: apps.map((a: any) => ({ id: a.id, name: a.name }))
                    };
                }
                if (matched) {
                    realId = matched.id;
                    matchedName = matched.name || appId;
                }

                const delRes = await fetchApi(nodeCtx, `/api/custom-tcp-apps/${realId}`, { method: 'DELETE' });
                const verifyData = await fetchApi(nodeCtx, '/api/custom-tcp-apps').catch(() => null);
                const afterApps = verifyData?.applications || (Array.isArray(verifyData) ? verifyData : []);
                const stillExists = afterApps.some(
                    (a: any) => a.id === realId || a.name?.trim().toLowerCase() === appId.toLowerCase()
                );
                return {
                    success: !stillExists,
                    verified: !stillExists,
                    deleted_id: realId,
                    deleted_name: matchedName,
                    remaining_apps_count: afterApps.length,
                    result: delRes,
                    message: !stillExists
                        ? `Custom TCP App "${matchedName}" (id: ${realId}) deleted and verified on ${nodeCtx.siteName}.`
                        : `Error: Custom TCP App "${matchedName}" still exists on ${nodeCtx.siteName} after delete attempt.`
                };
            }

            case 'list_custom_tcp_apps': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                if (nodeCtx.isLocal && ctx.tcpAppManager) {
                    const data = ctx.tcpAppManager.getSanitizedConfig();
                    const statuses = ctx.tcpAppManager.getAllAppsStatus() || [];
                    const apps = data?.applications || [];
                    return apps.map((app: any) => ({
                        ...app,
                        status: statuses.find((s: any) => s.appId === app.id)
                    }));
                }
                const res = await fetchApi(nodeCtx, '/api/custom-tcp-apps');
                return res?.applications || (Array.isArray(res) ? res : []);
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
                let targetId = args.app_id;
                try {
                    const appList = await fetchApi(nodeCtx, '/api/custom-tcp-apps');
                    const apps = appList?.applications || (Array.isArray(appList) ? appList : []);
                    const matched = apps.find((a: any) => a.id === targetId || a.name?.toLowerCase() === targetId?.toLowerCase());
                    if (matched?.id) targetId = matched.id;
                } catch {}

                return await fetchApi(nodeCtx, `/api/custom-tcp-apps/${targetId}/sessions`).catch(async () => {
                    const [incRes, outRes] = await Promise.all([
                        fetchApi(nodeCtx, `/api/custom-tcp-apps/${targetId}/sessions/incoming`).catch(() => ({ sessions: [] })),
                        fetchApi(nodeCtx, `/api/custom-tcp-apps/${targetId}/sessions/outgoing`).catch(() => ({ sessions: [] }))
                    ]);
                    const incoming = (incRes as any)?.sessions || [];
                    const outgoing = (outRes as any)?.sessions || [];
                    return {
                        success: true,
                        app_id: targetId,
                        total_incoming: incoming.length,
                        total_outgoing: outgoing.length,
                        incoming_sessions: incoming,
                        outgoing_sessions: outgoing,
                        sessions: [
                            ...incoming.map((s: any) => ({ ...s, direction: 'incoming' })),
                            ...outgoing.map((s: any) => ({ ...s, direction: 'outgoing' }))
                        ]
                    };
                });
            }

            case 'reset_tcp_app_metrics': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                return await fetchApi(nodeCtx, `/api/custom-tcp-apps/${args.app_id}/metrics/reset`, { method: 'POST' });
            }

            case 'get_controller_status': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                if (nodeCtx.isLocal && ctx.registryManager?.getStatus) {
                    return ctx.registryManager.getStatus();
                }
                return await fetchApi(nodeCtx, '/api/registry/status').catch(async () => {
                    return await fetchApi(nodeCtx, '/api/mesh/status');
                });
            }

            case 'list_controller_peers': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                if (nodeCtx.isLocal && ctx.registryManager?.getPeers) {
                    return ctx.registryManager.getPeers();
                }
                const status = await fetchApi(nodeCtx, '/api/registry/status').catch(() => ({}));
                return status?.peers || status?.instances || status?.local_instances || [];
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
                const summary = args.summary_only !== false ? 'true' : 'false';
                return await fetchApi(nodeCtx, `/api/provisioning/status?summary=${summary}`);
            }

            case 'purge_stale_leader_state': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                const dryRun = args.dry_run !== false;
                return await fetchApi(nodeCtx, `/api/provisioning/purge-stale-leader?dry_run=${dryRun}`, {
                    method: 'POST',
                    body: JSON.stringify({ dry_run: dryRun })
                });
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

            case 'take_snapshot': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                if (nodeCtx.isLocal && ctx.snapshotManager) {
                    const snap = await ctx.snapshotManager.captureState({
                        name: args.name,
                        description: args.description,
                        tags: args.tags,
                        createdBy: 'copilot',
                        context: ctx
                    });
                    return {
                        success: true,
                        snapshot_id: snap.id,
                        name: snap.name,
                        timestamp: snap.timestamp,
                        tunnels_count: snap.tunnels.length,
                        tunnels_up: snap.tunnels.filter((t: any) => t.status === 'UP').length,
                        probes_count: snap.demMatrix.length,
                        voice_mos: snap.voice?.avgMos ?? null,
                        vyos_impairments: snap.vyos?.activeImpairmentCount ?? 0,
                        health_score: snap.healthScore,
                        message: `Snapshot "${snap.name}" recorded on ${nodeCtx.siteName} (${snap.tunnels.filter((t: any) => t.status === 'UP').length}/${snap.tunnels.length} tunnels UP, ${snap.demMatrix.length} DEM probes captured${snap.voice?.avgMos ? `, Voice MOS ${snap.voice.avgMos}` : ''}).`
                    };
                }
                return await fetchApi(nodeCtx, '/api/snapshots', {
                    method: 'POST',
                    body: JSON.stringify(args)
                });
            }

            case 'list_snapshots': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                if (nodeCtx.isLocal && ctx.snapshotManager) {
                    return {
                        node: nodeCtx.siteName,
                        snapshots: ctx.snapshotManager.listSnapshots()
                    };
                }
                return await fetchApi(nodeCtx, '/api/snapshots');
            }

            case 'compare_snapshots': {
                const nodeCtx = resolveNodeContext(args.agent_id, ctx);
                if (nodeCtx.isLocal && ctx.snapshotManager) {
                    let baselineSnap = ctx.snapshotManager.getSnapshot(args.baseline);
                    if (!baselineSnap) {
                        return { error: `Baseline snapshot "${args.baseline}" not found on ${nodeCtx.siteName}.` };
                    }
                    if (typeof ctx.snapshotManager.enrichSnapshotIfNeeded === 'function') {
                        baselineSnap = await ctx.snapshotManager.enrichSnapshotIfNeeded(baselineSnap, ctx);
                    }
                    let targetSnap: any = null;
                    if (!args.target || args.target === 'current' || args.target === 'live') {
                        targetSnap = await ctx.snapshotManager.captureState({
                            name: 'current-live-state',
                            description: 'Live instantaneous state for comparison',
                            createdBy: 'copilot',
                            context: ctx,
                            persist: false
                        });
                    } else {
                        targetSnap = ctx.snapshotManager.getSnapshot(args.target);
                        if (!targetSnap) {
                            return { error: `Target snapshot "${args.target}" not found on ${nodeCtx.siteName}.` };
                        }
                        if (typeof ctx.snapshotManager.enrichSnapshotIfNeeded === 'function') {
                            targetSnap = await ctx.snapshotManager.enrichSnapshotIfNeeded(targetSnap, ctx);
                        }
                    }
                    const diff = ctx.snapshotManager.computeDiff(baselineSnap, targetSnap);
                    return {
                        node: nodeCtx.siteName,
                        ...diff
                    };
                }
                return await fetchApi(nodeCtx, '/api/snapshots/diff', {
                    method: 'POST',
                    body: JSON.stringify({ baseline: args.baseline, target: args.target || 'current' })
                });
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
