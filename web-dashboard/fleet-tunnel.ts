import http from 'http';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { log } from './utils/logger.js';
import type { RegistryManager } from './registry-manager.js';

export interface TunnelPeerInfo {
    instanceId: string;
    siteName: string;
    ip: string;
    connectedAt: number;
    lastPing: number;
    transport: string;
}

export interface ForwardRequestPayload {
    reqId?: string;
    method: string;
    path: string;
    headers: Record<string, string | string[]>;
    body?: any;
}

export interface ForwardResponsePayload {
    status: number;
    headers: Record<string, string | string[]>;
    body: any;
    isBase64?: boolean;
}

/**
 * FleetTunnelManager — Manages WebSocket Reverse Tunnels (M5)
 *
 * Provides:
 * 1. FleetTunnelServer (Leader Hub): Socket.IO namespace `/fleet-tunnel` allowing remote spoke nodes
 *    behind NAT/CGNAT/firewalls to connect inbound. Requests to /api/gateway/:peerId are proxied
 *    over the persistent WebSocket connection without needing inbound port forwarding on Spokes.
 *
 * 2. FleetTunnelClient (Spoke Client): Autonomously discovers the Leader via RegistryManager
 *    (zero .env configuration) and opens an outbound WebSocket tunnel to the Leader.
 */
export class FleetTunnelManager {
    private ioServer: SocketIOServer;
    private registryManager: RegistryManager;
    private secretKey: string;
    private localPort: number;

    // Leader state: active tunnels indexed by instanceId and alias siteName
    private activeTunnels: Map<string, { socket: Socket; info: TunnelPeerInfo }> = new Map();
    private siteToInstanceMap: Map<string, string> = new Map();

    // Spoke state: client socket connected to Leader
    private clientSocket: ClientSocket | null = null;
    private clientCurrentLeaderUrl: string | null = null;
    private checkLeaderInterval: NodeJS.Timeout | null = null;

    constructor(
        ioServer: SocketIOServer,
        registryManager: RegistryManager,
        secretKey: string,
        localPort: number = 8080
    ) {
        this.ioServer = ioServer;
        this.registryManager = registryManager;
        this.secretKey = secretKey;
        this.localPort = localPort;

        this.initServerNamespace();
    }

    /**
     * Leader Hub: Setup Socket.IO namespace `/fleet-tunnel`
     */
    private initServerNamespace(): void {
        const tunnelNamespace = this.ioServer.of('/fleet-tunnel');

        // Authentication middleware
        tunnelNamespace.use((socket: Socket, next: (err?: Error) => void) => {
            const auth = socket.handshake.auth || {};
            const token = auth.token;

            if (!token) {
                log('TUNNEL', `Rejecting unauthenticated reverse tunnel connection from ${socket.handshake.address}`, 'warn');
                return next(new Error('authentication_required'));
            }

            try {
                jwt.verify(token, this.secretKey);
                next();
            } catch (err: any) {
                log('TUNNEL', `Invalid reverse tunnel JWT token from ${socket.handshake.address}: ${err.message}`, 'warn');
                return next(new Error('invalid_token'));
            }
        });

        tunnelNamespace.on('connection', (socket: Socket) => {
            const auth = socket.handshake.auth || {};
            const instanceId: string = auth.instanceId || socket.id;
            const siteName: string = auth.siteName || instanceId;
            const clientIp: string = auth.ip || socket.handshake.address.replace(/^.*:/, '') || '127.0.0.1';

            const info: TunnelPeerInfo = {
                instanceId,
                siteName,
                ip: clientIp,
                connectedAt: Date.now(),
                lastPing: Date.now(),
                transport: 'websocket'
            };

            this.activeTunnels.set(instanceId, { socket, info });
            if (siteName) {
                this.siteToInstanceMap.set(siteName.toLowerCase(), instanceId);
            }

            log('TUNNEL', `⚡ Reverse tunnel connected: ${siteName} (${instanceId}) [${clientIp}] via WebSocket`);

            socket.on('disconnect', (reason: string) => {
                log('TUNNEL', `Reverse tunnel disconnected: ${siteName} (${instanceId}) — reason: ${reason}`, 'warn');
                this.activeTunnels.delete(instanceId);
                if (siteName && this.siteToInstanceMap.get(siteName.toLowerCase()) === instanceId) {
                    this.siteToInstanceMap.delete(siteName.toLowerCase());
                }
            });

            socket.on('tunnel:ping', (ack?: () => void) => {
                const entry = this.activeTunnels.get(instanceId);
                if (entry) entry.info.lastPing = Date.now();
                if (typeof ack === 'function') ack();
            });
        });

        log('TUNNEL', `🚀 Fleet Reverse Tunnel Hub mounted at /fleet-tunnel namespace`);
    }

    /**
     * Start background loop for Spoke auto-discovery of Leader
     */
    public start(): void {
        this.checkLeaderAndTunnel();
        this.checkLeaderInterval = setInterval(() => this.checkLeaderAndTunnel(), 5000);
    }

    public stop(): void {
        if (this.checkLeaderInterval) {
            clearInterval(this.checkLeaderInterval);
            this.checkLeaderInterval = null;
        }
        if (this.clientSocket) {
            this.clientSocket.disconnect();
            this.clientSocket = null;
        }
    }

    /**
     * Spoke Node: Checks if we are a spoke and connects outbound tunnel to discovered Leader
     */
    private checkLeaderAndTunnel(): void {
        const isLeader = this.registryManager.isLeader();

        if (isLeader) {
            // Leader node does not need an outbound tunnel client to itself
            if (this.clientSocket) {
                log('TUNNEL', `Node is Leader — disconnecting outbound tunnel client`);
                this.clientSocket.disconnect();
                this.clientSocket = null;
                this.clientCurrentLeaderUrl = null;
            }
            return;
        }

        // We are a Spoke node — discover Leader URL / IP from RegistryManager
        const status = this.registryManager.getStatus();
        let targetHost: string | null = null;
        let targetPort: number = 8080;

        if (status.leader_info?.ip && status.leader_info.ip !== '127.0.0.1') {
            targetHost = status.leader_info.ip;
        } else if (status.static_leader_url) {
            try {
                const u = new URL(status.static_leader_url);
                targetHost = u.hostname;
                targetPort = u.port ? parseInt(u.port) : 8080;
            } catch {}
        } else if (process.env.STIGIX_CONTROLLER_URL) {
            try {
                const u = new URL(process.env.STIGIX_CONTROLLER_URL.startsWith('http') ? process.env.STIGIX_CONTROLLER_URL : `http://${process.env.STIGIX_CONTROLLER_URL}`);
                targetHost = u.hostname;
                targetPort = u.port ? parseInt(u.port) : 8080;
            } catch {}
        } else if (process.env.STIGIX_LEADER_URL) {
            try {
                const u = new URL(process.env.STIGIX_LEADER_URL.startsWith('http') ? process.env.STIGIX_LEADER_URL : `http://${process.env.STIGIX_LEADER_URL}`);
                targetHost = u.hostname;
                targetPort = u.port ? parseInt(u.port) : 8080;
            } catch {}
        }

        if (!targetHost) {
            return; // No leader discovered yet
        }

        const targetUrl = `http://${targetHost}:${targetPort}`;

        // If target leader changed, disconnect old client
        if (this.clientSocket && this.clientCurrentLeaderUrl !== targetUrl) {
            log('TUNNEL', `Leader changed from ${this.clientCurrentLeaderUrl} to ${targetUrl} — reconnecting tunnel`);
            this.clientSocket.disconnect();
            this.clientSocket = null;
        }

        if (!this.clientSocket) {
            this.connectOutboundTunnel(targetUrl, targetHost, targetPort);
        }
    }

    /**
     * Spoke Node: Connect outbound WebSocket to Leader Hub
     */
    private connectOutboundTunnel(targetUrl: string, host: string, port: number): void {
        const regStatus = this.registryManager.getStatus();
        const instanceId = regStatus.instance_id || 'spoke-node';
        const siteName = regStatus.site_name || instanceId;
        const localIp = regStatus.detected_ip || '127.0.0.1';

        // Generate token for handshake
        const token = jwt.sign(
            { username: 'stigix-tunnel-spoke', role: 'admin', peer: instanceId, site: siteName },
            this.secretKey,
            { expiresIn: '24h' }
        );

        this.clientCurrentLeaderUrl = targetUrl;
        const wsUrl = `${targetUrl}/fleet-tunnel`;

        log('TUNNEL', `Connecting outbound WebSocket reverse tunnel to Leader at ${wsUrl}...`);

        const socket = ioClient(wsUrl, {
            auth: {
                token,
                instanceId,
                siteName,
                ip: localIp
            },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 3000,
            reconnectionDelayMax: 15000,
            timeout: 10000
        });

        socket.on('connect', () => {
            log('TUNNEL', `⚡ Outbound reverse tunnel ESTABLISHED to Leader (${host}:${port})`);
        });

        socket.on('connect_error', (err: any) => {
            log('TUNNEL', `Outbound reverse tunnel connection failed (${host}:${port}): ${err.message}`, 'warn');
        });

        socket.on('disconnect', (reason: string) => {
            log('TUNNEL', `Outbound reverse tunnel disconnected (${reason})`, 'warn');
        });

        // Handle forwarded HTTP requests from Leader
        socket.on('gateway:forward', (payload: ForwardRequestPayload, ack: (res: ForwardResponsePayload) => void) => {
            this.handleLocalHttpRequest(payload)
                .then((res) => {
                    if (typeof ack === 'function') ack(res);
                })
                .catch((err) => {
                    if (typeof ack === 'function') {
                        ack({
                            status: 502,
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({
                                error: 'local_proxy_error',
                                message: err.message
                            })
                        });
                    }
                });
        });

        this.clientSocket = socket;
    }

    /**
     * Spoke Node: Execute incoming request locally against 127.0.0.1:8080
     */
    private handleLocalHttpRequest(payload: ForwardRequestPayload): Promise<ForwardResponsePayload> {
        return new Promise((resolve) => {
            const hopByHop = new Set([
                'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
                'te', 'trailers', 'transfer-encoding', 'upgrade', 'host'
            ]);

            const cleanHeaders: Record<string, string | string[]> = {};
            if (payload.headers) {
                for (const [k, v] of Object.entries(payload.headers)) {
                    if (!hopByHop.has(k.toLowerCase()) && v !== undefined) {
                        cleanHeaders[k] = v;
                    }
                }
            }

            cleanHeaders['host'] = `127.0.0.1:${this.localPort}`;
            cleanHeaders['x-gateway-source'] = 'reverse-tunnel';

            let bodyBuf: Buffer | null = null;
            if (payload.body != null && !['GET', 'HEAD'].includes(payload.method.toUpperCase())) {
                if (typeof payload.body === 'object') {
                    bodyBuf = Buffer.from(JSON.stringify(payload.body), 'utf8');
                    cleanHeaders['content-type'] = cleanHeaders['content-type'] || 'application/json';
                } else if (typeof payload.body === 'string') {
                    bodyBuf = Buffer.from(payload.body, 'utf8');
                }
                if (bodyBuf) {
                    cleanHeaders['content-length'] = bodyBuf.length.toString();
                }
            }

            const reqOptions: http.RequestOptions = {
                hostname: '127.0.0.1',
                port: this.localPort,
                path: payload.path,
                method: payload.method,
                headers: cleanHeaders,
                timeout: 14000
            };

            const localReq = http.request(reqOptions, (localRes) => {
                const chunks: Buffer[] = [];
                localRes.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                localRes.on('end', () => {
                    const totalBuf = Buffer.concat(chunks);
                    const contentType = (localRes.headers['content-type'] || '').toLowerCase();
                    const isText = contentType.includes('json') ||
                        contentType.includes('text') ||
                        contentType.includes('javascript') ||
                        contentType.includes('xml') ||
                        contentType.includes('html');

                    const responseHeaders: Record<string, string | string[]> = {};
                    for (const [k, v] of Object.entries(localRes.headers)) {
                        if (!hopByHop.has(k.toLowerCase()) && v !== undefined) {
                            responseHeaders[k] = v;
                        }
                    }

                    resolve({
                        status: localRes.statusCode || 200,
                        headers: responseHeaders,
                        body: isText ? totalBuf.toString('utf8') : totalBuf.toString('base64'),
                        isBase64: !isText
                    });
                });
            });

            localReq.on('timeout', () => {
                localReq.destroy();
                resolve({
                    status: 504,
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ error: 'local_timeout', message: 'Local spoke request timed out.' })
                });
            });

            localReq.on('error', (err: any) => {
                resolve({
                    status: 502,
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ error: 'local_request_failed', message: err.message })
                });
            });

            if (bodyBuf && bodyBuf.length > 0) {
                localReq.write(bodyBuf);
            }
            localReq.end();
        });
    }

    /**
     * Leader Hub: Checks if a peer has an active reverse WebSocket tunnel
     */
    public hasTunnel(peerIdentifier: string): boolean {
        if (!peerIdentifier) return false;
        if (this.activeTunnels.has(peerIdentifier)) {
            const entry = this.activeTunnels.get(peerIdentifier);
            return !!(entry && entry.socket.connected);
        }
        const mappedId = this.siteToInstanceMap.get(peerIdentifier.toLowerCase());
        if (mappedId && this.activeTunnels.has(mappedId)) {
            const entry = this.activeTunnels.get(mappedId);
            return !!(entry && entry.socket.connected);
        }
        return false;
    }

    /**
     * Leader Hub: Forward an HTTP request over the reverse tunnel to a spoke node
     */
    public forwardRequest(
        peerIdentifier: string,
        reqPayload: ForwardRequestPayload,
        timeoutMs: number = 15000
    ): Promise<ForwardResponsePayload | null> {
        let entry = this.activeTunnels.get(peerIdentifier);
        if (!entry) {
            const mappedId = this.siteToInstanceMap.get(peerIdentifier.toLowerCase());
            if (mappedId) entry = this.activeTunnels.get(mappedId);
        }

        if (!entry || !entry.socket || !entry.socket.connected) {
            return Promise.resolve(null);
        }

        const socket = entry.socket;
        const payload: ForwardRequestPayload = {
            reqId: reqPayload.reqId || randomUUID(),
            method: reqPayload.method,
            path: reqPayload.path,
            headers: reqPayload.headers,
            body: reqPayload.body
        };

        return new Promise((resolve, reject) => {
            socket.timeout(timeoutMs).emit('gateway:forward', payload, (err: any, response: ForwardResponsePayload) => {
                if (err) {
                    return reject(new Error(`Reverse tunnel timeout or error: ${err.message || 'no response from peer'}`));
                }
                if (!response) {
                    return reject(new Error('Reverse tunnel returned empty response'));
                }
                resolve(response);
            });
        });
    }

    /**
     * Leader Hub: Get list of active connected tunnels
     */
    public getConnectedTunnels(): TunnelPeerInfo[] {
        const result: TunnelPeerInfo[] = [];
        for (const [, entry] of this.activeTunnels) {
            if (entry.socket.connected) {
                result.push({ ...entry.info });
            }
        }
        return result;
    }
}
