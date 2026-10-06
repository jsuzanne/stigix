import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import zlib from 'zlib';

export function createPcapApiRouter(
    configDir: string,
    projectRoot: string,
    pythonPath: string,
    onProfilesChanged?: () => void,
    getAutoSyncThresholdMb?: () => number
): Router {
    const router = Router();

    const isEnabled = () => process.env.ENABLE_PCAP_REPLAY === 'true';
    const maxUploadMb = parseInt(process.env.PCAP_MAX_UPLOAD_MB || '100', 10);

    const uploadsDir = path.join(configDir, 'pcap-uploads');
    const profilesDir = path.join(configDir, 'pcap-profiles');

    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    if (!fs.existsSync(profilesDir)) fs.mkdirSync(profilesDir, { recursive: true });

    const parserScript = path.join(projectRoot, 'engines', 'pcap_parser.py');

    // Multer upload config
    const storage = multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, uploadsDir),
        filename: (_req, file, cb) => {
            const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
            cb(null, `${Date.now()}-${safeName}`);
        }
    });

    const upload = multer({
        storage,
        limits: { fileSize: maxUploadMb * 1024 * 1024 }
    });

    // Guard middleware
    const checkFeatureFlag = (_req: Request, res: Response, next: Function) => {
        if (!isEnabled()) {
            return res.status(403).json({
                success: false,
                error: 'PCAP Replay engine is disabled. Set ENABLE_PCAP_REPLAY=true in .env to enable.',
                enabled: false
            });
        }
        next();
    };

    // GET /api/pcap/status (Public / unauthenticated check for feature flag status)
    router.get('/status', (_req: Request, res: Response) => {
        const thresholdMb = getAutoSyncThresholdMb ? getAutoSyncThresholdMb() : 10;
        res.json({
            enabled: isEnabled(),
            max_upload_mb: maxUploadMb,
            parser_available: fs.existsSync(parserScript),
            auto_sync_threshold_mb: thresholdMb,
            ws_buffer_limit_mb: 100
        });
    });

    // POST /api/pcap/inspect - Upload a PCAP and return flow preview
    router.post('/inspect', checkFeatureFlag, upload.single('pcap'), (req: Request, res: Response) => {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No capture file uploaded' });
        }

        const filePath = req.file.path;
        const scrub = req.body.scrub === 'true' || req.body.scrub === true;
        const password = req.body.password ? String(req.body.password).trim() : '';

        const args = [parserScript, filePath, '--inspect', '--json'];
        if (scrub) args.push('--scrub');
        if (password) args.push('--password', password);

        const proc = spawn(pythonPath, args);
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', data => { stdout += data.toString(); });
        proc.stderr.on('data', data => { stderr += data.toString(); });

        proc.on('close', code => {
            if (code !== 0) {
                // Parse python json error if available
                let errorMsg = `PCAP parser exited with code ${code}`;
                try {
                    const parsedErr = JSON.parse(stdout);
                    if (parsedErr && parsedErr.error) errorMsg = parsedErr.error;
                } catch (_) {
                    if (stderr.trim()) errorMsg = stderr.trim();
                }

                // Cleanup on failure
                try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
                return res.status(500).json({
                    success: false,
                    error: errorMsg,
                    details: stderr.trim() || stdout.trim()
                });
            }

            try {
                const parsed = JSON.parse(stdout);
                // Return inspection data and temp file token
                res.json({
                    success: true,
                    temp_file_token: path.basename(filePath),
                    inspection: parsed
                });
            } catch (err: any) {
                try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
                res.status(500).json({
                    success: false,
                    error: 'Failed to parse inspection output',
                    raw: stdout
                });
            }
        });
    });

    // POST /api/pcap/compile - Compile selected flow(s) into .stx-replay profile
    router.post('/compile', checkFeatureFlag, (req: Request, res: Response) => {
        const { temp_file_token, name, category, app_id, threat_id, scrub, flow_ids, port, password } = req.body;

        if (!temp_file_token) {
            return res.status(400).json({ success: false, error: 'Missing temp_file_token' });
        }

        // Sanitize token
        const safeToken = path.basename(temp_file_token);
        const filePath = path.join(uploadsDir, safeToken);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, error: 'Temporary capture file expired or not found. Please upload again.' });
        }

        const outName = `${safeToken}.stx-replay`;
        const outPath = path.join(profilesDir, outName);

        const args = [parserScript, filePath, '--out', outPath, '--json'];
        if (name) args.push('--name', name);
        if (category) args.push('--category', category);
        if (app_id) args.push('--app-id', app_id);
        if (threat_id) args.push('--threat-id', threat_id);
        if (port) args.push('--port', String(port));
        if (scrub) args.push('--scrub');
        if (password) args.push('--password', String(password).trim());
        if (Array.isArray(flow_ids)) {
            flow_ids.forEach((id: number) => args.push('--flow-id', String(id)));
        }

        const proc = spawn(pythonPath, args);
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', data => { stdout += data.toString(); });
        proc.stderr.on('data', data => { stderr += data.toString(); });

        proc.on('close', code => {
            if (code !== 0) {
                let errorMsg = `Profile compilation failed`;
                try {
                    const parsedErr = JSON.parse(stdout);
                    if (parsedErr && parsedErr.error) errorMsg = parsedErr.error;
                } catch (_) {
                    if (stderr.trim()) errorMsg = stderr.trim();
                }

                // Keep filePath on error so user can correct parameters or retry
                return res.status(500).json({
                    success: false,
                    error: errorMsg,
                    details: stderr.trim() || stdout.trim()
                });
            }

            // Delete raw uploaded file only upon successful compilation
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}

            try {
                const result = JSON.parse(stdout);
                onProfilesChanged?.();
                res.json({
                    success: true,
                    profile_id: result.profile_id,
                    profile_file: outName,
                    stats: result
                });
            } catch (err: any) {
                res.status(500).json({
                    success: false,
                    error: 'Failed to parse compilation result',
                    raw: stdout
                });
            }
        });
    });

    // GET /api/pcap/profiles - List available compiled replay profiles with flow metadata
    router.get('/profiles', checkFeatureFlag, (_req: Request, res: Response) => {
        try {
            if (!fs.existsSync(profilesDir)) {
                return res.json({ profiles: [], sync_threshold_mb: 10 });
            }
            const thresholdMb = getAutoSyncThresholdMb ? getAutoSyncThresholdMb() : 10;
            const thresholdBytes = thresholdMb * 1024 * 1024;
            const files = fs.readdirSync(profilesDir).filter(f => f.endsWith('.stx-replay'));
            const profiles = files.map(file => {
                const fullPath = path.join(profilesDir, file);
                const stat = fs.statSync(fullPath);
                let metadata: any = {};
                try {
                    const buf = fs.readFileSync(fullPath);
                    const unzipped = zlib.gunzipSync(buf);
                    const json = JSON.parse(unzipped.toString('utf8'));
                    metadata = {
                        id: json.id,
                        name: json.name,
                        category: json.category,
                        flows_count: json.flows?.length || 0,
                        total_turns: json.flows?.reduce((acc: number, f: any) => acc + (f.turns?.length || 0), 0) || 0,
                        primary_flow: json.flows?.[0] ? {
                            client_endpoint: json.flows[0].client_port ? `${json.flows[0].client_ip}:${json.flows[0].client_port}` : json.flows[0].client_ip,
                            server_endpoint: `${json.flows[0].server_ip}:${json.flows[0].server_port}`,
                            server_port: json.flows[0].server_port,
                            transport: json.flows[0].transport
                        } : null
                    };
                } catch (_) {}

                const isFleetSynced = stat.size <= thresholdBytes;

                return {
                    file_name: file,
                    size_bytes: stat.size,
                    created_at: stat.birthtime || stat.mtime,
                    is_fleet_synced: isFleetSynced,
                    sync_threshold_mb: thresholdMb,
                    ...metadata
                };
            });
            res.json({ profiles, sync_threshold_mb: thresholdMb });
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /api/pcap/profiles/download/:filename - Download a compiled profile (.stx-replay)
    router.get('/profiles/download/:filename', checkFeatureFlag, (req: Request, res: Response) => {
        const safeFile = path.basename(req.params.filename);
        const filePath = path.join(profilesDir, safeFile);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        res.setHeader('Content-Disposition', `attachment; filename="${safeFile}"`);
        res.setHeader('Content-Type', 'application/gzip');
        fs.createReadStream(filePath).pipe(res);
    });

    // GET /api/pcap/profiles/details/:filename - Read unpacked profile JSON (flows, turns, metadata)
    router.get('/profiles/details/:filename', checkFeatureFlag, (req: Request, res: Response) => {
        const safeFile = path.basename(req.params.filename);
        const filePath = path.join(profilesDir, safeFile);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        try {
            const buf = fs.readFileSync(filePath);
            const unzipped = zlib.gunzipSync(buf);
            const json = JSON.parse(unzipped.toString('utf8'));
            res.json({ success: true, profile: json });
        } catch (err: any) {
            res.status(500).json({ success: false, error: `Failed to unpack profile: ${err.message}` });
        }
    });

    // POST /api/pcap/profiles/upload - Upload an already compiled .stx-replay profile
    router.post('/profiles/upload', checkFeatureFlag, upload.single('profile'), (req: Request, res: Response) => {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No profile file provided' });
        }
        try {
            const destPath = path.join(profilesDir, path.basename(req.file.originalname));
            if (fs.existsSync(req.file.path)) {
                fs.copyFileSync(req.file.path, destPath);
                try { fs.unlinkSync(req.file.path); } catch (_) {}
            }
            onProfilesChanged?.();
            res.json({ success: true, file_name: path.basename(req.file.originalname) });
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // DELETE /api/pcap/profiles/:filename - Delete a compiled profile
    router.delete('/profiles/:filename', checkFeatureFlag, (req: Request, res: Response) => {
        const safeFile = path.basename(req.params.filename);
        const filePath = path.join(profilesDir, safeFile);
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                onProfilesChanged?.();
                return res.json({ success: true, deleted: safeFile });
            } catch (err: any) {
                return res.status(500).json({ success: false, error: err.message });
            }
        }
        res.status(404).json({ success: false, error: 'Profile not found' });
    });

    // PUT /api/pcap/profiles/:filename - Edit a compiled profile (name, category, server_port, description)
    router.put('/profiles/:filename', checkFeatureFlag, (req: Request, res: Response) => {
        const safeFile = path.basename(req.params.filename);
        const filePath = path.join(profilesDir, safeFile);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        try {
            const buf = fs.readFileSync(filePath);
            const unzipped = zlib.gunzipSync(buf);
            const json = JSON.parse(unzipped.toString('utf8'));

            const { name, category, server_port, description } = req.body;
            if (name !== undefined && String(name).trim()) {
                json.name = String(name).trim();
            }
            if (category !== undefined && String(category).trim()) {
                json.category = String(category).trim();
            }
            if (description !== undefined) {
                json.description = String(description).trim();
            }
            if (server_port !== undefined && !isNaN(parseInt(server_port, 10))) {
                const portNum = parseInt(server_port, 10);
                if (Array.isArray(json.flows)) {
                    json.flows.forEach((flow: any) => {
                        flow.server_port = portNum;
                    });
                }
            }

            const updatedGzip = zlib.gzipSync(Buffer.from(JSON.stringify(json, null, 2), 'utf8'));
            fs.writeFileSync(filePath, updatedGzip);
            onProfilesChanged?.();
            res.json({ success: true, updated: safeFile, profile: json });
        } catch (err: any) {
            res.status(500).json({ success: false, error: `Failed to update profile: ${err.message}` });
        }
    });

    // --- M2: Active Replay Process Tracking ---
    interface ActiveReplayJob {
        id: string;
        role: 'server' | 'client';
        profile_file: string;
        target?: string;
        port?: number;
        pid?: number;
        proc?: any;
        startedAt: number;
        recentEvents: any[];
        lastVerdict?: string;
        status: 'running' | 'stopped' | 'failed' | 'completed';
    }

    const activeJobs = new Map<string, ActiveReplayJob>();
    const runtimeScript = path.join(projectRoot, 'engines', 'pcap_replay_runtime.py');

    // POST /api/pcap/replay/start - Start server or client replay runtime
    router.post('/replay/start', checkFeatureFlag, (req: Request, res: Response) => {
        const { role, profile_file, target, port, loop, interval } = req.body;

        if (!role || !profile_file) {
            return res.status(400).json({ success: false, error: 'Missing role or profile_file' });
        }
        if (role === 'client' && !target) {
            return res.status(400).json({ success: false, error: 'Target IP is required for client role' });
        }

        const safeProfile = path.basename(profile_file);
        const profilePath = path.join(profilesDir, safeProfile);
        if (!fs.existsSync(profilePath)) {
            return res.status(404).json({ success: false, error: 'Profile file not found' });
        }

        const jobId = `job-${role}-${Date.now()}`;
        const args = [runtimeScript, profilePath, '--role', role];
        if (target) args.push('--target', target);
        if (port) args.push('--port', String(port));
        if (loop) args.push('--loop');
        if (interval) args.push('--interval', String(interval));

        const proc = spawn(pythonPath, args);
        const job: ActiveReplayJob = {
            id: jobId,
            role,
            profile_file: safeProfile,
            target,
            port,
            pid: proc.pid,
            proc,
            startedAt: Date.now(),
            recentEvents: [],
            status: 'running'
        };

        proc.stdout.on('data', data => {
            const lines = data.toString().split('\n').filter((l: string) => l.trim().length > 0);
            for (const line of lines) {
                try {
                    const ev = JSON.parse(line);
                    job.recentEvents.push(ev);
                    if (ev.verdict) job.lastVerdict = ev.verdict;
                    if (job.recentEvents.length > 50) job.recentEvents.shift();
                } catch (_) {}
            }
        });

        proc.stderr.on('data', data => {
            job.recentEvents.push({ timestamp: Date.now() / 1000, event: 'stderr', text: data.toString() });
        });

        proc.on('close', code => {
            job.status = code === 0 ? 'completed' : 'failed';
            delete job.proc;
        });

        activeJobs.set(jobId, job);

        res.json({
            success: true,
            job_id: jobId,
            pid: proc.pid,
            role,
            profile: safeProfile
        });
    });

    // POST /api/pcap/replay/stop - Stop a running replay job
    router.post('/replay/stop', checkFeatureFlag, (req: Request, res: Response) => {
        const { job_id } = req.body;
        if (!job_id) {
            return res.status(400).json({ success: false, error: 'Missing job_id' });
        }
        const job = activeJobs.get(job_id);
        if (!job) {
            return res.status(404).json({ success: false, error: 'Job not found' });
        }

        if (job.proc) {
            try {
                job.proc.kill('SIGTERM');
            } catch (_) {}
        }
        job.status = 'stopped';
        res.json({ success: true, job_id, status: 'stopped' });
    });

    // GET /api/pcap/replay/jobs - Get active and recent replay jobs
    router.get('/replay/jobs', checkFeatureFlag, (_req: Request, res: Response) => {
        const jobsList = Array.from(activeJobs.values()).map(j => ({
            id: j.id,
            role: j.role,
            profile_file: j.profile_file,
            target: j.target,
            port: j.port,
            pid: j.pid,
            startedAt: j.startedAt,
            status: j.status,
            lastVerdict: j.lastVerdict,
            recentEventsCount: j.recentEvents.length,
            recentEvents: j.recentEvents,
            latestEvent: j.recentEvents[j.recentEvents.length - 1] || null
        }));
        res.json({ jobs: jobsList });
    });

    // GET /api/pcap/replay/active-server - Check if there is an active replay server listening on this node
    router.get('/replay/active-server', checkFeatureFlag, (_req: Request, res: Response) => {
        const runningServer = Array.from(activeJobs.values()).find(j => j.role === 'server' && j.status === 'running');
        if (runningServer) {
            return res.json({
                active: true,
                profile_file: runningServer.profile_file,
                port: runningServer.port,
                startedAt: runningServer.startedAt
            });
        }
        res.json({ active: false });
    });

    // GET /api/pcap/replay/discover?target=192.168.203.100 - Query remote target node for active replay listener
    router.get('/replay/discover', checkFeatureFlag, async (req: Request, res: Response) => {
        const target = req.query.target as string;
        if (!target) return res.status(400).json({ error: 'Missing target' });
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const targetRes = await fetch(`http://${target}:8080/api/pcap/replay/active-server`, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (targetRes.ok) {
                const data = await targetRes.json();
                return res.json(data);
            }
        } catch (_) {}
        res.json({ active: false });
    });

    return router;
}

