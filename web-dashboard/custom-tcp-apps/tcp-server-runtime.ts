/**
 * Stigix Custom TCP Inter-Site Applications — Server Runtime
 * Manages net.Server, incoming client handshakes, allowlist, and simulation behaviors.
 */

import net from 'net';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import {
    CustomTcpApplicationConfig,
    IncomingSessionState,
    InstanceIdentityConfig,
    ClientHelloMessage,
    RequestMessage,
    PingMessage,
    ClientCloseMessage
} from './types.js';
import { FrameParser } from './frame-parser.js';
import {
    encodeFrame,
    buildServerHello,
    buildReject,
    buildResponse,
    buildError,
    buildPong,
    buildServerClose
} from './protocol.js';
import { isIpInCidrs, normalizeIp } from './cidr.js';
import { AppMetricsTracker } from './metrics.js';

interface TrackedIncomingClient {
    sessionId: string;
    socket: net.Socket;
    state: IncomingSessionState;
    parser: FrameParser;
    handshakeCompleted: boolean;
    handshakeTimer?: NodeJS.Timeout;
    idleTimer?: NodeJS.Timeout;
    requestCount: number;
    startedAt: number;
}

export class TcpServerRuntime extends EventEmitter {
    public readonly appConfig: CustomTcpApplicationConfig;
    private readonly localIdentity: InstanceIdentityConfig;
    private readonly metricsTracker: AppMetricsTracker;

    private server: net.Server | null = null;
    private readonly clients = new Map<string, TrackedIncomingClient>();
    private isRunning: boolean = false;

    constructor(
        appConfig: CustomTcpApplicationConfig,
        localIdentity: InstanceIdentityConfig,
        metricsTracker: AppMetricsTracker
    ) {
        super();
        this.appConfig = appConfig;
        this.localIdentity = localIdentity;
        this.metricsTracker = metricsTracker;
    }

    public async start(): Promise<void> {
        if (this.isRunning) return;

        const { port, bindAddress } = this.appConfig.listener;

        return new Promise((resolve, reject) => {
            const server = net.createServer({ pauseOnConnect: false }, socket => {
                this.handleIncomingConnection(socket);
            });

            server.once('error', (err: any) => {
                this.metricsTracker.listenerState = err.code === 'EADDRINUSE' ? 'port_conflict' : 'bind_error';
                this.metricsTracker.listenerError = err.message;
                this.isRunning = false;
                reject(err);
            });

            server.listen(port, bindAddress || '0.0.0.0', () => {
                this.server = server;
                this.isRunning = true;
                this.metricsTracker.listenerState = 'listening';
                this.metricsTracker.listenerError = undefined;
                resolve();
            });
        });
    }

    public async stop(): Promise<void> {
        this.isRunning = false;

        // Close all incoming client sockets cleanly
        for (const [id, client] of this.clients.entries()) {
            try {
                if (client.handshakeTimer) clearTimeout(client.handshakeTimer);
                if (client.idleTimer) clearTimeout(client.idleTimer);
                client.socket.write(encodeFrame(buildServerClose({
                    serverSessionId: id,
                    reason: 'Server stopping'
                })));
                client.socket.destroy();
            } catch {}
        }
        this.clients.clear();

        if (this.server) {
            await new Promise<void>(resolve => {
                this.server?.close(() => resolve());
                this.server = null;
            });
        }

        this.metricsTracker.listenerState = 'stopped';
    }

    public getIncomingSessions(): IncomingSessionState[] {
        return Array.from(this.clients.values()).map(c => ({ ...c.state }));
    }

    public getActiveSessionsCount(): number {
        return this.clients.size;
    }

    private handleIncomingConnection(socket: net.Socket): void {
        const remoteIp = normalizeIp(socket.remoteAddress || '');
        const remotePort = socket.remotePort || 0;

        // 1. Max connections check
        const maxConns = this.appConfig.listener.maxConnections || 100;
        if (this.clients.size >= maxConns) {
            socket.write(encodeFrame(buildReject({
                appId: this.appConfig.id,
                clientSessionId: 'unknown',
                code: 'MAX_CONNECTIONS_REACHED',
                reason: `Server reached maximum capacity of ${maxConns} connections`
            })));
            socket.destroy();
            return;
        }

        // 2. Allowlist CIDR check
        const allowCidrs = this.appConfig.listener.allowCidrs || [];
        if (!isIpInCidrs(remoteIp, allowCidrs)) {
            socket.write(encodeFrame(buildReject({
                appId: this.appConfig.id,
                clientSessionId: 'unknown',
                code: 'ALLOWLIST_DENIED',
                reason: `IP ${remoteIp} is not authorized by listener CIDR allowlist`
            })));
            socket.destroy();
            return;
        }

        // 3. Configure TCP Keepalive
        if (this.appConfig.listener.tcpKeepalive) {
            socket.setKeepAlive(true, 10000);
        }

        const serverSessionId = `ssess-${crypto.randomUUID().substring(0, 8)}`;
        const parser = new FrameParser(this.appConfig.listener.maxPayloadBytes || 1048576);

        const sessionState: IncomingSessionState = {
            sessionId: serverSessionId,
            appId: this.appConfig.id,
            declaredSiteName: 'Handshaking...',
            declaredInstanceId: '',
            declaredHostname: '',
            remoteIp,
            remotePort,
            isConfiguredPeer: false,
            state: 'handshaking',
            connectedAt: Date.now(),
            lastActivityAt: Date.now(),
            bytesReceived: 0,
            bytesSent: 0,
            requestsHandled: 0,
            simulatedDrops: 0,
            simulatedErrors: 0
        };

        const tracked: TrackedIncomingClient = {
            sessionId: serverSessionId,
            socket,
            state: sessionState,
            parser,
            handshakeCompleted: false,
            requestCount: 0,
            startedAt: Date.now()
        };

        // Handshake timeout (5s)
        tracked.handshakeTimer = setTimeout(() => {
            if (!tracked.handshakeCompleted) {
                socket.destroy();
                this.clients.delete(serverSessionId);
            }
        }, 5000);

        this.clients.set(serverSessionId, tracked);

        // Socket events
        socket.on('data', chunk => {
            sessionState.bytesReceived += chunk.length;
            sessionState.lastActivityAt = Date.now();
            this.metricsTracker.recordRx(chunk.length);
            this.resetIdleTimer(tracked);
            parser.push(chunk);
        });

        parser.on('message', msg => {
            this.handleMessage(tracked, msg);
        });

        parser.on('error', err => {
            socket.destroy();
            this.clients.delete(serverSessionId);
        });

        socket.on('error', () => {
            sessionState.state = 'error';
            this.cleanupClient(serverSessionId);
        });

        socket.on('close', () => {
            sessionState.state = 'closed';
            this.cleanupClient(serverSessionId);
        });
    }

    private handleMessage(client: TrackedIncomingClient, msg: any): void {
        const { socket, state } = client;

        // Message 1: Handshake
        if (!client.handshakeCompleted) {
            if (msg.type !== 'CLIENT_HELLO') {
                socket.write(encodeFrame(buildReject({
                    appId: this.appConfig.id,
                    clientSessionId: msg.clientSessionId || 'unknown',
                    code: 'INVALID_PROTOCOL',
                    reason: 'Expected CLIENT_HELLO as first message'
                })));
                socket.destroy();
                return;
            }

            const hello = msg as ClientHelloMessage;
            if (hello.appId !== this.appConfig.id) {
                socket.write(encodeFrame(buildReject({
                    appId: this.appConfig.id,
                    clientSessionId: hello.clientSessionId,
                    code: 'APP_NOT_FOUND',
                    reason: `Application ID mismatch (expected ${this.appConfig.id})`
                })));
                socket.destroy();
                return;
            }

            // Optional Auth Token check
            const authConfig = this.appConfig.listener.auth;
            if (authConfig?.enabled && authConfig.token) {
                if (!hello.authToken || hello.authToken !== authConfig.token) {
                    socket.write(encodeFrame(buildReject({
                        appId: this.appConfig.id,
                        clientSessionId: hello.clientSessionId,
                        code: 'AUTH_FAILED',
                        reason: 'Authentication token mismatch'
                    })));
                    socket.destroy();
                    return;
                }
            }

            // Accept Handshake
            if (client.handshakeTimer) clearTimeout(client.handshakeTimer);
            client.handshakeCompleted = true;

            state.declaredSiteName = hello.origin.siteName;
            state.declaredInstanceId = hello.origin.instanceId;
            state.declaredHostname = hello.origin.hostname;
            state.state = 'connected';

            // Match against configured peers
            const matchedPeer = (this.appConfig.peers || []).find(
                p => p.siteName.toLowerCase() === hello.origin.siteName.toLowerCase() || p.host === state.remoteIp
            );
            if (matchedPeer) {
                state.isConfiguredPeer = true;
                state.matchedPeerName = matchedPeer.name;
            }

            const serverHello = buildServerHello({
                appId: this.appConfig.id,
                clientSessionId: hello.clientSessionId,
                serverSessionId: client.sessionId,
                responder: {
                    instanceId: this.localIdentity.instanceId,
                    siteName: this.localIdentity.siteName,
                    hostname: this.localIdentity.hostname
                },
                acceptedBehavior: this.appConfig.serverBehavior.mode
            });

            const raw = encodeFrame(serverHello);
            socket.write(raw);
            state.bytesSent += raw.length;
            this.metricsTracker.recordTx(raw.length);
            this.resetIdleTimer(client);
            return;
        }

        // Regular Workload Messages
        switch (msg.type) {
            case 'REQUEST':
                this.handleRequest(client, msg as RequestMessage);
                break;
            case 'PING':
                const pongBuf = encodeFrame(buildPong({ clientSessionId: client.sessionId, seq: (msg as PingMessage).seq }));
                socket.write(pongBuf);
                state.bytesSent += pongBuf.length;
                this.metricsTracker.recordTx(pongBuf.length);
                break;
            case 'CLIENT_CLOSE':
                socket.end();
                break;
        }
    }

    private handleRequest(client: TrackedIncomingClient, req: RequestMessage): void {
        const { socket, state } = client;
        client.requestCount++;
        state.requestsHandled++;
        this.metricsTracker.totalRequests++;

        const behavior = this.appConfig.serverBehavior;

        // 1. Check Close Connection simulation
        if (behavior.mode === 'close_connection') {
            const limit = behavior.closeAfterRequests || 100;
            if (client.requestCount >= limit) {
                socket.write(encodeFrame(buildServerClose({
                    serverSessionId: client.sessionId,
                    reason: `Closed connection after ${limit} requests (simulated behavior)`,
                    simulated: true
                })));
                socket.destroy();
                return;
            }
        }

        // 2. Check Drop Response simulation
        if (behavior.mode === 'drop_response' || (behavior.dropProbability && behavior.dropProbability > 0)) {
            const prob = behavior.dropProbability || 10;
            if (Math.random() * 100 < prob) {
                state.simulatedDrops++;
                this.metricsTracker.totalSimulatedDrops++;
                // Skip sending response!
                return;
            }
        }

        // 3. Check Error Response simulation
        if (behavior.mode === 'error_response' || (behavior.errorProbability && behavior.errorProbability > 0)) {
            const prob = behavior.errorProbability || 10;
            if (Math.random() * 100 < prob) {
                state.simulatedErrors++;
                this.metricsTracker.totalErrors++;
                const errFrame = encodeFrame(buildError({
                    requestId: req.requestId,
                    clientSessionId: req.clientSessionId,
                    code: behavior.errorCode || 'SIMULATED_SERVER_ERROR',
                    message: 'Simulated server error response',
                    simulated: true
                }));
                socket.write(errFrame);
                state.bytesSent += errFrame.length;
                this.metricsTracker.recordTx(errFrame.length);
                return;
            }
        }

        // 4. Calculate Delay (Fixed, Random, Looping)
        let delayMs = 0;
        if (behavior.mode === 'fixed_delay') {
            delayMs = behavior.fixedDelayMs || 500;
        } else if (behavior.mode === 'random_delay') {
            const min = behavior.randomDelayMinMs || 100;
            const max = behavior.randomDelayMaxMs || 1000;
            delayMs = Math.floor(min + Math.random() * (max - min));
        } else if (behavior.mode === 'looping_delay') {
            const normalSec = behavior.loopingNormalSec || 60;
            const slowSec = behavior.loopingSlowSec || 60;
            const cycleMs = (normalSec + slowSec) * 1000;
            const posInCycle = (Date.now() - client.startedAt) % cycleMs;
            if (posInCycle >= normalSec * 1000) {
                // In slow phase
                delayMs = behavior.loopingSlowDelayMs || 1000;
            }
        }

        const sendResponse = () => {
            if (socket.destroyed) return;

            const isAck = behavior.mode === 'acknowledge';
            const resp = buildResponse({
                requestId: req.requestId,
                clientSessionId: req.clientSessionId,
                seq: req.seq,
                payloadSize: isAck ? 0 : (req.payloadSize || 0),
                data: isAck ? undefined : req.data,
                simulated: delayMs > 0 ? { applied: true, delayMs } : { applied: false }
            });

            const respBuf = encodeFrame(resp);
            socket.write(respBuf);
            state.bytesSent += respBuf.length;
            this.metricsTracker.recordTx(respBuf.length);
            this.metricsTracker.totalResponses++;
        };

        if (delayMs > 0) {
            state.state = 'delayed';
            setTimeout(sendResponse, delayMs);
        } else {
            sendResponse();
        }
    }

    private resetIdleTimer(client: TrackedIncomingClient): void {
        if (client.idleTimer) clearTimeout(client.idleTimer);
        const idleMs = this.appConfig.listener.idleTimeoutMs || 60000;
        client.idleTimer = setTimeout(() => {
            client.state.state = 'idle';
            client.socket.destroy();
        }, idleMs);
    }

    private cleanupClient(sessionId: string): void {
        const client = this.clients.get(sessionId);
        if (client) {
            if (client.handshakeTimer) clearTimeout(client.handshakeTimer);
            if (client.idleTimer) clearTimeout(client.idleTimer);
            this.clients.delete(sessionId);
        }
    }
}
