/**
 * Shared Target types for the Stigix Targets registry.
 * A Target is a site running sdwan-voice-echo / stigix that exposes
 * multiple services on well-known ports.
 */

export type TargetCapability = {
    voice: boolean; // UDP echo on ports.voice (default 6100)
    convergence: boolean; // UDP echo on ports.convergence (default 6200)
    xfr: boolean; // iperf3/xfr on ports.xfr (default 5201)
    security: boolean; // HTTP app-sim / EICAR on ports.http (default 8082)
    connectivity: boolean; // Generic HTTP/PING/DNS connectivity probe
};

export type TargetDefinition = {
    id: string;  // UUID v4
    name: string;  // Human-readable label, e.g. "DC1"
    host: string;  // IP address or FQDN, e.g. "192.168.203.100"
    enabled: boolean;
    capabilities: TargetCapability;
    ports?: {
        voice?: number; // default 6100
        convergence?: number; // default 6200
        iperf?: number; // default 5201
        http?: number; // default 8082
        xfr?: number; // default 5201
    };
    source?: 'managed' | 'synthesized';
    meta?: {
        registry?: boolean;
        leader_provided?: boolean;
        location?: any;
        ip_public?: string;
        last_seen?: string;
        [key: string]: any;
    };
};

export const TARGET_PORT_DEFAULTS = {
    voice: 6100,
    convergence: 6200,
    iperf: 5201,
    http: 8082,
    xfr: 5201,
} as const;
