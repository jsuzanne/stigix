import express, { Router, Request, Response } from 'express';
import { apiLogBuffer, ApiLogEntry, sanitizeData, generateCurlSnippet } from './api-logger.js';
import fs from 'fs';
import path from 'path';
import { log } from './utils/logger.js';
import https from 'https';

export function createApiStudioRouter(appConfigDir: string, projectRoot: string, vyosManager: any): Router {
    const router = express.Router();

    /**
     * Resolves Prisma SASE credentials and acquires an OAuth2 bearer token.
     */
    async function getPrismaSaseAuth(): Promise<{ token: string | null; tsgId?: string; baseUrl: string; error?: string }> {
        let tsgId = process.env.PRISMA_SDWAN_TSGID;
        let clientId = process.env.PRISMA_SDWAN_CLIENT_ID;
        let clientSecret = process.env.PRISMA_SDWAN_CLIENT_SECRET;
        let region = process.env.PRISMA_SDWAN_REGION || 'prd';

        // Check config files if env vars are missing
        if (!tsgId || !clientId || !clientSecret) {
            const candidateFiles = [
                path.join(appConfigDir, 'prisma-config.json'),
                path.join(appConfigDir, 'credentials.json'),
                path.join(projectRoot, 'credentials.json')
            ];
            for (const file of candidateFiles) {
                if (fs.existsSync(file)) {
                    try {
                        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
                        tsgId = tsgId || data.tsg_id || data.tsgId;
                        clientId = clientId || data.client_id || data.clientId;
                        clientSecret = clientSecret || data.client_secret || data.clientSecret;
                        region = region || data.region || 'prd';
                        if (tsgId && clientId && clientSecret) break;
                    } catch {}
                }
            }
        }

        const baseUrl = region === 'stg' 
            ? 'https://api.stg.sase.paloaltonetworks.com' 
            : 'https://api.sase.paloaltonetworks.com';

        if (!clientId || !clientSecret || !tsgId) {
            return { 
                token: null, 
                baseUrl,
                error: 'Prisma SASE credentials (TSG ID, Client ID, Client Secret) not configured in Stigix.' 
            };
        }

        const authUrl = 'https://auth.apps.paloaltonetworks.com/auth/v1/oauth2/access_token';
        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const scope = `tsg_id:${tsgId}`;

        try {
            const res = await fetch(authUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                body: new URLSearchParams({
                    grant_type: 'client_credentials',
                    scope: scope
                })
            });

            if (!res.ok) {
                const errText = await res.text();
                return { token: null, tsgId, baseUrl, error: `Authentication failed (${res.status}): ${errText}` };
            }

            const data = (await res.json()) as any;
            return { token: data.access_token, tsgId, baseUrl };
        } catch (e: any) {
            return { token: null, tsgId, baseUrl, error: `OAuth exception: ${e.message}` };
        }
    }

    /**
     * Resolves VyOS Router credentials from Stigix configuration.
     */
    function getVyosAuth(routerId?: string): { host: string | null; apiKey: string | null; error?: string } {
        try {
            const vyosConfig = vyosManager?.getConfig?.();
            if (!vyosConfig || !vyosConfig.routers || vyosConfig.routers.length === 0) {
                return { host: null, apiKey: null, error: 'No VyOS routers configured in Stigix Settings.' };
            }
            const router = routerId ? vyosConfig.routers.find((r: any) => r.id === routerId) : vyosConfig.routers[0];
            if (!router) {
                return { host: null, apiKey: null, error: `VyOS router with ID "${routerId}" not found.` };
            }
            return { host: router.host, apiKey: router.apiKey };
        } catch (e: any) {
            return { host: null, apiKey: null, error: `Failed to load VyOS config: ${e.message}` };
        }
    }

    // ─── 1. Real-Time Server-Sent Events Stream ───────────────────────────
    router.get('/stream', (req: Request, res: Response) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        // Send initial connection event
        res.write(`data: ${JSON.stringify({ type: 'init', connected: true, timestamp: new Date().toISOString() })}\n\n`);

        const onLog = (entry: ApiLogEntry) => {
            try {
                res.write(`data: ${JSON.stringify(entry)}\n\n`);
            } catch (err) {
                // Client probably disconnected
            }
        };

        const onClear = () => {
            try {
                res.write(`data: ${JSON.stringify({ type: 'clear' })}\n\n`);
            } catch (err) {}
        };

        apiLogBuffer.on('log', onLog);
        apiLogBuffer.on('clear', onClear);

        // Keep-alive heartbeat every 15s
        const heartbeat = setInterval(() => {
            try {
                res.write(': heartbeat\n\n');
            } catch {}
        }, 15000);

        req.on('close', () => {
            clearInterval(heartbeat);
            apiLogBuffer.off('log', onLog);
            apiLogBuffer.off('clear', onClear);
        });
    });

    // ─── 2. Get Recent Buffered Logs ───────────────────────────────────────
    router.get('/recent', (req: Request, res: Response) => {
        const limit = parseInt((req.query.limit as string) || '200', 10);
        const source = (req.query.source as string) || undefined;
        const statusCategory = (req.query.statusCategory as string) || undefined;

        const logs = apiLogBuffer.getRecentLogs(limit, source, statusCategory);
        res.json({
            success: true,
            total: apiLogBuffer.size(),
            logs
        });
    });

    // ─── 3. Clear Buffered Logs ───────────────────────────────────────────
    router.delete('/clear', (_req: Request, res: Response) => {
        apiLogBuffer.clear();
        res.json({ success: true, message: 'All API logs cleared.' });
    });

    // ─── 4. Internal Ingestion (Python & Child Processes) ───────────────────
    router.post('/internal/log-event', (req: Request, res: Response) => {
        try {
            const entry = apiLogBuffer.record(req.body);
            res.json({ success: true, id: entry.id });
        } catch (e: any) {
            res.status(400).json({ success: false, error: e.message });
        }
    });

    // ─── 5. Interactive API Playground Execution Proxy ─────────────────────
    router.post('/playground/execute', async (req: Request, res: Response) => {
        const {
            method = 'GET',
            url,
            headers = {},
            body,
            autoAuth,
            vyosRouterId,
            timeoutMs = 15000
        } = req.body;

        if (!url) {
            return res.status(400).json({ success: false, error: 'Target URL is required.' });
        }

        let targetUrl = url.trim();
        const finalHeaders: Record<string, string> = { ...headers };
        let autoAuthDetails = '';

        // 1. Automatic Authentication Handling
        if (autoAuth === 'sase') {
            const saseAuth = await getPrismaSaseAuth();
            if (saseAuth.error) {
                return res.status(400).json({ success: false, error: saseAuth.error });
            }
            if (saseAuth.token) {
                finalHeaders['Authorization'] = `Bearer ${saseAuth.token}`;
            }
            if (saseAuth.tsgId) {
                finalHeaders['X-PAN-TSG-ID'] = saseAuth.tsgId;
            }
            if (targetUrl.startsWith('/')) {
                targetUrl = `${saseAuth.baseUrl}${targetUrl}`;
            }
            autoAuthDetails = 'Prisma SASE OAuth injected';
        } else if (autoAuth === 'vyos') {
            const vyosAuth = getVyosAuth(vyosRouterId);
            if (vyosAuth.error) {
                return res.status(400).json({ success: false, error: vyosAuth.error });
            }
            if (vyosAuth.apiKey) {
                finalHeaders['key'] = vyosAuth.apiKey;
            }
            if (targetUrl.startsWith('/')) {
                targetUrl = `https://${vyosAuth.host}${targetUrl}`;
            }
            autoAuthDetails = `VyOS (${vyosAuth.host}) key injected`;
        } else if (autoAuth === 'stigix') {
            const authHeader = req.headers['authorization'];
            if (authHeader) {
                finalHeaders['Authorization'] = authHeader;
            }
            if (targetUrl.startsWith('/')) {
                const port = process.env.PORT || '8080';
                targetUrl = `http://127.0.0.1:${port}${targetUrl}`;
            }
            autoAuthDetails = 'Stigix Bearer JWT injected';
        }

        const start = performance.now();
        let statusCode = 0;
        let responseHeaders: Record<string, string> = {};
        let responseBody: any = null;
        let executionError: string | undefined = undefined;

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);

            const isBodyAllowed = !['GET', 'HEAD'].includes(method.toUpperCase());
            let formattedBody: any = undefined;

            if (isBodyAllowed && body !== undefined && body !== null) {
                if (typeof body === 'object') {
                    formattedBody = JSON.stringify(body);
                    if (!finalHeaders['Content-Type'] && !finalHeaders['content-type']) {
                        finalHeaders['Content-Type'] = 'application/json';
                    }
                } else {
                    formattedBody = String(body);
                }
            }

            // In dev / lab environments, self-signed certificates are common (e.g. VyOS, local appliances)
            // Node 18+ fetch options:
            const fetchOptions: any = {
                method: method.toUpperCase(),
                headers: finalHeaders,
                body: formattedBody,
                signal: controller.signal
            };

            const response = await fetch(targetUrl, fetchOptions);
            clearTimeout(timeout);

            statusCode = response.status;
            response.headers.forEach((value, key) => {
                responseHeaders[key] = value;
            });

            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                try {
                    responseBody = await response.json();
                } catch {
                    responseBody = await response.text();
                }
            } else {
                responseBody = await response.text();
            }
        } catch (err: any) {
            executionError = err.name === 'AbortError' ? `Request timed out after ${timeoutMs}ms` : err.message;
            statusCode = 0;
        }

        const durationMs = performance.now() - start;

        // Record the transaction in the live inspector buffer
        const recordedLog = apiLogBuffer.record({
            source: 'node',
            scriptName: 'api_playground',
            direction: 'outbound',
            method: method.toUpperCase() as any,
            url: targetUrl,
            statusCode: statusCode || 500,
            durationMs: Math.round(durationMs),
            requestHeaders: finalHeaders,
            requestBody: body,
            responseHeaders,
            responseBody,
            error: executionError
        });

        res.json({
            success: !executionError,
            statusCode,
            durationMs: Math.round(durationMs),
            request: {
                method: method.toUpperCase(),
                url: targetUrl,
                headers: sanitizeData(finalHeaders),
                body: sanitizeData(body),
                curl: recordedLog.curlSnippet,
                autoAuthDetails
            },
            response: {
                headers: responseHeaders,
                body: responseBody,
                error: executionError
            }
        });
    });

    return router;
}
