import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import net from 'net';
import tls from 'tls';
import dgram from 'dgram';
import dns from 'dns';
import http from 'http';
import jwt from 'jsonwebtoken';
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
    const systemSettingsFile = path.join(configDir, 'system-settings.json');
    const resolveStigixGoBin = (): string | null => {
        const candidates = [
            '/usr/local/bin/stigix-go',
            path.join(projectRoot, 'engines', 'stigix-go', 'stigix-go')
        ];
        for (const c of candidates) {
            if (fs.existsSync(c)) return c;
        }
        return null;
    };
    const shouldUseGoEngine = (): boolean => {
        try {
            if (fs.existsSync(systemSettingsFile)) {
                const s = JSON.parse(fs.readFileSync(systemSettingsFile, 'utf8'));
                if (s.engine_runtime === 'go') return true;
                if (s.engine_runtime === 'legacy') return false;
            }
        } catch {}
        return process.env.ENABLE_GO_ENGINE === 'true' || process.env.ENABLE_GO_ENGINE === '1';
    };

    const runEngine = (args: string[]): Promise<any> => {
        return new Promise((resolve, reject) => {
            const env = {
                ...process.env,
                CONFIG_DIR: configDir,
                STIGIX_CAPTURES_DIR: capturesDir
            };
            // Always use pcap_capture_engine.py so tcpdump runs with --immediate-mode
            // (disabling TPACKET_V3 kernel ring block buffering on short sub-second probe captures)
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

    // Helper: detect local Stigix site name from config or environment
    const getLocalSiteName = (): string => {
        if (process.env.SITE_NAME) return process.env.SITE_NAME.trim();
        if (process.env.PRISMA_SDWAN_SITE_NAME) return process.env.PRISMA_SDWAN_SITE_NAME.trim();
        const candidates = [
            path.join(configDir, 'site-detection.json'),
            path.join(configDir, 'system-info.json'),
            path.join(configDir, 'registry-config.json'),
            path.join(configDir, 'site.json'),
            path.join(configDir, 'site-name.json'),
            path.join(configDir, 'prisma-config.json')
        ];
        for (const p of candidates) {
            if (fs.existsSync(p)) {
                try {
                    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
                    const s =
                        doc.detected_site_name ||
                        doc.site_name ||
                        doc.site ||
                        doc.siteName ||
                        doc.SITE_NAME ||
                        doc.instance_id;
                    if (s && typeof s === 'string' && s.trim()) {
                        return s.trim().replace(/-(ubuntu|vm|stigix|node)$/i, '');
                    }
                } catch {}
            }
        }
        return '';
    };

    // Helper: run sdwan_ion_cli.py with JSON output and optional real-time stderr progress callback
    const runIonCliScript = (
        cliArgs: string[],
        timeoutMs = 45000,
        onProgress?: (prog: any) => void
    ): Promise<any> => {
        return new Promise((resolve) => {
            const ionCliScript = path.join(projectRoot, 'engines', 'sdwan_ion_cli.py');
            if (!fs.existsSync(ionCliScript)) {
                return resolve({ success: false, error: 'sdwan_ion_cli.py not found' });
            }
            const args = [ionCliScript, ...cliArgs, '--json'];
            const candidateCreds = [
                path.join(configDir, 'prisma-config.json'),
                path.join(configDir, 'credentials.json'),
                '/data/stigix/config/prisma-config.json',
                '/app/config/prisma-config.json'
            ];
            for (const cPath of candidateCreds) {
                if (fs.existsSync(cPath)) {
                    args.push('--credentials', cPath);
                    break;
                }
            }
            const proc = spawn(pythonPath, args, {
                cwd: path.join(projectRoot, 'engines'),
                timeout: timeoutMs,
                env: {
                    ...process.env,
                    PYTHONUNBUFFERED: '1',
                    PRISMA_SDWAN_TSG_ID: process.env.PRISMA_SDWAN_TSGID || process.env.PRISMA_SDWAN_TSG_ID
                }
            });
            let stdout = '';
            let stderr = '';
            let stderrLineBuf = '';
            let lastProgress: any = null;
            proc.stdout.on('data', (d) => { stdout += d.toString(); });
            proc.stderr.on('data', (d) => {
                const chunk = d.toString();
                stderr += chunk;
                stderrLineBuf += chunk;
                const lines = stderrLineBuf.split('\n');
                stderrLineBuf = lines.pop() || '';
                for (const line of lines) {
                    const markerIdx = line.indexOf('STIGIX_TRACE_PROGRESS:');
                    if (markerIdx >= 0) {
                        try {
                            const jsonPart = line.slice(markerIdx + 'STIGIX_TRACE_PROGRESS:'.length).trim();
                            const parsedProg = JSON.parse(jsonPart);
                            lastProgress = parsedProg;
                            if (onProgress) onProgress(parsedProg);
                        } catch {}
                    }
                }
            });
            proc.on('close', () => {
                try {
                    const idx = stdout.indexOf('{');
                    const parsed = JSON.parse(idx >= 0 ? stdout.slice(idx) : stdout);
                    resolve(parsed);
                } catch {
                    // If Ingress ION already succeeded (lastProgress emitted) before Transit Hub CLI timed out,
                    // preserve Hop 2 (ingress_ion + primary_flow) and mark only Hop 3 (transit_ion) as timed out!
                    if (lastProgress && lastProgress.ingress_ion) {
                        resolve({
                            success: true,
                            forwarding_mode: lastProgress.forwarding_mode || 'VPN_OVERLAY',
                            peer_site_name: lastProgress.peer_site_name || 'Transit Hub',
                            ingress_ion: {
                                ...lastProgress.ingress_ion,
                                success: true,
                                flows: lastProgress.primary_flow ? [lastProgress.primary_flow] : []
                            },
                            primary_flow: lastProgress.primary_flow || null,
                            transit_ion: {
                                success: false,
                                element: lastProgress.peer_site_name || 'Transit Hub',
                                site_name: lastProgress.peer_site_name || 'Transit Hub',
                                error: `Transit Hub (${lastProgress.peer_site_name || 'Hub'}) WebSocket CLI timed out while inspecting flow table`
                            },
                            servicelinks: []
                        });
                        return;
                    }
                    const cleanErr = (stderr || stdout || '')
                        .split('\n')
                        .filter((l) => !l.includes('STIGIX_TRACE_PROGRESS:'))
                        .join('\n')
                        .trim();
                    resolve({
                        success: false,
                        error: (cleanErr || 'vION WebSocket CLI session timed out').slice(0, 400)
                    });
                }
            });
            proc.on('error', (err) => {
                resolve({ success: false, error: err.message });
            });
        });
    };

    let cachedTraceSites: { ts: number; data: any } | null = null;
    let cachedFleetPeers: { ts: number; map: Map<string, { name: string; host: string; port: number; version: string; is_local: boolean }> } | null = null;
    let activeFlowTraceProgress: any = null;
    let activeDelegatedPeer: { host: string; port: number; authHeader?: string } | null = null;

    const normalizeSitePrefix = (raw?: string): string => {
        if (!raw) return '';
        return String(raw)
            .trim()
            .replace(/-(ubuntu|debian|linux|node|vm|host|srv|server|stigix)$/i, '')
            .trim()
            .toUpperCase();
    };

    const getFleetStigixPeersMap = async (localSite: string): Promise<Map<string, { name: string; host: string; port: number; version: string; is_local: boolean }>> => {
        const now = Date.now();
        if (cachedFleetPeers && now - cachedFleetPeers.ts < 15_000) {
            return cachedFleetPeers.map;
        }
        const map = new Map<string, { name: string; host: string; port: number; version: string; is_local: boolean }>();
        const localNorm = normalizeSitePrefix(localSite);

        const ingestTargetList = (list: any[]) => {
            if (!Array.isArray(list)) return;
            for (const t of list) {
                if (!t || !t.name || !t.host || t.enabled === false) continue;
                const siteKey = normalizeSitePrefix(t.name);
                if (!siteKey) continue;
                const isSelf = Boolean(t.meta?.self) || (localNorm && siteKey === localNorm);
                const entry = {
                    name: String(t.name),
                    host: String(t.host).trim(),
                    port: Number(t.ports?.dashboard || 8080),
                    version: String(t.meta?.version || ''),
                    is_local: isSelf
                };
                if (!map.has(siteKey) || isSelf || t.meta?.registry) {
                    map.set(siteKey, entry);
                }
            }
        };

        try {
            const secPath = path.join(configDir, '.cli-local-secret');
            const cliSecret = fs.existsSync(secPath) ? fs.readFileSync(secPath, 'utf8').trim() : '';
            const localPort = parseInt(process.env.PORT || '8080', 10) || 8080;
            const targetsData = await new Promise<any[]>((resolve) => {
                const req = http.get(
                    {
                        hostname: '127.0.0.1',
                        port: localPort,
                        path: '/api/targets',
                        headers: cliSecret ? { 'x-stigix-cli-secret': cliSecret } : {},
                        timeout: 1500
                    },
                    (resp) => {
                        let body = '';
                        resp.on('data', (c) => { body += c.toString(); });
                        resp.on('end', () => {
                            try {
                                const parsed = JSON.parse(body);
                                resolve(Array.isArray(parsed) ? parsed : []);
                            } catch {
                                resolve([]);
                            }
                        });
                    }
                );
                req.on('error', () => resolve([]));
                req.on('timeout', () => { req.destroy(); resolve([]); });
            });
            ingestTargetList(targetsData);
        } catch {}

        if (map.size === 0) {
            try {
                const tFile = path.join(configDir, 'targets.json');
                if (fs.existsSync(tFile)) {
                    ingestTargetList(JSON.parse(fs.readFileSync(tFile, 'utf8')));
                }
            } catch {}
        }

        cachedFleetPeers = { ts: now, map };
        return map;
    };

    const forwardHttpJson = (opts: {
        host: string;
        port: number;
        path: string;
        method: 'GET' | 'POST';
        headers?: Record<string, string>;
        body?: any;
        timeoutMs?: number;
    }): Promise<{ status: number; data: any }> => {
        return new Promise((resolve) => {
            const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : '';
            const headers: Record<string, string> = {
                'Accept': 'application/json',
                ...(opts.headers || {})
            };
            if (bodyStr) {
                headers['Content-Type'] = 'application/json';
                headers['Content-Length'] = String(Buffer.byteLength(bodyStr));
            }
            const req = http.request(
                {
                    hostname: opts.host,
                    port: opts.port || 8080,
                    path: opts.path,
                    method: opts.method,
                    headers,
                    timeout: opts.timeoutMs || 60000
                },
                (resp) => {
                    let raw = '';
                    resp.on('data', (chunk) => { raw += chunk.toString(); });
                    resp.on('end', () => {
                        try {
                            resolve({ status: resp.statusCode || 500, data: JSON.parse(raw) });
                        } catch {
                            resolve({ status: resp.statusCode || 500, data: null });
                        }
                    });
                }
            );
            req.on('error', () => resolve({ status: 0, data: null }));
            req.on('timeout', () => { req.destroy(); resolve({ status: 0, data: null }); });
            if (bodyStr) req.write(bodyStr);
            req.end();
        });
    };

    // 11. List Prisma SD-WAN tenant sites & elements for E2E Flow Trace
    router.get('/trace-sites', async (req: Request, res: Response) => {
        try {
            const force = req.query.refresh === '1' || req.query.refresh === 'true';
            const now = Date.now();
            const localSite = getLocalSiteName();
            const peersMap = await getFleetStigixPeersMap(localSite);
            const enrichSites = (rawSites: any[]) =>
                (Array.isArray(rawSites) ? rawSites : []).map((s: any) => {
                    const sKey = normalizeSitePrefix(s.site_name);
                    const peer = peersMap.get(sKey) || null;
                    return {
                        ...s,
                        stigix_peer: peer
                    };
                });

            if (!force && cachedTraceSites && now - cachedTraceSites.ts < 60_000) {
                return res.json({
                    ...cachedTraceSites.data,
                    sites: enrichSites(cachedTraceSites.data.sites),
                    local_site_name: localSite
                });
            }
            const result = await runIonCliScript(['--list-sites'], 25000);
            if (result && result.success && Array.isArray(result.sites)) {
                cachedTraceSites = { ts: now, data: result };
            }
            res.json({
                ...result,
                sites: enrichSites(result?.sites || []),
                local_site_name: localSite
            });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message || 'Failed to list tenant sites' });
        }
    });

    // 11b. Live Progress Endpoint for End-to-End Flow & Path Trace
    router.get('/trace-flow/progress', async (req: Request, res: Response) => {
        if (activeDelegatedPeer && req.headers['x-stigix-delegated'] !== '1') {
            try {
                const hdrs: Record<string, string> = { 'x-stigix-delegated': '1' };
                if (req.headers.authorization) hdrs['Authorization'] = String(req.headers.authorization);
                else if (activeDelegatedPeer.authHeader) hdrs['Authorization'] = activeDelegatedPeer.authHeader;
                const peerProg = await forwardHttpJson({
                    host: activeDelegatedPeer.host,
                    port: activeDelegatedPeer.port,
                    path: '/api/capture/trace-flow/progress',
                    method: 'GET',
                    headers: hdrs,
                    timeoutMs: 1500
                });
                if (peerProg.status === 200 && peerProg.data) {
                    return res.json(peerProg.data);
                }
            } catch {}
        }
        if (!activeFlowTraceProgress) {
            return res.json({ active: false });
        }
        res.json({
            ...activeFlowTraceProgress,
            elapsed_ms: Date.now() - (activeFlowTraceProgress.started_at || Date.now())
        });
    });

    // 12. Execute End-to-End Flow & Path Trace (NWPI-style Stigix PCAP + ION CLI Flow Trace)
    router.post('/trace-flow', async (req: Request, res: Response) => {
        const t0 = Date.now();
        const {
            traceId = `trace_${t0}`,
            sourceSite = '',
            sourceMode = 'auto', // 'auto' | 'stigix' | 'ion_only'
            srcIp = '',
            destination = '',
            dstPort = 443,
            protocol = 'tcp', // 'tcp' | 'udp' | 'icmp'
            generateProbe = true,
            interface: iface = 'any'
        } = req.body || {};

        const localSite = getLocalSiteName();
        const effectiveSourceSite = String(sourceSite || localSite || 'BR8').trim();
        const rawDest = String(destination || '').trim();
        const cleanSrcIp = String(srcIp || '').trim();
        const protoStr = String(protocol || 'tcp').toLowerCase();
        const protoNum = protoStr === 'udp' ? 17 : protoStr === 'icmp' ? 1 : 6;
        const portNum = protoNum === 1 ? 0 : (parseInt(String(dstPort || 443), 10) || 443);

        // Determine if this trace runs on the local Stigix site with local PCAP capability
        const isLocalStigixSite = Boolean(
            sourceMode !== 'ion_only' &&
            (sourceMode === 'stigix' ||
                !localSite ||
                effectiveSourceSite.toUpperCase() === localSite.toUpperCase())
        );

        // Check if the selected remote site has a Stigix Peer instance in the fleet (e.g. BR1-Ubuntu 192.168.207.10)
        const peersMap = await getFleetStigixPeersMap(localSite);
        const remoteStigixPeer = !isLocalStigixSite && sourceMode !== 'ion_only'
            ? (peersMap.get(normalizeSitePrefix(effectiveSourceSite)) || null)
            : null;
        const hasRemoteStigixPeer = Boolean(remoteStigixPeer && !remoteStigixPeer.is_local);

        // If the remote Stigix peer supports /api/capture/trace-flow, delegate execution directly
        // to that peer so it captures local PCAP + fires a local synthetic socket probe on the remote site!
        if (hasRemoteStigixPeer && remoteStigixPeer && req.headers['x-stigix-delegated'] !== '1') {
            try {
                const delegatedHdrs: Record<string, string> = { 'x-stigix-delegated': '1' };
                let authHdr = req.headers.authorization ? String(req.headers.authorization) : '';
                if (!authHdr) {
                    const secret = process.env.JWT_SECRET || 'your-secure-secret-here';
                    authHdr = `Bearer ${jwt.sign({ username: 'stigix-gateway', role: 'admin' }, secret, { expiresIn: '120s' })}`;
                }
                delegatedHdrs['Authorization'] = authHdr;
                activeDelegatedPeer = {
                    host: remoteStigixPeer.host,
                    port: remoteStigixPeer.port || 8080,
                    authHeader: authHdr
                };
                const delegatedRes = await forwardHttpJson({
                    host: remoteStigixPeer.host,
                    port: remoteStigixPeer.port || 8080,
                    path: '/api/capture/trace-flow',
                    method: 'POST',
                    headers: delegatedHdrs,
                    body: {
                        ...req.body,
                        sourceSite: effectiveSourceSite,
                        sourceMode: 'stigix'
                    },
                    timeoutMs: 85000
                });
                activeDelegatedPeer = null;
                if (delegatedRes.status === 200 && delegatedRes.data?.success) {
                    if (delegatedRes.data?.pcap?.filename && delegatedRes.data?.pcap?.raw_pcap_b64) {
                        try {
                            const localCopyPath = path.join(capturesDir, path.basename(delegatedRes.data.pcap.filename));
                            fs.writeFileSync(localCopyPath, Buffer.from(delegatedRes.data.pcap.raw_pcap_b64, 'base64'));
                        } catch {}
                        delete delegatedRes.data.pcap.raw_pcap_b64;
                    }
                    return res.json({
                        ...delegatedRes.data,
                        delegated_to_peer: remoteStigixPeer
                    });
                }
            } catch {
                activeDelegatedPeer = null;
            }
        }

        let resolvedDstIp = '';
        let dnsResolutionMs: number | null = null;
        let dnsError: string | null = null;

        const ipv4Regex = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
        if (rawDest) {
            if (ipv4Regex.test(rawDest)) {
                resolvedDstIp = rawDest;
            } else {
                const dnsT0 = Date.now();
                try {
                    const cleanHost = rawDest.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
                    const lookupRes = await dns.promises.lookup(cleanHost, { family: 4 });
                    resolvedDstIp = lookupRes.address;
                    dnsResolutionMs = Date.now() - dnsT0;
                } catch (err: any) {
                    dnsError = err.message || `Failed to resolve hostname "${rawDest}"`;
                }
            }
        }

        const dstPortLabelInit = protoNum === 1 ? 'ICMP' : `${protoStr.toUpperCase()}/${portNum || '*'}`;
        const dstLabelInit = rawDest && rawDest !== resolvedDstIp
            ? `${rawDest} (${resolvedDstIp || 'Unresolved'})`
            : (resolvedDstIp || rawDest || 'Target Destination');

        const defaultSourceIpLabel = cleanSrcIp || (hasRemoteStigixPeer && remoteStigixPeer ? remoteStigixPeer.host : 'Auto Source');

        // Initialize real-time step-by-step progress state
        activeFlowTraceProgress = {
            active: true,
            trace_id: traceId,
            started_at: t0,
            phase: isLocalStigixSite
                ? 'LOCAL_CAPTURE_AND_PROBE'
                : hasRemoteStigixPeer
                ? 'REMOTE_PEER_AND_ION_CLI'
                : 'INGRESS_ION_CLI',
            phase_label: isLocalStigixSite
                ? `Recording local PCAP & dispatching synthetic ${protoStr.toUpperCase()} probe...`
                : hasRemoteStigixPeer && remoteStigixPeer
                ? `Triggering remote Stigix Peer ${remoteStigixPeer.name} (${remoteStigixPeer.host}) & inspecting ${effectiveSourceSite} vION CLI...`
                : `Querying ${effectiveSourceSite} vION flow table via WebSocket CLI...`,
            flow_identity: {
                probe_5tuple: `${defaultSourceIpLabel} → ${resolvedDstIp || rawDest}${portNum && protoNum !== 1 ? `:${portNum}` : ''} · ${protoStr.toUpperCase()}`
            },
            hops: [
                {
                    id: 'hop_source',
                    role: isLocalStigixSite
                        ? 'SOURCE_STIGIX'
                        : hasRemoteStigixPeer
                        ? 'SOURCE_REMOTE_STIGIX'
                        : 'SOURCE_CLIENT_AGENTLESS',
                    role_label: isLocalStigixSite
                        ? 'Source Probe'
                        : hasRemoteStigixPeer
                        ? 'Remote Stigix Peer'
                        : 'Site Client (Agentless)',
                    title: isLocalStigixSite || hasRemoteStigixPeer
                        ? `Stigix ${effectiveSourceSite}`
                        : `Client (${effectiveSourceSite})`,
                    subtitle: cleanSrcIp || (
                        isLocalStigixSite
                            ? 'Capturing local NIC...'
                            : hasRemoteStigixPeer && remoteStigixPeer
                            ? `${remoteStigixPeer.host} (${remoteStigixPeer.name})`
                            : 'Agentless Mode'
                    ),
                    status: isLocalStigixSite || hasRemoteStigixPeer ? 'RUNNING' : 'PASSIVE',
                    badge: isLocalStigixSite
                        ? 'Capturing PCAP + Probe...'
                        : hasRemoteStigixPeer && remoteStigixPeer
                        ? `Stigix Peer (${remoteStigixPeer.host})`
                        : 'ION-Only Mode',
                    evidence_type: isLocalStigixSite
                        ? 'Local PCAP + Active Probe'
                        : hasRemoteStigixPeer && remoteStigixPeer
                        ? `Remote Stigix Peer (${remoteStigixPeer.version ? 'v' + remoteStigixPeer.version : 'Active'})`
                        : 'Agentless (No Local Probe)'
                },
                {
                    id: 'hop_ingress_ion',
                    role: 'INGRESS_ION',
                    role_label: 'Ingress ION',
                    title: `ION ${effectiveSourceSite}`,
                    subtitle: 'Waiting for probe generation',
                    status: isLocalStigixSite ? 'PENDING' : 'RUNNING',
                    badge: isLocalStigixSite ? 'Pending' : 'Inspecting vION CLI...',
                    evidence_type: 'vION Flow Table'
                },
                {
                    id: 'hop_transit',
                    role: 'TRANSIT_ION',
                    role_label: 'Transit / Egress Path',
                    title: 'Transit Hub / Egress',
                    subtitle: 'Pending ingress routing decision',
                    status: 'PENDING',
                    badge: 'Pending',
                    evidence_type: 'SD-WAN Control & Dataplane'
                },
                {
                    id: 'hop_destination',
                    role: 'DESTINATION',
                    role_label: `Destination ${dstPortLabelInit}`,
                    title: rawDest || resolvedDstIp || 'Destination',
                    subtitle: dstLabelInit,
                    status: dnsError ? 'BLOCKED' : 'PENDING',
                    badge: dnsError ? 'DNS Failed' : 'Pending',
                    evidence_type: 'Source Probe · No Remote Capture'
                }
            ]
        };

        let activeProbeSocket: net.Socket | null = null;
        let activeUdpSocket: dgram.Socket | null = null;
        let activePingProc: ReturnType<typeof spawn> | null = null;
        let probeKeepaliveTimer: ReturnType<typeof setInterval> | null = null;
        const sessionProbePorts = new Set<number>();
        const stopProbeKeepalive = () => {
            if (probeKeepaliveTimer) {
                clearInterval(probeKeepaliveTimer);
                probeKeepaliveTimer = null;
            }
            if (activePingProc) {
                try { activePingProc.kill('SIGTERM'); } catch {}
                activePingProc = null;
            }
            if (activeProbeSocket) {
                try { (activeProbeSocket as net.Socket).destroy(); } catch {}
                activeProbeSocket = null;
            }
            if (activeUdpSocket) {
                try { (activeUdpSocket as dgram.Socket).close(); } catch {}
                activeUdpSocket = null;
            }
        };
        let localCaptureStarted = false;
        let capturedPcapFile = '';
        let dissectedPcap: any = null;
        let bpfUsed = '';
        let probeInfo: {
            attempted: boolean;
            reachable: boolean | null;
            rttMs: number | null;
            localIp: string;
            localPort: number;
            detail: string;
        } = {
            attempted: false,
            reachable: null,
            rttMs: null,
            localIp: cleanSrcIp,
            localPort: 0,
            detail: 'Passive flow table inspection (no synthetic probe)'
        };

        try {
            // Step 1: If running on local Stigix site and resolvedDstIp is available, start a short focused PCAP
            if (isLocalStigixSite && resolvedDstIp) {
                const protoBpf = protoNum === 6 ? 'tcp' : protoNum === 17 ? 'udp' : protoNum === 1 ? 'icmp' : '';
                const bpfParts: string[] = [`host ${resolvedDstIp}`];
                if (cleanSrcIp) bpfParts.push(`host ${cleanSrcIp}`);
                if (protoBpf) bpfParts.push(protoBpf);
                if (portNum > 0 && protoNum !== 1) {
                    bpfParts.push(`port ${portNum}`);
                }
                bpfUsed = bpfParts.join(' and ');

                const traceIface = 'any';
                try {
                    const startRes = await runEngine([
                        'start',
                        '--interface', traceIface,
                        '--duration', '20',
                        '--max-packets', '400',
                        '--snaplen', '1500',
                        '--bpf', bpfUsed
                    ]);
                    if (startRes && startRes.active) {
                        localCaptureStarted = true;
                        capturedPcapFile = startRes.pcap_filename || startRes.pcap_path || '';
                        // start_capture in pcap_capture_engine.py already waits for 'listening on', add 50ms buffer
                        await new Promise((r) => setTimeout(r, 50));
                    }
                } catch {}

                // Step 2: Generate live synthetic packets & keep socket alive during ION CLI inspection
                if (generateProbe !== false) {
                    probeInfo.attempted = true;
                    const probeT0 = Date.now();
                    if (protoNum === 6) {
                        const isTlsPort = portNum === 443 || portNum === 8443;
                        const sniHost = !ipv4Regex.test(rawDest)
                            ? rawDest.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0]
                            : '';

                        // TCP / TLS Probe (hold socket open while ION CLI runs so flow remains active in vION flow table!)
                        await new Promise<void>((resolveProbe) => {
                            let settled = false;
                            let sockRef: net.Socket | tls.TLSSocket;
                            const finish = (reachable: boolean | null, detail: string) => {
                                if (settled) return;
                                settled = true;
                                probeInfo.reachable = reachable;
                                probeInfo.rttMs = Date.now() - probeT0;
                                probeInfo.localIp = sockRef?.localAddress || cleanSrcIp;
                                probeInfo.localPort = sockRef?.localPort || probeInfo.localPort || 0;
                                if (probeInfo.localPort > 0) sessionProbePorts.add(probeInfo.localPort);
                                probeInfo.detail = detail;
                                resolveProbe();
                            };

                            let probeConnected = false;
                            if (isTlsPort) {
                                const openTlsProbe = (isInitial: boolean, reusePort = true) => {
                                    probeConnected = false;
                                    const connectOpts: tls.ConnectionOptions = {
                                        host: resolvedDstIp,
                                        port: portNum,
                                        servername: sniHost || undefined,
                                        rejectUnauthorized: false
                                    };
                                    if (!isInitial && reusePort && probeInfo.localPort > 0) {
                                        (connectOpts as any).localPort = probeInfo.localPort;
                                        if (probeInfo.localIp) (connectOpts as any).localAddress = probeInfo.localIp;
                                    }
                                    const tlsSock = tls.connect(connectOpts);
                                    if (isInitial) sockRef = tlsSock;
                                    activeProbeSocket = tlsSock;
                                    tlsSock.setTimeout(isInitial ? 2500 : 1200);
                                    tlsSock.on('connect', () => {
                                        if (tlsSock.localPort) {
                                            if (isInitial && !probeInfo.localPort) probeInfo.localPort = tlsSock.localPort;
                                            sessionProbePorts.add(tlsSock.localPort);
                                        }
                                        if (isInitial && tlsSock.localAddress && !probeInfo.localIp) {
                                            probeInfo.localIp = tlsSock.localAddress;
                                        }
                                    });
                                    tlsSock.on('secureConnect', () => {
                                        probeConnected = true;
                                        if (tlsSock.localPort) sessionProbePorts.add(tlsSock.localPort);
                                        tlsSock.setKeepAlive(true, 1000);
                                        try {
                                            const hostHdr = sniHost || resolvedDstIp;
                                            // Send incomplete HTTP headers (no trailing \r\n\r\n) so the remote HTTPS server
                                            // holds the TCP connection in ESTABLISHED state while ION CLI inspects the flow table!
                                            tlsSock.write(`GET / HTTP/1.1\r\nHost: ${hostHdr}\r\nUser-Agent: Stigix-FlowTrace/2.0\r\n`);
                                        } catch {}
                                        if (isInitial) {
                                            finish(true, `TLS handshake${sniHost ? ` (SNI: ${sniHost})` : ''} succeeded (${Date.now() - probeT0}ms RTT)`);
                                        }
                                    });
                                    tlsSock.on('error', (err: any) => {
                                        probeConnected = false;
                                        if (tlsSock.localPort) sessionProbePorts.add(tlsSock.localPort);
                                        try { tlsSock.destroy(); } catch {}
                                        const code = err?.code || '';
                                        if (!isInitial && reusePort && (code === 'EADDRINUSE' || code === 'EADDRNOTAVAIL')) {
                                            openTlsProbe(false, false);
                                            return;
                                        }
                                        if (!isInitial) return;
                                        if (code === 'ECONNREFUSED') {
                                            finish(true, `TCP RST received (ECONNREFUSED in ${Date.now() - probeT0}ms — host reachable, port closed)`);
                                        } else {
                                            finish(false, `TLS connect failed (${code || err.message})`);
                                        }
                                    });
                                    tlsSock.on('timeout', () => {
                                        probeConnected = false;
                                        if (tlsSock.localPort) {
                                            if (isInitial && !probeInfo.localPort) probeInfo.localPort = tlsSock.localPort;
                                            sessionProbePorts.add(tlsSock.localPort);
                                        }
                                        try { tlsSock.destroy(); } catch {}
                                        if (isInitial) finish(false, 'TLS handshake timeout (no response within 2.5s)');
                                    });
                                };
                                openTlsProbe(true);
                                probeKeepaliveTimer = setInterval(() => {
                                    if (!settled) return;
                                    if (probeConnected && activeProbeSocket && !activeProbeSocket.destroyed && activeProbeSocket.writable) {
                                        try {
                                            activeProbeSocket.write(`X-Stigix-Keepalive: ${Date.now()}\r\n`);
                                        } catch {}
                                    } else {
                                        try { activeProbeSocket?.destroy(); } catch {}
                                        openTlsProbe(false, true);
                                    }
                                }, 650);
                            } else {
                                const openTcpProbe = (isInitial: boolean, reusePort = true) => {
                                    probeConnected = false;
                                    const sock = new net.Socket();
                                    if (isInitial) sockRef = sock;
                                    activeProbeSocket = sock;
                                    sock.setTimeout(isInitial ? 2200 : 1200);
                                    sock.on('connect', () => {
                                        probeConnected = true;
                                        if (sock.localPort) {
                                            if (isInitial && !probeInfo.localPort) probeInfo.localPort = sock.localPort;
                                            sessionProbePorts.add(sock.localPort);
                                        }
                                        if (isInitial && sock.localAddress && !probeInfo.localIp) {
                                            probeInfo.localIp = sock.localAddress;
                                        }
                                        sock.setKeepAlive(true, 1000);
                                        try {
                                            if (portNum !== 22) {
                                                const hostHdr = rawDest || resolvedDstIp;
                                                // Incomplete HTTP request header keeps server waiting in ESTABLISHED state
                                                sock.write(`GET / HTTP/1.1\r\nHost: ${hostHdr}\r\nUser-Agent: Stigix-FlowTrace/2.0\r\n`);
                                            }
                                        } catch {}
                                        if (isInitial) {
                                            finish(true, `TCP 3-way handshake succeeded (${Date.now() - probeT0}ms RTT)`);
                                        }
                                    });
                                    sock.on('error', (err: any) => {
                                        probeConnected = false;
                                        if (sock.localPort) sessionProbePorts.add(sock.localPort);
                                        try { sock.destroy(); } catch {}
                                        const code = err?.code || '';
                                        if (!isInitial && reusePort && (code === 'EADDRINUSE' || code === 'EADDRNOTAVAIL')) {
                                            openTcpProbe(false, false);
                                            return;
                                        }
                                        if (!isInitial) return;
                                        if (code === 'ECONNREFUSED') {
                                            finish(true, `TCP RST received (ECONNREFUSED in ${Date.now() - probeT0}ms — host reachable, port closed)`);
                                        } else {
                                            finish(false, `TCP connect failed (${code || err.message})`);
                                        }
                                    });
                                    sock.on('timeout', () => {
                                        probeConnected = false;
                                        if (sock.localPort) {
                                            if (isInitial && !probeInfo.localPort) probeInfo.localPort = sock.localPort;
                                            sessionProbePorts.add(sock.localPort);
                                        }
                                        try { sock.destroy(); } catch {}
                                        if (isInitial) finish(false, 'TCP SYN timeout (no SYN-ACK within 2.2s)');
                                    });
                                    try {
                                        const connectOpts: net.TcpSocketConnectOpts = {
                                            port: portNum,
                                            host: resolvedDstIp
                                        };
                                        if (!isInitial && reusePort && probeInfo.localPort > 0) {
                                            connectOpts.localPort = probeInfo.localPort;
                                            if (probeInfo.localIp) connectOpts.localAddress = probeInfo.localIp;
                                        }
                                        sock.connect(connectOpts);
                                    } catch (e: any) {
                                        if (isInitial) finish(false, `TCP connect error: ${e.message}`);
                                    }
                                };
                                openTcpProbe(true);
                                probeKeepaliveTimer = setInterval(() => {
                                    if (!settled) return;
                                    if (probeConnected && activeProbeSocket && !activeProbeSocket.destroyed && activeProbeSocket.writable) {
                                        if (portNum !== 22) {
                                            try {
                                                activeProbeSocket.write(`X-Stigix-Keepalive: ${Date.now()}\r\n`);
                                            } catch {}
                                        }
                                    } else {
                                        try { activeProbeSocket?.destroy(); } catch {}
                                        openTcpProbe(false, true);
                                    }
                                }, 650);
                            }
                        });
                    } else if (protoNum === 17) {
                        // UDP Probe (send real DNS A-record query on port 53 so DNS servers reply & vION DPI classifies dns-base)
                        const buildUdpPayload = (): Buffer => {
                            if (portNum === 53) {
                                // Standard DNS A query for www.microsoft.com
                                return Buffer.from([
                                    0x53, 0x54, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                                    0x03, 0x77, 0x77, 0x77, 0x09, 0x6d, 0x69, 0x63, 0x72, 0x6f, 0x73, 0x6f, 0x66, 0x74,
                                    0x03, 0x63, 0x6f, 0x6d, 0x00, 0x00, 0x01, 0x00, 0x01
                                ]);
                            }
                            return Buffer.from(`STIGIX-FLOW-TRACE:${Date.now()}:${effectiveSourceSite}`);
                        };
                        await new Promise<void>((resolveProbe) => {
                            const udpSock = dgram.createSocket('udp4');
                            activeUdpSocket = udpSock;
                            const payload = buildUdpPayload();
                            udpSock.connect(portNum, resolvedDstIp, (err) => {
                                if (err) {
                                    probeInfo.reachable = false;
                                    probeInfo.detail = `UDP socket error: ${err.message}`;
                                    return resolveProbe();
                                }
                                try {
                                    const addr = udpSock.address();
                                    probeInfo.localIp = addr.address !== '0.0.0.0' ? addr.address : cleanSrcIp;
                                    probeInfo.localPort = addr.port;
                                    if (addr.port > 0) sessionProbePorts.add(addr.port);
                                } catch {}
                                udpSock.send(payload, () => {
                                    // Send a second UDP datagram 150ms later and keep pulsing every 800ms during ION CLI inspection
                                    setTimeout(() => {
                                        try { udpSock.send(buildUdpPayload()); } catch {}
                                        probeInfo.reachable = true;
                                        probeInfo.rttMs = Date.now() - probeT0;
                                        probeInfo.detail = `Sent UDP ${portNum === 53 ? 'DNS query ' : ''}probe datagrams to ${resolvedDstIp}:${portNum}`;
                                        resolveProbe();
                                    }, 150);
                                });
                                probeKeepaliveTimer = setInterval(() => {
                                    try { udpSock.send(buildUdpPayload()); } catch {}
                                }, 800);
                            });
                        });
                    } else if (protoNum === 1) {
                        // ICMP Echo Probe
                        await new Promise<void>((resolveProbe) => {
                            const p = spawn('ping', ['-c', '2', '-W', '1', resolvedDstIp]);
                            let out = '';
                            p.stdout.on('data', (d) => { out += d.toString(); });
                            p.on('close', (code) => {
                                probeInfo.reachable = code === 0;
                                probeInfo.rttMs = Date.now() - probeT0;
                                probeInfo.detail = code === 0 ? 'ICMP Echo Reply received (2/2 packets)' : 'ICMP Echo timeout (0/2 replies)';
                                resolveProbe();
                            });
                            p.on('error', () => {
                                probeInfo.reachable = null;
                                probeInfo.detail = 'ICMP ping binary unavailable';
                                resolveProbe();
                            });
                        });
                        // Keep a single continuous ping process alive (same ICMP Echo Identifier) so the flow entry
                        // never expires from the vION flow table during WebSocket CLI inspection
                        try {
                            activePingProc = spawn('ping', ['-i', '0.4', '-W', '1', resolvedDstIp]);
                            activePingProc.on('error', () => {});
                        } catch {}
                    }
                }
                // Give kernel/NIC 250ms to deliver any return packets (SYN-ACK / HTTP banner / ICMP reply) to PF_PACKET,
                // then stop and dissect the local PCAP immediately while keeping activeProbeSocket open for ION CLI!
                if (localCaptureStarted) {
                    await new Promise((r) => setTimeout(r, 250));
                    try {
                        const stopRes = await runEngine(['stop']);
                        const targetPcap = (stopRes && (stopRes.pcap_path || stopRes.pcap_filename)) || capturedPcapFile;
                        if (targetPcap) {
                            const fullPath = targetPcap.startsWith('/') ? targetPcap : path.join(capturesDir, path.basename(targetPcap));
                            if (fs.existsSync(fullPath)) {
                                dissectedPcap = await runEngine(['dissect', '--file', fullPath, '--offset', '0', '--limit', '250']);
                                capturedPcapFile = path.basename(fullPath);
                            }
                        }
                    } catch {}
                    localCaptureStarted = false;
                }
            }

            // If the selected site has a remote Stigix peer on an older version (< v3.2.10), trigger its live
            // reachability/connectivity endpoints so it emits fresh packets from its LAN IP before we inspect the vION
            let remotePeerProbeTriggered = false;
            if (!isLocalStigixSite && hasRemoteStigixPeer && remoteStigixPeer && generateProbe !== false && resolvedDstIp) {
                try {
                    const peerHdrs: Record<string, string> = {};
                    if (req.headers.authorization) {
                        peerHdrs['Authorization'] = String(req.headers.authorization);
                    }
                    await Promise.race([
                        Promise.allSettled([
                            forwardHttpJson({
                                host: remoteStigixPeer.host,
                                port: remoteStigixPeer.port || 8080,
                                path: '/api/convergence/reachability',
                                method: 'POST',
                                headers: peerHdrs,
                                body: { target: resolvedDstIp, port: portNum || 80, force: true },
                                timeoutMs: 1800
                            }),
                            forwardHttpJson({
                                host: remoteStigixPeer.host,
                                port: remoteStigixPeer.port || 8080,
                                path: '/api/connectivity/test?live=true',
                                method: 'GET',
                                headers: peerHdrs,
                                timeoutMs: 1800
                            })
                        ]),
                        new Promise((r) => setTimeout(r, 900))
                    ]);
                    remotePeerProbeTriggered = true;
                } catch {}
            }

            // Summarize PCAP observations for Hop 1 before running ION CLI so we can pass the exact probe source IP
            const pcapPackets: any[] = Array.isArray(dissectedPcap?.packets) ? dissectedPcap.packets : [];
            const dstPackets = resolvedDstIp
                ? pcapPackets.filter((p) => p.source === resolvedDstIp || p.destination === resolvedDstIp)
                : pcapPackets;
            const txCount = resolvedDstIp ? dstPackets.filter((p) => p.destination === resolvedDstIp).length : 0;
            const rxCount = resolvedDstIp ? dstPackets.filter((p) => p.source === resolvedDstIp).length : 0;
            const seenSynAck = dstPackets.some((p) => String(p.info || '').includes('SYN') && String(p.info || '').includes('ACK'));
            const seenRst = dstPackets.some((p) => String(p.info || '').includes('RST'));
            const pcapTxPacket = resolvedDstIp ? dstPackets.find((p) => p.destination === resolvedDstIp) : null;
            const pcapTxSrcIp = pcapTxPacket?.source || '';
            if (!probeInfo.localIp && pcapTxSrcIp) {
                probeInfo.localIp = pcapTxSrcIp;
            }
            const pcapPorts: number[] = [];
            for (const pkt of dstPackets) {
                const candidatePort = pkt.destination === resolvedDstIp ? Number(pkt.sport || 0) : Number(pkt.dport || 0);
                if (candidatePort > 0 && !pcapPorts.includes(candidatePort)) {
                    pcapPorts.push(candidatePort);
                    sessionProbePorts.add(candidatePort);
                }
            }
            if (!probeInfo.localPort && pcapPorts.length > 0) {
                probeInfo.localPort = pcapPorts[0];
            }
            const effectiveSrcIp =
                cleanSrcIp ||
                (isLocalStigixSite && probeInfo.attempted
                    ? probeInfo.localIp
                    : hasRemoteStigixPeer && remoteStigixPeer
                    ? remoteStigixPeer.host
                    : '');
            const primaryProbePort = pcapPorts[0] || probeInfo.localPort || null;

            // Milestone 1 complete: Update live progress so Hop 1 (Stigix Probe) turns green/amber and Hop 2 enters RUNNING!
            if (activeFlowTraceProgress && activeFlowTraceProgress.trace_id === traceId) {
                const hop1LiveStatus = isLocalStigixSite
                    ? (dstPackets.length > 0 || probeInfo.reachable === true ? 'OBSERVED' : 'NOT_OBSERVED')
                    : hasRemoteStigixPeer
                    ? 'OBSERVED'
                    : 'PASSIVE';
                const tupleStr = `${effectiveSrcIp || 'Auto'}${primaryProbePort && protoNum !== 1 ? `:${primaryProbePort}` : ''} → ${resolvedDstIp || rawDest}${portNum && protoNum !== 1 ? `:${portNum}` : ''} · ${protoStr.toUpperCase()}`;
                activeFlowTraceProgress = {
                    ...activeFlowTraceProgress,
                    phase: 'INGRESS_ION_CLI',
                    phase_label: isLocalStigixSite
                        ? `Hop 1 validated (${txCount} TX / ${rxCount} RX). Inspecting ${effectiveSourceSite} vION flow table via WebSocket CLI...`
                        : hasRemoteStigixPeer && remoteStigixPeer
                        ? `Hop 1 (${remoteStigixPeer.name} · ${remoteStigixPeer.host}) ready. Inspecting ${effectiveSourceSite} vION flow table via WebSocket CLI...`
                        : `Inspecting ${effectiveSourceSite} vION flow table via WebSocket CLI...`,
                    flow_identity: {
                        probe_5tuple: tupleStr,
                        src_ip: effectiveSrcIp,
                        src_port: primaryProbePort,
                        dst_ip: resolvedDstIp,
                        dst_port: portNum,
                        protocol: protoStr.toUpperCase()
                    },
                    hops: [
                        {
                            id: 'hop_source',
                            role: isLocalStigixSite
                                ? 'SOURCE_STIGIX'
                                : hasRemoteStigixPeer
                                ? 'SOURCE_REMOTE_STIGIX'
                                : 'SOURCE_CLIENT_AGENTLESS',
                            role_label: isLocalStigixSite
                                ? 'Source Probe'
                                : hasRemoteStigixPeer
                                ? 'Remote Stigix Peer'
                                : 'Site Client (Agentless)',
                            title: isLocalStigixSite || hasRemoteStigixPeer
                                ? `Stigix ${effectiveSourceSite}`
                                : `Client (${effectiveSourceSite})`,
                            subtitle: effectiveSrcIp || 'Local Interface',
                            status: hop1LiveStatus,
                            badge: capturedPcapFile
                                ? `${txCount} TX / ${rxCount} RX (${dstPackets.length} pkts)`
                                : hasRemoteStigixPeer && remoteStigixPeer
                                ? `Stigix Peer (${remoteStigixPeer.host})`
                                : 'Local Probe',
                            evidence_type: isLocalStigixSite
                                ? 'Local PCAP + Active Probe'
                                : hasRemoteStigixPeer && remoteStigixPeer
                                ? `Remote Stigix Peer (${remoteStigixPeer.version ? 'v' + remoteStigixPeer.version : 'Active'})`
                                : 'Agentless (No Local Probe)'
                        },
                        {
                            id: 'hop_ingress_ion',
                            role: 'INGRESS_ION',
                            role_label: 'Ingress ION',
                            title: `ION ${effectiveSourceSite}`,
                            subtitle: 'Querying inspect flow brief via WebSocket...',
                            status: 'RUNNING',
                            badge: 'Inspecting Flow Table...',
                            evidence_type: 'vION Flow Table'
                        },
                        activeFlowTraceProgress.hops[2],
                        activeFlowTraceProgress.hops[3]
                    ]
                };
            }

            // Step 3: Run End-to-End SD-WAN ION CLI Flow Trace (Ingress Branch ION + Transit DC/Branch ION / ServiceLink)
            const cliArgs: string[] = ['--device', effectiveSourceSite, '--trace-path'];
            if (resolvedDstIp) {
                cliArgs.push('--dst-ip', resolvedDstIp);
            }
            const cliSrcIp = cleanSrcIp || (isLocalStigixSite && probeInfo.attempted ? probeInfo.localIp : '');
            if (cliSrcIp) {
                cliArgs.push('--src-ip', cliSrcIp);
            }
            if (primaryProbePort && protoNum !== 1) {
                cliArgs.push('--src-port', String(primaryProbePort));
            }
            if (portNum > 0 && protoNum !== 1) {
                cliArgs.push('--dst-port', String(portNum));
            }
            if (protoNum > 0) {
                cliArgs.push('--protocol', String(protoNum));
            }

            const ionTrace = await runIonCliScript(cliArgs, 75000, (prog: any) => {
                if (!activeFlowTraceProgress || activeFlowTraceProgress.trace_id !== traceId) return;
                const pFlow = prog?.primary_flow || null;
                const ingMeta = prog?.ingress_ion || {};
                const peerName = prog?.peer_site_name || 'Transit Hub';
                const fMode = prog?.forwarding_mode || 'VPN_OVERLAY';
                const secAct = String(pFlow?.sec_action || 'ALLOW').toUpperCase();
                const isBlk = secAct.includes('DENY') || secAct.includes('DROP') || secAct.includes('REJECT');

                activeFlowTraceProgress = {
                    ...activeFlowTraceProgress,
                    phase: prog?.phase || 'TRANSIT_ION_CLI',
                    phase_label: `Hop 2 (${ingMeta.element || effectiveSourceSite}) validated [App-ID: ${pFlow?.app_id || 'detected'}]. Inspecting next-hop ${peerName} via WebSocket CLI...`,
                    hops: [
                        activeFlowTraceProgress.hops[0],
                        {
                            id: 'hop_ingress_ion',
                            role: 'INGRESS_ION',
                            role_label: 'Ingress ION',
                            title: `ION ${ingMeta.element || effectiveSourceSite}`,
                            subtitle: `SW ${ingMeta.software_version || 'vION'} • ${pFlow?.egress_path || 'Evaluated'}`,
                            status: pFlow ? (isBlk ? 'BLOCKED' : 'OBSERVED') : 'NOT_OBSERVED',
                            badge: pFlow ? `App-ID: ${pFlow.app_id || 'unknown'} · ${secAct}` : 'No Matching Flow',
                            evidence_type: 'vION Flow Table',
                            secondary_info: pFlow?.egress_path || null
                        },
                        {
                            id: 'hop_transit',
                            role: fMode === 'SERVICELINK_SSE' ? 'TRANSIT_SERVICELINK' : 'TRANSIT_ION',
                            role_label: fMode === 'DC_BACKHAUL_INTERNET' ? 'Backhaul Hub ION' : fMode === 'SERVICELINK_SSE' ? 'Cloud Security SSE' : 'Transit Hub ION',
                            title: fMode === 'SERVICELINK_SSE' ? 'ServiceLink SSE' : `Hub ${peerName}`,
                            subtitle: pFlow?.egress_path || 'Inspecting tunnel arrival...',
                            status: 'RUNNING',
                            badge: `Inspecting ${peerName}...`,
                            evidence_type: 'vION Flow Table (HA)'
                        },
                        activeFlowTraceProgress.hops[3]
                    ]
                };
            });

            // Stop keepalive pulse and close any held probe sockets now that ION CLI flow inspection has completed
            stopProbeKeepalive();

            // Annotate & rank flows by 5-tuple precision (EXACT_PCAP_5TUPLE > SESSION_PROBE_FLOW > SAME_HOST_FLOW > ASSOCIATED_DST_FLOW)
            const annotateAndSortFlows = (rawFlows: any[]): any[] => {
                if (!Array.isArray(rawFlows)) return [];
                const rankOrder: Record<string, number> = {
                    EXACT_PCAP_5TUPLE: 1,
                    SESSION_PROBE_FLOW: 2,
                    SAME_HOST_FLOW: 3,
                    ASSOCIATED_DST_FLOW: 4
                };
                const annotated = rawFlows.map((fl: any) => {
                    const fSport = Number(fl.source_port || 0);
                    const fDport = Number(fl.destination_port || 0);
                    const isForward = (!effectiveSrcIp || fl.source_ip === effectiveSrcIp) && (!resolvedDstIp || fl.destination_ip === resolvedDstIp);
                    const isReverse = Boolean(effectiveSrcIp && resolvedDstIp && fl.source_ip === resolvedDstIp && fl.destination_ip === effectiveSrcIp);
                    const ipPairMatches = isForward || isReverse;
                    const clientPort = isReverse ? fDport : fSport;

                    let matchScope: 'EXACT_PCAP_5TUPLE' | 'SESSION_PROBE_FLOW' | 'SAME_HOST_FLOW' | 'ASSOCIATED_DST_FLOW' = 'ASSOCIATED_DST_FLOW';
                    let matchLabel = 'Associated Flow (Destination Match)';
                    if (ipPairMatches) {
                        if (protoNum === 1 || (clientPort > 0 && pcapPorts.includes(clientPort))) {
                            matchScope = 'EXACT_PCAP_5TUPLE';
                            matchLabel = 'Exact Probe 5-Tuple (In PCAP)';
                        } else if (clientPort > 0 && sessionProbePorts.has(clientPort)) {
                            matchScope = 'SESSION_PROBE_FLOW';
                            matchLabel = 'Session Probe Flow (Keepalive Port)';
                        } else if (!isLocalStigixSite || !probeInfo.attempted) {
                            matchScope = 'SAME_HOST_FLOW';
                            matchLabel = 'Matched Active Host Flow';
                        } else {
                            matchScope = 'SAME_HOST_FLOW';
                            matchLabel = 'Associated Flow (Same Host / Diff Port)';
                        }
                    } else if (effectiveSrcIp && resolvedDstIp && (fl.destination_ip === resolvedDstIp || fl.source_ip === resolvedDstIp)) {
                        const snatIp = fl.destination_ip === resolvedDstIp ? fl.source_ip : fl.destination_ip;
                        if (protoNum === 1 || (clientPort > 0 && pcapPorts.includes(clientPort))) {
                            matchScope = 'EXACT_PCAP_5TUPLE';
                            matchLabel = `Exact Probe 5-Tuple (SNAT ${effectiveSrcIp} → ${snatIp})`;
                        } else if (clientPort > 0 && sessionProbePorts.has(clientPort)) {
                            matchScope = 'SESSION_PROBE_FLOW';
                            matchLabel = `Session Probe Flow (SNAT ${effectiveSrcIp} → ${snatIp})`;
                        } else {
                            matchScope = 'SAME_HOST_FLOW';
                            matchLabel = `Source NAT Flow (${effectiveSrcIp} → ${snatIp})`;
                        }
                    }
                    return {
                        ...fl,
                        client_port: clientPort || null,
                        direction: isReverse ? 'reverse_indexed' : 'forward',
                        match_scope: matchScope,
                        match_label: matchLabel
                    };
                });
                annotated.sort((a, b) => (rankOrder[a.match_scope] || 9) - (rankOrder[b.match_scope] || 9));
                return annotated;
            };

            const ingressIon = ionTrace?.ingress_ion || null;
            const transitIon = ionTrace?.transit_ion || null;
            const annotatedIngressFlows = annotateAndSortFlows(ingressIon?.flows || []);
            const annotatedTransitFlows = annotateAndSortFlows(transitIon?.flows || []);

            // Promote best-matched flow (Exact PCAP 5-tuple first) as primaryFlow
            const primaryFlow = annotatedIngressFlows[0] || ionTrace?.primary_flow || null;
            const transitPrimaryFlow = annotatedTransitFlows[0] || null;
            const servicelinks: any[] = Array.isArray(ionTrace?.servicelinks) ? ionTrace.servicelinks : [];
            const forwardingMode: string = ionTrace?.forwarding_mode || 'NO_ACTIVE_FLOW';
            const transitObserved = annotatedTransitFlows.length > 0;
            const isUnidirectionalNoReply = Boolean(
                isLocalStigixSite &&
                probeInfo.attempted &&
                !dnsError &&
                ((capturedPcapFile && txCount > 0 && rxCount === 0) || (!capturedPcapFile && probeInfo.attempted && probeInfo.reachable === false)) &&
                !seenSynAck &&
                !seenRst
            );

            // Build structured End-to-End Hops array
            const hops: any[] = [];

            // Hop 1: Source Endpoint (Stigix Probe + Local PCAP OR Client Endpoint in Agentless Mode)
            if (isLocalStigixSite) {
                const hop1Status =
                    dstPackets.length > 0 || probeInfo.reachable === true
                        ? 'OBSERVED'
                        : resolvedDstIp
                        ? 'NOT_OBSERVED'
                        : 'READY';
                hops.push({
                    id: 'hop_source',
                    role: 'SOURCE_STIGIX',
                    role_label: probeInfo.attempted ? 'Source Probe' : 'Passive Capture',
                    title: `Stigix ${effectiveSourceSite}`,
                    subtitle: cleanSrcIp || probeInfo.localIp || 'Local Interface',
                    status: hop1Status,
                    badge: capturedPcapFile
                        ? dstPackets.length > 0
                            ? `Packets captured (${txCount} TX / ${rxCount} RX)`
                            : '0 packets captured'
                        : probeInfo.attempted
                        ? 'Active probe sent'
                        : 'Passive mode',
                    evidence_type: capturedPcapFile
                        ? (probeInfo.attempted ? 'Local PCAP + Active Probe' : 'Local Passive PCAP')
                        : 'Active Socket Probe',
                    secondary_info: primaryProbePort && protoNum !== 1 ? `Src Port :${primaryProbePort}` : `${dstPackets.length} pkts`,
                    metrics: {
                        interface: iface,
                        pcap_file: capturedPcapFile || null,
                        total_packets: pcapPackets.length,
                        flow_packets: dstPackets.length,
                        tx_packets: txCount,
                        rx_packets: rxCount,
                        syn_ack_seen: seenSynAck,
                        rst_seen: seenRst,
                        probe_attempted: probeInfo.attempted,
                        probe_reachable: probeInfo.reachable,
                        probe_rtt_ms: probeInfo.rttMs,
                        probe_detail: probeInfo.detail,
                        local_port: primaryProbePort || null,
                        pcap_ports: pcapPorts
                    }
                });
            } else if (hasRemoteStigixPeer && remoteStigixPeer) {
                const peerSrcIp = cleanSrcIp || primaryFlow?.source_ip || remoteStigixPeer.host;
                const peerSrcPort = primaryFlow?.client_port || primaryFlow?.source_port || null;
                hops.push({
                    id: 'hop_source',
                    role: 'SOURCE_REMOTE_STIGIX',
                    role_label: 'Remote Stigix Peer',
                    title: `Stigix ${effectiveSourceSite}`,
                    subtitle: `${peerSrcIp} (${remoteStigixPeer.name})`,
                    status: primaryFlow ? 'OBSERVED' : 'FORWARDED',
                    badge: primaryFlow
                        ? `Peer Flow Active${peerSrcPort ? ` (:${peerSrcPort})` : ''}`
                        : `Stigix Peer (${remoteStigixPeer.host})`,
                    evidence_type: `Remote Stigix Peer (${remoteStigixPeer.version ? 'v' + remoteStigixPeer.version : 'Active'})`,
                    secondary_info: primaryFlow && primaryFlow.destination_port && Number(primaryFlow.destination_port) !== portNum
                        ? `Active Flow on Port :${primaryFlow.destination_port}`
                        : peerSrcPort
                        ? `Src Port :${peerSrcPort}`
                        : `Host ${remoteStigixPeer.host}`,
                    metrics: {
                        peer_name: remoteStigixPeer.name,
                        peer_host: remoteStigixPeer.host,
                        peer_port: remoteStigixPeer.port,
                        peer_version: remoteStigixPeer.version || 'unknown',
                        source_ip: peerSrcIp,
                        source_port: peerSrcPort,
                        remote_probe_triggered: remotePeerProbeTriggered,
                        mode: `Remote Stigix Peer (${remoteStigixPeer.name}) + Direct ION WebSocket CLI`
                    }
                });
            } else {
                hops.push({
                    id: 'hop_source',
                    role: 'SOURCE_CLIENT_AGENTLESS',
                    role_label: 'Site Client (Agentless)',
                    title: `Client (${effectiveSourceSite})`,
                    subtitle: cleanSrcIp || primaryFlow?.source_ip || 'Any LAN Host',
                    status: primaryFlow ? 'OBSERVED' : 'PASSIVE',
                    badge: primaryFlow ? 'Active LAN Source' : 'No Local Probe',
                    evidence_type: 'Inferred from Ingress ION · No Remote Probe',
                    secondary_info: primaryFlow?.source_port ? `Src Port :${primaryFlow.source_port}` : 'Passive CLI Mode',
                    metrics: {
                        source_ip: cleanSrcIp || primaryFlow?.source_ip || 'Any',
                        source_port: primaryFlow?.source_port || null,
                        mode: 'Agentless (Direct ION WebSocket CLI)'
                    }
                });
            }

            // Hop 2: Ingress Branch ION
            if (!ionTrace || ionTrace.success === false) {
                hops.push({
                    id: 'hop_ingress_ion',
                    role: 'INGRESS_ION',
                    role_label: 'Ingress ION',
                    title: `ION ${effectiveSourceSite}`,
                    subtitle: 'WebSocket CLI Unavailable',
                    status: 'UNAVAILABLE',
                    badge: ionTrace?.code || 'CLI Error',
                    evidence_type: 'vION Flow Table (Error)',
                    secondary_info: 'Collection failed',
                    error: ionTrace?.error || 'Could not query ingress ION via WebSocket CLI',
                    metrics: {}
                });
            } else if (primaryFlow) {
                const secAction = String(primaryFlow.sec_action || 'ALLOW').toUpperCase();
                const isBlocked = secAction.includes('DENY') || secAction.includes('DROP') || secAction.includes('REJECT');
                hops.push({
                    id: 'hop_ingress_ion',
                    role: 'INGRESS_ION',
                    role_label: 'Ingress ION',
                    title: `ION ${ingressIon?.element || effectiveSourceSite}`,
                    subtitle: `SW ${ingressIon?.software_version || 'vION'} • VRF ${primaryFlow.vrf || 'Global'}`,
                    status: isBlocked ? 'BLOCKED' : 'OBSERVED',
                    badge: isBlocked ? `Blocked (${secAction})` : 'Matching flow found',
                    evidence_type: 'vION Flow Table',
                    secondary_info: `App-ID: ${primaryFlow.app_id || 'unknown'}`,
                    metrics: {
                        element: ingressIon?.element,
                        site_name: ingressIon?.site_name || effectiveSourceSite,
                        software_version: ingressIon?.software_version,
                        command: ingressIon?.command,
                        app_id: primaryFlow.app_id,
                        net_policy: primaryFlow.net_policy,
                        pri_policy: primaryFlow.pri_policy,
                        sec_policy: primaryFlow.sec_policy,
                        sec_action: primaryFlow.sec_action,
                        egress_path: primaryFlow.egress_path,
                        path_type: primaryFlow.path_type,
                        raw_path_type: primaryFlow.raw_path_type,
                        wanpath_id: primaryFlow.wanpath_id,
                        match_scope: primaryFlow.match_scope,
                        match_label: primaryFlow.match_label,
                        match_confidence: primaryFlow.match_confidence || ingressIon?.match_confidence,
                        matched_flows_count: annotatedIngressFlows.length,
                        total_table_flows: ingressIon?.total_table_flows || 0,
                        ha_elements_checked: ingressIon?.ha_elements_checked || [],
                        duration_ms: ingressIon?.duration_ms
                    }
                });
            } else {
                hops.push({
                    id: 'hop_ingress_ion',
                    role: 'INGRESS_ION',
                    role_label: 'Ingress ION',
                    title: `ION ${ingressIon?.element || effectiveSourceSite}`,
                    subtitle: `SW ${ingressIon?.software_version || 'vION'} • ${ingressIon?.total_table_flows || 0} active flows in table`,
                    status: 'NOT_OBSERVED',
                    badge: 'No Matching Flow',
                    evidence_type: 'vION Flow Table',
                    secondary_info: `${ingressIon?.total_table_flows || 0} table rows scanned`,
                    metrics: {
                        element: ingressIon?.element,
                        site_name: ingressIon?.site_name || effectiveSourceSite,
                        software_version: ingressIon?.software_version,
                        command: ingressIon?.command,
                        total_table_flows: ingressIon?.total_table_flows || 0,
                        ha_elements_checked: ingressIon?.ha_elements_checked || [],
                        duration_ms: ingressIon?.duration_ms
                    }
                });
            }

            // Hop 3: Transit / Egress Path (DC Hub ION, Remote Branch ION, ServiceLink Prisma Access/SSE, or Local DIA Breakout)
            if (primaryFlow) {
                if (
                    forwardingMode === 'DC_PRIVATE_APP' ||
                    forwardingMode === 'DC_BACKHAUL_INTERNET' ||
                    forwardingMode === 'BRANCH_TO_BRANCH_VPN'
                ) {
                    const peerSite = ionTrace?.peer_site_name || 'Peer Hub';
                    if (transitIon && transitIon.success === false) {
                        hops.push({
                            id: 'hop_transit',
                            role: 'TRANSIT_ION',
                            role_label: 'Expected Transit Hub',
                            title: `Hub ${peerSite}`,
                            subtitle: primaryFlow.egress_path || 'SD-WAN VPN Tunnel',
                            status: 'UNAVAILABLE',
                            badge: 'CLI Unavailable',
                            evidence_type: 'vION Flow Table (Error)',
                            secondary_info: primaryFlow.egress_path || null,
                            error: transitIon.error,
                            metrics: {
                                peer_site: peerSite,
                                tunnel: primaryFlow.egress_path,
                                wanpath_id: primaryFlow.wanpath_id
                            }
                        });
                    } else if (transitPrimaryFlow) {
                        hops.push({
                            id: 'hop_transit',
                            role: 'TRANSIT_ION',
                            role_label: forwardingMode === 'DC_BACKHAUL_INTERNET' ? 'Backhaul Hub ION' : forwardingMode === 'BRANCH_TO_BRANCH_VPN' ? 'Remote Branch ION' : 'Destination Hub ION',
                            title: `Hub ${peerSite} (${transitIon?.element || peerSite})`,
                            subtitle: `${primaryFlow.egress_path} • ${transitPrimaryFlow.raw_path_type || 'vpn_to_core'}`,
                            status: 'OBSERVED',
                            badge: 'Matching flow found',
                            evidence_type: 'vION Flow Table (HA)',
                            secondary_info: `${transitIon?.element || peerSite} (${transitPrimaryFlow.raw_path_type || 'vpn_to_core'})`,
                            metrics: {
                                element: transitIon?.element,
                                site_name: transitIon?.site_name || peerSite,
                                software_version: transitIon?.software_version,
                                command: transitIon?.command,
                                tunnel: primaryFlow.egress_path,
                                wanpath_id: transitPrimaryFlow.wanpath_id,
                                raw_path_type: transitPrimaryFlow.raw_path_type,
                                match_scope: transitPrimaryFlow.match_scope,
                                match_label: transitPrimaryFlow.match_label,
                                matched_flows_count: annotatedTransitFlows.length,
                                total_table_flows: transitIon?.total_table_flows || 0,
                                ha_elements_checked: transitIon?.ha_elements_checked || [],
                                duration_ms: transitIon?.duration_ms,
                                note: 'DPI App-ID & ZBFW policies are enforced at the ingress Branch ION; Hub ION confirms overlay tunnel arrival (vpn_to_core).'
                            }
                        });
                    } else {
                        const checkedNames = Array.isArray(transitIon?.ha_elements_checked)
                            ? transitIon.ha_elements_checked.map((h: any) => h.element).join(', ')
                            : (transitIon?.element || peerSite);
                        hops.push({
                            id: 'hop_transit',
                            role: 'TRANSIT_ION',
                            role_label: 'Expected Transit Hub',
                            title: `Hub ${peerSite}`,
                            subtitle: primaryFlow.egress_path || 'SD-WAN VPN Tunnel',
                            status: 'NOT_OBSERVED',
                            badge: 'No Matching Flow',
                            evidence_type: 'vION Flow Table (HA)',
                            secondary_info: `Checked: ${checkedNames}`,
                            metrics: {
                                element: transitIon?.element,
                                site_name: transitIon?.site_name || peerSite,
                                command: transitIon?.command,
                                tunnel: primaryFlow.egress_path,
                                total_table_flows: transitIon?.total_table_flows || 0,
                                ha_elements_checked: transitIon?.ha_elements_checked || [],
                                duration_ms: transitIon?.duration_ms
                            }
                        });
                    }
                } else if (forwardingMode === 'SERVICELINK_SSE') {
                    const upLinks = servicelinks.filter((s) => String(s.status).toLowerCase() === 'up');
                    hops.push({
                        id: 'hop_transit',
                        role: 'TRANSIT_SERVICELINK',
                        role_label: 'Cloud Security Tunnel',
                        title: 'Prisma Access / SSE (ServiceLink)',
                        subtitle: primaryFlow.egress_path || 'Standard IPSec ServiceLink',
                        status: upLinks.length > 0 || servicelinks.length === 0 ? 'OBSERVED' : 'BLOCKED',
                        badge: servicelinks.length > 0 ? `${upLinks.length}/${servicelinks.length} Tunnels UP` : 'ServiceLink Tunnel',
                        evidence_type: 'vION ServiceLink CLI',
                        secondary_info: primaryFlow.egress_path || 'IPSec Tunnel',
                        metrics: {
                            egress_path: primaryFlow.egress_path,
                            wanpath_id: primaryFlow.wanpath_id,
                            servicelinks
                        }
                    });
                } else {
                    // Direct Internet Breakout (DIA)
                    hops.push({
                        id: 'hop_transit',
                        role: 'TRANSIT_DIA',
                        role_label: 'Direct WAN Breakout',
                        title: `Local DIA (${primaryFlow.egress_path || 'Direct WAN'})`,
                        subtitle: `Circuit: ${primaryFlow.egress_path || 'Direct WAN'}`,
                        status: 'OBSERVED',
                        badge: `Direct Breakout (${primaryFlow.raw_path_type || 'direct'})`,
                        evidence_type: 'Ingress ION Forwarding Decision',
                        secondary_info: `Circuit: ${primaryFlow.egress_path || 'Direct'}`,
                        metrics: {
                            circuit: primaryFlow.egress_path,
                            raw_path_type: primaryFlow.raw_path_type,
                            wanpath_id: primaryFlow.wanpath_id
                        }
                    });
                }
            }

            // Hop 4: Target Destination / Application
            const effDstIp = resolvedDstIp || primaryFlow?.destination_ip || '';
            const effDstPort = protoNum === 1 ? 0 : (portNum || Number(primaryFlow?.destination_port || 0));
            const dstPortLabel = protoNum === 1 ? 'ICMP' : `${protoStr.toUpperCase()}/${effDstPort || '*'}`;
            let resolvedServiceTitle = rawDest || effDstIp || 'Destination';
            if (protoNum === 6 && effDstIp === '192.168.212.100' && effDstPort === 8098) {
                resolvedServiceTitle = 'DC1 Private App';
            } else if (protoNum === 6 && effDstIp === '192.168.203.100' && effDstPort === 8085) {
                resolvedServiceTitle = 'OnPrem App 8085';
            } else if (protoNum === 6 && effDstIp === '192.168.203.100' && effDstPort === 8096) {
                resolvedServiceTitle = 'OnPrem App 8096';
            } else if (protoNum === 6 && effDstIp === '40.99.155.50' && effDstPort === 443) {
                resolvedServiceTitle = 'Microsoft 365 (O365)';
            } else if (protoNum === 6 && rawDest.toLowerCase().includes('login.microsoftonline.com') && effDstPort === 443) {
                resolvedServiceTitle = 'Microsoft 365 Login';
            } else if (effDstIp === '192.168.212.100') {
                resolvedServiceTitle = 'DC2-Ubuntu (192.168.212.100)';
            } else if (effDstIp === '192.168.203.100') {
                resolvedServiceTitle = 'DC1-Ubuntu (192.168.203.100)';
            }
            const dstLabel = `${effDstIp || rawDest || 'Any Destination'} · ${dstPortLabel}`;
            const secAction = String(primaryFlow?.sec_action || '').toUpperCase();
            const isBlocked = secAction.includes('DENY') || secAction.includes('DROP') || secAction.includes('REJECT');
            const dstReached =
                !isUnidirectionalNoReply &&
                ((isLocalStigixSite && (seenSynAck || rxCount > 0 || probeInfo.reachable === true)) ||
                (!isLocalStigixSite && Boolean(primaryFlow) && secAction === 'ALLOW'));
            const lastObservedPoint = transitObserved
                ? (transitIon?.element || ionTrace?.peer_site_name || 'Transit Hub')
                : primaryFlow
                ? `ION ${ingressIon?.element || effectiveSourceSite}`
                : `Stigix ${effectiveSourceSite}`;
            const unidirDiagnosis = isUnidirectionalNoReply
                ? `Last confirmed flow observation: ${lastObservedPoint}. Failure location not determined — suggested checks: ${
                      transitObserved
                          ? 'hub egress, downstream filtering, or return routing'
                          : 'overlay tunnel, policy routing, or downstream filtering'
                  }.`
                : null;
            hops.push({
                id: 'hop_destination',
                role: 'DESTINATION',
                role_label: `Destination ${dstPortLabel}`,
                title: resolvedServiceTitle,
                subtitle: dstLabel,
                status: dnsError
                    ? 'BLOCKED'
                    : isBlocked
                    ? 'BLOCKED'
                    : isUnidirectionalNoReply
                    ? 'NO_RESPONSE'
                    : dstReached && isLocalStigixSite
                    ? 'OBSERVED'
                    : primaryFlow
                    ? 'FORWARDED'
                    : 'NOT_OBSERVED',
                badge: dnsError
                    ? 'DNS resolution failed'
                    : isBlocked
                    ? `Blocked by ZBFW (${secAction})`
                    : isUnidirectionalNoReply
                    ? 'No response received'
                    : seenRst
                    ? `TCP RST received at source (${rxCount} RX)`
                    : seenSynAck
                    ? `Reply verified at source (SYN-ACK · ${rxCount} RX)`
                    : rxCount > 0
                    ? `Reply verified at source (${rxCount} RX)`
                    : primaryFlow
                    ? 'No destination-side capture'
                    : 'No response received',
                evidence_type: isLocalStigixSite
                    ? 'Source probe · No destination capture'
                    : 'Uninstrumented remote target',
                secondary_info: dnsError
                    ? 'DNS Error'
                    : isUnidirectionalNoReply
                    ? `${txCount} TX / 0 RX at source`
                    : probeInfo.rttMs !== null
                    ? `RTT ${probeInfo.rttMs}ms`
                    : (resolvedDstIp || null),
                metrics: {
                    destination_input: rawDest || null,
                    resolved_ip: resolvedDstIp || primaryFlow?.destination_ip || null,
                    dns_resolution_ms: dnsResolutionMs,
                    dns_error: dnsError,
                    port: portNum || primaryFlow?.destination_port || null,
                    protocol: protoStr.toUpperCase(),
                    instrumented: false,
                    unidirectional_diagnosis: unidirDiagnosis
                }
            });

            // Overall Verdict
            const verdictStatus = dnsError
                ? 'DNS_ERROR'
                : isBlocked
                ? 'BLOCKED'
                : isUnidirectionalNoReply && primaryFlow
                ? 'UNIDIRECTIONAL_NO_REPLY'
                : isUnidirectionalNoReply
                ? 'NO_RESPONSE'
                : primaryFlow
                ? (dstReached && isLocalStigixSite ? 'VERIFIED_E2E' : 'FLOW_ACTIVE')
                : 'NO_MATCHING_FLOW';

            // Build Flow Identity & Plain-English Diagnostic Synthesis
            const exact5TupleIngress = annotatedIngressFlows.some((f) => f.match_scope === 'EXACT_PCAP_5TUPLE' || f.match_scope === 'SESSION_PROBE_FLOW');
            const exact5TupleTransit = annotatedTransitFlows.some((f) => f.match_scope === 'EXACT_PCAP_5TUPLE' || f.match_scope === 'SESSION_PROBE_FLOW');
            const displayedSrcIp = effectiveSrcIp || primaryFlow?.source_ip || 'Auto';
            const snatTranslatedIp =
                effectiveSrcIp &&
                primaryFlow?.source_ip &&
                primaryFlow.source_ip !== effectiveSrcIp &&
                primaryFlow.source_ip !== resolvedDstIp
                    ? String(primaryFlow.source_ip)
                    : null;
            const displayedSrcPort = primaryProbePort || primaryFlow?.client_port || primaryFlow?.source_port || null;
            const displayedDstIp = resolvedDstIp || primaryFlow?.destination_ip || rawDest;
            const displayedDstPort = primaryFlow?.destination_port || portNum || null;
            const srcTuplePart = `${displayedSrcIp}${displayedSrcPort && protoNum !== 1 ? `:${displayedSrcPort}` : ''}${snatTranslatedIp ? ` (SNAT ${snatTranslatedIp})` : ''}`;
            const tupleDisplay = `${srcTuplePart} → ${displayedDstIp}${displayedDstPort && protoNum !== 1 ? `:${displayedDstPort}` : ''} · ${protoStr.toUpperCase()}`;

            const connectivityHeadline = dnsError
                ? `DNS resolution failed for "${rawDest}": ${dnsError}.`
                : isBlocked
                ? `Flow blocked at Ingress ION (${ingressIon?.element || effectiveSourceSite}) by Zone-Based Firewall policy "${primaryFlow?.sec_policy || 'Security Rule'}" (${secAction}).`
                : isUnidirectionalNoReply
                ? `No response received — no return packets captured at ${effectiveSourceSite} during the test (${txCount} TX / 0 RX).`
                : dstReached && isLocalStigixSite
                ? seenRst
                    ? `Reply received (TCP RST) — host reachable at ${effectiveSourceSite} (${txCount} TX / ${rxCount} RX packets${probeInfo.rttMs ? `, ${probeInfo.rttMs}ms RTT` : ''}).`
                    : `Reply received — bidirectional connectivity confirmed at ${effectiveSourceSite} (${txCount} TX / ${rxCount} RX packets${probeInfo.rttMs ? `, ${probeInfo.rttMs}ms RTT` : ''}).`
                : primaryFlow && hasRemoteStigixPeer && remoteStigixPeer
                ? `Active dataplane flow observed from Stigix Peer ${remoteStigixPeer.name} (${remoteStigixPeer.host}) across the SD-WAN fabric.`
                : primaryFlow
                ? `Active dataplane flow observed on SD-WAN fabric (${isLocalStigixSite ? 'passive capture mode' : 'ION-only inspection'}).`
                : `No active matching flow observed in ${effectiveSourceSite} vION flow table during collection window.`;

            const peerSiteLabel = ionTrace?.peer_site_name || 'Hub';
            const visibilityHeadline = !ionTrace || ionTrace.success === false
                ? `Source check completed on ${effectiveSourceSite}, but vION WebSocket CLI collection was unavailable (${ionTrace?.error || 'CLI error'}).`
                : !primaryFlow
                ? hasRemoteStigixPeer && remoteStigixPeer
                    ? `Stigix Peer ${remoteStigixPeer.name} (${remoteStigixPeer.host}) is online, but no active flow to ${displayedDstIp}:${portNum} was present in ${ingressIon?.element || effectiveSourceSite} (${ingressIon?.total_table_flows || 0} active flows scanned).`
                    : `Local capture recorded ${txCount} TX / ${rxCount} RX packets, with no matching flow entry in ${ingressIon?.element || effectiveSourceSite} (${ingressIon?.total_table_flows || 0} active flows scanned).`
                : forwardingMode === 'DIRECT_INTERNET_DIA'
                ? `Local Internet breakout identified on ${ingressIon?.element || effectiveSourceSite} via "${primaryFlow.egress_path || 'Direct WAN'}" (${primaryFlow.raw_path_type || 'direct'}).`
                : forwardingMode === 'SERVICELINK_SSE'
                ? `Matching flow found on ${ingressIon?.element || effectiveSourceSite} routed into ServiceLink SSE tunnel "${primaryFlow.egress_path}".`
                : transitObserved
                ? `Matching flows found on ${ingressIon?.element || effectiveSourceSite} and hub ${transitIon?.element || peerSiteLabel} via "${primaryFlow.egress_path}" (${transitPrimaryFlow?.raw_path_type || 'vpn_to_core'}).`
                : `Matching flow found on ${ingressIon?.element || effectiveSourceSite} via "${primaryFlow.egress_path}", with no matching flow found on ${peerSiteLabel} IONs.`;

            const limitOrDiagnosis = isUnidirectionalNoReply
                ? (unidirDiagnosis as string)
                : !primaryFlow && txCount > 0
                ? 'Short-lived or rejected flows can expire from the vION flow table before WebSocket CLI inspection completes.'
                : primaryFlow && !transitObserved && (forwardingMode === 'DC_BACKHAUL_INTERNET' || forwardingMode === 'DC_PRIVATE_APP' || forwardingMode === 'BRANCH_TO_BRANCH_VPN')
                ? `Last confirmed flow observation: ${ingressIon?.element || effectiveSourceSite}. Absence of a matching flow on ${peerSiteLabel} alone does not locate a packet drop.`
                : dstReached && isLocalStigixSite
                ? 'Reply verified at source · No destination-side capture.'
                : 'No destination-side capture agent · Path visibility relies on source and ION flow tables.';

            activeFlowTraceProgress = {
                active: false,
                trace_id: traceId,
                started_at: t0,
                phase: 'COMPLETED',
                phase_label: 'Trace complete'
            };

            res.json({
                success: true,
                trace_id: traceId,
                duration_ms: Date.now() - t0,
                query: {
                    source_site: effectiveSourceSite,
                    is_local_stigix: isLocalStigixSite,
                    stigix_peer: remoteStigixPeer || null,
                    source_mode: isLocalStigixSite
                        ? 'stigix_plus_ion'
                        : hasRemoteStigixPeer
                        ? 'remote_stigix_peer_plus_ion'
                        : 'ion_only_agentless',
                    src_ip: displayedSrcIp,
                    src_ip_input: cleanSrcIp || '',
                    destination: rawDest,
                    resolved_dst_ip: resolvedDstIp || primaryFlow?.destination_ip || '',
                    dns_resolution_ms: dnsResolutionMs,
                    dns_error: dnsError,
                    dst_port: portNum,
                    protocol: protoStr,
                    bpf_used: bpfUsed
                },
                flow_identity: {
                    probe_5tuple: tupleDisplay,
                    src_ip: displayedSrcIp,
                    src_port: displayedSrcPort,
                    dst_ip: displayedDstIp,
                    dst_port: displayedDstPort,
                    protocol: protoStr.toUpperCase(),
                    pcap_ports: pcapPorts,
                    session_probe_ports: Array.from(sessionProbePorts),
                    exact_5tuple_ingress: exact5TupleIngress,
                    exact_5tuple_transit: exact5TupleTransit,
                    primary_match_scope: primaryFlow?.match_scope || null,
                    primary_match_label: primaryFlow?.match_label || null,
                    total_ingress_matches: annotatedIngressFlows.length,
                    total_transit_matches: annotatedTransitFlows.length,
                    associated_flows_count: Math.max(0, annotatedIngressFlows.length - 1)
                },
                synthesis: {
                    connectivity_headline: connectivityHeadline,
                    visibility_headline: visibilityHeadline,
                    limit_or_diagnosis: limitOrDiagnosis
                },
                verdict: {
                    status: verdictStatus,
                    forwarding_mode: forwardingMode,
                    app_id: primaryFlow?.app_id || null,
                    net_policy: primaryFlow?.net_policy || null,
                    pri_policy: primaryFlow?.pri_policy || null,
                    sec_policy: primaryFlow?.sec_policy || null,
                    sec_action: primaryFlow?.sec_action || null,
                    egress_path: primaryFlow?.egress_path || null,
                    raw_path_type: primaryFlow?.raw_path_type || null,
                    peer_site_name: ionTrace?.peer_site_name || null
                },
                hops,
                ingress_flows: annotatedIngressFlows,
                transit_flows: annotatedTransitFlows,
                servicelinks,
                pcap: dissectedPcap
                    ? {
                          filename: capturedPcapFile,
                          total_packets: dissectedPcap.total_packets || pcapPackets.length,
                          flow_packets: dstPackets.length,
                          file_size_bytes: dissectedPcap.file_size_bytes || 0,
                          duration_seconds: dissectedPcap.duration_seconds || 0,
                          packets: pcapPackets,
                          ...(req.headers['x-stigix-delegated'] === '1' &&
                          capturedPcapFile &&
                          fs.existsSync(path.join(capturesDir, path.basename(capturedPcapFile)))
                              ? {
                                    raw_pcap_b64: fs
                                        .readFileSync(path.join(capturesDir, path.basename(capturedPcapFile)))
                                        .toString('base64')
                                }
                              : {})
                      }
                    : null
            });
        } catch (e: any) {
            stopProbeKeepalive();
            activeFlowTraceProgress = null;
            if (localCaptureStarted) {
                try { await runEngine(['stop']); } catch {}
            }
            res.status(500).json({
                success: false,
                error: e.message || 'End-to-end flow trace failed'
            });
        }
    });

    return router;
}
