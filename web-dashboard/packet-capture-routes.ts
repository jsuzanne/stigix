import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import net from 'net';
import tls from 'tls';
import dgram from 'dgram';
import dns from 'dns';
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
            const goBin = shouldUseGoEngine() ? resolveStigixGoBin() : null;
            const proc = goBin
                ? spawn(goBin, ['pcap-capture', ...args], { env })
                : spawn(pythonPath, [captureScript, ...args], { env });
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

    // Helper: run sdwan_ion_cli.py with JSON output
    const runIonCliScript = (cliArgs: string[], timeoutMs = 45000): Promise<any> => {
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
            proc.stdout.on('data', (d) => { stdout += d.toString(); });
            proc.stderr.on('data', (d) => { stderr += d.toString(); });
            proc.on('close', () => {
                try {
                    const idx = stdout.indexOf('{');
                    const parsed = JSON.parse(idx >= 0 ? stdout.slice(idx) : stdout);
                    resolve(parsed);
                } catch {
                    resolve({
                        success: false,
                        error: (stderr || stdout || 'Failed to parse sdwan_ion_cli output').trim().slice(0, 400)
                    });
                }
            });
            proc.on('error', (err) => {
                resolve({ success: false, error: err.message });
            });
        });
    };

    let cachedTraceSites: { ts: number; data: any } | null = null;

    // 11. List Prisma SD-WAN tenant sites & elements for E2E Flow Trace
    router.get('/trace-sites', async (req: Request, res: Response) => {
        try {
            const force = req.query.refresh === '1' || req.query.refresh === 'true';
            const now = Date.now();
            const localSite = getLocalSiteName();
            if (!force && cachedTraceSites && now - cachedTraceSites.ts < 60_000) {
                return res.json({
                    ...cachedTraceSites.data,
                    local_site_name: localSite
                });
            }
            const result = await runIonCliScript(['--list-sites'], 25000);
            if (result && result.success && Array.isArray(result.sites)) {
                cachedTraceSites = { ts: now, data: result };
            }
            res.json({
                ...result,
                local_site_name: localSite
            });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message || 'Failed to list tenant sites' });
        }
    });

    // 12. Execute End-to-End Flow & Path Trace (NWPI-style Stigix PCAP + ION CLI Flow Trace)
    router.post('/trace-flow', async (req: Request, res: Response) => {
        const t0 = Date.now();
        const {
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

        let activeProbeSocket: net.Socket | null = null;
        let activeUdpSocket: dgram.Socket | null = null;
        let probeKeepaliveTimer: ReturnType<typeof setInterval> | null = null;
        const stopProbeKeepalive = () => {
            if (probeKeepaliveTimer) {
                clearInterval(probeKeepaliveTimer);
                probeKeepaliveTimer = null;
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
                                probeInfo.localPort = sockRef?.localPort || 0;
                                probeInfo.detail = detail;
                                resolveProbe();
                            };

                            if (isTlsPort) {
                                const openTlsProbe = (isInitial: boolean) => {
                                    const tlsSock = tls.connect({
                                        host: resolvedDstIp,
                                        port: portNum,
                                        servername: sniHost || undefined,
                                        rejectUnauthorized: false
                                    });
                                    if (isInitial) sockRef = tlsSock;
                                    activeProbeSocket = tlsSock;
                                    tlsSock.setTimeout(2500);
                                    tlsSock.on('secureConnect', () => {
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
                                        if (!isInitial) return;
                                        const code = err?.code || '';
                                        if (code === 'ECONNREFUSED') {
                                            finish(true, `TCP RST received (ECONNREFUSED in ${Date.now() - probeT0}ms — host reachable, port closed)`);
                                        } else {
                                            finish(false, `TLS connect failed (${code || err.message})`);
                                        }
                                    });
                                    tlsSock.on('timeout', () => {
                                        if (isInitial) finish(false, 'TLS handshake timeout (no response within 2.5s)');
                                    });
                                };
                                openTlsProbe(true);
                                probeKeepaliveTimer = setInterval(() => {
                                    if (activeProbeSocket && !activeProbeSocket.destroyed && activeProbeSocket.writable) {
                                        try {
                                            activeProbeSocket.write(`X-Stigix-Keepalive: ${Date.now()}\r\n`);
                                        } catch {}
                                    } else {
                                        openTlsProbe(false);
                                    }
                                }, 900);
                            } else {
                                const openTcpProbe = (isInitial: boolean) => {
                                    const sock = new net.Socket();
                                    if (isInitial) sockRef = sock;
                                    activeProbeSocket = sock;
                                    sock.setTimeout(2200);
                                    sock.on('connect', () => {
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
                                        if (!isInitial) return;
                                        const code = err?.code || '';
                                        if (code === 'ECONNREFUSED') {
                                            finish(true, `TCP RST received (ECONNREFUSED in ${Date.now() - probeT0}ms — host reachable, port closed)`);
                                        } else {
                                            finish(false, `TCP connect failed (${code || err.message})`);
                                        }
                                    });
                                    sock.on('timeout', () => {
                                        if (isInitial) finish(false, 'TCP SYN timeout (no SYN-ACK within 2.2s)');
                                    });
                                    try {
                                        sock.connect(portNum, resolvedDstIp);
                                    } catch (e: any) {
                                        if (isInitial) finish(false, `TCP connect error: ${e.message}`);
                                    }
                                };
                                openTcpProbe(true);
                                probeKeepaliveTimer = setInterval(() => {
                                    if (activeProbeSocket && !activeProbeSocket.destroyed && activeProbeSocket.writable) {
                                        if (portNum !== 22) {
                                            try {
                                                activeProbeSocket.write(`X-Stigix-Keepalive: ${Date.now()}\r\n`);
                                            } catch {}
                                        }
                                    } else {
                                        openTcpProbe(false);
                                    }
                                }, 900);
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
                        probeKeepaliveTimer = setInterval(() => {
                            try { spawn('ping', ['-c', '1', '-W', '1', resolvedDstIp]); } catch {}
                        }, 900);
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

            // Step 3: Run End-to-End SD-WAN ION CLI Flow Trace (Ingress Branch ION + Transit DC/Branch ION / ServiceLink)
            const cliArgs: string[] = ['--device', effectiveSourceSite, '--trace-path'];
            if (resolvedDstIp) {
                cliArgs.push('--dst-ip', resolvedDstIp);
            }
            if (cleanSrcIp) {
                cliArgs.push('--src-ip', cleanSrcIp);
            }
            if (portNum > 0 && protoNum !== 1) {
                cliArgs.push('--dst-port', String(portNum));
            }
            if (protoNum > 0) {
                cliArgs.push('--protocol', String(protoNum));
            }

            const ionTrace = await runIonCliScript(cliArgs, 45000);

            // Stop keepalive pulse and close any held probe sockets now that ION CLI flow inspection has completed
            stopProbeKeepalive();

            // Summarize PCAP observations for Hop 1
            const pcapPackets: any[] = Array.isArray(dissectedPcap?.packets) ? dissectedPcap.packets : [];
            const dstPackets = resolvedDstIp
                ? pcapPackets.filter((p) => p.source === resolvedDstIp || p.destination === resolvedDstIp)
                : pcapPackets;
            const txCount = resolvedDstIp ? dstPackets.filter((p) => p.destination === resolvedDstIp).length : 0;
            const rxCount = resolvedDstIp ? dstPackets.filter((p) => p.source === resolvedDstIp).length : 0;
            const seenSynAck = dstPackets.some((p) => String(p.info || '').includes('SYN') && String(p.info || '').includes('ACK'));
            const seenRst = dstPackets.some((p) => String(p.info || '').includes('RST'));

            // Build structured End-to-End Hops array
            const hops: any[] = [];
            const ingressIon = ionTrace?.ingress_ion || null;
            const primaryFlow = ionTrace?.primary_flow || null;
            const transitIon = ionTrace?.transit_ion || null;
            const servicelinks: any[] = Array.isArray(ionTrace?.servicelinks) ? ionTrace.servicelinks : [];
            const forwardingMode: string = ionTrace?.forwarding_mode || 'NO_ACTIVE_FLOW';

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
                    title: `Stigix Probe (${effectiveSourceSite})`,
                    subtitle: probeInfo.localIp || 'Local Interface',
                    status: hop1Status,
                    badge: capturedPcapFile ? `${dstPackets.length} pkts (${txCount} TX / ${rxCount} RX)` : 'Local Probe',
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
                        local_port: probeInfo.localPort || null
                    }
                });
            } else {
                hops.push({
                    id: 'hop_source',
                    role: 'SOURCE_CLIENT_AGENTLESS',
                    title: `Site Client (${effectiveSourceSite})`,
                    subtitle: cleanSrcIp || primaryFlow?.source_ip || 'Any LAN Host (Agentless Mode)',
                    status: primaryFlow ? 'OBSERVED' : 'PASSIVE',
                    badge: 'ION-Only Mode (No Stigix Probe)',
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
                    title: `Ingress ION (${effectiveSourceSite})`,
                    subtitle: 'WebSocket CLI Unavailable',
                    status: 'UNAVAILABLE',
                    badge: ionTrace?.code || 'CLI Error',
                    error: ionTrace?.error || 'Could not query ingress ION via WebSocket CLI',
                    metrics: {}
                });
            } else if (primaryFlow) {
                const secAction = String(primaryFlow.sec_action || 'ALLOW').toUpperCase();
                const isBlocked = secAction.includes('DENY') || secAction.includes('DROP') || secAction.includes('REJECT');
                hops.push({
                    id: 'hop_ingress_ion',
                    role: 'INGRESS_ION',
                    title: `Ingress ION (${ingressIon?.element || effectiveSourceSite})`,
                    subtitle: `SW ${ingressIon?.software_version || 'vION'} • VRF ${primaryFlow.vrf || 'Global'}`,
                    status: isBlocked ? 'BLOCKED' : 'OBSERVED',
                    badge: `App-ID: ${primaryFlow.app_id || 'unknown'}`,
                    metrics: {
                        element: ingressIon?.element,
                        site_name: ingressIon?.site_name || effectiveSourceSite,
                        software_version: ingressIon?.software_version,
                        app_id: primaryFlow.app_id,
                        net_policy: primaryFlow.net_policy,
                        pri_policy: primaryFlow.pri_policy,
                        sec_policy: primaryFlow.sec_policy,
                        sec_action: primaryFlow.sec_action,
                        egress_path: primaryFlow.egress_path,
                        path_type: primaryFlow.path_type,
                        raw_path_type: primaryFlow.raw_path_type,
                        wanpath_id: primaryFlow.wanpath_id,
                        match_confidence: primaryFlow.match_confidence || ingressIon?.match_confidence,
                        matched_flows_count: (ingressIon?.flows || []).length,
                        total_table_flows: ingressIon?.total_table_flows || 0,
                        ha_elements_checked: ingressIon?.ha_elements_checked || [],
                        duration_ms: ingressIon?.duration_ms
                    }
                });
            } else {
                hops.push({
                    id: 'hop_ingress_ion',
                    role: 'INGRESS_ION',
                    title: `Ingress ION (${ingressIon?.element || effectiveSourceSite})`,
                    subtitle: `SW ${ingressIon?.software_version || 'vION'} • ${ingressIon?.total_table_flows || 0} active flows in table`,
                    status: 'NOT_OBSERVED',
                    badge: 'No Matching Flow',
                    metrics: {
                        element: ingressIon?.element,
                        site_name: ingressIon?.site_name || effectiveSourceSite,
                        software_version: ingressIon?.software_version,
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
                    const transitFlows: any[] = Array.isArray(transitIon?.flows) ? transitIon.flows : [];
                    const transitPrimary = transitFlows[0] || null;
                    if (transitIon && transitIon.success === false) {
                        hops.push({
                            id: 'hop_transit',
                            role: 'TRANSIT_ION',
                            title: `Transit / Hub ION (${peerSite})`,
                            subtitle: primaryFlow.egress_path || 'SD-WAN VPN Tunnel',
                            status: 'UNAVAILABLE',
                            badge: 'CLI Unavailable',
                            error: transitIon.error,
                            metrics: {
                                peer_site: peerSite,
                                tunnel: primaryFlow.egress_path,
                                wanpath_id: primaryFlow.wanpath_id
                            }
                        });
                    } else if (transitPrimary) {
                        hops.push({
                            id: 'hop_transit',
                            role: 'TRANSIT_ION',
                            title: `${forwardingMode === 'DC_BACKHAUL_INTERNET' ? 'Backhaul Hub' : 'Destination / Hub'} ION (${transitIon?.element || peerSite})`,
                            subtitle: `${primaryFlow.egress_path} • ${transitPrimary.raw_path_type || 'vpn_to_core'}`,
                            status: 'OBSERVED',
                            badge: `Arrived (${transitPrimary.raw_path_type || 'vpn_to_core'})`,
                            metrics: {
                                element: transitIon?.element,
                                site_name: transitIon?.site_name || peerSite,
                                software_version: transitIon?.software_version,
                                tunnel: primaryFlow.egress_path,
                                wanpath_id: transitPrimary.wanpath_id,
                                raw_path_type: transitPrimary.raw_path_type,
                                matched_flows_count: transitFlows.length,
                                total_table_flows: transitIon?.total_table_flows || 0,
                                ha_elements_checked: transitIon?.ha_elements_checked || [],
                                duration_ms: transitIon?.duration_ms,
                                note: 'DPI App-ID & ZBFW policies are enforced at the ingress Branch ION; Hub ION confirms overlay tunnel arrival (vpn_to_core).'
                            }
                        });
                    } else {
                        hops.push({
                            id: 'hop_transit',
                            role: 'TRANSIT_ION',
                            title: `Transit / Hub ION (${transitIon?.element || peerSite})`,
                            subtitle: primaryFlow.egress_path || 'SD-WAN VPN Tunnel',
                            status: 'NOT_OBSERVED',
                            badge: 'Not Seen on Hub',
                            metrics: {
                                element: transitIon?.element,
                                site_name: transitIon?.site_name || peerSite,
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
                        title: 'Prisma Access / Cloud Security (ServiceLink)',
                        subtitle: primaryFlow.egress_path || 'Standard IPSec ServiceLink',
                        status: upLinks.length > 0 || servicelinks.length === 0 ? 'OBSERVED' : 'BLOCKED',
                        badge: servicelinks.length > 0 ? `${upLinks.length}/${servicelinks.length} Tunnels UP` : 'ServiceLink Tunnel',
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
                        title: `Local Internet Breakout (DIA)`,
                        subtitle: `Circuit: ${primaryFlow.egress_path || 'Direct WAN'}`,
                        status: 'OBSERVED',
                        badge: `DIA (${primaryFlow.egress_path || 'Direct'})`,
                        metrics: {
                            circuit: primaryFlow.egress_path,
                            raw_path_type: primaryFlow.raw_path_type,
                            wanpath_id: primaryFlow.wanpath_id
                        }
                    });
                }
            }

            // Hop 4: Target Destination / Application
            const dstLabel = rawDest && rawDest !== resolvedDstIp
                ? `${rawDest} (${resolvedDstIp || 'Unresolved'})`
                : (resolvedDstIp || primaryFlow?.destination_ip || 'Any Destination');
            const dstPortLabel = protoNum === 1 ? 'ICMP' : `${protoStr.toUpperCase()}/${portNum || primaryFlow?.destination_port || '*'}`;
            const dstReached =
                (isLocalStigixSite && (seenSynAck || rxCount > 0 || probeInfo.reachable === true)) ||
                (!isLocalStigixSite && Boolean(primaryFlow) && String(primaryFlow.sec_action || '').toUpperCase() === 'ALLOW');
            hops.push({
                id: 'hop_destination',
                role: 'DESTINATION',
                title: `Destination (${dstPortLabel})`,
                subtitle: dstLabel,
                status: dnsError ? 'BLOCKED' : dstReached ? 'OBSERVED' : primaryFlow ? 'FORWARDED' : 'NOT_OBSERVED',
                badge: dnsError
                    ? 'DNS Failed'
                    : seenSynAck
                    ? 'SYN-ACK Verified'
                    : rxCount > 0
                    ? `${rxCount} Return Pkts`
                    : primaryFlow
                    ? (forwardingMode === 'DC_PRIVATE_APP' ? 'Private DC App' : forwardingMode === 'DC_BACKHAUL_INTERNET' ? 'SaaS via DC Backhaul' : forwardingMode === 'SERVICELINK_SSE' ? 'Cloud / Prisma Access' : 'Public / Internet')
                    : 'No Response',
                metrics: {
                    destination_input: rawDest || null,
                    resolved_ip: resolvedDstIp || primaryFlow?.destination_ip || null,
                    dns_resolution_ms: dnsResolutionMs,
                    dns_error: dnsError,
                    port: portNum || primaryFlow?.destination_port || null,
                    protocol: protoStr.toUpperCase()
                }
            });

            // Overall Verdict
            const secAction = String(primaryFlow?.sec_action || '').toUpperCase();
            const isBlocked = secAction.includes('DENY') || secAction.includes('DROP') || secAction.includes('REJECT');
            const verdictStatus = dnsError
                ? 'DNS_ERROR'
                : isBlocked
                ? 'BLOCKED'
                : primaryFlow
                ? (dstReached ? 'VERIFIED_E2E' : 'FLOW_ACTIVE')
                : 'NO_MATCHING_FLOW';

            res.json({
                success: true,
                duration_ms: Date.now() - t0,
                query: {
                    source_site: effectiveSourceSite,
                    is_local_stigix: isLocalStigixSite,
                    source_mode: isLocalStigixSite ? 'stigix_plus_ion' : 'ion_only_agentless',
                    src_ip: cleanSrcIp || probeInfo.localIp || primaryFlow?.source_ip || '',
                    destination: rawDest,
                    resolved_dst_ip: resolvedDstIp || primaryFlow?.destination_ip || '',
                    dns_resolution_ms: dnsResolutionMs,
                    dns_error: dnsError,
                    dst_port: portNum,
                    protocol: protoStr,
                    bpf_used: bpfUsed
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
                ingress_flows: ingressIon?.flows || [],
                transit_flows: transitIon?.flows || [],
                servicelinks,
                pcap: dissectedPcap
                    ? {
                          filename: capturedPcapFile,
                          total_packets: dissectedPcap.total_packets || pcapPackets.length,
                          flow_packets: dstPackets.length,
                          file_size_bytes: dissectedPcap.file_size_bytes || 0,
                          duration_seconds: dissectedPcap.duration_seconds || 0,
                          packets: pcapPackets
                      }
                    : null
            });
        } catch (e: any) {
            stopProbeKeepalive();
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
