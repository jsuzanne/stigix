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

export type AutoAuthType = 'none' | 'sase' | 'vyos' | 'stigix';

export interface ApiPreset {
    id: string;
    name: string;
    category: 'Prisma SD-WAN' | 'Palo Alto SCM' | 'VyOS SD-WAN' | 'Stigix Platform' | 'External Probes';
    description: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    url: string;
    autoAuth: AutoAuthType;
    headers?: Record<string, string>;
    body?: any;
}

export interface PlaygroundExecutionResult {
    success: boolean;
    statusCode: number;
    durationMs: number;
    request: {
        method: string;
        url: string;
        headers: Record<string, string>;
        body?: any;
        curl?: string;
        autoAuthDetails?: string;
    };
    response: {
        headers: Record<string, string>;
        body?: any;
        error?: string;
    };
}
