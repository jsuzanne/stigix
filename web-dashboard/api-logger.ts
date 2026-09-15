import { EventEmitter } from 'events';
import crypto from 'crypto';

export interface ApiLogEntry {
    id: string;
    timestamp: string;
    source: 'node' | 'python' | 'probe' | 'vyos' | 'registry';
    scriptName?: string;
    direction: 'outbound' | 'inbound';
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
    url: string;
    pathname?: string;
    statusCode: number;
    durationMs: number;
    requestHeaders?: Record<string, string>;
    requestBody?: any;
    responseHeaders?: Record<string, string>;
    responseBody?: any;
    error?: string;
    curlSnippet?: string;
}

const SENSITIVE_KEYS = [
    'authorization',
    'x-api-key',
    'client_secret',
    'secret',
    'password',
    'token',
    'access_token',
    'refresh_token',
    'api_key',
    'cookie',
    'set-cookie'
];

/**
 * Redacts sensitive credentials from headers and bodies to comply with security rules.
 */
export function sanitizeData(data: any): any {
    if (data === null || data === undefined) return data;

    if (typeof data === 'string') {
        // Redact bearer tokens
        let sanitized = data.replace(/(Bearer\s+)[A-Za-z0-9\-_.]+/gi, '$1***MASKED***');
        // Redact basic auth
        sanitized = sanitized.replace(/(Basic\s+)[A-Za-z0-9+/=]+/gi, '$1***MASKED***');
        return sanitized;
    }

    if (Array.isArray(data)) {
        return data.map(item => sanitizeData(item));
    }

    if (typeof data === 'object') {
        const result: Record<string, any> = {};
        for (const [key, value] of Object.entries(data)) {
            const lowerKey = key.toLowerCase();
            if (SENSITIVE_KEYS.some(k => lowerKey.includes(k))) {
                result[key] = typeof value === 'string' && value.length > 8 
                    ? `${value.substring(0, 4)}***MASKED***` 
                    : '***MASKED***';
            } else {
                result[key] = sanitizeData(value);
            }
        }
        return result;
    }

    return data;
}

/**
 * Generates an executable cURL snippet from request data.
 */
export function generateCurlSnippet(
    method: string,
    url: string,
    headers?: Record<string, string>,
    body?: any
): string {
    let curl = `curl -X ${method.toUpperCase()} "${url}"`;

    if (headers) {
        for (const [key, val] of Object.entries(headers)) {
            // Skip browser or node pseudo-headers
            if (!key.startsWith(':') && key.toLowerCase() !== 'content-length') {
                curl += ` \\\n  -H "${key}: ${val}"`;
            }
        }
    }

    if (body !== undefined && body !== null && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
        const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
        curl += ` \\\n  -d '${bodyStr.replace(/'/g, "'\\''")}'`;
    }

    return curl;
}

class ApiLogBufferService extends EventEmitter {
    private buffer: ApiLogEntry[] = [];
    private maxCapacity: number = 500;

    constructor(capacity: number = 500) {
        super();
        this.maxCapacity = capacity;
    }

    /**
     * Records a new API transaction log, sanitizes sensitive data, and emits it to live listeners.
     */
    public record(entry: Partial<ApiLogEntry> & { method: string; url: string; statusCode: number; durationMs: number }): ApiLogEntry {
        let pathname = '';
        try {
            const parsed = new URL(entry.url.startsWith('http') ? entry.url : `http://localhost${entry.url}`);
            pathname = parsed.pathname;
        } catch {
            pathname = entry.url;
        }

        const sanitizedReqHeaders = entry.requestHeaders ? sanitizeData(entry.requestHeaders) : undefined;
        const sanitizedReqBody = entry.requestBody !== undefined ? sanitizeData(entry.requestBody) : undefined;
        const sanitizedResHeaders = entry.responseHeaders ? sanitizeData(entry.responseHeaders) : undefined;
        const sanitizedResBody = entry.responseBody !== undefined ? sanitizeData(entry.responseBody) : undefined;

        const curlSnippet = entry.curlSnippet || generateCurlSnippet(
            entry.method,
            entry.url,
            entry.requestHeaders,
            entry.requestBody
        );

        const fullEntry: ApiLogEntry = {
            id: entry.id || crypto.randomUUID(),
            timestamp: entry.timestamp || new Date().toISOString(),
            source: entry.source || 'node',
            scriptName: entry.scriptName,
            direction: entry.direction || 'outbound',
            method: (entry.method.toUpperCase() as any),
            url: entry.url,
            pathname,
            statusCode: entry.statusCode,
            durationMs: entry.durationMs,
            requestHeaders: sanitizedReqHeaders,
            requestBody: sanitizedReqBody,
            responseHeaders: sanitizedResHeaders,
            responseBody: sanitizedResBody,
            error: entry.error,
            curlSnippet
        };

        this.buffer.push(fullEntry);
        if (this.buffer.length > this.maxCapacity) {
            this.buffer.shift(); // FIFO eviction
        }

        this.emit('log', fullEntry);
        return fullEntry;
    }

    /**
     * Returns a snapshot of recent logs (latest first).
     */
    public getRecentLogs(limit: number = 200, source?: string, statusCategory?: string): ApiLogEntry[] {
        let logs = [...this.buffer];

        if (source && source !== 'all') {
            logs = logs.filter(l => l.source === source || (l.scriptName && l.scriptName.includes(source)));
        }

        if (statusCategory) {
            if (statusCategory === '2xx') logs = logs.filter(l => l.statusCode >= 200 && l.statusCode < 300);
            else if (statusCategory === '4xx') logs = logs.filter(l => l.statusCode >= 400 && l.statusCode < 500);
            else if (statusCategory === '5xx') logs = logs.filter(l => l.statusCode >= 500);
            else if (statusCategory === 'error') logs = logs.filter(l => l.statusCode >= 400 || !!l.error);
        }

        return logs.slice(-limit).reverse();
    }

    /**
     * Clears all buffered logs.
     */
    public clear(): void {
        this.buffer = [];
        this.emit('clear');
    }

    /**
     * Number of items currently stored.
     */
    public size(): number {
        return this.buffer.length;
    }
}

export const apiLogBuffer = new ApiLogBufferService(500);
