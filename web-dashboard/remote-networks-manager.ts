import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { log } from './utils/logger.js';

export interface RemoteNetworkItem {
    id: string;
    name: string;
    region?: string;
    folder?: string;
    subnets?: string[];
    gateway_ips: string[];
    egress_ips: string[];
    status: 'active' | 'degraded' | 'inactive' | 'configured';
    connected_sites?: string[];
    service_endpoints?: string[];
    last_synced?: string;
    source: 'prisma_sase_api' | 'sdwan_topology' | 'hybrid' | 'manual';
    notes?: string;
}

export interface RemoteNetworksMetadata {
    last_updated: string | null;
    total_count: number;
    total_egress_ips: number;
    total_gateway_ips: number;
    networks: RemoteNetworkItem[];
}

export class RemoteNetworksManager {
    private configDir: string;
    private storagePath: string;
    private metadata: RemoteNetworksMetadata = {
        last_updated: null,
        total_count: 0,
        total_egress_ips: 0,
        total_gateway_ips: 0,
        networks: []
    };

    constructor(projectRoot: string) {
        this.configDir = path.join(projectRoot, 'config');
        this.storagePath = path.join(this.configDir, 'prisma-remote-networks.json');
        this.init();
    }

    public init(): void {
        try {
            if (!fs.existsSync(this.configDir)) {
                fs.mkdirSync(this.configDir, { recursive: true });
            }

            if (fs.existsSync(this.storagePath)) {
                const raw = fs.readFileSync(this.storagePath, 'utf8');
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed.networks)) {
                    this.metadata = parsed;
                    this.recalculateTotals();
                }
            }
        } catch (e: any) {
            log('RN-MGR', `Error initializing RemoteNetworksManager: ${e.message}`, 'error');
        }
    }

    private recalculateTotals(): void {
        const egressSet = new Set<string>();
        const gwSet = new Set<string>();

        for (const net of this.metadata.networks) {
            (net.egress_ips || []).forEach(ip => egressSet.add(ip.trim()));
            (net.gateway_ips || []).forEach(ip => gwSet.add(ip.trim()));
        }

        this.metadata.total_count = this.metadata.networks.length;
        this.metadata.total_egress_ips = egressSet.size;
        this.metadata.total_gateway_ips = gwSet.size;
    }

    public getStatus() {
        const egressSet = new Set<string>();
        const gwSet = new Set<string>();

        for (const net of this.metadata.networks) {
            (net.egress_ips || []).forEach(ip => {
                if (ip.trim()) egressSet.add(ip.trim());
            });
            (net.gateway_ips || []).forEach(ip => {
                if (ip.trim()) gwSet.add(ip.trim());
            });
        }

        const allEgress = Array.from(egressSet).sort();
        const allGateways = Array.from(gwSet).sort();

        // Formats for firewall whitelisting (CIDRs, iptables, ufw, JSON)
        const cidrList = allEgress.map(ip => ip.includes('/') ? ip : `${ip}/32`).join('\n');
        const commaSeparated = allEgress.join(', ');
        const iptablesRules = allEgress.map(ip => `iptables -A INPUT -s ${ip.includes('/') ? ip : `${ip}/32`} -j ACCEPT`).join('\n');
        const ufwRules = allEgress.map(ip => `ufw allow from ${ip.includes('/') ? ip : `${ip}/32`} to any`).join('\n');
        const jsonArray = JSON.stringify(allEgress, null, 2);

        const formatObj = {
            cidr_list: cidrList,
            cidrs: cidrList,
            comma_separated: commaSeparated,
            json_array: jsonArray,
            iptables: iptablesRules,
            ufw: ufwRules
        };

        return {
            last_updated: this.metadata.last_updated,
            total_count: this.metadata.networks.length,
            total_egress_ips: allEgress.length,
            total_gateway_ips: allGateways.length,
            networks: this.metadata.networks,
            all_egress_ips: allEgress,
            all_gateway_ips: allGateways,
            export_formats: formatObj,
            formats: formatObj
        };
    }

    private saveToDisk(): void {
        try {
            this.recalculateTotals();
            fs.writeFileSync(this.storagePath, JSON.stringify(this.metadata, null, 2), 'utf8');
        } catch (e: any) {
            log('RN-MGR', `Failed saving remote networks to disk: ${e.message}`, 'error');
        }
    }

    /**
     * Extracts Prisma SASE Service Links and Gateway IPs from SD-WAN Topology
     */
    public extractFromSdwanTopology(topologyData: any): RemoteNetworkItem[] {
        if (!topologyData || !Array.isArray(topologyData.sites)) {
            return [];
        }

        const endpointMap = new Map<string, {
            name: string;
            gateway_ips: Set<string>;
            connected_sites: Set<string>;
            service_endpoints: Set<string>;
            hasUpState: boolean;
            subnets: Set<string>;
        }>();

        for (const site of topologyData.sites) {
            const siteName = site.name || site.id || 'Unknown Site';
            for (const dev of (site.devices || [])) {
                for (const sl of (dev.service_links || [])) {
                    const provider = (sl.provider || '').toLowerCase();
                    const seName = sl.service_endpoint_name || sl.name || '';
                    const seLower = seName.toLowerCase();

                    const isPrisma = provider.includes('prisma') ||
                        provider.includes('palo') ||
                        seLower.includes('prisma') ||
                        seLower.includes('france-south') ||
                        seLower.includes('france-central') ||
                        seLower.includes('ireland');

                    if (!isPrisma) continue;

                    // Group by recognized compute location or endpoint
                    let groupKey = seName.trim() || 'Prisma Access';
                    if (seLower.includes('france-south')) groupKey = 'Prisma Access France South';
                    else if (seLower.includes('france-central')) groupKey = 'Prisma Access France Central';
                    else if (seLower.includes('ireland')) groupKey = 'Prisma Access Ireland';
                    else if (seLower.includes('germany') || seLower.includes('frankfurt')) groupKey = 'Prisma Access Germany';

                    if (!endpointMap.has(groupKey)) {
                        endpointMap.set(groupKey, {
                            name: groupKey,
                            gateway_ips: new Set(),
                            connected_sites: new Set(),
                            service_endpoints: new Set(),
                            hasUpState: false,
                            subnets: new Set()
                        });
                    }

                    const entry = endpointMap.get(groupKey)!;
                    if (sl.remote_ip && sl.remote_ip !== '0.0.0.0') {
                        entry.gateway_ips.add(sl.remote_ip.trim());
                    }
                    if (siteName) {
                        entry.connected_sites.add(siteName);
                    }
                    if (seName) {
                        entry.service_endpoints.add(seName);
                    }
                    if (sl.operational_state === 'up' || sl.extended_state === 'tunnel_up') {
                        entry.hasUpState = true;
                    }
                    if (sl.inside_ip) {
                        entry.subnets.add(sl.inside_ip);
                    }
                }
            }
        }

        const items: RemoteNetworkItem[] = [];
        for (const [key, val] of endpointMap.entries()) {
            const gwIps = Array.from(val.gateway_ips);
            // In Prisma Access Remote Networks, the public IPsec endpoint or allocated NAT pool is used for egress
            const egressIps = [...gwIps];

            items.push({
                id: `topo-${crypto.createHash('md5').update(key).digest('hex').substring(0, 8)}`,
                name: val.name,
                region: key.replace('Prisma Access ', ''),
                folder: 'Remote Networks',
                subnets: Array.from(val.subnets),
                gateway_ips: gwIps,
                egress_ips: egressIps,
                status: val.hasUpState ? 'active' : 'inactive',
                connected_sites: Array.from(val.connected_sites),
                service_endpoints: Array.from(val.service_endpoints),
                last_synced: new Date().toISOString(),
                source: 'sdwan_topology'
            });
        }

        return items;
    }

    /**
     * Query Palo Alto SASE OAuth and fetch Remote Networks configuration & status
     */
    public async fetchFromPrisma(
        creds: { tsg_id?: string; client_id?: string; client_secret?: string },
        topologyData?: any
    ): Promise<{ success: boolean; count: number; networks: RemoteNetworkItem[]; error?: string }> {
        const tsg_id = creds?.tsg_id || process.env.PRISMA_SDWAN_TSGID;
        const client_id = creds?.client_id || process.env.PRISMA_SDWAN_CLIENT_ID;
        const client_secret = creds?.client_secret || process.env.PRISMA_SDWAN_CLIENT_SECRET;

        // 1. Gather topology-derived Remote Networks as solid base / fallback
        const topoItems = this.extractFromSdwanTopology(topologyData);

        if (!tsg_id || !client_id || !client_secret) {
            if (topoItems.length > 0) {
                // We have live topology data even without SASE API credentials
                this.mergeNetworks(topoItems);
                this.metadata.last_updated = new Date().toISOString();
                this.saveToDisk();
                log('RN-MGR', `✓ Extracted ${topoItems.length} Remote Network(s) from SD-WAN live topology (credentials not configured)`);
                return { success: true, count: this.metadata.networks.length, networks: this.metadata.networks };
            }
            return {
                success: false,
                count: 0,
                networks: [],
                error: 'Missing Prisma SASE credentials (TSG ID, Client ID, Client Secret) and no SD-WAN topology available'
            };
        }

        try {
            log('RN-MGR', `Authenticating with Palo Alto OAuth for TSG: ${tsg_id}...`);

            const tokenUrl = 'https://auth.apps.paloaltonetworks.com/am/oauth2/access_token';
            const params = new URLSearchParams();
            params.append('grant_type', 'client_credentials');
            params.append('client_id', client_id);
            params.append('client_secret', client_secret);
            params.append('scope', `tsg_id:${tsg_id}`);

            const tokenRes = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString()
            });

            if (!tokenRes.ok) {
                const errText = await tokenRes.text();
                // If API fails but we have topology items, fallback gracefully!
                if (topoItems.length > 0) {
                    this.mergeNetworks(topoItems);
                    this.metadata.last_updated = new Date().toISOString();
                    this.saveToDisk();
                    return {
                        success: true,
                        count: this.metadata.networks.length,
                        networks: this.metadata.networks,
                        error: `OAuth notice: ${errText.substring(0, 100)} - populated from SD-WAN topology`
                    };
                }
                return { success: false, count: 0, networks: [], error: `OAuth Authentication Failed: HTTP ${tokenRes.status}` };
            }

            const tokenData = await tokenRes.json() as any;
            const accessToken = tokenData.access_token;
            if (!accessToken) {
                return { success: false, count: 0, networks: [], error: 'OAuth response missing access_token' };
            }

            log('RN-MGR', '✓ OAuth token obtained. Querying Prisma Access Remote Networks & IP endpoints...');

            const apiItems: RemoteNetworkItem[] = [];
            const folders = ['Remote Networks', 'Shared', 'Prisma Access'];

            // 1. Query SASE Remote Networks Configuration
            for (const folder of folders) {
                try {
                    const rnUrl = `https://api.sase.paloaltonetworks.com/sse/config/v1/remote-networks?folder=${encodeURIComponent(folder)}`;
                    const res = await fetch(rnUrl, {
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Accept': 'application/json'
                        }
                    });

                    if (res.ok) {
                        const json = await res.json() as any;
                        const items = json.data || [];
                        for (const it of items) {
                            const netName = it.name || it.id;
                            const region = it.region || it.spn_name || '';
                            const subnets = Array.isArray(it.subnets) ? it.subnets : [];
                            const egressIps: string[] = [];
                            const gwIps: string[] = [];

                            if (it.ipsec_tunnel) {
                                if (typeof it.ipsec_tunnel === 'string') {
                                    // Sometimes contains IP or tunnel reference
                                    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(it.ipsec_tunnel)) {
                                        gwIps.push(it.ipsec_tunnel);
                                    }
                                }
                            }
                            if (Array.isArray(it.static_ip_list)) {
                                egressIps.push(...it.static_ip_list);
                            }
                            if (Array.isArray(it.allocated_ip_list)) {
                                egressIps.push(...it.allocated_ip_list);
                            }

                            apiItems.push({
                                id: it.id || `rn-${crypto.randomUUID()}`,
                                name: netName,
                                region: region,
                                folder: folder,
                                subnets: subnets,
                                gateway_ips: gwIps,
                                egress_ips: egressIps,
                                status: 'configured',
                                last_synced: new Date().toISOString(),
                                source: 'prisma_sase_api',
                                notes: it.description || ''
                            });
                        }
                    }
                } catch (folderErr: any) {
                    log('RN-MGR', `Warning querying folder ${folder}: ${folderErr.message}`);
                }
            }

            // 2. Query SASE Locations & Egress IPs (Locations endpoint)
            try {
                const locUrl = `https://api.sase.paloaltonetworks.com/sse/config/v1/locations`;
                const locRes = await fetch(locUrl, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Accept': 'application/json'
                    }
                });
                if (locRes.ok) {
                    const locJson = await locRes.json() as any;
                    const locs = locJson.data || [];
                    for (const loc of locs) {
                        if (loc.egress_ip_list && Array.isArray(loc.egress_ip_list)) {
                            // Find matching remote network or add region-level egress entry
                            const matchingNet = apiItems.find(n =>
                                (n.region && loc.name && n.region.toLowerCase().includes(loc.name.toLowerCase())) ||
                                (n.name && loc.name && n.name.toLowerCase().includes(loc.name.toLowerCase()))
                            );
                            if (matchingNet) {
                                for (const eIp of loc.egress_ip_list) {
                                    if (!matchingNet.egress_ips.includes(eIp)) {
                                        matchingNet.egress_ips.push(eIp);
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (locErr: any) {
                log('RN-MGR', `Locations lookup non-blocking: ${locErr.message}`);
            }

            // Merge API items with SD-WAN Topology items
            this.mergeNetworks([...apiItems, ...topoItems]);
            this.metadata.last_updated = new Date().toISOString();
            this.saveToDisk();

            log('RN-MGR', `✓ Successfully synchronized ${this.metadata.networks.length} Remote Network(s) with ${this.metadata.total_egress_ips} Egress IP(s)`);
            return {
                success: true,
                count: this.metadata.networks.length,
                networks: this.metadata.networks
            };
        } catch (e: any) {
            log('RN-MGR', `Error fetching remote networks from Prisma: ${e.message}`, 'error');
            // If API errored but topology items exist, preserve topology items
            if (topoItems.length > 0) {
                this.mergeNetworks(topoItems);
                this.metadata.last_updated = new Date().toISOString();
                this.saveToDisk();
                return {
                    success: true,
                    count: this.metadata.networks.length,
                    networks: this.metadata.networks,
                    error: `Prisma API error (${e.message}) - SD-WAN topology used`
                };
            }
            return { success: false, count: 0, networks: [], error: e.message };
        }
    }

    /**
     * Intelligently merges network entries from different sources
     */
    private mergeNetworks(incoming: RemoteNetworkItem[]): void {
        const mergedMap = new Map<string, RemoteNetworkItem>();

        // Load existing
        for (const net of this.metadata.networks) {
            mergedMap.set(net.name.toLowerCase(), { ...net });
        }

        // Merge incoming
        for (const item of incoming) {
            const key = item.name.toLowerCase();
            if (mergedMap.has(key)) {
                const existing = mergedMap.get(key)!;
                // Merge Gateway IPs
                const gwSet = new Set([...(existing.gateway_ips || []), ...(item.gateway_ips || [])]);
                existing.gateway_ips = Array.from(gwSet).filter(Boolean);

                // Merge Egress IPs
                const egressSet = new Set([...(existing.egress_ips || []), ...(item.egress_ips || [])]);
                existing.egress_ips = Array.from(egressSet).filter(Boolean);

                // If no egress IPs were explicitly specified, fall back to gateway IPs
                if (existing.egress_ips.length === 0 && existing.gateway_ips.length > 0) {
                    existing.egress_ips = [...existing.gateway_ips];
                }

                // Subnets
                const subnetsSet = new Set([...(existing.subnets || []), ...(item.subnets || [])]);
                existing.subnets = Array.from(subnetsSet).filter(Boolean);

                // Connected Sites
                const sitesSet = new Set([...(existing.connected_sites || []), ...(item.connected_sites || [])]);
                existing.connected_sites = Array.from(sitesSet).filter(Boolean);

                // Endpoints
                const seSet = new Set([...(existing.service_endpoints || []), ...(item.service_endpoints || [])]);
                existing.service_endpoints = Array.from(seSet).filter(Boolean);

                if (item.status === 'active') existing.status = 'active';
                if (item.region && !existing.region) existing.region = item.region;
                existing.last_synced = new Date().toISOString();
                existing.source = existing.source === item.source ? existing.source : 'hybrid';
            } else {
                const copy = { ...item };
                if ((!copy.egress_ips || copy.egress_ips.length === 0) && copy.gateway_ips && copy.gateway_ips.length > 0) {
                    copy.egress_ips = [...copy.gateway_ips];
                }
                mergedMap.set(key, copy);
            }
        }

        this.metadata.networks = Array.from(mergedMap.values());
        this.recalculateTotals();
    }

    public addCustomNetwork(item: { name: string; region?: string; egress_ips: string[]; gateway_ips?: string[]; notes?: string }): RemoteNetworkItem {
        const newItem: RemoteNetworkItem = {
            id: `manual-${crypto.randomUUID()}`,
            name: item.name.trim(),
            region: item.region?.trim(),
            egress_ips: (item.egress_ips || []).map(i => i.trim()).filter(Boolean),
            gateway_ips: (item.gateway_ips || []).map(i => i.trim()).filter(Boolean),
            status: 'configured',
            last_synced: new Date().toISOString(),
            source: 'manual',
            notes: item.notes
        };

        this.metadata.networks.push(newItem);
        this.metadata.last_updated = new Date().toISOString();
        this.saveToDisk();
        return newItem;
    }

    public deleteNetwork(id: string): boolean {
        const initialLen = this.metadata.networks.length;
        this.metadata.networks = this.metadata.networks.filter(n => n.id !== id);
        if (this.metadata.networks.length !== initialLen) {
            this.metadata.last_updated = new Date().toISOString();
            this.saveToDisk();
            return true;
        }
        return false;
    }

    public clearAll(): void {
        this.metadata.networks = [];
        this.metadata.total_count = 0;
        this.metadata.total_egress_ips = 0;
        this.metadata.total_gateway_ips = 0;
        this.metadata.last_updated = new Date().toISOString();
        this.saveToDisk();
    }
}
