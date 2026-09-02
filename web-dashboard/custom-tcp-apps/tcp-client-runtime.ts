/**
 * Stigix Custom TCP Inter-Site Applications — Client Runtime
 * Manages outgoing connection pool towards peers, request/reply generation, backoff with jitter, and RTT.
 */

import net from 'net';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import {
    CustomTcpApplicationConfig,
    PeerConfig,
    OutgoingSessionState,
    InstanceIdentityConfig,
    ResponseMessage,
    ServerHelloMessage,
    RejectMessage,
    ErrorMessage
} from './types.js';
import { FrameParser } from './frame-parser.js';
import {
    encodeFrame,
    buildClientHello,
    buildRequest,
    buildPing,
    buildClientClose
} from './protocol.js';
import { AppMetricsTracker, RollingRttTracker } from './metrics.js';

interface ActiveClientSession {
    sessionId: string;
    peer: PeerConfig;
    socket: net.Socket | null;
    parser: FrameParser;
    state: OutgoingSessionState;
    rttTracker: RollingRttTracker;
    handshakeCompleted: boolean;
    reconnectAttempts: number;
    reconnectTimer?: NodeJS.Timeout;
    workloadTimer?: NodeJS.Timeout;
    pendingRequests: Map<string, { sentTs: number; timer: NodeJS.Timeout }>;
    seq: number;
    isStopping: boolean;
}

export class TcpClientRuntime extends EventEmitter {
    public appConfig: CustomTcpApplicationConfig;
    private readonly localIdentity: InstanceIdentityConfig;
    private readonly metricsTracker: AppMetricsTracker;

    private readonly sessions = new Map<string, ActiveClientSession>();
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

    public updateConfig(newConfig: CustomTcpApplicationConfig): void {
        this.appConfig = newConfig;
    }

    public async start(targetPeerIds?: string[]): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;
        this.metricsTracker.clientWorkloadRunning = true;

        const enabledPeers = (this.appConfig.peers || []).filter(
            p => p.enabled && (!targetPeerIds || targetPeerIds.includes(p.id))
        );

        for (const peer of enabledPeers) {
            const conns = peer.connectionsOverride || this.appConfig.clientDefaults.connectionsPerPeer || 2;
            for (let i = 0; i < conns; i++) {
                this.spawnSession(peer);
            }
        }
    }

    public async stop(): Promise<void> {
        this.isRunning = false;
        this.metricsTracker.clientWorkloadRunning = false;

        for (const [id, session] of this.sessions.entries()) {
            session.isStopping = true;
            if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
            if (session.workloadTimer) clearTimeout(session.workloadTimer);
            for (const req of session.pendingRequests.values()) {
                clearTimeout(req.timer);
            }
            session.pendingRequests.clear();

            if (session.socket && !session.socket.destroyed) {
                try {
                    session.socket.write(encodeFrame(buildClientClose({ clientSessionId: id, reason: 'Client stopping' })));
                    session.socket.destroy();
                } catch {}
            }
        }
        this.sessions.clear();
    }

    public getOutgoingSessions(): OutgoingSessionState[] {
        return Array.from(this.sessions.values()).map(s => ({
            ...s.state,
            rttMs: s.rttTracker.getStats()
        }));
    }

    public getActiveSessionsCount(): number {
        return Array.from(this.sessions.values()).filter(s => s.state.state === 'connected').length;
    }

    /**
     * Executes a single one-off connect + handshake test against a peer.
     */
    public async testPeerHandshake(peer: PeerConfig): Promise<{
        success: boolean;
        rttMs?: number;
        responder?: any;
        error?: string;
    }> {
        return new Promise(resolve => {
            const socket = new net.Socket();
            const parser = new FrameParser(this.appConfig.listener.maxPayloadBytes || 1048576);
            const clientSessionId = `test-${crypto.randomUUID().substring(0, 8)}`;
            let startTs = 0;

            const timeout = setTimeout(() => {
                socket.destroy();
                resolve({ success: false, error: 'Connection or handshake timeout (5s)' });
            }, 5000);

            socket.once('error', (err: any) => {
                clearTimeout(timeout);
                socket.destroy();
                resolve({ success: false, error: err.message });
            });

            socket.connect(peer.port, peer.host, () => {
                startTs = Date.now();
                const hello = buildClientHello({
                    appId: this.appConfig.id,
                    clientSessionId,
                    origin: {
                        instanceId: this.localIdentity.instanceId,
                        siteName: this.localIdentity.siteName,
                        hostname: this.localIdentity.hostname
                    },
                    authToken: peer.token || this.appConfig.listener.auth?.token
                });
                socket.write(encodeFrame(hello));
            });

            socket.on('data', chunk => parser.push(chunk));

            parser.once('message', msg => {
                clearTimeout(timeout);
                const rtt = Date.now() - startTs;
                socket.destroy();

                if (msg.type === 'SERVER_HELLO') {
                    const sHello = msg as ServerHelloMessage;
                    resolve({
                        success: true,
                        rttMs: rtt,
                        responder: sHello.responder
                    });
                } else if (msg.type === 'REJECT') {
                    const reject = msg as RejectMessage;
                    resolve({
                        success: false,
                        error: `Rejected by peer: ${reject.reason} (${reject.code})`
                    });
                } else {
                    resolve({
                        success: false,
                        error: `Unexpected message from peer: ${msg.type}`
                    });
                }
            });
        });
    }

    private spawnSession(peer: PeerConfig): void {
        const sessionId = `csess-${crypto.randomUUID().substring(0, 8)}`;
        const rttTracker = new RollingRttTracker(100);

        const state: OutgoingSessionState = {
            sessionId,
            appId: this.appConfig.id,
            peerId: peer.id,
            peerName: peer.name,
            peerHost: peer.host,
            peerPort: peer.port,
            state: 'connecting',
            rttMs: rttTracker.getStats(),
            requestsSent: 0,
            responsesReceived: 0,
            timeouts: 0,
            errors: 0,
            reconnects: 0,
            bytesSent: 0,
            bytesReceived: 0
        };

        const session: ActiveClientSession = {
            sessionId,
            peer,
            socket: null,
            parser: new FrameParser(this.appConfig.listener.maxPayloadBytes || 1048576),
            state,
            rttTracker,
            handshakeCompleted: false,
            reconnectAttempts: 0,
            pendingRequests: new Map(),
            seq: 0,
            isStopping: false
        };

        this.sessions.set(sessionId, session);
        this.connectSession(session);
    }

    private connectSession(session: ActiveClientSession): void {
        if (!this.isRunning || session.isStopping) return;

        session.state.state = 'connecting';
        session.handshakeCompleted = false;
        session.parser.reset();

        const socket = new net.Socket();
        session.socket = socket;

        const connectTimeoutMs = this.appConfig.clientDefaults.connectTimeoutMs || 5000;
        socket.setTimeout(connectTimeoutMs);

        if (this.appConfig.clientDefaults.tcpKeepalive) {
            socket.setKeepAlive(true, 10000);
        }

        socket.connect(session.peer.port, session.peer.host, () => {
            session.state.state = 'handshaking';
            session.state.connectedAt = Date.now();
            session.reconnectAttempts = 0; // Reset backoff upon successful TCP connect

            // Send CLIENT_HELLO
            const hello = buildClientHello({
                appId: this.appConfig.id,
                clientSessionId: session.sessionId,
                origin: {
                    instanceId: this.localIdentity.instanceId,
                    siteName: this.localIdentity.siteName,
                    hostname: this.localIdentity.hostname
                },
                authToken: session.peer.token || this.appConfig.listener.auth?.token
            });

            const buf = encodeFrame(hello);
            socket.write(buf);
            session.state.bytesSent += buf.length;
            this.metricsTracker.recordTx(buf.length);
        });

        socket.on('data', chunk => {
            session.state.bytesReceived += chunk.length;
            this.metricsTracker.recordRx(chunk.length);
            session.parser.push(chunk);
        });

        session.parser.on('message', msg => {
            this.handleIncomingMessage(session, msg);
        });

        socket.on('timeout', () => {
            session.state.timeouts++;
            this.metricsTracker.totalTimeouts++;
            socket.destroy();
        });

        socket.on('error', (err: any) => {
            session.state.errors++;
            session.state.lastError = err.message;
            this.metricsTracker.totalErrors++;
        });

        socket.on('close', () => {
            this.handleSessionClose(session);
        });
    }

    private handleIncomingMessage(session: ActiveClientSession, msg: any): void {
        if (!session.handshakeCompleted) {
            if (msg.type === 'SERVER_HELLO') {
                session.handshakeCompleted = true;
                session.state.state = 'connected';
                this.startWorkloadLoop(session);
            } else if (msg.type === 'REJECT') {
                const reject = msg as RejectMessage;
                session.state.state = 'rejected';
                session.state.lastError = `Rejected: ${reject.reason} (${reject.code})`;
                session.socket?.destroy();
            }
            return;
        }

        if (msg.type === 'RESPONSE') {
            const resp = msg as ResponseMessage;
            const pending = session.pendingRequests.get(resp.requestId);
            if (pending) {
                clearTimeout(pending.timer);
                session.pendingRequests.delete(resp.requestId);

                const rtt = Date.now() - pending.sentTs;
                session.rttTracker.record(rtt);
                this.metricsTracker.recordRtt(rtt);

                session.state.responsesReceived++;
                session.state.lastSuccessAt = Date.now();
                this.metricsTracker.totalResponses++;
            }
        } else if (msg.type === 'ERROR') {
            const err = msg as ErrorMessage;
            if (err.requestId && session.pendingRequests.has(err.requestId)) {
                clearTimeout(session.pendingRequests.get(err.requestId)!.timer);
                session.pendingRequests.delete(err.requestId);
            }
            session.state.errors++;
            session.state.lastError = `${err.code}: ${err.message}`;
            this.metricsTracker.totalErrors++;
        } else if (msg.type === 'PONG') {
            // Heartbeat pong received
            session.state.lastSuccessAt = Date.now();
        }
    }

    private startWorkloadLoop(session: ActiveClientSession): void {
        if (!this.isRunning || session.isStopping) return;

        const intervalMs = session.peer.intervalOverrideMs || this.appConfig.clientDefaults.intervalMs || 1000;
        const mode = this.appConfig.clientDefaults.mode || 'persistent_request_reply';

        const scheduleNext = () => {
            if (!this.isRunning || session.isStopping || session.state.state !== 'connected') return;
            session.workloadTimer = setTimeout(() => {
                this.executeWorkloadTick(session);
                scheduleNext();
            }, intervalMs);
        };

        scheduleNext();
    }

    private executeWorkloadTick(session: ActiveClientSession): void {
        if (!session.socket || session.socket.destroyed || !session.handshakeCompleted) return;

        session.seq++;
        const requestId = `req-${session.sessionId}-${session.seq}`;
        const payloadSize = this.appConfig.clientDefaults.payloadBytes || 1024;
        const requestTimeoutMs = this.appConfig.clientDefaults.requestTimeoutMs || 5000;

        // Generate synthetic payload string
        const sampleData = 'X'.repeat(Math.min(payloadSize, 4096));

        const req = buildRequest({
            requestId,
            clientSessionId: session.sessionId,
            seq: session.seq,
            payloadSize,
            data: sampleData
        });

        const buf = encodeFrame(req);
        session.socket.write(buf);
        session.state.requestsSent++;
        session.state.bytesSent += buf.length;
        this.metricsTracker.totalRequests++;
        this.metricsTracker.recordTx(buf.length);

        // Track timeout for this specific request
        const timer = setTimeout(() => {
            session.pendingRequests.delete(requestId);
            session.state.timeouts++;
            this.metricsTracker.totalTimeouts++;
        }, requestTimeoutMs);

        session.pendingRequests.set(requestId, {
            sentTs: Date.now(),
            timer
        });
    }

    private handleSessionClose(session: ActiveClientSession): void {
        if (session.workloadTimer) clearTimeout(session.workloadTimer);
        for (const req of session.pendingRequests.values()) {
            clearTimeout(req.timer);
        }
        session.pendingRequests.clear();

        if (!this.isRunning || session.isStopping) {
            session.state.state = 'closed';
            return;
        }

        // Bounded exponential backoff with full jitter
        session.reconnectAttempts++;
        session.state.reconnects++;
        session.state.state = 'reconnecting';
        this.metricsTracker.totalReconnects++;

        const initialMs = this.appConfig.clientDefaults.reconnectInitialMs || 1000;
        const maxMs = this.appConfig.clientDefaults.reconnectMaxMs || 30000;

        // delay = min(maxMs, initialMs * 1.5^attempts) * (0.5 + Math.random() * 0.5)
        const exponentialDelay = Math.min(maxMs, initialMs * Math.pow(1.5, session.reconnectAttempts - 1));
        const jitteredDelay = Math.floor(exponentialDelay * (0.5 + Math.random() * 0.5));

        session.reconnectTimer = setTimeout(() => {
            this.connectSession(session);
        }, jitteredDelay);
    }
}
