/**
 * underlay-topology-manager.ts
 *
 * Resolves Prisma SD-WAN WAN interfaces to their VyOS underlay next-hop
 * using strict IPv4/CIDR same-subnet matching only.
 *
 * Safety rules:
 *  - No name-based inference (no MPLS, INET, WAN, site-name matching)
 *  - No string prefix comparison for IPs
 *  - Uses ipaddr.js for all IP/CIDR operations
 *  - apiKey and credentials never leave this module
 *  - All errors are isolated; topology endpoint remains unaffected
 */

import fs from 'fs';
import path from 'path';
import ipaddr from 'ipaddr.js';
import { log } from './utils/logger.js';

// ─── Public Types ─────────────────────────────────────────────────────────────

export type UnderlayResolutionStatus =
    | 'matched'
    | 'no_match'
    | 'ambiguous'
    | 'wan_ip_unavailable'
    | 'vyos_unavailable';

export type PrismaWanEndpoint = {
    elementId: string;
    elementName?: string;
    siteId?: string;
    siteName?: string;
    interfaceId?: string;
    interfaceName?: string;
    ipCidr?: string | null;
    ip?: string | null;
    network?: string | null;
    linkType?: string | null;
    ipType?: string | null; // 'static_with_cidr' | 'dhcp_ip_only' | 'unknown'
};

export type VyosInterfaceEndpoint = {
    routerId: string;
    routerName: string;
    location?: string | null;
    interfaceName: string;
    description?: string | null;
    ipCidr: string;
    ip: string;
    network: string;
    routerStatus?: string | null;
};

export type UnderlayResolution = {
    id: string;
    status: UnderlayResolutionStatus;
    prismaWan: PrismaWanEndpoint;
    vyos?: VyosInterfaceEndpoint;
    candidates?: VyosInterfaceEndpoint[];
    matchMethod?: 'same_subnet';
    matchedNetwork?: string;
    diagnostic?: string;
};

export type UnderlayRouterSummary = {
    id: string;
    name: string;
    host: string;
    location?: string | null;
    status?: string | null;
    interfaces: {
        name: string;
        description?: string | null;
        address: string[];
        status: string;
    }[];
};

export type UnderlayPayload = {
    available: boolean;
    vyosConfigAvailable: boolean;
    summary: {
        wanInterfacesSeen: number;
        matched: number;
        noMatch: number;
        ambiguous: number;
        wanIpUnavailable: number;
    };
    resolutions: UnderlayResolution[];
    routers?: UnderlayRouterSummary[];
};

// ─── Internal Types ───────────────────────────────────────────────────────────

interface VyosInterfaceInventoryEntry extends VyosInterfaceEndpoint {
    parsedNetwork: ipaddr.IPv4 | null;
    parsedPrefix: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a CIDR string like "192.168.190.254/24" into a validated IPv4 entry.
 * Returns null for DHCP strings, IPv6, malformed values, or empty strings.
 */
function parseStaticIPv4Cidr(raw: string): { ip: string; cidr: string; network: string; parsedAddr: ipaddr.IPv4; parsedPrefix: number } | null {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.toLowerCase() === 'dhcp') return null;

    try {
        if (!trimmed.includes('/')) return null;
        const [parsedAddr, prefix] = ipaddr.parseCIDR(trimmed);
        if (parsedAddr.kind() !== 'ipv4') return null; // skip IPv6

        const ipOnly = trimmed.split('/')[0];
        // Compute network address by masking
        const addrBytes = (parsedAddr as ipaddr.IPv4).toByteArray();
        const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
        const netInt = ((addrBytes[0] << 24) | (addrBytes[1] << 16) | (addrBytes[2] << 8) | addrBytes[3]) >>> 0;
        const networkInt = (netInt & mask) >>> 0;
        const networkAddr = [(networkInt >>> 24) & 0xFF, (networkInt >>> 16) & 0xFF, (networkInt >>> 8) & 0xFF, networkInt & 0xFF].join('.');

        return {
            ip: ipOnly,
            cidr: trimmed,
            network: `${networkAddr}/${prefix}`,
            parsedAddr: parsedAddr as ipaddr.IPv4,
            parsedPrefix: prefix,
        };
    } catch {
        return null;
    }
}

/**
 * Check whether a host IPv4 address belongs to a given IPv4 network (CIDR).
 * Uses ipaddr.js matchCIDR exclusively — no string operations.
 */
function ipBelongsToNetwork(hostIp: string, networkCidr: string): boolean {
    try {
        const host = ipaddr.parse(hostIp);
        if (host.kind() !== 'ipv4') return false;
        const [netParsed, prefix] = ipaddr.parseCIDR(networkCidr);
        if (netParsed.kind() !== 'ipv4') return false;
        return host.match([netParsed as ipaddr.IPv4, prefix]);
    } catch {
        return false;
    }
}

// ─── Main Class ───────────────────────────────────────────────────────────────

export class UnderlayTopologyManager {
    private vyosConfigFile: string;

    constructor(configDir: string) {
        this.vyosConfigFile = path.join(configDir, 'vyos-config.json');
    }

    /**
     * Build the safe inventory of eligible VyOS IPv4 interfaces.
     * Excludes: disabled routers, DHCP addresses, IPv6, malformed, empty.
     * Never exposes apiKey or host credentials.
     */
    private buildVyosInventory(): VyosInterfaceInventoryEntry[] | null {
        try {
            if (!fs.existsSync(this.vyosConfigFile)) {
                log('UNDERLAY', 'VyOS config file not found — underlay resolution unavailable', 'warn');
                return null;
            }

            const raw = JSON.parse(fs.readFileSync(this.vyosConfigFile, 'utf8'));
            const routers: any[] = raw.routers || [];
            const inventory: VyosInterfaceInventoryEntry[] = [];

            let totalRouters = 0;
            let enabledRouters = 0;
            let totalInterfaces = 0;
            let eligibleInterfaces = 0;

            for (const router of routers) {
                totalRouters++;
                if (!router.enabled) continue; // skip disabled routers
                enabledRouters++;

                const routerId: string = router.id || router.name || '';
                const routerName: string = router.name || routerId;
                const location: string | null = router.location || null;
                const routerStatus: string | null = router.status || null;
                const interfaces: any[] = router.interfaces || [];

                for (const iface of interfaces) {
                    totalInterfaces++;
                    const ifaceName: string = iface.name || '';
                    const description: string | null = iface.description || null;
                    const addresses: string[] = Array.isArray(iface.address) ? iface.address : [];

                    for (const addrRaw of addresses) {
                        const parsed = parseStaticIPv4Cidr(addrRaw);
                        if (!parsed) continue; // skip DHCP, IPv6, malformed

                        eligibleInterfaces++;
                        inventory.push({
                            routerId,
                            routerName,
                            location,
                            interfaceName: ifaceName,
                            description,
                            ipCidr: parsed.cidr,
                            ip: parsed.ip,
                            network: parsed.network,
                            routerStatus,
                            parsedNetwork: ipaddr.parse(parsed.network.split('/')[0]) as ipaddr.IPv4,
                            parsedPrefix: parsed.parsedPrefix,
                        });
                    }
                }
            }

            log('UNDERLAY', `VyOS inventory: ${enabledRouters}/${totalRouters} routers enabled, ${eligibleInterfaces}/${totalInterfaces} interfaces eligible`);
            return inventory;
        } catch (e: any) {
            log('UNDERLAY', `Failed to build VyOS inventory: ${e.message}`, 'error');
            return null;
        }
    }

    /**
     * Resolve a single Prisma WAN endpoint against the VyOS inventory.
     *
     * Matching rules (v1):
     *  - If wan_ip_cidr or wan_ip_only is available: check if the Prisma IP
     *    belongs to any VyOS interface network (using the VyOS CIDR as reference)
     *  - Unique match → 'matched'
     *  - Multiple matches → 'ambiguous' (no edge drawn)
     *  - Zero matches → 'no_match'
     */
    private resolveOne(
        wan: any,
        inventory: VyosInterfaceInventoryEntry[],
        resolutionId: string
    ): UnderlayResolution {
        const prismaWan: PrismaWanEndpoint = {
            elementId: wan.element_id || wan.elementId || '',
            elementName: wan.element_name || wan.elementName,
            siteId: wan.site_id || wan.siteId,
            siteName: wan.site_name || wan.siteName,
            interfaceId: wan.wan_if_id || wan.interfaceId,
            interfaceName: wan.name || wan.interfaceName,
            ipCidr: wan.wan_ip_cidr || null,
            ip: wan.wan_ip_only || null,
            network: wan.wan_network_cidr || null,
            linkType: wan.wan_network || null,
            ipType: wan.wan_ip_type || null,
        };

        // Determine the host IP to match
        const hostIp: string | null = wan.wan_ip_only || null;

        if (!hostIp) {
            return {
                id: resolutionId,
                status: 'wan_ip_unavailable',
                prismaWan,
                diagnostic: 'No usable IPv4 address available from Prisma SD-WAN for this WAN interface.',
            };
        }

        // Find all VyOS interface candidates where the Prisma IP belongs to the VyOS network
        const candidates: VyosInterfaceInventoryEntry[] = inventory.filter(entry =>
            ipBelongsToNetwork(hostIp, entry.network)
        );

        if (candidates.length === 0) {
            return {
                id: resolutionId,
                status: 'no_match',
                prismaWan,
                diagnostic: `No enabled VyOS interface belongs to the same subnet as ${hostIp}.`,
            };
        }

        if (candidates.length > 1) {
            // Ambiguous: sanitize candidates (no apiKey, no host credentials)
            const sanitizedCandidates: VyosInterfaceEndpoint[] = candidates.map(c => ({
                routerId: c.routerId,
                routerName: c.routerName,
                location: c.location,
                interfaceName: c.interfaceName,
                description: c.description,
                ipCidr: c.ipCidr,
                ip: c.ip,
                network: c.network,
                routerStatus: c.routerStatus,
            }));
            return {
                id: resolutionId,
                status: 'ambiguous',
                prismaWan,
                candidates: sanitizedCandidates,
                diagnostic: `More than one enabled VyOS interface matches ${hostIp}. No underlay link is displayed.`,
            };
        }

        // Unique match
        const match = candidates[0];
        const vyosEndpoint: VyosInterfaceEndpoint = {
            routerId: match.routerId,
            routerName: match.routerName,
            location: match.location,
            interfaceName: match.interfaceName,
            description: match.description,
            ipCidr: match.ipCidr,
            ip: match.ip,
            network: match.network,
            routerStatus: match.routerStatus,
        };

        return {
            id: resolutionId,
            status: 'matched',
            prismaWan,
            vyos: vyosEndpoint,
            matchMethod: 'same_subnet',
            matchedNetwork: match.network,
            diagnostic: `Resolved by unique same-subnet IPv4 match on ${match.network}.`,
        };
    }

    /**
     * Main entry point: resolve all WAN interfaces from the topology payload.
     * Returns a safe, degraded UnderlayPayload on any error.
     */
    public async resolveAll(topologyData: any): Promise<UnderlayPayload> {
        const degraded = (reason: string): UnderlayPayload => ({
            available: false,
            vyosConfigAvailable: false,
            summary: { wanInterfacesSeen: 0, matched: 0, noMatch: 0, ambiguous: 0, wanIpUnavailable: 0 },
            resolutions: [],
        });

        try {
            // Build VyOS inventory
            const inventory = this.buildVyosInventory();
            if (!inventory) {
                return {
                    available: true,
                    vyosConfigAvailable: false,
                    summary: { wanInterfacesSeen: 0, matched: 0, noMatch: 0, ambiguous: 0, wanIpUnavailable: 0 },
                    resolutions: [],
                };
            }

            // Collect all WAN interfaces from all sites/devices
            const allWanInterfaces: any[] = [];
            const sites: any[] = topologyData?.sites || [];
            for (const site of sites) {
                for (const device of (site.devices || [])) {
                    for (const wan of (device.wan_interfaces || [])) {
                        allWanInterfaces.push({
                            ...wan,
                            element_id: wan.element_id || device.device_id,
                            element_name: wan.element_name || device.device_name,
                            site_id: wan.site_id || site.site_id,
                            site_name: wan.site_name || site.site_name,
                        });
                    }
                }
            }

            log('UNDERLAY', `Resolving ${allWanInterfaces.length} WAN interfaces against ${inventory.length} VyOS endpoints`);

            const resolutions: UnderlayResolution[] = [];
            let matched = 0, noMatch = 0, ambiguous = 0, wanIpUnavailable = 0;

            for (let i = 0; i < allWanInterfaces.length; i++) {
                const wan = allWanInterfaces[i];
                const id = `${wan.site_id || 'unknown'}-${wan.element_id || 'unknown'}-${wan.wan_if_id || i}`;
                const resolution = this.resolveOne(wan, inventory, id);
                resolutions.push(resolution);

                switch (resolution.status) {
                    case 'matched': matched++; break;
                    case 'no_match': noMatch++; break;
                    case 'ambiguous': ambiguous++; break;
                    case 'wan_ip_unavailable': wanIpUnavailable++; break;
                }
            }

            // Extract safe router list for underlay topology rendering
            let safeRouters: UnderlayRouterSummary[] = [];
            try {
                const rawCfg = JSON.parse(fs.readFileSync(this.vyosConfigFile, 'utf8'));
                safeRouters = (rawCfg.routers || []).filter((r: any) => r.enabled !== false).map((r: any) => ({
                    id: r.id || r.name,
                    name: r.name || r.id,
                    host: r.host,
                    location: r.location || null,
                    status: r.status || 'up',
                    interfaces: (r.interfaces || []).map((i: any) => ({
                        name: i.name,
                        description: i.description || null,
                        address: Array.isArray(i.address) ? i.address : [],
                        status: i.status || 'up'
                    }))
                }));
            } catch {
                safeRouters = [];
            }

            log('UNDERLAY', `Resolution complete: ${matched} matched, ${noMatch} no-match, ${ambiguous} ambiguous, ${wanIpUnavailable} wan-ip-unavailable out of ${allWanInterfaces.length} WAN interfaces`);

            return {
                available: true,
                vyosConfigAvailable: true,
                summary: {
                    wanInterfacesSeen: allWanInterfaces.length,
                    matched,
                    noMatch,
                    ambiguous,
                    wanIpUnavailable,
                },
                resolutions,
                routers: safeRouters,
            };

        } catch (e: any) {
            log('UNDERLAY', `Unexpected error during resolution: ${e.message}`, 'error');
            return degraded(e.message);
        }
    }
}
