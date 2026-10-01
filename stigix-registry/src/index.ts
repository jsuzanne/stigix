/**
 * Stigix Cloudflare Rendezvous Relay (v2.0 - Universal Magic Join Relay)
 * 
 * Provides:
 * 1. GET /realms/:realmHash/stream    - Real-time Server-Sent Events (SSE) push channel for Private Leaders (0 CPU, 0 polling).
 * 2. POST /realms/:realmHash/register - Instant single-shot announcement for joining Cloud VMs (broadcasts to Leader in <10ms).
 * 3. GET /realms/:realmHash/peers     - Ephemeral peer listing fallback (180s TTL in KV).
 * 4. GET /health                      - Service status check.
 */

export interface Env {
    STIGIX_REGISTRY: KVNamespace;
    REGISTRY_API_KEY?: string;
}

interface PeerAnnouncementPayload {
    instance_id: string;
    site_name?: string;
    ip?: string;
    port?: number;
    capabilities?: Record<string, any>;
    tags?: Record<string, any>;
    timestamp?: number;
}

// In-memory active stream subscribers per realm
const realmStreams = new Map<string, Set<ReadableStreamDefaultController>>();

const jsonResponse = (data: any, status = 200) => {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key, X-Realm-Key'
        }
    });
};

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const method = request.method;

        // Handle CORS preflight
        if (method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key, X-Realm-Key'
                }
            });
        }

        try {
            // Healthcheck
            if (url.pathname === '/' || url.pathname === '/health') {
                return jsonResponse({
                    status: 'ok',
                    service: 'stigix-rendezvous-relay',
                    version: '2.0.0',
                    features: ['sse-push-channel', 'instant-rendezvous', 'multi-tenant-realms']
                });
            }

            // Match /realms/:realmHash/stream
            const streamMatch = url.pathname.match(/^\/realms\/([a-zA-Z0-9_-]+)\/stream$/);
            if (streamMatch && method === 'GET') {
                const realmHash = streamMatch[1];
                return handleRealmStream(realmHash, request, env, ctx);
            }

            // Match /realms/:realmHash/register
            const registerMatch = url.pathname.match(/^\/realms\/([a-zA-Z0-9_-]+)\/register$/);
            if (registerMatch && method === 'POST') {
                const realmHash = registerMatch[1];
                return await handleRealmRegister(realmHash, request, env);
            }

            // Match /realms/:realmHash/peers
            const peersMatch = url.pathname.match(/^\/realms\/([a-zA-Z0-9_-]+)\/peers$/);
            if (peersMatch && method === 'GET') {
                const realmHash = peersMatch[1];
                return await handleRealmPeers(realmHash, env);
            }

            return jsonResponse({ status: 'error', error: 'not_found', message: `Route ${url.pathname} not found` }, 404);
        } catch (err: any) {
            console.error(`[ERROR] Global handler exception: ${err.message}`);
            return jsonResponse({ status: 'error', error: 'internal_error', message: err.message }, 500);
        }
    }
};

/**
 * GET /realms/:realmHash/stream — Long-lived SSE stream for Private Leaders
 */
function handleRealmStream(realmHash: string, request: Request, env: Env, ctx: ExecutionContext): Response {
    let keepAliveInterval: any = null;
    let streamController: ReadableStreamDefaultController | null = null;

    const stream = new ReadableStream({
        start(controller) {
            streamController = controller;

            if (!realmStreams.has(realmHash)) {
                realmStreams.set(realmHash, new Set());
            }
            realmStreams.get(realmHash)!.add(controller);

            // Send initial connected handshake event
            const initEvent = `event: connected\ndata: ${JSON.stringify({ realm: realmHash, timestamp: Date.now() })}\n\n`;
            controller.enqueue(new TextEncoder().encode(initEvent));

            // Periodic keep-alive ping comment every 15s to keep proxy connections alive
            keepAliveInterval = setInterval(() => {
                try {
                    controller.enqueue(new TextEncoder().encode(`: ping\n\n`));
                } catch {
                    cleanup();
                }
            }, 15000);
        },
        cancel() {
            cleanup();
        }
    });

    const cleanup = () => {
        if (keepAliveInterval) {
            clearInterval(keepAliveInterval);
            keepAliveInterval = null;
        }
        if (streamController && realmStreams.has(realmHash)) {
            const set = realmStreams.get(realmHash);
            if (set) {
                set.delete(streamController);
                if (set.size === 0) realmStreams.delete(realmHash);
            }
        }
    };

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'X-Accel-Buffering': 'no'
        }
    });
}

/**
 * POST /realms/:realmHash/register — Instant single-shot announcement from joining Cloud VMs
 */
async function handleRealmRegister(realmHash: string, request: Request, env: Env): Promise<Response> {
    const clientIp = request.headers.get('CF-Connecting-IP') || '127.0.0.1';

    let payload: PeerAnnouncementPayload;
    try {
        payload = await request.json();
    } catch {
        return jsonResponse({ status: 'error', error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
    }

    const instanceId = payload.instance_id || `node-${Math.random().toString(16).slice(2, 10)}`;
    const effectiveIp = payload.ip || clientIp;
    const port = payload.port || 8080;
    const siteName = payload.site_name || instanceId;

    const eventData = {
        event: 'peer_registered',
        realm: realmHash,
        instance_id: instanceId,
        site_name: siteName,
        ip: effectiveIp,
        ips: Array.isArray(payload.ips) ? payload.ips : [effectiveIp],
        port,
        capabilities: payload.capabilities || {},
        tags: payload.tags || {},
        timestamp: Date.now()
    };

    // 1. Instant Fan-out to all active Leader SSE streams in memory
    const subscribers = realmStreams.get(realmHash);
    let subscriberCount = 0;

    if (subscribers && subscribers.size > 0) {
        const sseMessage = `event: peer_registered\ndata: ${JSON.stringify(eventData)}\n\n`;
        const encoded = new TextEncoder().encode(sseMessage);

        for (const controller of Array.from(subscribers)) {
            try {
                controller.enqueue(encoded);
                subscriberCount++;
            } catch {
                subscribers.delete(controller);
            }
        }
    }

    // 2. Ephemeral storage in KV (180s TTL) for disconnect fallback
    if (env.STIGIX_REGISTRY) {
        try {
            const kvKey = `realm:${realmHash}:peer:${instanceId}`;
            await env.STIGIX_REGISTRY.put(kvKey, JSON.stringify(eventData), {
                expirationTtl: 180
            });
        } catch (kvErr: any) {
            console.warn(`[KV] Ephemeral storage warning: ${kvErr.message}`);
        }
    }

    console.log(`[RENDEZVOUS] Registered peer ${siteName} (${effectiveIp}:${port}) in realm ${realmHash.slice(0, 8)}... — pushed to ${subscriberCount} active listeners`);

    return jsonResponse({
        status: 'ok',
        pushed_to_listeners: subscriberCount,
        peer: eventData,
        message: 'Rendezvous announcement broadcasted successfully'
    });
}

/**
 * GET /realms/:realmHash/peers — Fallback listing of active ephemeral peers
 */
async function handleRealmPeers(realmHash: string, env: Env): Promise<Response> {
    if (!env.STIGIX_REGISTRY) {
        return jsonResponse({ status: 'ok', peers: [] });
    }

    const prefix = `realm:${realmHash}:peer:`;
    const list = await env.STIGIX_REGISTRY.list({ prefix });
    const peers: any[] = [];

    for (const key of list.keys) {
        const val = await env.STIGIX_REGISTRY.get(key.name);
        if (val) {
            try {
                peers.push(JSON.parse(val));
            } catch {}
        }
    }

    return jsonResponse({ status: 'ok', realm: realmHash, peers });
}
