/**
 * Stigix Custom TCP Inter-Site Applications — Express API Routes
 */

import { Router, Request, Response } from 'express';
import { TcpAppManager } from './tcp-app-manager.js';
import { validateApplicationConfig, checkHostPortAvailable } from './validation.js';
import crypto from 'crypto';

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
    router.post('/:id/peers/:peerId/test', async (req: Request, res: Response) => {
        try {
            const result = await tcpAppManager.testPeer(req.params.id, req.params.peerId);
            res.json(result);
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // GET /api/custom-tcp-apps/:id/status — Status & Metrics snapshot
    router.get('/:id/status', (req: Request, res: Response) => {
        try {
            const metrics = tcpAppManager.getAppStatus(req.params.id);
            res.json(metrics);
        } catch (err: any) {
            res.status(404).json({ error: err.message });
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

    // ─── Prisma SD-WAN Custom Apps Sync Endpoints ─────────────────────────────

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

    return router;
}

function getPythonPath(): string {
    const cwd = process.cwd();
    const candidates = [
        path.join(cwd, 'engines', '.venv', 'bin', 'python3'),
        path.join(cwd, '..', 'engines', '.venv', 'bin', 'python3'),
        '/app/engines/.venv/bin/python3'
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return 'python3';
}

function getPrismaCustomAppsScript(): string {
    const cwd = process.cwd();
    const candidates = [
        path.join(cwd, 'engines', 'prisma_custom_apps.py'),
        path.join(cwd, '..', 'engines', 'prisma_custom_apps.py'),
        '/app/engines/prisma_custom_apps.py'
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return 'engines/prisma_custom_apps.py';
}

function runPrismaCustomApps(args: string[]): Promise<any> {
    return new Promise((resolve, reject) => {
        const script = getPrismaCustomAppsScript();
        const python = getPythonPath();
        const fullArgs = [script, ...args, '--json'];

        const proc = spawn(python, fullArgs, {
            timeout: 35000,
            env: { ...process.env }
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
