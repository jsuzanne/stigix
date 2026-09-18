/**
 * Stigix Custom TCP Inter-Site Applications — Path MTU & SD-WAN Diagnostic Probe Engine
 * Performs on-demand Path MTU discovery (PMTUD), One-Way Delay calculation, and Prisma SD-WAN Flow correlation.
 */

import net from 'net';
import crypto from 'crypto';
import {
    PathProbeResult,
    PathProbeStepResult,
    PathProbeAckMessage,
    ServerHelloMessage,
    RejectMessage,
    PrismaFlowCorrelation,
    InstanceIdentityConfig
} from './types.js';
import { FrameParser } from './frame-parser.js';
import {
    encodeFrame,
    buildClientHello,
    buildPathProbe,
    buildClientClose,
    buildRequest
} from './protocol.js';

export interface PathProbeOptions {
    appId: string;
    appName: string;
    targetHost: string;
    targetPort: number;
    authToken?: string;
    identity: InstanceIdentityConfig;
    localIp?: string;
    preferredSourcePort?: number;
    stepTimeoutMs?: number;
    runPrismaCorrelation?: boolean;
    prismaLookupFn?: (siteName: string, srcPort: number, dstIp: string, dstPort: number) => Promise<PrismaFlowCorrelation | null>;
}

// Standard probe MTU sizes to test in descending order
export const STANDARD_MTU_TIERS = [1500, 1492, 1460, 1420, 1400, 1380, 1350, 1300, 1200];

/**
 * Executes an on-demand Path MTU and WAN transport diagnostic against a target peer.
 * Guaranteed never to throw unhandled exceptions or crash the process.
 */
export async function runPathProbe(options: PathProbeOptions): Promise<PathProbeResult> {
    const probeId = `PRB-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const startTime = Date.now();
    const connectTimeoutMs = 3000;
    const handshakeTimeoutMs = 3000;
    const stepTimeoutMs = options.stepTimeoutMs || 1200;

    const result: PathProbeResult = {
        probeId,
        appId: options.appId,
        appName: options.appName,
        targetHost: options.targetHost,
        targetPort: options.targetPort,
        timestamp: new Date().toISOString(),
        durationMs: 0,
        connected: false,
        maxPathMtu: 0,
        recommendedMss: 0,
        fragmentationDetected: false,
        overheadBytes: 0,
        avgRttMs: 0,
        steps: [],
        recommendations: {
            summary: '',
            ciscoIos: '',
            vyos: '',
            linux: ''
        },
        peerCapabilities: {
            supportsOneWay: false
        }
    };

    let socket: net.Socket | null = null;
    const parser = new FrameParser();
    const clientSessionId = `diag-${crypto.randomBytes(6).toString('hex')}`;
    let socketClosed = false;
    let socketError: string | null = null;
    let parserError: string | null = null;

    // Queue for parsed messages & active waiter
    const pendingFrames: any[] = [];
    let frameWaiter: ((msg: any) => void) | null = null;

    // Safe parser listeners — captures HTTP response banners and malformed JSON
    parser.on('message', (msg: any) => {
        if (frameWaiter) {
            const fn = frameWaiter;
            frameWaiter = null;
            fn(msg);
        } else {
            pendingFrames.push(msg);
        }
    });

    parser.on('error', (err: any) => {
        parserError = err?.message || String(err);
        const errorFrame = { type: 'PARSER_ERROR', error: parserError };
        if (frameWaiter) {
            const fn = frameWaiter;
            frameWaiter = null;
            fn(errorFrame);
        } else {
            pendingFrames.push(errorFrame);
        }
    });

    const waitForNextMessage = (timeoutLimitMs: number): Promise<any> => {
        return new Promise((resolve) => {
            if (pendingFrames.length > 0) {
                return resolve(pendingFrames.shift());
            }
            if (socketClosed) {
                return resolve({ type: 'SOCKET_CLOSED', error: socketError || 'Socket closed' });
            }

            const timer = setTimeout(() => {
                frameWaiter = null;
                resolve({ type: 'TIMEOUT', timeoutMs: timeoutLimitMs });
            }, timeoutLimitMs);

            frameWaiter = (msg: any) => {
                clearTimeout(timer);
                resolve(msg);
            };
        });
    };

    try {
        // ── Connect Socket ───────────────────────────────────────────────────
        socket = new net.Socket();
        socket.setNoDelay(true);

        socket.on('error', (err: any) => {
            socketError = err?.message || String(err);
            if (frameWaiter) {
                const fn = frameWaiter;
                frameWaiter = null;
                fn({ type: 'SOCKET_ERROR', error: socketError });
            }
        });

        socket.on('close', () => {
            socketClosed = true;
            if (frameWaiter) {
                const fn = frameWaiter;
                frameWaiter = null;
                fn({ type: 'SOCKET_CLOSED', error: socketError || 'Socket closed' });
            }
        });

        socket.on('data', (chunk: Buffer) => {
            try {
                parser.push(chunk);
            } catch (err: any) {
                parserError = err?.message || String(err);
            }
        });

        const connected = await new Promise<boolean>((resolve) => {
            const connTimer = setTimeout(() => {
                resolve(false);
            }, connectTimeoutMs);

            socket!.once('connect', () => {
                clearTimeout(connTimer);
                resolve(true);
            });

            socket!.once('error', (err) => {
                clearTimeout(connTimer);
                socketError = err?.message || String(err);
                resolve(false);
            });

            try {
                if (options.preferredSourcePort) {
                    socket!.connect({
                        host: options.targetHost,
                        port: options.targetPort,
                        localPort: options.preferredSourcePort
                    });
                } else {
                    socket!.connect(options.targetPort, options.targetHost);
                }
            } catch (err: any) {
                clearTimeout(connTimer);
                socketError = err?.message || String(err);
                resolve(false);
            }
        });

        if (!connected || socketClosed) {
            result.error = `Could not reach target ${options.targetHost}:${options.targetPort} (${socketError || 'Connection timed out'}). Destination peer appears offline or port is filtered.`;
            result.recommendations = {
                summary: `Target peer at ${options.targetHost}:${options.targetPort} is unreachable. Verify that the destination container is running and that TCP port ${options.targetPort} is open in firewall policies.`,
                ciscoIos: `# Destination ${options.targetHost}:${options.targetPort} unreachable`,
                vyos: `# Destination ${options.targetHost}:${options.targetPort} unreachable`,
                linux: `# Destination ${options.targetHost}:${options.targetPort} unreachable`
            };
            result.durationMs = Date.now() - startTime;
            return result;
        }

        result.connected = true;
        result.sourceIp = socket.localAddress;
        result.sourcePort = socket.localPort;

        // ── Step 1: Handshake ────────────────────────────────────────────────
        try {
            const helloBuf = encodeFrame(buildClientHello({
                appId: options.appId,
                clientSessionId,
                origin: options.identity,
                authToken: options.authToken
            }));
            socket.write(helloBuf);
        } catch (writeErr: any) {
            result.error = `Failed to send handshake: ${writeErr?.message || writeErr}`;
            result.durationMs = Date.now() - startTime;
            return result;
        }

        const helloResp = await waitForNextMessage(handshakeTimeoutMs);

        if (helloResp.type === 'PARSER_ERROR') {
            const isHttp = (helloResp.error || '').includes('HTTP response banner');
            result.error = isHttp
                ? `Destination ${options.targetHost}:${options.targetPort} is running a standard HTTP web server, not a Stigix Custom TCP App.`
                : `Protocol error from destination ${options.targetHost}:${options.targetPort}: ${helloResp.error}`;
            result.recommendations = {
                summary: isHttp
                    ? `Port ${options.targetPort} on ${options.targetHost} replied with an HTTP banner. Ensure you are targeting a Custom TCP App port, or configure the application protocol accordingly.`
                    : `Destination returned non-Stigix protocol data: ${helloResp.error}`,
                ciscoIos: `# Protocol mismatch on port ${options.targetPort}`,
                vyos: `# Protocol mismatch on port ${options.targetPort}`,
                linux: `# Protocol mismatch on port ${options.targetPort}`
            };
            result.durationMs = Date.now() - startTime;
            return result;
        }

        if (helloResp.type === 'TIMEOUT' || helloResp.type === 'SOCKET_CLOSED' || helloResp.type === 'SOCKET_ERROR') {
            result.error = `Destination ${options.targetHost}:${options.targetPort} connected, but did not complete the Stigix session handshake (${helloResp.type}). The remote peer may be running an older Stigix version or an un-upgraded node.`;
            result.recommendations = {
                summary: `Remote peer at ${options.targetHost} is running an older Stigix version without PATH_PROBE support. Upgrade the remote node with: TAG=v2 docker compose pull && TAG=v2 docker compose up -d`,
                ciscoIos: `# Remote peer did not respond to handshake (upgrade destination to v2)`,
                vyos: `# Remote peer did not respond to handshake (upgrade destination to v2)`,
                linux: `# Remote peer did not respond to handshake (upgrade destination to v2)`
            };
            result.durationMs = Date.now() - startTime;
            return result;
        }

        if (helloResp.type === 'REJECT') {
            const rejectMsg = helloResp as RejectMessage;
            result.error = `Peer rejected diagnostic session: ${rejectMsg.code} - ${rejectMsg.reason}`;
            result.recommendations = {
                summary: `Session rejected by destination (${rejectMsg.code}). Verify authentication token and allowed CIDRs for application ${options.appName}.`,
                ciscoIos: `# Session rejected: ${rejectMsg.code}`,
                vyos: `# Session rejected: ${rejectMsg.code}`,
                linux: `# Session rejected: ${rejectMsg.code}`
            };
            result.durationMs = Date.now() - startTime;
            return result;
        }

        if (helloResp.type === 'SERVER_HELLO') {
            const serverHello = helloResp as ServerHelloMessage;
            result.peerCapabilities.serverVersion = `v${serverHello.protocolVersion || 1}`;
        }

        // ── Step 2: Tiered MTU Probes ─────────────────────────────────────────
        const rttList: number[] = [];
        const forwardDelays: number[] = [];
        const reverseDelays: number[] = [];
        let isLegacyServer = false;
        let seq = 1;

        for (const stepBytes of STANDARD_MTU_TIERS) {
            if (socketClosed) {
                result.steps.push({
                    stepBytes,
                    success: false,
                    rttMs: 0,
                    error: 'Socket disconnected'
                });
                continue;
            }

            const targetL4Size = Math.max(100, stepBytes - 40);
            const approxJsonOverhead = 160;
            const paddingLength = Math.max(0, targetL4Size - approxJsonOverhead);
            const padding = 'X'.repeat(paddingLength);

            const sendTs = Date.now();
            const stepResult: PathProbeStepResult = {
                stepBytes,
                success: false,
                rttMs: 0
            };

            try {
                if (!isLegacyServer) {
                    const probeMsg = buildPathProbe({
                        probeId,
                        clientSessionId,
                        seq: seq++,
                        stepBytes,
                        padding
                    });
                    socket.write(encodeFrame(probeMsg));

                    const resp = await waitForNextMessage(stepTimeoutMs);
                    const recvTs = Date.now();
                    const rtt = Math.max(1, recvTs - sendTs);

                    if (resp.type === 'PATH_PROBE_ACK') {
                        const ack = resp as PathProbeAckMessage;
                        stepResult.success = true;
                        stepResult.rttMs = rtt;
                        result.peerCapabilities.supportsOneWay = true;

                        if (ack.serverRecvTs && ack.clientSentTs) {
                            const fwd = Math.max(0, ack.serverRecvTs - ack.clientSentTs);
                            const rev = Math.max(0, recvTs - ack.serverRecvTs);
                            stepResult.forwardDelayMs = fwd;
                            stepResult.reverseDelayMs = rev;
                            forwardDelays.push(fwd);
                            reverseDelays.push(rev);
                        }
                        rttList.push(rtt);
                    } else if (resp.type === 'RESPONSE' || resp.type === 'PONG') {
                        isLegacyServer = true;
                        stepResult.success = true;
                        stepResult.rttMs = rtt;
                        rttList.push(rtt);
                    } else if (resp.type === 'TIMEOUT') {
                        // Switch to legacy fallback for subsequent steps if step 1 timed out
                        isLegacyServer = true;
                        stepResult.error = `Probe frame dropped / timeout (${stepTimeoutMs}ms)`;
                    } else {
                        stepResult.error = resp.error || `Received ${resp.type}`;
                    }
                }

                // Fallback to universal REQUEST frame for legacy destinations
                if (isLegacyServer && !stepResult.success && !socketClosed) {
                    const legacySendTs = Date.now();
                    const reqMsg = buildRequest({
                        requestId: `pmtu-${seq}-${stepBytes}`,
                        clientSessionId,
                        seq: seq++,
                        payloadSize: paddingLength,
                        data: padding
                    });
                    socket.write(encodeFrame(reqMsg));

                    const resp = await waitForNextMessage(stepTimeoutMs);
                    const legacyRecvTs = Date.now();
                    const legacyRtt = Math.max(1, legacyRecvTs - legacySendTs);

                    if (resp.type === 'RESPONSE' || resp.type === 'PONG' || resp.type === 'PATH_PROBE_ACK') {
                        stepResult.success = true;
                        stepResult.rttMs = legacyRtt;
                        stepResult.error = undefined;
                        rttList.push(legacyRtt);
                    } else {
                        stepResult.error = resp.type === 'TIMEOUT'
                            ? `Timeout (${stepTimeoutMs}ms)`
                            : (resp.error || `Response: ${resp.type}`);
                    }
                }
            } catch (err: any) {
                stepResult.error = err?.message || 'Frame send failed';
            }

            result.steps.push(stepResult);
        }

        // Clean session closure
        try {
            if (!socketClosed && socket.writable) {
                socket.write(encodeFrame(buildClientClose({ clientSessionId, reason: 'Diagnostic probe complete' })));
                socket.end();
            }
        } catch {}

        // ── Step 3: Analyze MTU Thresholds & One-Way Delay ────────────────────
        const successfulSteps = result.steps.filter(s => s.success);
        if (successfulSteps.length > 0) {
            result.maxPathMtu = Math.max(...successfulSteps.map(s => s.stepBytes));
            result.recommendedMss = Math.max(536, result.maxPathMtu - 40);
            result.fragmentationDetected = result.maxPathMtu < 1500;
            result.overheadBytes = Math.max(0, 1500 - result.maxPathMtu);

            const sumRtt = rttList.reduce((a, b) => a + b, 0);
            result.avgRttMs = Number((sumRtt / (rttList.length || 1)).toFixed(2));

            if (forwardDelays.length > 0 && reverseDelays.length > 0) {
                const avgFwd = Number((forwardDelays.reduce((a, b) => a + b, 0) / forwardDelays.length).toFixed(2));
                const avgRev = Number((reverseDelays.reduce((a, b) => a + b, 0) / reverseDelays.length).toFixed(2));
                const diff = Number(Math.abs(avgFwd - avgRev).toFixed(2));
                result.oneWayDelay = {
                    forwardMs: avgFwd,
                    reverseMs: avgRev,
                    asymmetryMs: diff,
                    status: diff <= 5 ? 'SYMMETRIC' : 'ASYMMETRIC'
                };
            }
        } else {
            result.maxPathMtu = 0;
            result.recommendedMss = 536;
            result.error = result.error || 'All MTU probe steps timed out or were dropped by intermediary network.';
        }

        // ── Step 4: Generate Configuration Recommendations ───────────────────
        const mss = result.recommendedMss || 1380;
        if (result.fragmentationDetected && result.maxPathMtu > 0) {
            result.recommendations = {
                summary: `Path MTU is constrained to ${result.maxPathMtu}B (likely IPsec/SD-WAN overhead of ~${result.overheadBytes}B). Apply TCP MSS clamping to prevent fragmentation.`,
                ciscoIos: `interface <LAN_INTERFACE>\n ip tcp adjust-mss ${mss}`,
                vyos: `set firewall options interface <LAN_INTERFACE> adjust-mss ${mss}`,
                linux: `iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss ${mss}`
            };
        } else if (result.maxPathMtu >= 1500) {
            result.recommendations = {
                summary: `Full 1500B Standard MTU is available end-to-end without fragmentation. Optimal transport detected.`,
                ciscoIos: `# No MSS adjustment needed (Full 1500B Path MTU supported)`,
                vyos: `# No MSS adjustment needed (Full 1500B Path MTU supported)`,
                linux: `# No MSS adjustment needed (Full 1500B Path MTU supported)`
            };
        }

        // ── Step 5: Prisma SD-WAN Flow Correlation ───────────────────────────
        if (options.runPrismaCorrelation && options.prismaLookupFn && result.sourcePort) {
            try {
                const prismaRes = await Promise.race([
                    options.prismaLookupFn(
                        options.identity.siteName || 'LOCAL',
                        result.sourcePort,
                        options.targetHost,
                        options.targetPort
                    ),
                    new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))
                ]);
                if (prismaRes) {
                    result.prismaFlow = prismaRes;
                }
            } catch (err: any) {
                result.prismaFlow = {
                    matched: false,
                    flowFound: false,
                    error: `Prisma SD-WAN lookup error: ${err?.message || String(err)}`
                };
            }
        }
    } catch (err: any) {
        result.error = err?.message || String(err);
    } finally {
        if (socket) {
            try { socket.destroy(); } catch {}
        }
    }

    result.durationMs = Date.now() - startTime;
    return result;
}
