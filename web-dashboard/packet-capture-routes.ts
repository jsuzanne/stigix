import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

export function createCaptureApiRouter(
    configDir: string,
    projectRoot: string,
    pythonPath: string
): Router {
    const router = Router();
    const capturesDir = path.join(configDir, 'captures');
    const pcapUploadsDir = path.join(configDir, 'pcap-uploads');

    if (!fs.existsSync(capturesDir)) fs.mkdirSync(capturesDir, { recursive: true });
    if (!fs.existsSync(pcapUploadsDir)) fs.mkdirSync(pcapUploadsDir, { recursive: true });

    const captureScript = path.join(projectRoot, 'engines', 'pcap_capture_engine.py');

    const runEngine = (args: string[]): Promise<any> => {
        return new Promise((resolve, reject) => {
            const env = {
                ...process.env,
                STIGIX_CAPTURES_DIR: capturesDir
            };
            const proc = spawn(pythonPath, [captureScript, ...args], { env });
            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (d) => { stdout += d.toString(); });
            proc.stderr.on('data', (d) => { stderr += d.toString(); });

            proc.on('close', (code) => {
                if (code !== 0) {
                    try {
                        const parsedErr = JSON.parse(stdout);
                        return resolve(parsedErr);
                    } catch {
                        return reject(new Error(stderr || `Engine exited with code ${code}`));
                    }
                }
                try {
                    const parsed = JSON.parse(stdout);
                    resolve(parsed);
                } catch (e: any) {
                    resolve({ raw: stdout, error: 'JSON parse failed' });
                }
            });

            proc.on('error', (err) => reject(err));
        });
    };

    // 1. Interfaces
    router.get('/interfaces', async (_req: Request, res: Response) => {
        try {
            const data = await runEngine(['interfaces']);
            res.json(data);
        } catch (e: any) {
            res.status(500).json({ error: e.message || 'Failed to list interfaces' });
        }
    });

    // 2. Presets
    router.get('/presets', async (_req: Request, res: Response) => {
        try {
            const data = await runEngine(['presets']);
            res.json(data);
        } catch (e: any) {
            res.status(500).json({ error: e.message || 'Failed to list presets' });
        }
    });

    // 3. Start Capture
    router.post('/start', async (req: Request, res: Response) => {
        try {
            const { interface: iface = 'any', bpf = '', duration = 30, maxPackets = 2000, snaplen = 1500 } = req.body;
            const args = [
                'start',
                '--interface', String(iface),
                '--duration', String(duration),
                '--max-packets', String(maxPackets),
                '--snaplen', String(snaplen)
            ];
            if (bpf && String(bpf).trim()) {
                args.push('--bpf', String(bpf).trim());
            }

            const data = await runEngine(args);
            if (data.error) {
                return res.status(400).json(data);
            }
            res.json(data);
        } catch (e: any) {
            res.status(500).json({ error: e.message || 'Failed to start capture' });
        }
    });

    // 4. Status
    router.get('/status', async (_req: Request, res: Response) => {
        try {
            const data = await runEngine(['status']);
            res.json(data);
        } catch (e: any) {
            res.status(500).json({ error: e.message || 'Failed to get capture status' });
        }
    });

    // 5. Stop Capture
    router.post('/stop', async (_req: Request, res: Response) => {
        try {
            const data = await runEngine(['stop']);
            res.json(data);
        } catch (e: any) {
            res.status(500).json({ error: e.message || 'Failed to stop capture' });
        }
    });

    // 6. Dissect Packets
    router.get('/packets', async (req: Request, res: Response) => {
        try {
            let targetFile = req.query.file ? String(req.query.file) : '';
            const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;
            const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 500;

            if (!targetFile) {
                // Read active session to find current pcap
                const status = await runEngine(['status']);
                if (status && status.pcap_path) {
                    targetFile = status.pcap_path;
                }
            } else if (!targetFile.startsWith('/')) {
                // If relative filename given, prepend capturesDir
                targetFile = path.join(capturesDir, path.basename(targetFile));
            }

            if (!targetFile || !fs.existsSync(targetFile)) {
                return res.json({ packets: [], total_packets: 0, count: 0, file: '' });
            }

            const data = await runEngine(['dissect', '--file', targetFile, '--offset', String(offset), '--limit', String(limit)]);
            res.json(data);
        } catch (e: any) {
            res.status(500).json({ error: e.message || 'Failed to dissect packets' });
        }
    });

    // 7. History / List saved captures
    router.get('/history', async (_req: Request, res: Response) => {
        try {
            const data = await runEngine(['list']);
            res.json(data);
        } catch (e: any) {
            res.status(500).json({ error: e.message || 'Failed to list captures' });
        }
    });

    // 8. Download raw .pcap
    router.get('/download/:filename', (req: Request, res: Response) => {
        const safeName = path.basename(req.params.filename);
        if (!safeName.endsWith('.pcap')) {
            return res.status(400).json({ error: 'Invalid file extension' });
        }
        const fullPath = path.join(capturesDir, safeName);
        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: 'Capture file not found' });
        }

        res.setHeader('Content-Type', 'application/vnd.tcpdump.pcap');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
        fs.createReadStream(fullPath).pipe(res);
    });

    // 9. Delete capture
    router.delete('/:filename', async (req: Request, res: Response) => {
        try {
            const safeName = path.basename(req.params.filename);
            const data = await runEngine(['delete', '--filename', safeName]);
            res.json(data);
        } catch (e: any) {
            res.status(500).json({ error: e.message || 'Failed to delete capture' });
        }
    });

    // 10. Send to PCAP Replay Engine
    router.post('/send-to-replay', async (req: Request, res: Response) => {
        try {
            const { filename } = req.body;
            if (!filename) {
                return res.status(400).json({ error: 'Filename is required' });
            }
            const safeName = path.basename(filename);
            const sourcePcap = path.join(capturesDir, safeName);
            if (!fs.existsSync(sourcePcap)) {
                return res.status(404).json({ error: 'Source capture not found' });
            }

            const replayDestFilename = `${Date.now()}-${safeName}`;
            const destPath = path.join(pcapUploadsDir, replayDestFilename);

            fs.copyFileSync(sourcePcap, destPath);

            res.json({
                success: true,
                message: `Successfully transferred "${safeName}" to PCAP Replay catalog!`,
                replayFilename: replayDestFilename
            });
        } catch (e: any) {
            res.status(500).json({ error: e.message || 'Failed to send capture to replay' });
        }
    });

    return router;
}
