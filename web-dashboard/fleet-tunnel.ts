import http from 'http';
import https from 'https';
import fs from 'fs';
import crypto, { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { log } from './utils/logger.js';
import type { RegistryManager } from './registry-manager.js';
import type { LocalRegistryServer } from './local-registry-server.js';
import type { TargetsManager } from './targets-manager.js';
import type { ProvisioningManager, GlobalBundleType } from './provisioning-manager.js';

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
 *
 * 4. Leader Cloudflare Rendezvous Push Listener (PRD Magic Join): Passive SSE listener for real-time
 *    cloud peer announcements from registry.stigix.io (<10ms instant outbound dial).
 */
export class FleetTunnelManager {
    private ioServer: SocketIOServer;
    private registryManager: RegistryManager;
    private targetsManager?: TargetsManager;
    private localRegistryServer?: LocalRegistryServer;
    private provisioningManager?: ProvisioningManager;
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

    // Spoke state when dialed by a Leader (M6) or connected via M5
    private activeLeaderTunnelSocket: Socket | ClientSocket | null = null;
    private activeLeaderInfo: { instanceId?: string; siteName?: string; ip?: string; direction?: string } | null = null;

    // Leader state: outbound dialed client sockets to Cloud/Manual peers (M6)
    private outboundDialedSockets: Map<string, ClientSocket> = new Map();

    // Leader state: Cloudflare SSE Rendezvous Listener
    private cloudflareReq: http.ClientRequest | null = null;
    private cloudflareRetryTimeout: NodeJS.Timeout | null = null;
    private isListeningCloudflare: boolean = false;

    private backgroundLoopInterval: NodeJS.Timeout | null = null;

    constructor(
        ioServer: SocketIOServer,
        registryManager: RegistryManager,
        secretKey: string,
        localPort: number = 8080,
        targetsManager?: TargetsManager,
        localRegistryServer?: LocalRegistryServer,
        provisioningManager?: ProvisioningManager
    ) {
        this.ioServer = ioServer;
        this.registryManager = registryManager;
        this.targetsManager = targetsManager;
        this.localRegistryServer = localRegistryServer;
        this.provisioningManager = provisioningManager;
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

    public setProvisioningManager(provisioningManager: ProvisioningManager): void {
        this.provisioningManager = provisioningManager;
    }

    public setTelemetryProvider(provider: () => Promise<any> | any): void {
        this.telemetryProvider = provider;
    }

    public hasActiveLeaderTunnel(): boolean {
        if (this.spokeClientSocket && this.spokeClientSocket.connected) return true;
        if (this.activeLeaderTunnelSocket && (this.activeLeaderTunnelSocket as any).connected !== false) return true;
        return false;
    }

    public getActiveLeaderInfo(): { instanceId?: string; siteName?: string; ip?: string; direction?: string } | null {
        if (!this.hasActiveLeaderTunnel()) return null;
        return this.activeLeaderInfo || { instanceId: 'Leader', siteName: 'Leader', direction: 'fleet_tunnel' };
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

            // If this node is acting as Spoke dialed by Leader (M6)
            let dialHeartbeatInterval: NodeJS.Timeout | null = null;
            if (isLeaderDial) {
                this.activeLeaderTunnelSocket = socket;
                this.activeLeaderInfo = { instanceId, siteName, ip: clientIp, direction: 'inbound_leader_dial' };
                this.pushLocalTelemetryToSocket(socket);
                dialHeartbeatInterval = setInterval(() => {
                    if (socket.connected) {
                        this.pushLocalTelemetryToSocket(socket);
                    }
                }, 15000);

                // Spoke listens for config updates and triggers initial sync
                socket.on('peer:bundle_updated', (type?: string) => {
                    this.syncProvisioningOverTunnel(socket, type);
                });
                this.syncProvisioningOverTunnel(socket);
            } else {
                // If this node is Leader receiving Spoke connection (M5), serve Leader provisioning/targets
                this.registerLeaderHandlers(socket);
            }

            socket.on('disconnect', (reason: string) => {
                if (dialHeartbeatInterval) {
                    clearInterval(dialHeartbeatInterval);
                    dialHeartbeatInterval = null;
                }
                if (this.activeLeaderTunnelSocket === socket) {
                    this.activeLeaderTunnelSocket = null;
                    this.activeLeaderInfo = null;
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

            // Handle forwarded streaming HTTP requests (SSE / chunked streams)
            socket.on('gateway:stream:start', (payload: ForwardRequestPayload, ack: (res: any) => void) => {
                this.handleLocalStreamRequest(socket, payload, ack);
            });

            socket.on('gateway:stream:abort', (data: { streamId: string }) => {
                if (data && data.streamId) {
                    this.abortLocalStream(data.streamId);
                }
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
        this.stopCloudflareRendezvousListener();
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

            // 2. Leader mode: Start passive Cloudflare SSE Rendezvous Listener (PRD Magic Join)
            this.startCloudflareRendezvousListener();

            // 3. Leader mode (M6): Check manual & cloud targets for outbound reverse dialing
            this.syncLeaderOutboundDials();
        } else {
            // Spoke mode: Stop Cloudflare listener if running
            this.stopCloudflareRendezvousListener();

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
            this.activeLeaderTunnelSocket = socket;
            this.activeLeaderInfo = { instanceId: 'Leader', siteName: host, ip: host, direction: 'outbound_spoke' };

            this.pushLocalTelemetryToSocket(socket);
            if (this.spokeTelemetryInterval) clearInterval(this.spokeTelemetryInterval);
            this.spokeTelemetryInterval = setInterval(() => {
                if (socket.connected) this.pushLocalTelemetryToSocket(socket);
            }, 15000);

            // Spoke listens for config updates and triggers initial sync
            socket.on('peer:bundle_updated', (type?: string) => {
                this.syncProvisioningOverTunnel(socket, type);
            });
            this.syncProvisioningOverTunnel(socket);
        });

        socket.on('connect_error', (err: any) => {
            log('TUNNEL', `Outbound reverse tunnel connection failed (${host}:${port}): ${err.message}`, 'warn');
        });

        socket.on('disconnect', (reason: string) => {
            log('TUNNEL', `Outbound reverse tunnel disconnected (${reason})`, 'warn');
            if (this.activeLeaderTunnelSocket === socket) {
                this.activeLeaderTunnelSocket = null;
                this.activeLeaderInfo = null;
            }
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

        // Handle forwarded streaming HTTP requests on Spoke (SSE / chunked streams)
        socket.on('gateway:stream:start', (payload: ForwardRequestPayload, ack: (res: any) => void) => {
            this.handleLocalStreamRequest(socket, payload, ack);
        });

        socket.on('gateway:stream:abort', (data: { streamId: string }) => {
            if (data && data.streamId) {
                this.abortLocalStream(data.streamId);
            }
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

        // Collect keys of peers that already connected INBOUND to Leader (M5 spokes)
        const inboundSpokeKeys = new Set<string>();
        if (ownInstanceId) inboundSpokeKeys.add(ownInstanceId);
        if (localIp) inboundSpokeKeys.add(localIp);

        for (const [id, entry] of this.activeTunnels) {
            if (entry.socket.connected && entry.info.direction === 'inbound') {
                inboundSpokeKeys.add(id.toLowerCase());
                if (entry.info.siteName) inboundSpokeKeys.add(entry.info.siteName.toLowerCase());
                if (entry.info.ip) inboundSpokeKeys.add(entry.info.ip.toLowerCase());
            }
        }

        // Candidate targets: enabled, valid host, not self, and not already connected inbound
        const externalTargets = targets.filter(t => {
            if (t.enabled === false) return false;
            if (!t.host) return false;
            const h = t.host.trim().toLowerCase();
            const tid = (t.id || '').toLowerCase();
            const tname = (t.name || '').toLowerCase();

            if (h === '127.0.0.1' || h === 'localhost' || h === localIp) return false;

            // If already known as an active inbound spoke or self, do not dial
            if (inboundSpokeKeys.has(h) || (tid && inboundSpokeKeys.has(tid)) || (tname && inboundSpokeKeys.has(tname))) {
                return false;
            }
            return true;
        });

        // 1. Clean up dialed sockets for targets that are no longer candidates (e.g. removed or now connected inbound)
        for (const [targetKey, socket] of this.outboundDialedSockets) {
            const stillTarget = externalTargets.some(t => {
                const port = t.ports?.http || 8080;
                return `${t.host.trim().toLowerCase()}:${port}` === targetKey.toLowerCase();
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
            const targetKey = `${host.toLowerCase()}:${port}`;

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

            // Register Leader services (Provisioning, Manifest, Targets, Ping) on this outbound socket
            this.registerLeaderHandlers(socket);

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
                    info.instanceId = remoteStatus.instance_id;
                    info.siteName = remoteStatus.meta?.site || remoteStatus.instance_id;
                    this.activeTunnels.set(remoteStatus.instance_id, { socket, info });
                    this.siteToInstanceMap.set(remoteStatus.instance_id.toLowerCase(), remoteStatus.instance_id);
                    if (remoteStatus.meta?.site) {
                        this.siteToInstanceMap.set(remoteStatus.meta.site.toLowerCase(), remoteStatus.instance_id);
                    }
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
                            info.instanceId = remoteStatus.instance_id;
                            info.siteName = remoteStatus.meta?.site || remoteStatus.instance_id;
                            this.activeTunnels.set(remoteStatus.instance_id, { socket, info });
                            this.siteToInstanceMap.set(remoteStatus.instance_id.toLowerCase(), remoteStatus.instance_id);
                        }
                    });
                }
            }, 15000);
        });

        socket.on('peer:telemetry', (remoteStatus: any) => {
            if (this.localRegistryServer && remoteStatus && remoteStatus.instance_id) {
                this.localRegistryServer.upsertInstance(remoteStatus);
                const entry = this.activeTunnels.get(targetId);
                if (entry) {
                    entry.info.instanceId = remoteStatus.instance_id;
                    entry.info.siteName = remoteStatus.meta?.site || remoteStatus.instance_id;
                    this.activeTunnels.set(remoteStatus.instance_id, entry);
                    this.siteToInstanceMap.set(remoteStatus.instance_id.toLowerCase(), remoteStatus.instance_id);
                }
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

    // ─────────────────────────────────────────────────────────────────────────────
    // Cloudflare SSE Stateless Rendezvous Relay Listener (PRD Magic Join)
    // ─────────────────────────────────────────────────────────────────────────────

    private getRealmHash(): string {
        const seed = process.env.PRISMA_SDWAN_TSGID ||
                     process.env.STIGIX_CLUSTER_KEY ||
                     process.env.STIGIX_POC_ID ||
                     'default-stigix-realm';
        return crypto.createHash('sha256').update(seed).digest('hex');
    }

    private startCloudflareRendezvousListener(): void {
        if (this.isListeningCloudflare) return;
        this.isListeningCloudflare = true;

        const registryBaseUrl = (process.env.STIGIX_REGISTRY_URL || 'https://registry.stigix.io').replace(/\/$/, '');
        const realmHash = this.getRealmHash();
        const streamUrl = `${registryBaseUrl}/realms/${realmHash}/stream`;

        log('RENDEZVOUS', `🛰️ Starting Cloudflare SSE push listener for realm: ${realmHash.slice(0, 8)}...`);

        const connect = () => {
            if (!this.isListeningCloudflare || !this.registryManager.isLeader()) return;

            try {
                const u = new URL(streamUrl);
                const reqModule = u.protocol === 'https:' ? https : http;

                const req = reqModule.get(streamUrl, {
                    headers: {
                        'Accept': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'User-Agent': 'Stigix-Leader-Rendezvous/2.0'
                    }
                }, (res) => {
                    if (res.statusCode !== 200) {
                        scheduleRetry(15000);
                        return;
                    }

                    log('RENDEZVOUS', `⚡ Cloudflare SSE Push channel CONNECTED for realm ${realmHash.slice(0, 8)}... (0 CPU, 0 polling)`);
                    let buffer = '';

                    res.on('data', (chunk: Buffer) => {
                        buffer += chunk.toString('utf8');
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (trimmed.startsWith('data:')) {
                                try {
                                    const jsonStr = trimmed.slice(5).trim();
                                    if (jsonStr) {
                                        const event = JSON.parse(jsonStr);
                                        this.handleRendezvousEvent(event);
                                    }
                                } catch {}
                            }
                        }
                    });

                    res.on('end', () => {
                        scheduleRetry(5000);
                    });
                });

                req.on('error', () => {
                    scheduleRetry(10000);
                });

                this.cloudflareReq = req;
            } catch {
                scheduleRetry(15000);
            }
        };

        const scheduleRetry = (delayMs: number) => {
            if (this.cloudflareReq) {
                try { this.cloudflareReq.destroy(); } catch {}
                this.cloudflareReq = null;
            }
            if (this.cloudflareRetryTimeout) clearTimeout(this.cloudflareRetryTimeout);
            if (this.isListeningCloudflare && this.registryManager.isLeader()) {
                this.cloudflareRetryTimeout = setTimeout(connect, delayMs);
            }
        };

        connect();
    }

    private stopCloudflareRendezvousListener(): void {
        this.isListeningCloudflare = false;
        if (this.cloudflareRetryTimeout) {
            clearTimeout(this.cloudflareRetryTimeout);
            this.cloudflareRetryTimeout = null;
        }
        if (this.cloudflareReq) {
            try { this.cloudflareReq.destroy(); } catch {}
            this.cloudflareReq = null;
        }
    }

    private handleRendezvousEvent(event: any): void {
        if (!event || event.event !== 'peer_registered') return;

        const peerIp = event.ip;
        const peerPort = event.port || 8080;
        const peerInstanceId = event.instance_id;
        const peerSiteName = event.site_name || peerInstanceId;

        const localStatus = this.registryManager.getStatus();
        const localIp = localStatus.detected_ip;
        const localId = localStatus.instance_id;

        if (peerIp === '127.0.0.1' || peerIp === localIp || peerInstanceId === localId) {
            return; // Ignore self announcements
        }

        log('RENDEZVOUS', `✨ Instant Cloudflare Push: new Cloud Peer announced: ${peerSiteName} (${peerIp}:${peerPort})!`);

        // Auto-create target in targetsManager if not present
        if (this.targetsManager && typeof this.targetsManager.createTarget === 'function') {
            try {
                const existingTargets = this.targetsManager.loadTargets();
                const alreadyExists = existingTargets.some((t: any) => t.host === peerIp || t.label === peerSiteName);
                if (!alreadyExists) {
                    this.targetsManager.createTarget({
                        label: peerSiteName,
                        host: peerIp,
                        port: peerPort,
                        protocol: 'http',
                        capabilities: event.capabilities || { voice: true, convergence: true, custom_app: true, xfr: true, security: true, connectivity: true },
                        tags: ['magic-join', 'cloudflare-rendezvous'],
                        comments: `Auto-enrolled via Cloudflare Rendezvous on ${new Date().toISOString()}`
                    });
                    log('RENDEZVOUS', `🎯 Target auto-provisioned for ${peerSiteName} (${peerIp}:${peerPort})`);
                }
            } catch (tErr: any) {
                log('RENDEZVOUS', `Warning auto-provisioning target: ${tErr.message}`, 'warn');
            }
        }

        // Trigger immediate outbound reverse dial
        const targetKey = `${peerIp.toLowerCase()}:${peerPort}`;
        if (!this.outboundDialedSockets.has(targetKey) && !this.activeTunnels.has(peerInstanceId)) {
            const targetObj = { id: peerInstanceId, name: peerSiteName, host: peerIp, ports: { http: peerPort } };
            this.dialOutboundPeer(targetObj, peerIp, peerPort, targetKey);
        }
    }

    /**
     * Leader services: Serve provisioning manifest, bundle downloads, and targets across WebSocket
     */
    private registerLeaderHandlers(socket: Socket | ClientSocket): void {
        socket.on('provisioning:get_manifest', (ack?: (m: any) => void) => {
            if (typeof ack === 'function') {
                ack(this.provisioningManager?.getManifest() || null);
            }
        });

        socket.on('provisioning:pull_bundle', (type: string, ack?: (payload: any) => void) => {
            if (typeof ack === 'function') {
                if (this.provisioningManager) {
                    const bundle = this.provisioningManager.getPublishedBundle(type as GlobalBundleType);
                    ack(bundle);
                } else {
                    ack(null);
                }
            }
        });

        socket.on('targets:get_all', (ack?: (targets: any[]) => void) => {
            if (typeof ack === 'function') {
                ack(this.targetsManager?.getMergedTargets() || []);
            }
        });

        socket.on('tunnel:ping_leader', (ack?: (res: any) => void) => {
            if (typeof ack === 'function') {
                const regStatus = this.registryManager.getStatus();
                ack({
                    pong: true,
                    leader_id: regStatus.instance_id || 'leader',
                    site_name: regStatus.site_name || regStatus.instance_id || 'Leader',
                    timestamp: Date.now()
                });
            }
        });
    }

    /**
     * Spoke services: Sync provisioning bundles from Leader across WebSocket tunnel
     */
    public async syncProvisioningOverTunnel(socket: Socket | ClientSocket, specificType?: string): Promise<{ success: boolean; count: number; error?: string }> {
        if (!this.provisioningManager) return { success: false, count: 0, error: 'no_provisioning_manager' };
        try {
            log('PROVISIONING', `⚡ [TUNNEL SYNC] Pulling provisioning manifest from Leader over Fleet Tunnel...`);
            const manifest = await new Promise<any>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Manifest request timeout (5s)')), 5000);
                socket.emit('provisioning:get_manifest', (res: any) => {
                    clearTimeout(timer);
                    resolve(res);
                });
            });

            if (!manifest || !Array.isArray(manifest.bundles)) {
                return { success: false, count: 0, error: 'empty_manifest' };
            }

            const localState = this.provisioningManager.getState();
            let appliedCount = 0;

            for (const bundle of manifest.bundles) {
                if (specificType && bundle.type !== specificType) continue;
                const currentApplied = localState.appliedRevisions?.[bundle.type];
                const needsSync = !currentApplied || currentApplied.revision < bundle.revision || currentApplied.checksum !== bundle.checksum || currentApplied.status !== 'applied';

                if (needsSync) {
                    log('PROVISIONING', `⚡ [TUNNEL SYNC] Pulling bundle '${bundle.type}' (rev ${bundle.revision}) from Leader...`);
                    const bundlePayload = await new Promise<any>((resolve) => {
                        const timer = setTimeout(() => resolve(null), 5000);
                        socket.emit('provisioning:pull_bundle', bundle.type, (data: any) => {
                            clearTimeout(timer);
                            resolve(data);
                        });
                    });

                    if (bundlePayload !== undefined && bundlePayload !== null) {
                        this.provisioningManager.applyGlobalBundle(bundle.type, bundle.revision, bundle.checksum, bundlePayload);
                        appliedCount++;
                        log('PROVISIONING', `✅ [TUNNEL SYNC] Successfully applied bundle '${bundle.type}' (rev ${bundle.revision}) over Fleet Tunnel`);
                    }
                }
            }

            return { success: true, count: appliedCount };
        } catch (err: any) {
            log('PROVISIONING', `Failed to sync provisioning over tunnel: ${err.message}`, 'warn');
            return { success: false, count: 0, error: err.message };
        }
    }

    /**
     * Trigger manual pull sync over active Leader tunnel
     */
    public async triggerManualSync(): Promise<{ success: boolean; count: number; error?: string }> {
        const socket = this.activeLeaderTunnelSocket || this.spokeClientSocket;
        if (!socket || !this.hasActiveLeaderTunnel()) {
            return { success: false, count: 0, error: 'No active Fleet WebSocket Tunnel connected to Leader' };
        }
        return this.syncProvisioningOverTunnel(socket);
    }

    /**
     * Test round-trip latency and reachability to Leader over WebSocket tunnel
     */
    public async testLeaderConnectivity(): Promise<{ success: boolean; rtt?: number; leaderId?: string; site_name?: string; error?: string }> {
        const socket = this.activeLeaderTunnelSocket || this.spokeClientSocket;
        if (!socket || !this.hasActiveLeaderTunnel()) {
            return { success: false, error: 'No active Fleet WebSocket Tunnel connected to Leader' };
        }
        const start = Date.now();
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                resolve({ success: false, error: 'Timeout waiting for Leader ping response over tunnel (5s)' });
            }, 5000);

            socket.emit('tunnel:ping_leader', (res: any) => {
                clearTimeout(timer);
                const rtt = Date.now() - start;
                if (res && res.pong) {
                    resolve({
                        success: true,
                        rtt,
                        leaderId: res.leader_id || res.instance_id,
                        site_name: res.site_name || res.site
                    });
                } else {
                    resolve({ success: false, error: 'Invalid response from Leader over tunnel' });
                }
            });
        });
    }

    /**
     * Leader broadcasts bundle update notification to all connected spoke tunnels
     */
    public broadcastProvisioningUpdate(type?: GlobalBundleType): void {
        log('PROVISIONING', `📢 [TUNNEL PUSH] Broadcasting bundle update notification (${type || 'all'}) to all connected tunnel peers...`);
        for (const [id, entry] of this.activeTunnels) {
            try {
                entry.socket.emit('peer:bundle_updated', type);
            } catch (err: any) {
                log('TUNNEL', `Failed to push bundle update to ${id}: ${err.message}`, 'warn');
            }
        }
        for (const [targetId, socket] of this.outboundDialedSockets) {
            try {
                socket.emit('peer:bundle_updated', type);
            } catch (err: any) {
                log('TUNNEL', `Failed to push bundle update to dialed target ${targetId}: ${err.message}`, 'warn');
            }
        }
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
            capabilities: this.registryManager.getNodeCapabilities(),
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

    private activeLocalStreams = new Map<string, http.ClientRequest>();

    /**
     * Execute incoming streaming request locally (SSE / chunked) and stream chunks back over WebSocket
     */
    private handleLocalStreamRequest(
        socket: Socket | ClientSocket,
        payload: ForwardRequestPayload,
        ack?: (res: any) => void
    ): void {
        const streamId = payload.reqId || randomUUID();
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
        cleanHeaders['x-gateway-source'] = 'reverse-tunnel-stream';

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
            timeout: 0 // No client timeout on streams
        };

        const localReq = http.request(reqOptions, (localRes) => {
            const responseHeaders: Record<string, string | string[]> = {};
            for (const [k, v] of Object.entries(localRes.headers)) {
                if (!hopByHop.has(k.toLowerCase()) && v !== undefined) {
                    responseHeaders[k] = v;
                }
            }

            socket.emit('gateway:stream:headers', {
                streamId,
                status: localRes.statusCode || 200,
                headers: responseHeaders
            });

            if (typeof ack === 'function') ack({ success: true, streamId });

            localRes.on('data', (chunk) => {
                const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
                socket.emit('gateway:stream:chunk', { streamId, chunk: text });
            });

            localRes.on('end', () => {
                this.activeLocalStreams.delete(streamId);
                socket.emit('gateway:stream:end', { streamId });
            });

            localRes.on('error', (err) => {
                this.activeLocalStreams.delete(streamId);
                socket.emit('gateway:stream:error', { streamId, error: err.message });
            });
        });

        localReq.on('error', (err) => {
            this.activeLocalStreams.delete(streamId);
            socket.emit('gateway:stream:error', { streamId, error: err.message });
            if (typeof ack === 'function') ack({ success: false, error: err.message });
        });

        this.activeLocalStreams.set(streamId, localReq);

        if (bodyBuf && bodyBuf.length > 0) {
            localReq.write(bodyBuf);
        }
        localReq.end();
    }

    /**
     * Abort an active local stream if client disconnected
     */
    private abortLocalStream(streamId: string): void {
        const localReq = this.activeLocalStreams.get(streamId);
        if (localReq) {
            try {
                localReq.destroy();
            } catch {}
            this.activeLocalStreams.delete(streamId);
        }
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
     * Forward a streaming HTTP request (SSE / chunked) over the reverse tunnel
     */
    public forwardStream(
        peerIdentifier: string,
        reqPayload: ForwardRequestPayload,
        clientReq: any,
        clientRes: any,
        timeoutMs: number = 10000
    ): Promise<boolean> {
        let entry = this.activeTunnels.get(peerIdentifier);
        if (!entry) {
            const mappedId = this.siteToInstanceMap.get(peerIdentifier.toLowerCase());
            if (mappedId) entry = this.activeTunnels.get(mappedId);
        }

        if (!entry || !entry.socket || !entry.socket.connected) {
            return Promise.resolve(false);
        }

        const socket = entry.socket;
        const streamId = reqPayload.reqId || randomUUID();
        const payload: ForwardRequestPayload = {
            reqId: streamId,
            method: reqPayload.method,
            path: reqPayload.path,
            headers: reqPayload.headers,
            body: reqPayload.body
        };

        return new Promise<boolean>((resolve) => {
            let headersSent = false;
            let streamEnded = false;

            const cleanup = () => {
                socket.off('gateway:stream:headers', onHeaders);
                socket.off('gateway:stream:chunk', onChunk);
                socket.off('gateway:stream:end', onEnd);
                socket.off('gateway:stream:error', onError);
            };

            const onHeaders = (data: { streamId: string; status: number; headers: Record<string, any> }) => {
                if (data.streamId !== streamId) return;
                if (!headersSent && !clientRes.headersSent) {
                    headersSent = true;
                    clientRes.status(data.status);
                    for (const [k, v] of Object.entries(data.headers)) {
                        clientRes.setHeader(k, v);
                    }
                    clientRes.setHeader('x-gateway-peer', peerIdentifier);
                    clientRes.setHeader('x-gateway-transport', 'websocket-tunnel-stream');
                    if (typeof clientRes.flushHeaders === 'function') {
                        clientRes.flushHeaders();
                    }
                    resolve(true);
                }
            };

            const onChunk = (data: { streamId: string; chunk: string }) => {
                if (data.streamId !== streamId) return;
                if (!headersSent && !clientRes.headersSent) {
                    headersSent = true;
                    clientRes.writeHead(200, {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                        'x-gateway-peer': peerIdentifier,
                        'x-gateway-transport': 'websocket-tunnel-stream'
                    });
                    resolve(true);
                }
                clientRes.write(data.chunk);
            };

            const onEnd = (data: { streamId: string }) => {
                if (data.streamId !== streamId) return;
                if (streamEnded) return;
                streamEnded = true;
                cleanup();
                if (!clientRes.writableEnded) {
                    clientRes.end();
                }
            };

            const onError = (data: { streamId: string; error: string }) => {
                if (data.streamId !== streamId) return;
                if (streamEnded) return;
                streamEnded = true;
                cleanup();
                if (!headersSent && !clientRes.headersSent) {
                    resolve(false);
                } else if (!clientRes.writableEnded) {
                    clientRes.end();
                }
            };

            socket.on('gateway:stream:headers', onHeaders);
            socket.on('gateway:stream:chunk', onChunk);
            socket.on('gateway:stream:end', onEnd);
            socket.on('gateway:stream:error', onError);

            // Handle client abort / disconnect
            clientReq.on('close', () => {
                if (!streamEnded) {
                    streamEnded = true;
                    cleanup();
                    try {
                        socket.emit('gateway:stream:abort', { streamId });
                    } catch {}
                }
            });

            // Start stream on remote peer with timeout
            const startTimer = setTimeout(() => {
                if (!headersSent) {
                    cleanup();
                    resolve(false);
                }
            }, timeoutMs);

            socket.emit('gateway:stream:start', payload, (ack: any) => {
                clearTimeout(startTimer);
                if (ack && ack.success === false) {
                    cleanup();
                    resolve(false);
                }
            });
        });
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
