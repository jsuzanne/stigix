import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import jwt from 'jsonwebtoken';

export function deriveFleetTunnelKey(secretKey: string): string {
    return crypto.createHmac('sha256', secretKey).update('stigix-fleet-tunnel-key-v1').digest('hex');
}

const INSECURE_DEFAULT_SECRETS = new Set([
    '',
    'super-secret-key-change-this',
    'stigix-secret-key-12345',
    'change-me',
    'changeme',
    'default'
]);

/**
 * Resolves a persistent cryptographic JWT secret.
 * If JWT_SECRET is not set or equals a known insecure placeholder, loads or generates
 * `/app/config/jwt-secret.key` (0600 permissions) and synchronizes `process.env.JWT_SECRET`.
 */
export function resolveOrGenerateJwtSecret(configDir = '/app/config'): string {
    const envSecret = (process.env.JWT_SECRET || '').trim();
    if (envSecret.length >= 16 && !INSECURE_DEFAULT_SECRETS.has(envSecret.toLowerCase())) {
        return envSecret;
    }

    const secretFile = path.join(configDir, 'jwt-secret.key');
    try {
        if (fs.existsSync(secretFile)) {
            const existing = fs.readFileSync(secretFile, 'utf8').trim();
            if (existing.length >= 32 && !INSECURE_DEFAULT_SECRETS.has(existing.toLowerCase())) {
                process.env.JWT_SECRET = existing;
                return existing;
            }
        }
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        const generatedKey = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(secretFile, generatedKey, { encoding: 'utf8', mode: 0o600 });
        process.env.JWT_SECRET = generatedKey;
        console.log(`[SECURITY] Auto-generated persistent 256-bit JWT secret in ${secretFile}`);
        return generatedKey;
    } catch (e) {
        const ephemeralKey = crypto.randomBytes(32).toString('hex');
        process.env.JWT_SECRET = ephemeralKey;
        console.warn('[SECURITY] Could not persist jwt-secret.key to disk; using generated in-memory 256-bit secret.');
        return ephemeralKey;
    }
}

/**
 * Extracts effective external Host and Protocol from HTTP headers,
 * supporting Cloudflare Tunnel (`cf-visitor`), Nginx, Traefik, Caddy, and standard reverse proxies (`x-forwarded-proto`, `x-forwarded-host`).
 */
export function extractRequestIngress(headers?: Record<string, any>): { host?: string; proto?: 'http' | 'https' } {
    if (!headers) return {};

    const rawForwardedHost = headers['x-forwarded-host'];
    const rawHost = headers['host'];
    const hostHeader = (Array.isArray(rawForwardedHost) ? rawForwardedHost[0] : rawForwardedHost)
        || (Array.isArray(rawHost) ? rawHost[0] : rawHost);
    const host = typeof hostHeader === 'string' ? hostHeader.split(',')[0].trim() : undefined;

    let proto: 'http' | 'https' | undefined;
    const xfp = headers['x-forwarded-proto'];
    const xfpStr = Array.isArray(xfp) ? xfp[0] : xfp;
    if (typeof xfpStr === 'string') {
        const firstProto = xfpStr.split(',')[0].trim().toLowerCase();
        if (firstProto === 'https' || firstProto === 'http') {
            proto = firstProto;
        }
    }

    if (!proto && headers['cf-visitor']) {
        const cfv = Array.isArray(headers['cf-visitor']) ? headers['cf-visitor'][0] : headers['cf-visitor'];
        if (typeof cfv === 'string' && cfv.toLowerCase().includes('"https"')) {
            proto = 'https';
        }
    }

    if (!proto && headers['x-forwarded-ssl'] === 'on') {
        proto = 'https';
    }

    return { host, proto };
}

export function resolveClusterRealmHash(configDir = '/app/config'): string {
    if (process.env.STIGIX_CLUSTER_REALM && /^[a-f0-9]{64}$/i.test(process.env.STIGIX_CLUSTER_REALM.trim())) {
        return process.env.STIGIX_CLUSTER_REALM.trim().toLowerCase();
    }
    if (process.env.STIGIX_CLUSTER_KEY && process.env.STIGIX_CLUSTER_KEY.trim().length >= 16) {
        return crypto.createHash('sha256').update(process.env.STIGIX_CLUSTER_KEY.trim()).digest('hex');
    }
    const realmFile = path.join(configDir, 'cluster-realm.key');
    try {
        if (fs.existsSync(realmFile)) {
            const existing = fs.readFileSync(realmFile, 'utf8').trim();
            if (existing.length >= 32) {
                return crypto.createHash('sha256').update(existing).digest('hex');
            }
        }
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        const generatedKey = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(realmFile, generatedKey, { encoding: 'utf8', mode: 0o600 });
        return crypto.createHash('sha256').update(generatedKey).digest('hex');
    } catch {
        const fallbackSeed = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
        return crypto.createHmac('sha256', fallbackSeed).update('stigix-cluster-realm-v1').digest('hex');
    }
}

export interface JoinTokenPayload {
    v: number;
    jti: string;
    endpoints: string[];
    realm: string;
    exp: number;
    max_uses: number;
    site_hint?: string;
    tags?: Record<string, string>;
    relay_url?: string;
}

export interface JoinTokenEntry {
    jti: string;
    token_str: string;
    payload: JoinTokenPayload;
    status: 'ACTIVE' | 'REDEEMED' | 'EXPIRED' | 'REVOKED';
    created_at: string;
    expires_at: string;
    uses_count: number;
    max_uses: number;
    redeemed_by?: {
        instance_id: string;
        public_ip?: string;
        hostname?: string;
        site_name?: string;
        redeemed_at: string;
        node_token?: string;
    }[];
}

export class MagicJoinManager {
    private tokensFile: string;
    private tokens: Map<string, JoinTokenEntry> = new Map();
    private secretKey: string;
    private configDir: string;

    constructor(configDir = '/app/config', secretKey?: string) {
        this.configDir = configDir;
        this.tokensFile = path.join(configDir, 'magic-join-tokens.json');
        this.secretKey = secretKey || resolveOrGenerateJwtSecret(configDir);
        this.loadTokens();
    }

    private loadTokens() {
        try {
            if (fs.existsSync(this.tokensFile)) {
                const data = JSON.parse(fs.readFileSync(this.tokensFile, 'utf8'));
                if (Array.isArray(data)) {
                    for (const entry of data) {
                        this.tokens.set(entry.jti, entry);
                    }
                }
            }
        } catch (e) {
            console.error('[MAGIC-JOIN] Error loading tokens from file:', e);
        }
    }

    private saveTokens() {
        try {
            if (!fs.existsSync(this.configDir)) {
                fs.mkdirSync(this.configDir, { recursive: true });
            }
            const data = Array.from(this.tokens.values());
            fs.writeFileSync(this.tokensFile, JSON.stringify(data, null, 2), 'utf8');
        } catch (e) {
            console.error('[MAGIC-JOIN] Error saving tokens to file:', e);
        }
    }

    public getRealmHash(): string {
        return resolveClusterRealmHash(this.configDir);
    }

    public detectLeaderEndpoints(requestHost?: string, localIp?: string, requestProto?: 'http' | 'https'): string[] {
        const endpoints = new Set<string>();

        // 1. Explicit Public URL
        if (process.env.STIGIX_PUBLIC_URL) {
            try {
                const u = new URL(process.env.STIGIX_PUBLIC_URL);
                endpoints.add(u.origin);
            } catch {
                endpoints.add(process.env.STIGIX_PUBLIC_URL.replace(/\/$/, ''));
            }
        }

        // 2. Request Host Header from Browser/Client (supports HTTPS Reverse Proxy / Cloudflare Tunnel)
        if (requestHost && !requestHost.includes('127.0.0.1') && !requestHost.includes('localhost')) {
            const isHttps = requestProto === 'https' || requestHost.endsWith(':443');
            if (isHttps) {
                const cleanHost = requestHost.replace(/:443$/, '');
                endpoints.add(`https://${cleanHost}`);
            } else {
                const hostWithPort = requestHost.includes(':') ? requestHost : `${requestHost}:8080`;
                endpoints.add(`http://${hostWithPort}`);
            }
        }

        // 3. Local Private IP detected
        if (localIp && localIp !== '127.0.0.1') {
            endpoints.add(`http://${localIp}:8080`);
        }

        // 4. All host IPv4 network interfaces
        try {
            const nets = os.networkInterfaces();
            for (const name of Object.keys(nets)) {
                if (['lo', 'docker', 'veth', 'br-'].some(b => name.startsWith(b))) continue;
                for (const netInfo of nets[name] || []) {
                    if (netInfo.family === 'IPv4' && !netInfo.internal) {
                        endpoints.add(`http://${netInfo.address}:8080`);
                    }
                }
            }
        } catch {}

        return Array.from(endpoints);
    }

    public createToken(options: {
        ttlSeconds?: number;
        siteHint?: string;
        maxUses?: number;
        tags?: Record<string, string>;
        requestHost?: string;
        requestProto?: 'http' | 'https';
        localIp?: string;
        endpoints?: string[];
        relayUrl?: string;
    }): { token: string; entry: JoinTokenEntry; curlCommand: string } {
        const ttl = options.ttlSeconds || 3600; // 1 hour default
        const now = Date.now();
        const exp = Math.floor((now + ttl * 1000) / 1000);
        const jti = `stx_tok_${crypto.randomBytes(6).toString('hex')}`;

        const finalEndpoints = (options.endpoints && options.endpoints.length > 0)
            ? options.endpoints
            : this.detectLeaderEndpoints(options.requestHost, options.localIp, options.requestProto);

        const payload: JoinTokenPayload = {
            v: 1,
            jti,
            endpoints: finalEndpoints,
            realm: this.getRealmHash(),
            exp,
            max_uses: options.maxUses ?? 1,
            site_hint: options.siteHint,
            tags: options.tags,
            relay_url: options.relayUrl || undefined
        };

        const headerObj = { alg: 'HS256', typ: 'STX-JOIN' };
        const headerB64 = Buffer.from(JSON.stringify(headerObj)).toString('base64url');
        const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const signatureB64 = crypto
            .createHmac('sha256', this.secretKey)
            .update(`${headerB64}.${payloadB64}`)
            .digest('base64url');

        const token = `STX-${headerB64}.${payloadB64}.${signatureB64}`;

        const entry: JoinTokenEntry = {
            jti,
            token_str: token,
            payload,
            status: 'ACTIVE',
            created_at: new Date(now).toISOString(),
            expires_at: new Date(exp * 1000).toISOString(),
            uses_count: 0,
            max_uses: options.maxUses ?? 1,
            redeemed_by: []
        };

        this.tokens.set(jti, entry);
        this.saveTokens();

        const curlCommand = `curl -fsSL https://raw.githubusercontent.com/jsuzanne/stigix/v2/install.sh | sudo bash -s -- ${token}`;

        return { token, entry, curlCommand };
    }

    public verifyToken(tokenStr: string): { valid: boolean; payload?: JoinTokenPayload; entry?: JoinTokenEntry; error?: string } {
        try {
            if (!tokenStr.startsWith('STX-')) {
                return { valid: false, error: 'ERR_INVALID_FORMAT: Token must start with STX-' };
            }

            const cleanStr = tokenStr.slice(4);
            const parts = cleanStr.split('.');
            if (parts.length !== 3) {
                return { valid: false, error: 'ERR_INVALID_STRUCTURE: Malformed token payload' };
            }

            const [headerB64, payloadB64, signatureB64] = parts;

            const expectedSig = crypto
                .createHmac('sha256', this.secretKey)
                .update(`${headerB64}.${payloadB64}`)
                .digest('base64url');

            if (signatureB64 !== expectedSig) {
                return { valid: false, error: 'ERR_INVALID_SIGNATURE: Cryptographic verification failed' };
            }

            const payload: JoinTokenPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
            const nowSec = Math.floor(Date.now() / 1000);

            if (payload.exp && payload.exp < nowSec) {
                return { valid: false, payload, error: `ERR_JOIN_EXPIRED: Token expired at ${new Date(payload.exp * 1000).toLocaleTimeString()}` };
            }

            const entry = this.tokens.get(payload.jti);
            if (entry) {
                if (entry.status === 'REVOKED') {
                    return { valid: false, payload, entry, error: 'ERR_JOIN_REVOKED: Token was manually revoked by cluster administrator' };
                }
                if (entry.status === 'REDEEMED' || entry.uses_count >= entry.max_uses) {
                    return { valid: false, payload, entry, error: 'ERR_JOIN_REDEEMED: Single-use token has already been redeemed' };
                }
            }

            return { valid: true, payload, entry };
        } catch (e: any) {
            return { valid: false, error: `ERR_DECODE_FAILED: ${e.message}` };
        }
    }

    public issueScopedNodeToken(nodeId: string, siteName?: string, jti?: string): string {
        const fleetTunnelKey = deriveFleetTunnelKey(this.secretKey);
        return jwt.sign(
            {
                typ: 'STX-NODE',
                sub: nodeId,
                jti: jti || `stx_dial_${crypto.randomBytes(6).toString('hex')}`,
                site: siteName || nodeId,
                role: 'spoke-tunnel'
            },
            fleetTunnelKey,
            { expiresIn: '3650d' }
        );
    }

    public redeemToken(tokenStr: string, nodeInfo: {
        instance_id: string;
        public_ip?: string;
        hostname?: string;
        site_name?: string;
        capabilities?: any;
    }): { success: boolean; node_id?: string; node_token?: string; error?: string } {
        const verify = this.verifyToken(tokenStr);
        if (!verify.valid || !verify.payload) {
            return { success: false, error: verify.error };
        }

        const nodeId = nodeInfo.instance_id;
        const resolvedSite = nodeInfo.site_name || verify.payload.site_hint || nodeId;
        const nodeToken = this.issueScopedNodeToken(nodeId, resolvedSite, verify.payload.jti);

        const entry = this.tokens.get(verify.payload.jti);
        if (entry) {
            entry.uses_count += 1;
            entry.redeemed_by = entry.redeemed_by || [];
            entry.redeemed_by.push({
                instance_id: nodeInfo.instance_id,
                public_ip: nodeInfo.public_ip,
                hostname: nodeInfo.hostname,
                site_name: resolvedSite,
                redeemed_at: new Date().toISOString(),
                node_token: nodeToken
            });

            if (entry.uses_count >= entry.max_uses) {
                entry.status = 'REDEEMED';
            }
            this.saveTokens();
        }

        return {
            success: true,
            node_id: nodeId,
            node_token: nodeToken
        };
    }

    public isTokenRevoked(jti?: string): boolean {
        if (!jti) return false;
        const entry = this.tokens.get(jti);
        return Boolean(entry && entry.status === 'REVOKED');
    }

    public getNodeTokenForPeer(identifier: string): string | null {
        if (!identifier) return null;
        const cleanId = identifier.trim().toLowerCase();
        const entries = Array.from(this.tokens.values()).sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        for (const entry of entries) {
            if (entry.status === 'REVOKED' || !Array.isArray(entry.redeemed_by)) continue;
            for (let i = entry.redeemed_by.length - 1; i >= 0; i--) {
                const r = entry.redeemed_by[i];
                if (!r.node_token) continue;
                const candidates = [r.instance_id, r.site_name, r.public_ip, r.hostname]
                    .filter(Boolean)
                    .map(s => String(s).trim().toLowerCase());
                if (candidates.includes(cleanId)) {
                    return r.node_token;
                }
            }
        }
        return null;
    }

    public revokeToken(jti: string): boolean {
        const entry = this.tokens.get(jti);
        if (!entry) return false;
        entry.status = 'REVOKED';
        this.saveTokens();
        return true;
    }

    public deleteToken(jti: string): boolean {
        const res = this.tokens.delete(jti);
        if (res) this.saveTokens();
        return res;
    }

    public listTokens(statusFilter?: string): JoinTokenEntry[] {
        const nowSec = Math.floor(Date.now() / 1000);
        const list = Array.from(this.tokens.values()).map(e => {
            if (e.status === 'ACTIVE' && e.payload.exp < nowSec) {
                e.status = 'EXPIRED';
            }
            return e;
        });

        if (statusFilter && statusFilter !== 'ALL') {
            return list.filter(e => e.status === statusFilter);
        }
        return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
}
