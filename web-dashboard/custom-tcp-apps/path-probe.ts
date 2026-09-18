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
    buildClientClose
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

// Range of dedicated probe source ports
const PROBE_PORT_START = 49190;
const PROBE_PORT_END = 49199;

/**
 * Executes an on-demand Path MTU and WAN transport diagnostic against a target peer.
 */
export async function runPathProbe(options: PathProbeOptions): Promise<PathProbeResult> {
    const probeId = `PRB-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const startTime = Date.now();
    const timeoutMs = options.stepTimeoutMs || 1800;

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

    // Find an available source port in the probe range
    let boundPort = options.preferredSourcePort || PROBE_PORT_START;
    let socket: net.Socket | null = null;
    let parser = new FrameParser();
    let clientSessionId = `diag-${crypto.randomBytes(6).toString('hex')}`;

    // Attempt connecting with deterministic source port
    let connected = false;
    let connectError: string | null = null;

    for (let port = boundPort; port <= PROBE_PORT_END; port++) {
        try {
            socket = new net.Socket();
            parser = new FrameParser();

            await new Promise<void>((resolve, reject) => {
                const connTimer = setTimeout(() => {
                    reject(new Error(`Connection timeout (${timeoutMs}ms) to ${options.targetHost}:${options.targetPort}`));
                }, timeoutMs);

                socket!.once('error', err => {
                    clearTimeout(connTimer);
                    reject(err);
                });

                // Bind to deterministic source port if specified/possible
                socket!.connect({
                    host: options.targetHost,
                    port: options.targetPort,
                    localPort: port,
                    localAddress: options.localIp
                }, () => {
                    clearTimeout(connTimer);
                    boundPort = port;
                    resolve();
                });
            });

            connected = true;
            break;
        } catch (err: any) {
            connectError = err.message || String(err);
            if (socket) {
                try { socket.destroy(); } catch {}
                socket = null;
            }
        }
    }

    // Fallback: connect without explicit localPort binding if all probe ports are busy
    if (!connected) {
        try {
            socket = new net.Socket();
            parser = new FrameParser();
            await new Promise<void>((resolve, reject) => {
                const connTimer = setTimeout(() => {
                    reject(new Error(`Connection timeout (${timeoutMs}ms) to ${options.targetHost}:${options.targetPort}`));
                }, timeoutMs);

                socket!.once('error', err => {
                    clearTimeout(connTimer);
                    reject(err);
                });

                socket!.connect({
                    host: options.targetHost,
                    port: options.targetPort,
                    localAddress: options.localIp
                }, () => {
                    clearTimeout(connTimer);
                    boundPort = socket!.localPort || boundPort;
                    resolve();
                });
            });
            connected = true;
        } catch (err: any) {
            connectError = err.message || String(err);
        }
    }

    if (!connected || !socket) {
        result.error = `Could not reach target ${options.targetHost}:${options.targetPort} (${connectError || 'Connection refused / timeout'}). Destination peer appears offline or port is closed.`;
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
    result.sourcePort = socket.localPort || boundPort;

    // Attach data parser
    const pendingFrames: any[] = [];
    let frameWaiter: ((msg: any) => void) | null = null;

    socket.on('data', (chunk: Buffer) => {
        const frames = parser.push(chunk);
        for (const frame of frames) {
            if (frameWaiter) {
                const fn = frameWaiter;
                frameWaiter = null;
                fn(frame);
            } else {
                pendingFrames.push(frame);
            }
        }
    });

    const waitForNextMessage = (timeoutLimitMs: number): Promise<any> => {
        return new Promise((resolve, reject) => {
            if (pendingFrames.length > 0) {
                return resolve(pendingFrames.shift());
            }
            const timer = setTimeout(() => {
                frameWaiter = null;
                reject(new Error(`Timeout (${timeoutLimitMs}ms) waiting for peer response`));
            }, timeoutLimitMs);

            frameWaiter = (msg: any) => {
                clearTimeout(timer);
                resolve(msg);
            };
        });
    };

    try {
        // ── Step 1: Handshake ────────────────────────────────────────────────
        const helloBuf = encodeFrame(buildClientHello({
            appId: options.appId,
            clientSessionId,
            origin: options.identity,
            authToken: options.authToken
        }));
        socket.write(helloBuf);

        let helloResp: any = null;
        try {
            helloResp = await waitForNextMessage(timeoutMs);
        } catch (handshakeErr: any) {
            result.error = `Destination ${options.targetHost}:${options.targetPort} connected, but did not respond to session handshake within ${timeoutMs}ms. The remote peer is likely running an older version of Stigix or the listener is unresponsive.`;
            result.recommendations = {
                summary: `Remote peer at ${options.targetHost} is running an older Stigix version without PATH_PROBE support. Upgrade the remote node with: TAG=v2 docker compose pull && TAG=v2 docker compose up -d`,
                ciscoIos: `# Remote peer did not respond to handshake (upgrade destination to v2)`,
                vyos: `# Remote peer did not respond to handshake (upgrade destination to v2)`,
                linux: `# Remote peer did not respond to handshake (upgrade destination to v2)`
            };
            try { socket.destroy(); } catch {}
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
            try { socket.destroy(); } catch {}
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

        let seq = 1;
        for (const stepBytes of STANDARD_MTU_TIERS) {
            // Target L4 payload size: stepBytes minus IP header (20B) and TCP header (20B)
            const targetL4Size = Math.max(100, stepBytes - 40);
            
            // Generate padding to match exact target L4 size
            // Note: Frame length header is 4B, JSON structure is ~140B
            const approxJsonOverhead = 140;
            const paddingLength = Math.max(0, targetL4Size - approxJsonOverhead);
            const padding = 'X'.repeat(paddingLength);

            const sendTs = Date.now();
            const probeMsg = buildPathProbe({
                probeId,
                clientSessionId,
                seq: seq++,
                stepBytes,
                padding
            });
            const probeBuf = encodeFrame(probeMsg);

            const stepResult: PathProbeStepResult = {
                stepBytes,
                success: false,
                rttMs: 0
            };

            try {
                socket.write(probeBuf);
                const resp = await waitForNextMessage(timeoutMs);
                const recvTs = Date.now();
                const rtt = Math.max(1, recvTs - sendTs);

                if (resp.type === 'PATH_PROBE_ACK') {
                    const ack = resp as PathProbeAckMessage;
                    stepResult.success = true;
                    stepResult.rttMs = rtt;
                    result.peerCapabilities.supportsOneWay = true;

                    // Calculate forward and reverse delay if server timestamp is present
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
                    // Graceful fallback for older peer versions
                    stepResult.success = true;
                    stepResult.rttMs = rtt;
                    rttList.push(rtt);
                } else {
                    stepResult.error = `Unexpected response type: ${resp.type}`;
                }
            } catch (err: any) {
                stepResult.error = err.message || 'Frame drop / timeout';
            }

            result.steps.push(stepResult);
        }

        // Close diagnostic session cleanly
        try {
            socket.write(encodeFrame(buildClientClose({ clientSessionId, reason: 'Diagnostic probe complete' })));
            socket.end();
        } catch {}

        // ── Step 3: Analyze MTU Thresholds & One-Way Delay ────────────────────
        const successfulSteps = result.steps.filter(s => s.success);
        if (successfulSteps.length > 0) {
            // The maximum successful size tested
            result.maxPathMtu = Math.max(...successfulSteps.map(s => s.stepBytes));
            result.recommendedMss = Math.max(536, result.maxPathMtu - 40);
            result.fragmentationDetected = result.maxPathMtu < 1500;
            result.overheadBytes = Math.max(0, 1500 - result.maxPathMtu);

            const sumRtt = rttList.reduce((a, b) => a + b, 0);
            result.avgRttMs = Number((sumRtt / rttList.length).toFixed(2));

            // One-Way Asymmetry calculation
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
            result.error = 'All MTU probe steps timed out or were dropped by intermediary network.';
        }

        // ── Step 4: Generate Configuration Recommendations ───────────────────
        const mss = result.recommendedMss || 1380;
        if (result.fragmentationDetected) {
            result.recommendations = {
                summary: `Path MTU is constrained to ${result.maxPathMtu}B (likely IPsec/SD-WAN overhead of ~${result.overheadBytes}B). Apply TCP MSS clamping to prevent fragmentation.`,
                ciscoIos: `interface <LAN_INTERFACE>\n ip tcp adjust-mss ${mss}`,
                vyos: `set firewall options interface <LAN_INTERFACE> adjust-mss ${mss}`,
                linux: `iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss ${mss}`
            };
        } else {
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
                const prismaRes = await options.prismaLookupFn(
                    options.identity.siteName || 'LOCAL',
                    result.sourcePort,
                    options.targetHost,
                    options.targetPort
                );
                if (prismaRes) {
                    result.prismaFlow = prismaRes;
                }
            } catch (err: any) {
                result.prismaFlow = {
                    matched: false,
                    flowFound: false,
                    error: `Prisma SD-WAN lookup error: ${err.message || String(err)}`
                };
            }
        }

    } catch (err: any) {
        result.error = err.message || String(err);
    } finally {
        if (socket) {
            try { socket.destroy(); } catch {}
        }
    }

    result.durationMs = Date.now() - startTime;
    return result;
}
