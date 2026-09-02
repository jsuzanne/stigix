/**
 * Stigix Custom TCP Inter-Site Applications — Configuration & Port Validator
 */

import net from 'net';
import { CustomTcpApplicationConfig } from './types.js';

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
