import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface JoinTokenPayload {
    v: number;
    jti: string;
    endpoints: string[];
    realm: string;
    exp: number;
    max_uses: number;
    site_hint?: string;
    tags?: Record<string, string>;
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
    }[];
}

export class MagicJoinManager {
    private tokensFile: string;
    private tokens: Map<string, JoinTokenEntry> = new Map();
    private secretKey: string;
    private configDir: string;

    constructor(configDir = '/app/config', secretKey = process.env.JWT_SECRET || 'stigix-secret-key-12345') {
        this.configDir = configDir;
        this.tokensFile = path.join(configDir, 'magic-join-tokens.json');
        this.secretKey = secretKey;
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
        const seed = process.env.PRISMA_SDWAN_TSGID ||
                     process.env.STIGIX_CLUSTER_KEY ||
                     process.env.STIGIX_POC_ID ||
                     'default-stigix-realm';
        return crypto.createHash('sha256').update(seed).digest('hex');
    }

    public detectLeaderEndpoints(requestHost?: string, localIp?: string): string[] {
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

        // 2. Request Host Header from Browser/Client
        if (requestHost && !requestHost.includes('127.0.0.1') && !requestHost.includes('localhost')) {
            const proto = requestHost.includes(':443') ? 'https' : 'http';
            const hostWithPort = requestHost.includes(':') ? requestHost : `${requestHost}:8080`;
            endpoints.add(`${proto}://${hostWithPort}`);
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
        localIp?: string;
        endpoints?: string[];
    }): { token: string; entry: JoinTokenEntry; curlCommand: string } {
        const ttl = options.ttlSeconds || 3600; // 1 hour default
        const now = Date.now();
        const exp = Math.floor((now + ttl * 1000) / 1000);
        const jti = `stx_tok_${crypto.randomBytes(6).toString('hex')}`;

        const finalEndpoints = (options.endpoints && options.endpoints.length > 0)
            ? options.endpoints
            : this.detectLeaderEndpoints(options.requestHost, options.localIp);

        const payload: JoinTokenPayload = {
            v: 1,
            jti,
            endpoints: finalEndpoints,
            realm: this.getRealmHash(),
            exp,
            max_uses: options.maxUses ?? 1,
            site_hint: options.siteHint,
            tags: options.tags
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

        const curlCommand = `curl -fsSL https://stigix.io/join | sudo bash -s -- ${token}`;

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

        const entry = this.tokens.get(verify.payload.jti);
        if (entry) {
            entry.uses_count += 1;
            entry.redeemed_by = entry.redeemed_by || [];
            entry.redeemed_by.push({
                instance_id: nodeInfo.instance_id,
                public_ip: nodeInfo.public_ip,
                hostname: nodeInfo.hostname,
                site_name: nodeInfo.site_name || verify.payload.site_hint,
                redeemed_at: new Date().toISOString()
            });

            if (entry.uses_count >= entry.max_uses) {
                entry.status = 'REDEEMED';
            }
            this.saveTokens();
        }

        // Generate persistent node authentication credentials
        const nodeId = nodeInfo.instance_id;
        const nodeToken = crypto
            .createHmac('sha256', this.secretKey)
            .update(`node:${nodeId}:${Date.now()}`)
            .digest('hex');

        return {
            success: true,
            node_id: nodeId,
            node_token: nodeToken
        };
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
