/**
 * Stigix Custom TCP Inter-Site Applications — Protocol Builders & Encoders
 */

import {
    CustomTcpMessage,
    ClientHelloMessage,
    ServerHelloMessage,
    RejectMessage,
    RequestMessage,
    ResponseMessage,
    ErrorMessage,
    PingMessage,
    PongMessage,
    ClientCloseMessage,
    ServerCloseMessage,
    ServerBehaviorMode
} from './types.js';

export const PROTOCOL_VERSION = 1;

/**
 * Encodes a Custom TCP message object into a 4-byte UInt32BE length-prefixed Buffer.
 */
export function encodeFrame(message: CustomTcpMessage): Buffer {
    const jsonStr = JSON.stringify(message);
    const payloadBuf = Buffer.from(jsonStr, 'utf8');
    const headerBuf = Buffer.alloc(4);
    headerBuf.writeUInt32BE(payloadBuf.length, 0);
    return Buffer.concat([headerBuf, payloadBuf]);
}

export function buildClientHello(params: {
    appId: string;
    clientSessionId: string;
    origin: {
        instanceId: string;
        siteName: string;
        hostname: string;
    };
    authToken?: string;
}): ClientHelloMessage {
    return {
        type: 'CLIENT_HELLO',
        protocolVersion: PROTOCOL_VERSION,
        appId: params.appId,
        clientSessionId: params.clientSessionId,
        origin: params.origin,
        authToken: params.authToken,
        sentTs: Date.now()
    };
}

export function buildServerHello(params: {
    appId: string;
    clientSessionId: string;
    serverSessionId: string;
    responder: {
        instanceId: string;
        siteName: string;
        hostname: string;
    };
    acceptedBehavior: ServerBehaviorMode;
}): ServerHelloMessage {
    return {
        type: 'SERVER_HELLO',
        protocolVersion: PROTOCOL_VERSION,
        appId: params.appId,
        clientSessionId: params.clientSessionId,
        serverSessionId: params.serverSessionId,
        responder: params.responder,
        acceptedBehavior: params.acceptedBehavior,
        sentTs: Date.now()
    };
}

export function buildReject(params: {
    appId: string;
    clientSessionId: string;
    code: 'AUTH_FAILED' | 'APP_NOT_FOUND' | 'ALLOWLIST_DENIED' | 'MAX_CONNECTIONS_REACHED' | 'INVALID_PROTOCOL' | 'INTERNAL_ERROR';
    reason: string;
}): RejectMessage {
    return {
        type: 'REJECT',
        protocolVersion: PROTOCOL_VERSION,
        appId: params.appId,
        clientSessionId: params.clientSessionId,
        code: params.code,
        reason: params.reason,
        sentTs: Date.now()
    };
}

export function buildRequest(params: {
    requestId: string;
    clientSessionId: string;
    seq: number;
    payloadSize: number;
    data?: string;
}): RequestMessage {
    return {
        type: 'REQUEST',
        requestId: params.requestId,
        clientSessionId: params.clientSessionId,
        seq: params.seq,
        payloadSize: params.payloadSize,
        data: params.data,
        sentTs: Date.now()
    };
}

export function buildResponse(params: {
    requestId: string;
    clientSessionId: string;
    seq: number;
    payloadSize: number;
    data?: string;
    simulated?: {
        applied: boolean;
        delayMs?: number;
    };
}): ResponseMessage {
    return {
        type: 'RESPONSE',
        requestId: params.requestId,
        clientSessionId: params.clientSessionId,
        seq: params.seq,
        payloadSize: params.payloadSize,
        data: params.data,
        simulated: params.simulated,
        sentTs: Date.now()
    };
}

export function buildError(params: {
    requestId?: string;
    clientSessionId: string;
    code: string;
    message: string;
    simulated?: boolean;
}): ErrorMessage {
    return {
        type: 'ERROR',
        requestId: params.requestId,
        clientSessionId: params.clientSessionId,
        code: params.code,
        message: params.message,
        simulated: !!params.simulated,
        sentTs: Date.now()
    };
}

export function buildPing(params: {
    clientSessionId: string;
    seq: number;
}): PingMessage {
    return {
        type: 'PING',
        clientSessionId: params.clientSessionId,
        seq: params.seq,
        sentTs: Date.now()
    };
}

export function buildPong(params: {
    clientSessionId: string;
    seq: number;
}): PongMessage {
    return {
        type: 'PONG',
        clientSessionId: params.clientSessionId,
        seq: params.seq,
        sentTs: Date.now()
    };
}

export function buildClientClose(params: {
    clientSessionId: string;
    reason?: string;
}): ClientCloseMessage {
    return {
        type: 'CLIENT_CLOSE',
        clientSessionId: params.clientSessionId,
        reason: params.reason,
        sentTs: Date.now()
    };
}

export function buildServerClose(params: {
    serverSessionId: string;
    reason?: string;
    simulated?: boolean;
}): ServerCloseMessage {
    return {
        type: 'SERVER_CLOSE',
        serverSessionId: params.serverSessionId,
        reason: params.reason,
        simulated: !!params.simulated,
        sentTs: Date.now()
    };
}
