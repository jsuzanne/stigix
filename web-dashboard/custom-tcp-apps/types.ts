/**
 * Stigix Custom TCP Inter-Site Applications — Type Definitions
 * Complete protocol, configuration, and runtime models.
 */

// ─── Behavioral Modes ──────────────────────────────────────────────────────────

export type ServerBehaviorMode =
    | 'echo'
    | 'acknowledge'
    | 'fixed_delay'
    | 'random_delay'
    | 'looping_delay'
    | 'drop_response'
    | 'close_connection'
    | 'error_response';

export type ClientWorkloadMode =
    | 'heartbeat'
    | 'transactional'
    | 'persistent_request_reply'
    | 'bulk_burst'
    | 'continuous_stream';

export type SessionState =
    | 'connecting'
    | 'handshaking'
    | 'connected'
    | 'idle'
    | 'delayed'
    | 'timed_out'
    | 'reconnecting'
    | 'rejected'
    | 'closing'
    | 'closed'
    | 'error';

export type ListenerState =
    | 'listening'
    | 'stopped'
    | 'bind_error'
    | 'port_conflict';

export type AppHealthState =
    | 'healthy'
    | 'degraded'
    | 'unreachable'
    | 'listener_error'
    | 'stopped';

// ─── Protocol Message Definitions ─────────────────────────────────────────────

export type ProtocolMessageType =
    | 'CLIENT_HELLO'
    | 'SERVER_HELLO'
    | 'REJECT'
    | 'REQUEST'
    | 'RESPONSE'
    | 'ERROR'
    | 'PING'
    | 'PONG'
    | 'CLIENT_CLOSE'
    | 'SERVER_CLOSE';

export interface BaseMessage {
    type: ProtocolMessageType;
    sentTs: number;
}

export interface ClientHelloMessage extends BaseMessage {
    type: 'CLIENT_HELLO';
    protocolVersion: number;
    appId: string;
    clientSessionId: string;
    origin: {
        instanceId: string;
        siteName: string;
        hostname: string;
    };
    authToken?: string;
}

export interface ServerHelloMessage extends BaseMessage {
    type: 'SERVER_HELLO';
    protocolVersion: number;
    appId: string;
    clientSessionId: string;
    serverSessionId: string;
    responder: {
        instanceId: string;
        siteName: string;
        hostname: string;
    };
    acceptedBehavior: ServerBehaviorMode;
}

export interface RejectMessage extends BaseMessage {
    type: 'REJECT';
    protocolVersion: number;
    appId: string;
    clientSessionId: string;
    code: 'AUTH_FAILED' | 'APP_NOT_FOUND' | 'ALLOWLIST_DENIED' | 'MAX_CONNECTIONS_REACHED' | 'INVALID_PROTOCOL' | 'INTERNAL_ERROR';
    reason: string;
}

export interface RequestMessage extends BaseMessage {
    type: 'REQUEST';
    requestId: string;
    clientSessionId: string;
    seq: number;
    payloadSize: number;
    data?: string;
}

export interface ResponseMessage extends BaseMessage {
    type: 'RESPONSE';
    requestId: string;
    clientSessionId: string;
    seq: number;
    simulated?: {
        applied: boolean;
        delayMs?: number;
    };
    payloadSize: number;
    data?: string;
}

export interface ErrorMessage extends BaseMessage {
    type: 'ERROR';
    requestId?: string;
    clientSessionId: string;
    code: string;
    message: string;
    simulated: boolean;
}

export interface PingMessage extends BaseMessage {
    type: 'PING';
    clientSessionId: string;
    seq: number;
}

export interface PongMessage extends BaseMessage {
    type: 'PONG';
    clientSessionId: string;
    seq: number;
}

export interface ClientCloseMessage extends BaseMessage {
    type: 'CLIENT_CLOSE';
    clientSessionId: string;
    reason?: string;
}

export interface ServerCloseMessage extends BaseMessage {
    type: 'SERVER_CLOSE';
    serverSessionId: string;
    reason?: string;
    simulated?: boolean;
}

export type CustomTcpMessage =
    | ClientHelloMessage
    | ServerHelloMessage
    | RejectMessage
    | RequestMessage
    | ResponseMessage
    | ErrorMessage
    | PingMessage
    | PongMessage
    | ClientCloseMessage
    | ServerCloseMessage;

// ─── Configuration Models ─────────────────────────────────────────────────────

export interface InstanceIdentityConfig {
    instanceId: string;
    siteName: string;
    hostname: string;
    displayName?: string;
}

export interface CustomTcpListenerConfig {
    bindAddress: string;           // "0.0.0.0"
    port: number;                  // 1024 - 65535
    maxConnections: number;        // default: 100
    idleTimeoutMs: number;         // default: 60000 (60s)
    maxPayloadBytes: number;       // default: 1048576 (1 MiB)
    tcpKeepalive: boolean;         // default: true
    allowCidrs: string[];          // e.g. ["10.0.0.0/8", "192.168.0.0/16"]
    auth: {
        enabled: boolean;
        token?: string;            // Redacted in GET APIs
    };
}

export interface ServerBehaviorConfig {
    mode: ServerBehaviorMode;
    fixedDelayMs: number;
    randomDelayMinMs: number;
    randomDelayMaxMs: number;
    loopingNormalSec: number;
    loopingSlowSec: number;
    loopingSlowDelayMs: number;
    dropProbability: number;       // 0 to 100%
    closeAfterRequests?: number;
    closeAfterDurationSec?: number;
    errorProbability: number;      // 0 to 100%
    errorCode?: string;
}

export interface ClientDefaultsConfig {
    mode: ClientWorkloadMode;
    connectionsPerPeer: number;    // default: 2
    intervalMs: number;            // default: 1000 (1s)
    payloadBytes: number;          // default: 1024 (1 KiB)
    requestTimeoutMs: number;      // default: 5000 (5s)
    connectTimeoutMs: number;      // default: 5000 (5s)
    autoReconnect: boolean;        // default: true
    reconnectInitialMs: number;    // default: 1000 (1s)
    reconnectMaxMs: number;        // default: 30000 (30s)
    tcpKeepalive: boolean;         // default: true
    sourceInterface?: string;      // "auto" or specific interface
}

export interface PeerConfig {
    id: string;
    name: string;
    siteName: string;
    host: string;
    port: number;
    enabled: boolean;
    connectionsOverride?: number;
    intervalOverrideMs?: number;
    token?: string;                // Redacted in GET APIs
    tags: string[];
}

export interface CustomTcpApplicationConfig {
    id: string;
    name: string;
    description?: string;
    enabled: boolean;
    listener: CustomTcpListenerConfig;
    serverBehavior: ServerBehaviorConfig;
    clientDefaults: ClientDefaultsConfig;
    peers: PeerConfig[];
    startup: {
        startListener: boolean;
        startClientWorkload: boolean;
    };
}

export interface CustomTcpApplicationsFile {
    version: number;
    instance: InstanceIdentityConfig;
    applications: CustomTcpApplicationConfig[];
}

// ─── Runtime & Session Models ─────────────────────────────────────────────────

export interface IncomingSessionState {
    sessionId: string;
    appId: string;
    declaredSiteName: string;
    declaredInstanceId: string;
    declaredHostname: string;
    remoteIp: string;
    remotePort: number;
    isConfiguredPeer: boolean;
    matchedPeerName?: string;
    state: SessionState;
    connectedAt: number;
    lastActivityAt: number;
    bytesReceived: number;
    bytesSent: number;
    requestsHandled: number;
    simulatedDrops: number;
    simulatedErrors: number;
}

export interface RttStats {
    last: number;
    min: number;
    avg: number;
    p50: number;
    p95: number;
    max: number;
    samples: number;
}

export interface OutgoingSessionState {
    sessionId: string;
    appId: string;
    peerId: string;
    peerName: string;
    peerHost: string;
    peerPort: number;
    state: SessionState;
    connectedAt?: number;
    lastSuccessAt?: number;
    rttMs: RttStats;
    requestsSent: number;
    responsesReceived: number;
    timeouts: number;
    errors: number;
    reconnects: number;
    bytesSent: number;
    bytesReceived: number;
    lastError?: string;
}

export interface AppRuntimeMetrics {
    appId: string;
    appName: string;
    port: number;
    listenerState: ListenerState;
    listenerError?: string;
    clientWorkloadRunning: boolean;
    activeIncomingSessions: number;
    activeOutgoingSessions: number;
    totalTxBytes: number;
    totalRxBytes: number;
    serverTxBytes?: number;
    serverRxBytes?: number;
    clientTxBytes?: number;
    clientRxBytes?: number;
    totalRequests: number;
    totalResponses: number;
    totalTimeouts: number;
    totalErrors: number;
    totalReconnects: number;
    totalSimulatedDrops: number;
    avgRttMs: number;
    p95RttMs: number;
    health: AppHealthState;
}

export interface RunHistoryRecord {
    id: string;
    appId: string;
    appName: string;
    startedAt: string;
    endedAt?: string;
    durationSec?: number;
    targetedPeers: string[];
    desiredConnections: number;
    totalTxBytes: number;
    totalRxBytes: number;
    totalRequests: number;
    totalResponses: number;
    totalTimeouts: number;
    totalErrors: number;
    totalReconnects: number;
    rttStats: RttStats;
    status: 'completed' | 'stopped' | 'failed';
    summary: string;
}
