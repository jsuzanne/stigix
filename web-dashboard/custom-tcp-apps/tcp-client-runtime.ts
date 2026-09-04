/**
 * Stigix Custom TCP Inter-Site Applications — Client Runtime
 * Manages outgoing connection pool towards peers, request/reply generation, backoff with jitter, and RTT.
 */

import net from 'net';
import crypto from 'crypto';
import os from 'os';
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
    lastRateCalcTs?: number;
    prevTxBytes?: number;
    prevRxBytes?: number;
    prevReqCount?: number;
    liveTxBps?: number;
    liveRxBps?: number;
    liveTps?: number;
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

    public updateIdentity(newIdentity: InstanceIdentityConfig): void {
        this.localIdentity.siteName = newIdentity.siteName;
        this.localIdentity.displayName = newIdentity.displayName;
    }

    /**
     * Determines whether a target peer corresponds to the local node itself.
     */
    public isSelfPeer(peer: PeerConfig): boolean {
        if (!peer) return false;

        const ownSiteName = (this.localIdentity?.siteName || '').trim().toLowerCase();
        const ownDisplayName = (this.localIdentity?.displayName || '').trim().toLowerCase();
        const ownHostname = (this.localIdentity?.hostname || '').trim().toLowerCase();
        const ownInstanceId = (this.localIdentity?.instanceId || '').trim().toLowerCase();

        const peerSiteName = (peer.siteName || '').trim().toLowerCase();
        const peerName = (peer.name || '').trim().toLowerCase();
        const peerId = (peer.id || '').trim().toLowerCase();
        const peerHost = (peer.host || '').trim().toLowerCase();

        // 1. Exact or normalized Site Name / Display Name / Hostname matches
        if (ownSiteName && (peerSiteName === ownSiteName || peerName === ownSiteName)) {
            return true;
        }
        if (ownDisplayName && (peerSiteName === ownDisplayName || peerName === ownDisplayName)) {
            return true;
        }
        if (ownHostname && (peerSiteName === ownHostname || peerName === ownHostname || peerHost === ownHostname)) {
            return true;
        }

        // 2. Exact Instance ID or synthetic registry ID matches (e.g. reg-self-DC1-Ubuntu)
        if (ownInstanceId && peerId === ownInstanceId) {
            return true;
        }
        if (ownSiteName && (peerId === `reg-self-${ownSiteName}` || peerId === `target-${ownSiteName}`)) {
            return true;
        }

        // 3. Localhost / Loopback addresses
        if (peerHost === '127.0.0.1' || peerHost === 'localhost' || peerHost === '::1' || peerHost === '0.0.0.0') {
            return true;
        }

        // 4. Match against all local network interface IPv4/IPv6 addresses
        try {
            const ifaces = os.networkInterfaces();
            for (const ifaceList of Object.values(ifaces)) {
                if (!ifaceList) continue;
                for (const iface of ifaceList) {
                    if (iface.address && iface.address.toLowerCase() === peerHost) {
                        return true;
                    }
                }
            }
        } catch {}

        return false;
    }

    public async start(targetPeerIds?: string[]): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;
        this.metricsTracker.clientWorkloadRunning = true;

        const allConfiguredPeers = (this.appConfig.peers || []).filter(
            p => p.enabled && (!targetPeerIds || targetPeerIds.includes(p.id))
        );

        // Auto-exclusion: if there are multiple peers in the mesh, filter out self to avoid local loopback traffic
        let enabledPeers = allConfiguredPeers.filter(p => {
            const isSelf = this.isSelfPeer(p);
            if (isSelf && allConfiguredPeers.length > 1) {
                console.log(`[CUSTOM_TCP_CLIENT] Auto-excluded local self peer "${p.name || p.siteName || p.host}" from outgoing workload for app "${this.appConfig.name}".`);
                return false;
            }
            return true;
        });

        // Fallback: If only self was configured (e.g. standalone single-node test), keep it so user can still test
        if (enabledPeers.length === 0 && allConfiguredPeers.length > 0) {
            enabledPeers = allConfiguredPeers;
        }

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
        const now = Date.now();
        return Array.from(this.sessions.values()).map(s => {
            const now = Date.now();
            const deltaSec = (now - (s.lastRateCalcTs || (now - 1000))) / 1000;
            if (deltaSec >= 0.5) {
                const prevTx = s.prevTxBytes || 0;
                const prevRx = s.prevRxBytes || 0;
                const prevReq = s.prevReqCount || 0;
                const instTxBps = Math.max(0, Math.round(((s.state.bytesSent - prevTx) * 8) / deltaSec));
                const instRxBps = Math.max(0, Math.round(((s.state.bytesReceived - prevRx) * 8) / deltaSec));
                const instTps = Number((Math.max(0, (s.state.requestsSent - prevReq)) / deltaSec).toFixed(1));

                // Smooth rates using EMA (alpha = 0.5) if previous rate exists
                s.liveTxBps = s.liveTxBps !== undefined ? Math.round(s.liveTxBps * 0.5 + instTxBps * 0.5) : instTxBps;
                s.liveRxBps = s.liveRxBps !== undefined ? Math.round(s.liveRxBps * 0.5 + instRxBps * 0.5) : instRxBps;
                s.liveTps = s.liveTps !== undefined ? Number((s.liveTps * 0.5 + instTps * 0.5).toFixed(1)) : instTps;

                // If session is active and total bytes > 0, ensure lifetime avg fallback if idle between ticks
                if (s.liveTxBps === 0 && s.state.requestsSent > 0 && s.state.connectedAt) {
                    const totalUptimeSec = Math.max(1, Math.floor((now - s.state.connectedAt) / 1000));
                    const avgTxBps = Math.round((s.state.bytesSent * 8) / totalUptimeSec);
                    const avgRxBps = Math.round((s.state.bytesReceived * 8) / totalUptimeSec);
                    const avgTps = Number((s.state.requestsSent / totalUptimeSec).toFixed(1));
                    s.liveTxBps = avgTxBps;
                    s.liveRxBps = avgRxBps;
                    s.liveTps = avgTps;
                }

                s.prevTxBytes = s.state.bytesSent;
                s.prevRxBytes = s.state.bytesReceived;
                s.prevReqCount = s.state.requestsSent;
                s.lastRateCalcTs = now;
            }

            const connectedAt = s.state.connectedAt || 0;
            const uptimeSec = (s.state.state === 'connected' && connectedAt > 0)
                ? Math.floor((now - connectedAt) / 1000)
                : 0;

            return {
                ...s.state,
                uptimeSec,
                txBps: s.liveTxBps || 0,
                rxBps: s.liveRxBps || 0,
                tps: s.liveTps || 0,
                rttMs: s.rttTracker.getStats()
            };
        });
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

        const startConnectTs = Date.now();
        socket.connect(session.peer.port, session.peer.host, () => {
            session.state.state = 'handshaking';
            session.state.connectedAt = Date.now();
            session.state.tcpConnectMs = Math.max(1, Date.now() - startConnectTs);
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
            this.metricsTracker.recordClientTx(buf.length);
        });

        socket.on('data', chunk => {
            session.state.bytesReceived += chunk.length;
            this.metricsTracker.recordClientRx(chunk.length);
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
                const serverDelayMs = resp.simulated?.delayMs || 0;
                const networkRttMs = Math.max(0, rtt - serverDelayMs);

                session.rttTracker.record(rtt, serverDelayMs, networkRttMs);
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
        this.metricsTracker.recordClientTx(buf.length);

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
