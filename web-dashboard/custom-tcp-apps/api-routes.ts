/**
 * Stigix Custom TCP Inter-Site Applications — Express API Routes
 */

import { Router, Request, Response } from 'express';
import { TcpAppManager } from './tcp-app-manager.js';
import { validateApplicationConfig, checkHostPortAvailable } from './validation.js';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createCustomTcpApiRouter(tcpAppManager: TcpAppManager): Router {
    const router = Router();

    // ─── Configuration Endpoints ──────────────────────────────────────────────

    // GET /api/custom-tcp-apps — List all applications (sanitized)
    router.get('/', (_req: Request, res: Response) => {
        try {
            const data = tcpAppManager.getSanitizedConfig();
            res.json(data);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // POST /api/custom-tcp-apps — Create new application
    router.post('/', async (req: Request, res: Response) => {
        try {
            const app = req.body;
            if (!app.id) {
                app.id = `app-${crypto.randomUUID().substring(0, 6)}`;
            }
            await tcpAppManager.saveApplication(app);
            res.json({ success: true, application: app });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // POST /api/custom-tcp-apps/validate — Validate configuration & check port availability
    router.post('/validate', async (req: Request, res: Response) => {
        try {
            const app = req.body;
            const file = tcpAppManager.getConfig();
            const validation = validateApplicationConfig(app, file.applications);
            let portAvailable = true;
            let isCurrentAppPort = false;

            const existingApp = file.applications.find(a => a.id === app.id);
            if (existingApp && existingApp.listener?.port === app.listener?.port) {
                isCurrentAppPort = true;
                portAvailable = true;
            } else if (app.listener?.port && validation.valid) {
                portAvailable = await checkHostPortAvailable(app.listener.port, app.listener.bindAddress);
                if (!portAvailable) {
                    validation.errors.push(`Port ${app.listener.port} is currently occupied by another service on the host network.`);
                    validation.valid = false;
                }
            }

            res.json({
                valid: validation.valid,
                portAvailable,
                isCurrentAppPort,
                errors: validation.errors,
                warnings: validation.warnings
            });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // GET /api/custom-tcp-apps/summary/all — Get aggregated status of all apps
    router.get('/summary/all', (_req: Request, res: Response) => {
        try {
            const statuses = tcpAppManager.getAllAppsStatus();
            res.json({ statuses });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // ─── Prisma SD-WAN Custom Apps Sync Endpoints (Static prefix before /:id) ─

    // GET /api/custom-tcp-apps/prisma/status — Check tenant status and list Prisma appdefs
    router.get('/prisma/status', async (_req: Request, res: Response) => {
        try {
            const result = await runPrismaCustomApps(['--list']);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /api/custom-tcp-apps/prisma/sync-app/:id — Sync single app to Prisma SD-WAN
    router.post('/prisma/sync-app/:id', async (req: Request, res: Response) => {
        try {
            const file = tcpAppManager.getConfig();
            const app = file.applications.find(a => a.id === req.params.id);
            if (!app) return res.status(404).json({ success: false, error: 'Application not found' });

            const port = app.listener?.port || app.peers?.[0]?.port;
            if (!port) return res.status(400).json({ success: false, error: 'Application has no port configured' });

            const result = await runPrismaCustomApps([
                '--create',
                '--name', app.name,
                '--port', String(port),
                '--protocol', 'tcp',
                '--display-name', `Stigix ${app.name} (TCP ${port})`,
                '--description', app.description || `Auto-provisioned by Stigix for ${app.name}`
            ]);

            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /api/custom-tcp-apps/prisma/delete-app/:id — Delete app from Prisma SD-WAN
    router.post('/prisma/delete-app/:id', async (req: Request, res: Response) => {
        try {
            const file = tcpAppManager.getConfig();
            const app = file.applications.find(a => a.id === req.params.id);
            const appName = app ? app.name : req.params.id;

            const result = await runPrismaCustomApps([
                '--delete',
                '--name', appName
            ]);

            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /api/custom-tcp-apps/prisma/sync-all — 1-click sync all apps to Prisma SD-WAN
    router.post('/prisma/sync-all', async (_req: Request, res: Response) => {
        try {
            const file = tcpAppManager.getConfig();
            const jsonString = JSON.stringify(file);
            const result = await runPrismaCustomApps([
                '--sync-all',
                '--json-data', jsonString
            ]);

            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /api/custom-tcp-apps/prisma/clean-all — Delete all Stigix apps from tenant
    router.post('/prisma/clean-all', async (_req: Request, res: Response) => {
        try {
            const result = await runPrismaCustomApps(['--clean-all']);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ─── Individual Application Routes ────────────────────────────────────────

    // GET /api/custom-tcp-apps/:id — Get application details
    router.get('/:id', (req: Request, res: Response) => {
        try {
            const file = tcpAppManager.getConfig();
            const app = file.applications.find(a => a.id === req.params.id);
            if (!app) return res.status(404).json({ error: 'Application not found' });
            res.json({ application: app });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // PUT /api/custom-tcp-apps/:id — Update application
    router.put('/:id', async (req: Request, res: Response) => {
        try {
            const app = req.body;
            app.id = req.params.id;
            await tcpAppManager.saveApplication(app);
            res.json({ success: true, application: app });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // POST /api/custom-tcp-apps/:id/duplicate — Duplicate application
    router.post('/:id/duplicate', async (req: Request, res: Response) => {
        try {
            const file = tcpAppManager.getConfig();
            const original = file.applications.find(a => a.id === req.params.id);
            if (!original) return res.status(404).json({ error: 'Application not found' });

            const copy = JSON.parse(JSON.stringify(original));
            copy.id = `${original.id}-copy-${crypto.randomUUID().substring(0, 4)}`;
            copy.name = `${original.name} (Copy)`;
            copy.enabled = false;
            copy.listener.port = original.listener.port + 1; // Suggest next port

            await tcpAppManager.saveApplication(copy);
            res.json({ success: true, duplicated: copy });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // DELETE /api/custom-tcp-apps/:id — Delete application
    router.delete('/:id', async (req: Request, res: Response) => {
        try {
            await tcpAppManager.deleteApplication(req.params.id);
            res.json({ success: true });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // ─── Runtime Control Endpoints ────────────────────────────────────────────

    // POST /api/custom-tcp-apps/:id/listener/start — Start TCP Server Listener
    router.post('/:id/listener/start', async (req: Request, res: Response) => {
        try {
            await tcpAppManager.startListener(req.params.id);
            res.json({ success: true, state: 'listening' });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // POST /api/custom-tcp-apps/:id/listener/stop — Stop TCP Server Listener
    router.post('/:id/listener/stop', async (req: Request, res: Response) => {
        try {
            await tcpAppManager.stopListener(req.params.id);
            res.json({ success: true, state: 'stopped' });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // POST /api/custom-tcp-apps/:id/client/start — Start Outgoing Client Workload
    router.post('/:id/client/start', async (req: Request, res: Response) => {
        try {
            const { peerIds } = req.body || {};
            await tcpAppManager.startClient(req.params.id, peerIds);
            res.json({ success: true, clientRunning: true });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // POST /api/custom-tcp-apps/:id/client/stop — Stop Outgoing Client Workload
    router.post('/:id/client/stop', async (req: Request, res: Response) => {
        try {
            await tcpAppManager.stopClient(req.params.id);
            res.json({ success: true, clientRunning: false });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // POST /api/custom-tcp-apps/:id/peers/:peerId/test — Test single-shot handshake to peer
    const testPeerHandler = async (req: Request, res: Response) => {
        try {
            const result = await tcpAppManager.testPeer(req.params.id, req.params.peerId);
            res.json(result);
        } catch (err: any) {
            res.status(400).json({ success: false, error: err.message });
        }
    };
    router.post('/:id/peers/:peerId/test', testPeerHandler);
    router.post('/:id/test-peer/:peerId', testPeerHandler);

    // POST /api/custom-tcp-apps/:id/metrics/reset — Reset runtime metrics
    router.post('/:id/metrics/reset', (req: Request, res: Response) => {
        try {
            tcpAppManager.resetMetrics(req.params.id);
            res.json({ success: true });
        } catch (err: any) {
            res.status(400).json({ success: false, error: err.message });
        }
    });

    // GET /api/custom-tcp-apps/:id/status — Status & Metrics snapshot
    router.get('/:id/status', (req: Request, res: Response) => {
        try {
            const metrics = tcpAppManager.getAppStatus(req.params.id);
            const file = tcpAppManager.getConfig();
            const app = file?.applications?.find(a => a.id === req.params.id || a.id === metrics.appId || a.name.toLowerCase() === req.params.id.toLowerCase());
            const inboundSessions = tcpAppManager.getIncomingSessions(req.params.id);
            const outboundSessions = tcpAppManager.getOutgoingSessions(req.params.id);

            res.json({
                success: true,
                ...metrics,
                app: app || { id: metrics.appId, name: metrics.appName, listener: { port: metrics.port } },
                listener: {
                    state: metrics.listenerState,
                    port: metrics.port,
                    activeConnections: metrics.activeIncomingSessions,
                    error: metrics.listenerError
                },
                clientWorkload: {
                    state: metrics.clientWorkloadRunning ? 'running' : 'stopped',
                    activeSessions: metrics.activeOutgoingSessions
                },
                inboundSessions,
                outboundSessions,
                metrics: {
                    rtt: {
                        avg: metrics.avgRttMs,
                        p50: metrics.p50RttMs,
                        p95: metrics.p95RttMs,
                        count: (metrics.totalResponses || 0)
                    },
                    throughput: {
                        txKbps: 0,
                        rxKbps: 0
                    },
                    txBytes: metrics.totalTxBytes,
                    rxBytes: metrics.totalRxBytes,
                    txPackets: metrics.totalRequests,
                    rxPackets: metrics.totalResponses,
                    errors: metrics.totalErrors,
                    timeouts: metrics.totalTimeouts,
                    rejectedHandshakes: metrics.totalSimulatedDrops
                }
            });
        } catch (err: any) {
            res.status(404).json({ success: false, error: err.message });
        }
    });

    // GET /api/custom-tcp-apps/:id/sessions/incoming — Incoming active sessions
    router.get('/:id/sessions/incoming', (req: Request, res: Response) => {
        try {
            const sessions = tcpAppManager.getIncomingSessions(req.params.id);
            res.json({ sessions });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/custom-tcp-apps/:id/sessions/outgoing — Outgoing active sessions
    router.get('/:id/sessions/outgoing', (req: Request, res: Response) => {
        try {
            const sessions = tcpAppManager.getOutgoingSessions(req.params.id);
            res.json({ sessions });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/custom-tcp-apps/:id/history — Past run history
    router.get('/:id/history', async (req: Request, res: Response) => {
        try {
            const limit = parseInt(req.query.limit as string, 10) || 50;
            const records = await tcpAppManager.getHistory(req.params.id, limit);
            res.json({ history: records });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
}

function findProjectRoot(): string {
    const cwd = process.cwd();
    const candidates = [
        cwd,
        path.join(cwd, '..'),
        path.resolve(__dirname, '..'),
        path.resolve(__dirname, '../..'),
        '/app',
        '/opt/sdwan-traffic-gen'
    ];
    for (const c of candidates) {
        if (fs.existsSync(path.join(c, 'engines', 'prisma_custom_apps.py'))) {
            return c;
        }
    }
    return cwd;
}

function getPythonPath(): string {
    const root = findProjectRoot();
    const candidates = [
        path.join(root, 'engines', '.venv', 'bin', 'python3'),
        path.join(root, 'engines', '.venv', 'bin', 'python'),
        '/app/engines/.venv/bin/python3',
        path.join(process.cwd(), 'engines', '.venv', 'bin', 'python3'),
        'python3'
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return 'python3';
}

function getPrismaCustomAppsScript(): string {
    const root = findProjectRoot();
    const candidates = [
        path.join(root, 'engines', 'prisma_custom_apps.py'),
        '/app/engines/prisma_custom_apps.py',
        path.join(process.cwd(), 'engines', 'prisma_custom_apps.py')
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return 'engines/prisma_custom_apps.py';
}

function runPrismaCustomApps(args: string[]): Promise<any> {
    return new Promise((resolve, reject) => {
        const root = findProjectRoot();
        const script = getPrismaCustomAppsScript();
        const python = getPythonPath();
        const fullArgs = [script, ...args, '--json'];

        // Ensure Prisma credentials from process.env or prisma-config.json are in child env
        const childEnv: Record<string, string> = {
            ...process.env as Record<string, string>,
            PYTHONUNBUFFERED: '1'
        };

        const tsgId = process.env.PRISMA_SDWAN_TSGID || process.env.PRISMA_SDWAN_TSG_ID;
        if (tsgId) {
            childEnv.PRISMA_SDWAN_TSGID = tsgId;
            childEnv.PRISMA_SDWAN_TSG_ID = tsgId;
        }

        // Try to load prisma-config.json if env vars missing
        if (!childEnv.PRISMA_SDWAN_CLIENT_ID || !childEnv.PRISMA_SDWAN_CLIENT_SECRET) {
            const configCandidates = [
                path.join(root, 'config', 'prisma-config.json'),
                path.join(root, 'config', 'credentials.json'),
                '/data/stigix/config/prisma-config.json',
                '/data/stigix/prisma-config.json',
                '/app/config/prisma-config.json'
            ];
            for (const cfgPath of configCandidates) {
                if (fs.existsSync(cfgPath)) {
                    try {
                        const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
                        if (parsed.client_id) childEnv.PRISMA_SDWAN_CLIENT_ID = parsed.client_id;
                        if (parsed.client_secret) childEnv.PRISMA_SDWAN_CLIENT_SECRET = parsed.client_secret;
                        const tsg = parsed.tsg_id || parsed.tsgid || parsed.tsgId;
                        if (tsg) {
                            childEnv.PRISMA_SDWAN_TSGID = tsg;
                            childEnv.PRISMA_SDWAN_TSG_ID = tsg;
                        }
                        if (parsed.region) childEnv.PRISMA_SDWAN_REGION = parsed.region;
                        break;
                    } catch {}
                }
            }
        }

        const proc = spawn(python, fullArgs, {
            cwd: path.dirname(script),
            timeout: 35000,
            env: childEnv
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        proc.on('close', (code) => {
            try {
                const parsed = JSON.parse(stdout);
                if (code === 0 && parsed.success !== false) {
                    resolve(parsed);
                } else {
                    reject(new Error(parsed.error || stderr || `Script failed (exit code ${code})`));
                }
            } catch (err) {
                if (code === 0) {
                    resolve({ success: true, raw: stdout });
                } else {
                    reject(new Error(stderr || stdout || `Script failed (exit code ${code})`));
                }
            }
        });

        proc.on('error', (err) => {
            reject(err);
        });
    });
}
