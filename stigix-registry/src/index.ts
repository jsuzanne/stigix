const TTL_SECONDS = 300;

export interface Env {
    STIGIX_REGISTRY: KVNamespace;
    REGISTRY_API_KEY?: string;
}

interface RegisterPayload {
    poc_id: string;
    instance_id: string;
    type: string;
    ip_private: string;
    capabilities: Record<string, any>;
    meta: Record<string, any>;
}

interface StoredInstance extends RegisterPayload {
    ip_public: string;
    location: {
        country: string;
        city: string;
    };
    last_seen: string;
}

// --- Helper: JSON Response ---
const jsonResponse = (data: any, status = 200) => {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
};

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const method = request.method;

        // --- Router ---
        try {
            if (url.pathname === '/register' && method === 'POST') {
                return await handleRegister(request, env);
            } else if (url.pathname === '/instances' && method === 'GET') {
                return await handleInstances(request, env);
            } else if (url.pathname === '/leader' && method === 'POST') {
                return await handleSetLeader(request, env);
            } else if (url.pathname === '/leader' && method === 'GET') {
                return await handleGetLeader(request, env);
            } else {
                return jsonResponse({ status: 'error', error: 'not_found' }, 404);
            }
        } catch (err: any) {
            console.error(`[ERROR] Global handler: ${err.message}`);
            return jsonResponse({ status: 'error', error: 'internal_error' }, 500);
        }
    },
};

// --- GET /leader (Peer Discovery) ---
async function handleGetLeader(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const poc_id = url.searchParams.get('poc_id');

    if (!poc_id) {
        return jsonResponse({ status: 'error', error: 'invalid_payload', details: 'Missing poc_id' }, 400);
    }

    // Auth Check
    const storedPocKey = await env.STIGIX_REGISTRY.get(`auth:poc:${poc_id}`);
    const providedPocKey = request.headers.get('X-PoC-Key');
    if (!storedPocKey || (providedPocKey !== storedPocKey)) {
        return jsonResponse({ status: 'error', error: 'forbidden' }, 403);
    }

    const leaderVal = await env.STIGIX_REGISTRY.get(`leader:${poc_id}`);
    if (!leaderVal) {
        return jsonResponse({ status: 'error', error: 'not_found', details: 'No leader announced for this PoC' }, 404);
    }

    try {
        const leader = JSON.parse(leaderVal);
        return jsonResponse({
            status: 'ok',
            poc_id,
            leader_ip: leader.ip,
            leader_id: leader.id,
            last_announced: leader.last_announced
        });
    } catch (e) {
        // Fallback for legacy IP-only storage
        return jsonResponse({ status: 'ok', poc_id, leader_ip: leaderVal });
    }
}

// --- POST /leader (Leader Announcement) ---
async function handleSetLeader(request: Request, env: Env): Promise<Response> {
    let payload: { poc_id: string; leader_ip: string; leader_id?: string };
    try {
        payload = await request.json();
    } catch (e) {
        return jsonResponse({ status: 'error', error: 'invalid_payload' }, 400);
    }

    if (!payload.poc_id || !payload.leader_ip) {
        return jsonResponse({ status: 'error', error: 'invalid_payload', details: 'Missing poc_id or leader_ip' }, 400);
    }

    // Auth Check
    const storedPocKey = await env.STIGIX_REGISTRY.get(`auth:poc:${payload.poc_id}`);
    const providedPocKey = request.headers.get('X-PoC-Key');

    // First registration of a PoC via /leader is also allowed (auto-enrollment)
    if (!storedPocKey) {
        const newKey = providedPocKey || crypto.randomUUID();
        await env.STIGIX_REGISTRY.put(`auth:poc:${payload.poc_id}`, newKey);
        console.log(`[AUTH] Enrolled PoC via /leader: ${payload.poc_id}`);
    } else if (providedPocKey !== storedPocKey) {
        return jsonResponse({ status: 'error', error: 'forbidden' }, 403);
    }

    // Save leader info with a long TTL (900s = 15 min)
    const leaderInfo = {
        ip: payload.leader_ip,
        id: payload.leader_id || 'unknown',
        last_announced: new Date().toISOString()
    };

    await env.STIGIX_REGISTRY.put(`leader:${payload.poc_id}`, JSON.stringify(leaderInfo), {
        expirationTtl: 900
    });

    console.log(`[BOOTSTRAP] Leader announced for PoC ${payload.poc_id}: ${payload.leader_ip} (${leaderInfo.id})`);
    return jsonResponse({ status: 'ok' });
}

// --- POST /register ---
async function handleRegister(request: Request, env: Env): Promise<Response> {
    const ip_public = request.headers.get('CF-Connecting-IP') || '0.0.0.0';

    // 1. Global Auth Check (Gateway)
    if (env.REGISTRY_API_KEY) {
        const apiKey = request.headers.get('X-Api-Key');
        if (apiKey !== env.REGISTRY_API_KEY) {
            console.warn(`[AUTH] Refused registration from ${ip_public}: Invalid Global Key`);
            return new Response(JSON.stringify({ status: 'error', error: 'forbidden', details: 'Invalid Global Key' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
            });
        }
    }

    let payload: RegisterPayload;
    try {
        payload = await request.json();
    } catch (e) {
        return new Response(JSON.stringify({ status: 'error', error: 'invalid_payload', details: 'Invalid JSON' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // 2. Validation
    const required: (keyof RegisterPayload)[] = ['poc_id', 'instance_id', 'type', 'ip_private'];
    for (const field of required) {
        if (!payload[field] || typeof payload[field] !== 'string') {
            return new Response(
                JSON.stringify({ status: 'error', error: 'invalid_payload', details: `Missing or invalid field: ${field}` }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }
    }

    // 3. PoC Key Management (Stateless / Auto-Join)
    const authKey = `auth:poc:${payload.poc_id}`;
    let storedPocKey = await env.STIGIX_REGISTRY.get(authKey);
    const providedPocKey = request.headers.get('X-PoC-Key');

    if (!storedPocKey) {
        // First instance for this PoC. Enroll with the provided key (or generate one)
        storedPocKey = providedPocKey || crypto.randomUUID();
        await env.STIGIX_REGISTRY.put(authKey, storedPocKey);
        console.log(`[AUTH] Enrolled PoC: ${payload.poc_id} (Type: ${providedPocKey ? 'Stateless' : 'Legacy'})`);
    } else {
        // Verify subsequent registrations
        if (providedPocKey && providedPocKey !== storedPocKey) {
            console.warn(`[AUTH] Refused heartbeat for PoC: ${payload.poc_id} (IP: ${ip_public}) - Invalid PoC Key`);
            return jsonResponse({ status: 'error', error: 'forbidden', details: 'Invalid PoC Key' }, 403);
        }
    }

    // 4. Enrichment
    const country = request.cf?.country?.toString() || 'Unknown';
    const city = request.cf?.city?.toString() || 'Unknown';

    const instance: StoredInstance = {
        ...payload,
        ip_public,
        location: { country, city },
        last_seen: new Date().toISOString(),
    };

    // 5. Storage
    const key = `poc:${payload.poc_id}:inst:${payload.instance_id}`;
    await env.STIGIX_REGISTRY.put(key, JSON.stringify(instance), {
        expirationTtl: TTL_SECONDS,
    });

    console.log(`[REG] Instance heartbeat: ${key} (IP: ${ip_public})`);

    return jsonResponse({
        status: 'ok',
        poc_id: payload.poc_id,
        instance_id: payload.instance_id,
        poc_key: storedPocKey,
        detected: {
            ip_public,
            location: { country, city },
        },
    });
}

// --- GET /instances ---
async function handleInstances(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const poc_id = url.searchParams.get('poc_id');
    const scope = url.searchParams.get('scope') || 'all';
    const self_instance_id = url.searchParams.get('self_instance_id');

    // 1. Multi-level Auth Check
    const globalKey = request.headers.get('X-Api-Key');
    const pocKeyHeader = request.headers.get('X-PoC-Key');
    let isAuthorized = false;

    // Check Global Key (Admin/Global Listing)
    if (env.REGISTRY_API_KEY && globalKey === env.REGISTRY_API_KEY) {
        isAuthorized = true;
        console.log(`[AUTH] Admin access to /instances via Global Key`);
    }
    // Check PoC Key (Discovery)
    else if (poc_id) {
        const storedPocKey = await env.STIGIX_REGISTRY.get(`auth:poc:${poc_id}`);
        if (storedPocKey && pocKeyHeader === storedPocKey) {
            isAuthorized = true;
            console.log(`[AUTH] PoC access to /instances for PoC: ${poc_id}`);
        }
    }

    if (!isAuthorized) {
        console.warn(`[AUTH] Forbidden access to /instances (PoC: ${poc_id || 'all'})`);
        return new Response(JSON.stringify({ status: 'error', error: 'forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // 2. Listing
    const prefix = poc_id ? `poc:${poc_id}:inst:` : `poc:`;
    const list = await env.STIGIX_REGISTRY.list({ prefix });

    const instances: StoredInstance[] = [];

    for (const key of list.keys) {
        // Skip auth keys if listing globally
        if (key.name.startsWith('auth:')) continue;

        const val = await env.STIGIX_REGISTRY.get(key.name);
        if (val) {
            try {
                const inst: StoredInstance = JSON.parse(val);
                if (scope === 'others' && inst.instance_id === self_instance_id) {
                    continue;
                }
                instances.push(inst);
            } catch (e) {
                console.error(`[ERROR] Failed to parse instance data: ${key.name}`);
            }
        }
    }

    return new Response(JSON.stringify({ poc_id: poc_id || 'all', instances }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
