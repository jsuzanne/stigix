/**
 * Stigix Custom TCP Inter-Site Applications — Configuration & Port Validator
 */

import net from 'net';
import { CustomTcpApplicationConfig, CustomMulticastApplicationConfig } from './types.js';

export const RESERVED_STIGIX_PORTS = new Set([
    80, 443, 8080, 8082, 9000, 5060, 5061, 3000, 3001
]);

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

export function validateApplicationConfig(
    app: Partial<CustomTcpApplicationConfig>,
    existingApps: CustomTcpApplicationConfig[] = []
): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Name & ID
    if (!app.name || app.name.trim().length < 2) {
        errors.push('Application name must be at least 2 characters.');
    }
    if (!app.id || !/^[a-z0-9-_]+$/i.test(app.id)) {
        errors.push('Application ID must only contain alphanumeric characters, hyphens, and underscores.');
    }

    // 2. Port & Listener
    const port = app.listener?.port;
    if (typeof port !== 'number' || isNaN(port) || port < 1024 || port > 65535) {
        errors.push('Port must be a non-privileged number between 1024 and 65535.');
    } else if (RESERVED_STIGIX_PORTS.has(port)) {
        errors.push(`Port ${port} is reserved for core Stigix services (Web UI, Target, XFR, Voice).`);
    }

    // Collision check against other enabled applications
    if (app.id && port) {
        const conflicting = existingApps.find(
            other => other.id !== app.id && other.enabled && other.listener?.port === port
        );
        if (conflicting) {
            errors.push(`Port ${port} is already used by active application "${conflicting.name}".`);
        }
    }

    if (app.listener?.allowCidrs && app.listener.allowCidrs.length === 0) {
        warnings.push('No CIDR allowlist configured: listener is open to all incoming connections.');
    }

    // 3. Server Behavior
    if (app.serverBehavior) {
        const { dropProbability, errorProbability, fixedDelayMs } = app.serverBehavior;
        if (typeof dropProbability === 'number' && (dropProbability < 0 || dropProbability > 100)) {
            errors.push('Drop probability must be between 0 and 100%.');
        }
        if (typeof errorProbability === 'number' && (errorProbability < 0 || errorProbability > 100)) {
            errors.push('Error probability must be between 0 and 100%.');
        }
        if (typeof fixedDelayMs === 'number' && fixedDelayMs < 0) {
            errors.push('Fixed delay cannot be negative.');
        }
    }

    // 4. Client Defaults
    if (app.clientDefaults) {
        const { connectionsPerPeer, intervalMs, requestTimeoutMs } = app.clientDefaults;
        if (typeof connectionsPerPeer === 'number' && (connectionsPerPeer < 1 || connectionsPerPeer > 50)) {
            errors.push('Connections per peer must be between 1 and 50.');
        }
        if (typeof intervalMs === 'number' && intervalMs < 50) {
            errors.push('Request interval must be at least 50ms.');
        }
        if (typeof requestTimeoutMs === 'number' && requestTimeoutMs < 500) {
            errors.push('Request timeout must be at least 500ms.');
        }
    }

    // 5. Peers
    if (app.peers) {
        for (const [idx, p] of app.peers.entries()) {
            if (!p.name || p.name.trim().length === 0) {
                errors.push(`Peer #${idx + 1} must have a name.`);
            }
            if (!p.host || p.host.trim().length === 0) {
                errors.push(`Peer "${p.name || idx + 1}" must specify a host IP or FQDN.`);
            }
            if (typeof p.port !== 'number' || p.port < 1 || p.port > 65535) {
                errors.push(`Peer "${p.name || idx + 1}" has an invalid port (${p.port}).`);
            }
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Validates a Custom Multicast Overlay Application configuration.
 */
export function validateMulticastApplicationConfig(
    app: Partial<CustomMulticastApplicationConfig> & Record<string, any>,
    existingApps: CustomMulticastApplicationConfig[] = []
): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Name & ID
    if (!app.name || app.name.trim().length < 2) {
        errors.push('Multicast application name must be at least 2 characters.');
    }
    if (!app.id || !/^[a-z0-9-_]+$/i.test(app.id)) {
        errors.push('Application ID must only contain alphanumeric characters, hyphens, and underscores.');
    }

    const mc = app.multicast || app;
    const mode = String(mc.mode || 'ASM').toUpperCase();

    // 2. Multicast Group IP (ASM 239.0.0.0/8 or SSM 232.0.0.0/8, reject 224.0.0.0/24 link-local)
    const group = String(mc.group || '').trim();
    const ipv4Parts = group.split('.').map(n => Number(n));
    const isValidIpv4 = group.length > 0 && ipv4Parts.length === 4 && ipv4Parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255);
    if (!isValidIpv4) {
        errors.push('Multicast group must be a valid IPv4 address.');
    } else {
        const firstOctet = ipv4Parts[0];
        if (firstOctet === 224 && ipv4Parts[1] === 0 && ipv4Parts[2] === 0) {
            errors.push('Group 224.0.0.0/24 is reserved for link-local control traffic and is not routed across SD-WAN overlays.');
        } else if (mode === 'SSM') {
            if (firstOctet !== 232) {
                errors.push('Source-Specific Multicast (SSM) requires a group in the 232.0.0.0/8 range.');
            }
        } else {
            if (firstOctet !== 239 && firstOctet !== 232) {
                errors.push('Multicast group must be in 239.0.0.0/8 (Administratively Scoped ASM) or 232.0.0.0/8 (SSM).');
            }
        }
    }

    // 3. SSM Source IP
    if (mode === 'SSM') {
        const src = String(mc.ssmSource || '').trim();
        const srcParts = src.split('.').map(n => Number(n));
        const isValidSrc = src.length > 0 && srcParts.length === 4 && srcParts.every(n => Number.isInteger(n) && n >= 0 && n <= 255);
        if (!isValidSrc) {
            errors.push('SSM mode requires a valid IPv4 Source IP address (ssmSource).');
        }
    }

    // 4. UDP Port
    const port = Number(mc.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        errors.push('UDP Port must be between 1024 and 65535.');
    } else if (RESERVED_STIGIX_PORTS.has(port)) {
        errors.push(`Port ${port} is reserved for core Stigix services.`);
    }

    // 5. Sender & Receivers
    const senderNodeId = app.sender?.nodeId || app.senderNode;
    if (!senderNodeId || !String(senderNodeId).trim()) {
        errors.push('A Sender node must be selected.');
    }
    if (!Array.isArray(app.receivers) || app.receivers.length === 0) {
        warnings.push('No receiver nodes selected yet.');
    }

    // 6. Rate & Payload & TTL
    const kbps = Number(mc.bitrateKbps ?? app.rate?.kbps ?? 1000);
    if (isNaN(kbps) || kbps < 16 || kbps > 50000) {
        errors.push('Target bitrate must be between 16 kbps and 50,000 kbps (50 Mbps cap).');
    }
    const payloadBytes = Number(mc.packetSizeBytes ?? app.payloadBytes ?? 1200);
    if (!Number.isInteger(payloadBytes) || payloadBytes < 64 || payloadBytes > 1400) {
        errors.push('Payload size must be between 64 and 1400 bytes to prevent IP fragmentation over SD-WAN tunnels.');
    }
    const ttl = Number(mc.ttl ?? app.ttl ?? 8);
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 255) {
        errors.push('TTL must be between 1 and 255.');
    } else if (ttl > 16) {
        warnings.push(`TTL is set to ${ttl} (> 16). Ensure multicast boundary ACLs are in place to prevent leakage outside the SD-WAN fabric.`);
    }

    if (existingApps.length >= 10 && !existingApps.some(e => e.id === app.id)) {
        errors.push('Maximum of 10 Multicast applications per node reached.');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Non-destructive check to verify if a TCP port is currently free on the host.
 */
export function checkHostPortAvailable(port: number, bindAddress: string = '0.0.0.0'): Promise<boolean> {
    return new Promise(resolve => {
        const testServer = net.createServer();
        testServer.unref();

        testServer.once('error', (err: any) => {
            if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
                resolve(false);
            } else {
                resolve(false);
            }
        });

        testServer.once('listening', () => {
            testServer.close(() => resolve(true));
        });

        testServer.listen(port, bindAddress);
    });
}
