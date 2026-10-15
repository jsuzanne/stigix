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
    | 'error_response'
    | 'eicar_response';

export type ClientWorkloadMode =
    | 'heartbeat'
    | 'transactional'
    | 'persistent_request_reply'
    | 'bulk_burst'
    | 'continuous_stream'
    | 'stochastic';

export type SessionState =
    | 'connecting'
    | 'handshaking'
    | 'connected'
    | 'idle'
    | 'delayed'
    | 'timed_out'
    | 'reconnecting'
    | 'paused_offline'
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
    idleTimeoutMs: number;         // default: 0 (disabled / persistent TCP session)
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
    eicarPeriodMs?: number;        // eicar_response mode: interval between EICAR probes (default 60000 ms). Normal ACK sent between probes.
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

export type ApplicationWireProtocol = 'stigix_tcp' | 'http_1_1';

export interface CustomTcpApplicationConfig {
    id: string;
    name: string;
    description?: string;
    enabled: boolean;
    protocol?: ApplicationWireProtocol; // 'stigix_tcp' (default length-prefixed) or 'http_1_1' (REST/HTTP)
    listener: CustomTcpListenerConfig;
    serverBehavior: ServerBehaviorConfig;
    clientDefaults: ClientDefaultsConfig;
    peers: PeerConfig[];
    serverNodes?: string[]; // Array of node names / IDs assigned to host server listener (e.g. ['DC1-Ubuntu', 'DC2-Ubuntu'] or ['all'])
    targetMode?: 'auto_mesh' | 'specific'; // Auto-Mesh: dynamic discovery of active servers; Specific: static peer list
    manualOverride?: {
        listenerStopped?: boolean;
        clientStopped?: boolean;
    };
    startup: {
        startListener: boolean;
        startClientWorkload: boolean;
    };
}

export interface CustomTcpApplicationsFile {
    version: number;
    instance: InstanceIdentityConfig;
    applications: CustomTcpApplicationConfig[];
    multicastApplications?: CustomMulticastApplicationConfig[];
}

// ─── Multicast Overlay Application & Telemetry Models ─────────────────────────

export type MulticastAddressingMode = 'asm' | 'ssm';
export type MulticastRateMode = 'cbr' | 'burst';
export type MulticastExpectationMode = 'traffic' | 'none';
export type MulticastHealthVerdict = 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'NO_TRAFFIC';
export type MulticastPayloadFormat = 'raw-stgx' | 'rtp-mpegts' | 'rtp-g711';

export interface MulticastReceiverPeerConfig {
    node: string; // Site name / Instance ID (e.g. 'BR1', 'BR2', 'BR5')
    expect: MulticastExpectationMode; // 'traffic' (EXPECT_TRAFFIC) or 'none' (EXPECT_NONE / leak test)
    interfaceIp?: string; // 'auto' or explicit LAN IPv4
    enabled: boolean;
}

export interface MulticastRateConfig {
    mode: MulticastRateMode;
    kbps: number; // 64 to 50000 (50 Mbps)
    burstPackets?: number; // For 'burst' mode: N packets per burst
    burstIntervalMs?: number; // For 'burst' mode: burst period in ms
}

export interface MulticastThresholdsConfig {
    maxLossPct: number; // default 0.1
    degradedLossPct: number; // default 2.0
    maxJitterMs?: number; // default 30 (RFC 3550 jitter threshold for DEGRADED)
    maxDuplicates?: number; // default 0 (allowed duplicates during PIM SPT switchover before DEGRADED)
    maxGapMs: number; // default 3000
}

export interface CustomMulticastApplicationConfig {
    id: string;
    name: string;
    description?: string;
    presetId?: string;
    payloadFormat?: MulticastPayloadFormat; // 'raw-stgx' (default) | 'rtp-mpegts' | 'rtp-g711'
    enabled: boolean;
    group: string; // ASM: 239.x.x.x, SSM: 232.x.x.x
    port: number; // default 5000 (or 5004 for RTP)
    mode: MulticastAddressingMode;
    ssmSource?: string; // Required when mode === 'ssm'
    senderNode: string; // Site name / node ID acting as multicast source (e.g. 'DC1' or 'BR1' for BSS)
    senderInterfaceIp?: string; // 'auto' or explicit LAN IPv4
    receivers: MulticastReceiverPeerConfig[];
    rate: MulticastRateConfig;
    payloadBytes: number; // 64..1400, default 1316 (7 MPEG-TS packets)
    ttl: number; // 1..255, default 64
    dscp: string; // 'BE' | 'CS5' | 'EF' | 'AF41' | 'CS4' | 'CS2'
    durationSec: number; // 0 = continuous until stopped
    thresholds?: MulticastThresholdsConfig;
}

export interface MulticastApplicationPreset {
    id: string;
    name: string;
    shortLabel: string;
    badge: string;
    description: string;
    appIdHint: string;
    group: string;
    port: number;
    mode: MulticastAddressingMode;
    rate: MulticastRateConfig;
    payloadBytes: number;
    payloadFormat: MulticastPayloadFormat;
    ttl: number;
    dscp: string;
    thresholds: MulticastThresholdsConfig;
}

export interface MulticastSenderStats {
    appId: string;
    node: string;
    active: boolean;
    group: string;
    port: number;
    interfaceName: string;
    interfaceIp: string;
    runId: number;
    streamId: number;
    currentSeq: number;
    packetsSent: number;
    bytesSent: number;
    txBitrateKbps: number;
    txPps: number;
    targetKbps: number;
    payloadBytes: number;
    ttl: number;
    dscp: string;
    startedAt?: number;
    uptimeSec: number;
    lastError?: string;
}

export interface MulticastThroughputSample {
    ts: number;
    kbps: number;
    pps: number;
    lossPct: number;
    maxGapMs: number;
}

export interface MulticastReceiverStats {
    appId: string;
    node: string;
    joined: boolean;
    expect: MulticastExpectationMode;
    group: string;
    port: number;
    mode: MulticastAddressingMode;
    ssmSource?: string;
    interfaceName: string;
    interfaceIp: string;
    igmpVersion: string;
    runId: number;
    firstSeq: number | null;
    highestSeq: number | null;
    packetsReceived: number;
    packetsExpected: number;
    packetsLost: number;
    lossPct: number;
    duplicatePackets: number;
    reorderedPackets: number;
    foreignPackets: number;
    bytesReceived: number;
    rxBitrateKbps: number;
    rxPps: number;
    jitterMs: number;
    maxGapMs: number;
    currentSilenceMs: number;
    joinLatencyMs: number | null;
    joinedAt?: number;
    firstPacketAt?: number;
    lastPacketAt?: number;
    verdict: MulticastHealthVerdict;
    verdictReason: string;
    lastError?: string;
    history: MulticastThroughputSample[];
}

export interface MulticastNodePreflightResult {
    node: string;
    role: 'sender' | 'receiver';
    reachable: boolean;
    status: 'pass' | 'warn' | 'fail';
    interfaceName: string;
    interfaceIp: string;
    multicastCapable: boolean;
    igmpVersion: string;
    rpFilter: number | null;
    portAvailable: boolean;
    checks: {
        name: string;
        status: 'pass' | 'warn' | 'fail';
        detail: string;
    }[];
    hints: string[];
}

export interface MulticastClusterStatus {
    appId: string;
    appName: string;
    group: string;
    port: number;
    mode: MulticastAddressingMode;
    ssmSource?: string;
    active: boolean;
    startedAt?: number;
    sender: MulticastSenderStats;
    receivers: MulticastReceiverStats[];
    overallVerdict: MulticastHealthVerdict;
    diagnostics: string[];
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
    uptimeSec?: number;
    rxBps?: number;
    txBps?: number;
    tps?: number;
    tcpConnectMs?: number;
}

export interface RttStats {
    last: number;
    min: number;
    avg: number;
    p50: number;
    p95: number;
    max: number;
    samples: number;
    jitterMs?: number;
    recentSamples?: number[];
    serverDelayMs?: number;
    networkRttMs?: number;
    avgServerDelayMs?: number;
    avgNetworkRttMs?: number;
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
    uptimeSec?: number;
    txBps?: number;
    rxBps?: number;
    tps?: number;
    tcpConnectMs?: number;
    eicarReceivedCount: number; // EICAR string received by client = SASE did NOT block it
    serverStatusReason?: string;
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
    serverRequestsHandled?: number;
    clientRequestsSent?: number;
    serverResponsesSent?: number;
    clientResponsesReceived?: number;
    totalRequests: number;
    totalResponses: number;
    totalTimeouts: number;
    totalErrors: number;
    totalReconnects: number;
    totalSimulatedDrops: number;
    avgRttMs: number;
    p50RttMs: number;
    p95RttMs: number;
    jitterMs?: number;
    liveTxBps?: number;
    liveRxBps?: number;
    liveTps?: number;
    liveServerTxBps?: number;
    liveServerRxBps?: number;
    liveServerTps?: number;
    liveClientTxBps?: number;
    liveClientRxBps?: number;
    liveClientTps?: number;
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
