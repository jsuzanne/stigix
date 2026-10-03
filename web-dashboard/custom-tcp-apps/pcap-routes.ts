import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

export function createPcapApiRouter(configDir: string, projectRoot: string, pythonPath: string): Router {
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
        res.json({
            enabled: isEnabled(),
            max_upload_mb: maxUploadMb,
            parser_available: fs.existsSync(parserScript)
        });
    });

    // POST /api/pcap/inspect - Upload a PCAP and return flow preview
    router.post('/inspect', checkFeatureFlag, upload.single('pcap'), (req: Request, res: Response) => {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No capture file uploaded' });
        }

        const filePath = req.file.path;
        const scrub = req.body.scrub === 'true' || req.body.scrub === true;

        const args = [parserScript, filePath, '--inspect', '--json'];
        if (scrub) args.push('--scrub');

        const proc = spawn(pythonPath, args);
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', data => { stdout += data.toString(); });
        proc.stderr.on('data', data => { stderr += data.toString(); });

        proc.on('close', code => {
            if (code !== 0) {
                // Cleanup on failure
                try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
                return res.status(500).json({
                    success: false,
                    error: `PCAP parser exited with code ${code}`,
                    details: stderr.trim()
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
        const { temp_file_token, name, category, app_id, threat_id, scrub, flow_ids } = req.body;

        if (!temp_file_token) {
            return res.status(400).json({ success: false, error: 'Missing temp_file_token' });
        }

        // Sanitize token
        const safeToken = path.basename(temp_file_token);
        const filePath = path.join(uploadsDir, safeToken);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, error: 'Temporary capture file expired or not found' });
        }

        const outName = `${safeToken}.stx-replay`;
        const outPath = path.join(profilesDir, outName);

        const args = [parserScript, filePath, '--out', outPath, '--json'];
        if (name) args.push('--name', name);
        if (category) args.push('--category', category);
        if (app_id) args.push('--app-id', app_id);
        if (threat_id) args.push('--threat-id', threat_id);
        if (scrub) args.push('--scrub');
        if (Array.isArray(flow_ids)) {
            flow_ids.forEach((id: number) => args.push('--flow-id', String(id)));
        }

        const proc = spawn(pythonPath, args);
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', data => { stdout += data.toString(); });
        proc.stderr.on('data', data => { stderr += data.toString(); });

        proc.on('close', code => {
            // Delete raw uploaded PCAP file per PRD Section 13 (data protection)
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}

            if (code !== 0) {
                return res.status(500).json({
                    success: false,
                    error: `Profile compilation exited with code ${code}`,
                    details: stderr.trim()
                });
            }

            try {
                const result = JSON.parse(stdout);
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

    // GET /api/pcap/profiles - List available compiled replay profiles
    router.get('/profiles', checkFeatureFlag, (_req: Request, res: Response) => {
        try {
            if (!fs.existsSync(profilesDir)) {
                return res.json({ profiles: [] });
            }
            const files = fs.readdirSync(profilesDir).filter(f => f.endsWith('.stx-replay'));
            const profiles = files.map(file => {
                const fullPath = path.join(profilesDir, file);
                const stat = fs.statSync(fullPath);
                return {
                    file_name: file,
                    size_bytes: stat.size,
                    created_at: stat.birthtime || stat.mtime
                };
            });
            res.json({ profiles });
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
}
