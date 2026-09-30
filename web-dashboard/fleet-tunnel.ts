import http from 'http';
import fs from 'fs';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { log } from './utils/logger.js';
import type { RegistryManager } from './registry-manager.js';
import type { LocalRegistryServer } from './local-registry-server.js';
import type { TargetsManager } from './targets-manager.js';

export interface TunnelPeerInfo {
    instanceId: string;
    siteName: string;
    ip: string;
    connectedAt: number;
    lastPing: number;
    transport: string;
    direction: 'inbound' | 'outbound_dial';
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
 * FleetTunnelManager — WebSocket Reverse Tunnels & Outbound Reverse Dialing (M5 & M6)
 *
 * Provides:
 * 1. FleetTunnelServer (Leader Hub & Spoke Namespace): Socket.IO namespace `/fleet-tunnel` allowing
 *    peers behind NAT/CGNAT/firewalls to connect. Requests to /api/gateway/:peerId are proxied
 *    over the persistent WebSocket connection without requiring inbound port opening.
 *
 * 2. Spoke Inbound-to-Leader Client (M5): Autonomously discovers Leader via RegistryManager
 *    and opens an outbound WebSocket tunnel to Leader.
 *
 * 3. Leader Outbound Reverse Dialing (M6): Leader dials outward to configured manual/cloud peers
 *    (e.g. Hetzner, AWS, Home LAN) without requiring the Leader to be exposed on the public Internet.
 */
export class FleetTunnelManager {
    private ioServer: SocketIOServer;
    private registryManager: RegistryManager;
    private targetsManager?: TargetsManager;
    private localRegistryServer?: LocalRegistryServer;
    private telemetryProvider?: () => Promise<any> | any;
    private secretKey: string;
    private localPort: number;

    // Active tunnels indexed by instanceId and alias siteName
    private activeTunnels: Map<string, { socket: Socket | ClientSocket; info: TunnelPeerInfo }> = new Map();
    private siteToInstanceMap: Map<string, string> = new Map();

    // Spoke state: client socket connected to Leader (M5)
    private spokeClientSocket: ClientSocket | null = null;
    private spokeCurrentLeaderUrl: string | null = null;
    private spokeTelemetryInterval: NodeJS.Timeout | null = null;

    // Leader state: outbound dialed client sockets to Cloud/Manual peers (M6)
    private outboundDialedSockets: Map<string, ClientSocket> = new Map();

    private backgroundLoopInterval: NodeJS.Timeout | null = null;

    constructor(
        ioServer: SocketIOServer,
        registryManager: RegistryManager,
        secretKey: string,
        localPort: number = 8080,
        targetsManager?: TargetsManager,
        localRegistryServer?: LocalRegistryServer
    ) {
        this.ioServer = ioServer;
        this.registryManager = registryManager;
        this.targetsManager = targetsManager;
        this.localRegistryServer = localRegistryServer;
        this.secretKey = secretKey;
        this.localPort = localPort;

        this.initServerNamespace();
    }

    public setTargetsManager(targetsManager: TargetsManager): void {
        this.targetsManager = targetsManager;
    }

    public setLocalRegistryServer(localRegistryServer: LocalRegistryServer): void {
        this.localRegistryServer = localRegistryServer;
    }

    public setTelemetryProvider(provider: () => Promise<any> | any): void {
        this.telemetryProvider = provider;
    }

    /**
     * Setup Socket.IO namespace `/fleet-tunnel` on this node
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
            const isLeaderDial: boolean = !!auth.isLeaderDial;

            const info: TunnelPeerInfo = {
                instanceId,
                siteName,
                ip: clientIp,
                connectedAt: Date.now(),
                lastPing: Date.now(),
                transport: 'websocket',
                direction: isLeaderDial ? 'outbound_dial' : 'inbound'
            };

            this.activeTunnels.set(instanceId, { socket, info });
            if (siteName) {
                this.siteToInstanceMap.set(siteName.toLowerCase(), instanceId);
            }
            this.siteToInstanceMap.set(clientIp.toLowerCase(), instanceId);

            log('TUNNEL', `⚡ Reverse tunnel connected: ${siteName} (${instanceId}) [${clientIp}] via WebSocket (${info.direction})`);

            // If a Leader dials into this Spoke (M6), automatically push our telemetry to the Leader periodically
            let dialHeartbeatInterval: NodeJS.Timeout | null = null;
            if (isLeaderDial) {
                this.pushLocalTelemetryToSocket(socket);
                dialHeartbeatInterval = setInterval(() => {
                    if (socket.connected) {
                        this.pushLocalTelemetryToSocket(socket);
                    }
                }, 15000);
            }

            socket.on('disconnect', (reason: string) => {
                if (dialHeartbeatInterval) {
                    clearInterval(dialHeartbeatInterval);
                    dialHeartbeatInterval = null;
                }
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

            // Handle telemetry push from remote peer (M6)
            socket.on('peer:telemetry', (peerTelemetry: any) => {
                if (this.localRegistryServer && peerTelemetry && peerTelemetry.instance_id) {
                    this.localRegistryServer.upsertInstance(peerTelemetry);
                }
            });

            // Handle query status request (async)
            socket.on('peer:query_status', async (ack: (status: any) => void) => {
                if (typeof ack === 'function') {
                    const status = await this.buildLocalTelemetryPayload();
                    ack(status);
                }
            });

            // Handle forwarded HTTP requests
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
        });

        log('TUNNEL', `🚀 Fleet Reverse Tunnel Hub mounted at /fleet-tunnel namespace`);
    }

    /**
     * Start background loop for:
     * - Spoke auto-discovery of Leader (M5)
     * - Leader outbound reverse dialing to Cloud/Manual Peers (M6)
     */
    public start(): void {
        this.runBackgroundLoop();
        this.backgroundLoopInterval = setInterval(() => this.runBackgroundLoop(), 5000);
    }

    public stop(): void {
        if (this.backgroundLoopInterval) {
            clearInterval(this.backgroundLoopInterval);
            this.backgroundLoopInterval = null;
        }
        if (this.spokeClientSocket) {
            this.spokeClientSocket.disconnect();
            this.spokeClientSocket = null;
        }
        if (this.spokeTelemetryInterval) {
            clearInterval(this.spokeTelemetryInterval);
            this.spokeTelemetryInterval = null;
        }
        for (const [, socket] of this.outboundDialedSockets) {
            socket.disconnect();
        }
        this.outboundDialedSockets.clear();
    }

    private runBackgroundLoop(): void {
        const isLeader = this.registryManager.isLeader();

        if (isLeader) {
            // 1. Leader mode: Clean up spoke socket if previously active
            if (this.spokeClientSocket) {
                log('TUNNEL', `Node is Leader — disconnecting spoke outbound client`);
                this.spokeClientSocket.disconnect();
                this.spokeClientSocket = null;
                this.spokeCurrentLeaderUrl = null;
                if (this.spokeTelemetryInterval) {
                    clearInterval(this.spokeTelemetryInterval);
                    this.spokeTelemetryInterval = null;
                }
            }

            // 2. Leader mode (M6): Check manual & cloud targets for outbound reverse dialing
            this.syncLeaderOutboundDials();
        } else {
            // Spoke mode (M5): Connect outbound to discovered Leader
            this.syncSpokeOutboundTunnel();
        }
    }

    /**
     * M5: Spoke Node connects outbound tunnel to Leader
     */
    private syncSpokeOutboundTunnel(): void {
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

        if (!targetHost) return;

        const targetUrl = `http://${targetHost}:${targetPort}`;

        if (this.spokeClientSocket && this.spokeCurrentLeaderUrl !== targetUrl) {
            log('TUNNEL', `Leader endpoint changed to ${targetUrl} — reconnecting tunnel`);
            this.spokeClientSocket.disconnect();
            this.spokeClientSocket = null;
        }

        if (!this.spokeClientSocket) {
            this.connectSpokeOutbound(targetUrl, targetHost, targetPort);
        }
    }

    private connectSpokeOutbound(targetUrl: string, host: string, port: number): void {
        const regStatus = this.registryManager.getStatus();
        const instanceId = regStatus.instance_id || 'spoke-node';
        const siteName = regStatus.site_name || instanceId;
        const localIp = regStatus.detected_ip || '127.0.0.1';

        const token = jwt.sign(
            { username: 'stigix-tunnel-spoke', role: 'admin', peer: instanceId, site: siteName },
            this.secretKey,
            { expiresIn: '24h' }
        );

        this.spokeCurrentLeaderUrl = targetUrl;
        const wsUrl = `${targetUrl}/fleet-tunnel`;

        const socket = ioClient(wsUrl, {
            auth: { token, instanceId, siteName, ip: localIp },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 3000,
            reconnectionDelayMax: 15000,
            timeout: 10000
        });

        socket.on('connect', () => {
            log('TUNNEL', `⚡ Outbound reverse tunnel ESTABLISHED to Leader (${host}:${port})`);
            this.pushLocalTelemetryToSocket(socket);
            if (this.spokeTelemetryInterval) clearInterval(this.spokeTelemetryInterval);
            this.spokeTelemetryInterval = setInterval(() => {
                if (socket.connected) this.pushLocalTelemetryToSocket(socket);
            }, 15000);
        });

        socket.on('connect_error', (err: any) => {
            log('TUNNEL', `Outbound reverse tunnel connection failed (${host}:${port}): ${err.message}`, 'warn');
        });

        socket.on('disconnect', (reason: string) => {
            log('TUNNEL', `Outbound reverse tunnel disconnected (${reason})`, 'warn');
            if (this.spokeTelemetryInterval) {
                clearInterval(this.spokeTelemetryInterval);
                this.spokeTelemetryInterval = null;
            }
        });

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
                            body: JSON.stringify({ error: 'local_proxy_error', message: err.message })
                        });
                    }
                });
        });

        this.spokeClientSocket = socket;
    }

    /**
     * M6: Leader initiates outbound reverse dial to Cloud / Manual Peers (e.g. Hetzner, AWS, Home LAN)
     */
    private syncLeaderOutboundDials(): void {
        if (!this.targetsManager) return;

        const targets = this.targetsManager.getMergedTargets();
        const localStatus = this.registryManager.getStatus();
        const localIp = (localStatus.detected_ip || '127.0.0.1').toLowerCase();
        const ownInstanceId = (localStatus.instance_id || '').toLowerCase();

        // Collect all known peer keys (inbound tunnels, local registry instances, or self)
        const knownPeerKeys = new Set<string>();
        if (ownInstanceId) knownPeerKeys.add(ownInstanceId);
        if (localIp) knownPeerKeys.add(localIp);

        // Inbound active tunnels (Spokes connected to Leader via M5)
        for (const [id, entry] of this.activeTunnels) {
            if (entry.socket.connected && entry.info.direction === 'inbound') {
                knownPeerKeys.add(id.toLowerCase());
                if (entry.info.siteName) knownPeerKeys.add(entry.info.siteName.toLowerCase());
                if (entry.info.ip) knownPeerKeys.add(entry.info.ip.toLowerCase());
            }
        }

        // Instances already registered in localRegistryServer via HTTP heartbeats
        if (this.localRegistryServer) {
            for (const inst of this.localRegistryServer.getInstances()) {
                if (inst.instance_id) knownPeerKeys.add(inst.instance_id.toLowerCase());
                if (inst.meta?.site) knownPeerKeys.add(inst.meta.site.toLowerCase());
                if (inst.ip_private) knownPeerKeys.add(inst.ip_private.toLowerCase());
            }
        }

        // Candidate targets: enabled, valid host, and NOT in knownPeerKeys
        const externalTargets = targets.filter(t => {
            if (t.enabled === false) return false;
            if (!t.host) return false;
            const h = t.host.trim().toLowerCase();
            const tid = (t.id || '').toLowerCase();
            const tname = (t.name || '').toLowerCase();

            if (h === '127.0.0.1' || h === 'localhost' || h === localIp) return false;

            // If already known as an active local spoke or self, do not dial
            if (knownPeerKeys.has(h) || (tid && knownPeerKeys.has(tid)) || (tname && knownPeerKeys.has(tname))) {
                return false;
            }
            return true;
        });

        // 1. Clean up dialed sockets for targets that are no longer candidates (e.g. removed or now connected inbound)
        for (const [targetKey, socket] of this.outboundDialedSockets) {
            const stillTarget = externalTargets.some(t => {
                const port = t.ports?.http || 8080;
                return `${t.host.trim()}:${port}` === targetKey;
            });
            if (!stillTarget) {
                log('TUNNEL', `[M6 DIAL] Closing dialed connection for target no longer needing dial: ${targetKey}`);
                socket.disconnect();
                this.outboundDialedSockets.delete(targetKey);
            }
        }

        // 2. Dial candidate external cloud/manual targets
        for (const target of externalTargets) {
            const host = target.host.trim();
            const port = target.ports?.http || 8080;
            const targetKey = `${host}:${port}`;

            if (!this.outboundDialedSockets.has(targetKey)) {
                this.dialOutboundPeer(target, host, port, targetKey);
            }
        }
    }

    /**
     * M6: Leader opens client WebSocket connection to a specific remote peer
     */
    private dialOutboundPeer(target: any, host: string, port: number, targetKey: string): void {
        const localStatus = this.registryManager.getStatus();
        const localId = localStatus.instance_id || 'leader-dc1';
        const localSite = localStatus.site_name || 'DC1-Leader';
        const targetId = target.id || target.name || host;
        const targetSiteName = target.name || host;

        const token = jwt.sign(
            { username: 'stigix-leader-dial', role: 'admin', peer: targetId, site: localSite },
            this.secretKey,
            { expiresIn: '24h' }
        );

        const wsUrl = `http://${host}:${port}/fleet-tunnel`;
        log('TUNNEL', `🌐 [M6 DIAL] Leader dialing outbound reverse tunnel to Cloud Peer: ${targetSiteName} (${wsUrl})...`);

        const socket = ioClient(wsUrl, {
            auth: {
                token,
                instanceId: localId,
                siteName: localSite,
                ip: localStatus.detected_ip || '127.0.0.1',
                isLeaderDial: true
            },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 5000,
            reconnectionDelayMax: 20000,
            timeout: 10000
        });

        let queryInterval: NodeJS.Timeout | null = null;

        socket.on('connect', () => {
            log('TUNNEL', `⚡ [M6 DIAL] Leader reverse dial CONNECTED to Cloud Peer: ${targetSiteName} (${host}:${port})`);

            const info: TunnelPeerInfo = {
                instanceId: targetId,
                siteName: targetSiteName,
                ip: host,
                connectedAt: Date.now(),
                lastPing: Date.now(),
                transport: 'websocket',
                direction: 'outbound_dial'
            };

            this.activeTunnels.set(targetId, { socket, info });
            this.siteToInstanceMap.set(targetSiteName.toLowerCase(), targetId);
            this.siteToInstanceMap.set(host.toLowerCase(), targetId);

            // Initial query for remote peer's telemetry
            socket.emit('peer:query_status', (remoteStatus: any) => {
                if (this.localRegistryServer && remoteStatus && remoteStatus.instance_id) {
                    this.localRegistryServer.upsertInstance(remoteStatus);
                    log('LOCAL-REGISTRY', `🏠 Ingested Cloud Peer status from ${targetSiteName} (${remoteStatus.instance_id})`);
                }
            });

            // Recurring query to keep dialed peer's telemetry fresh on Leader
            if (queryInterval) clearInterval(queryInterval);
            queryInterval = setInterval(() => {
                if (socket.connected) {
                    socket.timeout(5000).emit('peer:query_status', (err: any, remoteStatus: any) => {
                        if (!err && this.localRegistryServer && remoteStatus && remoteStatus.instance_id) {
                            this.localRegistryServer.upsertInstance(remoteStatus);
                        }
                    });
                }
            }, 15000);
        });

        socket.on('peer:telemetry', (remoteStatus: any) => {
            if (this.localRegistryServer && remoteStatus && remoteStatus.instance_id) {
                this.localRegistryServer.upsertInstance(remoteStatus);
            }
        });

        socket.on('disconnect', (reason: string) => {
            if (queryInterval) {
                clearInterval(queryInterval);
                queryInterval = null;
            }
            log('TUNNEL', `[M6 DIAL] Leader reverse dial disconnected from ${targetSiteName} (${reason})`, 'warn');
            this.activeTunnels.delete(targetId);
        });

        socket.on('connect_error', () => {
            // Silently keep retrying in background
        });

        this.outboundDialedSockets.set(targetKey, socket);
    }

    /**
     * Helper: Build local node telemetry payload for pushing across tunnel
     */
    private async buildLocalTelemetryPayload(): Promise<any> {
        const regStatus = this.registryManager.getStatus();
        let summary: any = undefined;
        if (this.telemetryProvider) {
            try {
                summary = await this.telemetryProvider();
            } catch (err) {
                log('TUNNEL', `Error collecting telemetry for tunnel: ${err}`, 'warn');
            }
        }

        let version = 'v2';
        try {
            if (fs.existsSync('/app/VERSION')) {
                version = fs.readFileSync('/app/VERSION', 'utf8').trim();
            }
        } catch {}

        return {
            instance_id: regStatus.instance_id,
            poc_id: regStatus.poc_id || 'local-leader',
            type: regStatus.mode === 'leader' ? 'leader' : 'spoke',
            ip_private: regStatus.detected_ip,
            status: 'online',
            is_leader: regStatus.mode === 'leader',
            meta: {
                site: regStatus.site_name || regStatus.instance_id,
                version
            },
            summary,
            provisioning_status: summary?.provisioning_status,
            last_seen: new Date().toISOString()
        };
    }

    /**
     * Helper: Push local telemetry to a specific socket
     */
    private async pushLocalTelemetryToSocket(socket: Socket | ClientSocket): Promise<void> {
        try {
            const payload = await this.buildLocalTelemetryPayload();
            socket.emit('peer:telemetry', payload);
        } catch {}
    }

    /**
     * Execute incoming request locally against 127.0.0.1:8080
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
     * Checks if a peer has an active reverse WebSocket tunnel (inbound or dialed)
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
     * Forward an HTTP request over the reverse tunnel to a peer
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
     * Get list of active connected tunnels
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
