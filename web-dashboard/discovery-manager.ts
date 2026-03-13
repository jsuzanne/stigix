import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { log } from './utils/logger.js';

export interface DiscoveredProbe {
    name: string;
    type: 'PING';
    target: string;
    timeout: number;
    enabled: boolean;
    source: 'discovery';
    discoveryKey: string;
    site_id: string;
    site_name: string;
    scope: 'branch' | 'dc';
    selected_interface_name: string;
    selected_interface_label?: string;
    selected_network: string;
    stale?: boolean;
}

export interface DiscoverySyncResult {
    created: number;
    updated: number;
    unchanged: number;
    staleMarked: number;
    totalSites: number;
    totalDiscovered: number;
    warnings: string[];
}

export class DiscoveryManager {
    private discoveredFile: string;

    constructor(configDir: string) {
        this.discoveredFile = path.join(configDir, 'connectivity-discovered.json');
    }

    private async runPython(args: string[]): Promise<any> {
        return new Promise((resolve, reject) => {
            const pythonPath = 'python3';
            const scriptPath = path.join(process.cwd(), 'engines', 'getflow.py');

            const child = spawn(pythonPath, [scriptPath, ...args], {
                env: { ...process.env, PYTHONUNBUFFERED: '1' }
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => { stdout += data; });
            child.stderr.on('data', (data) => { stderr += data; });

            child.on('close', (code) => {
                if (code !== 0) {
                    return reject(new Error(`Python script exited with code ${code}. Stderr: ${stderr}`));
                }
                try {
                    resolve(JSON.parse(stdout));
                } catch (e) {
                    reject(new Error(`Failed to parse Python output as JSON: ${e}. Output: ${stdout}`));
                }
            });
        });
    }

    private compareIPs(a: string, b: string): number {
        const partA = a.split('.').map(Number);
        const partB = b.split('.').map(Number);
        for (let i = 0; i < 4; i++) {
            if (partA[i] < partB[i]) return -1;
            if (partA[i] > partB[i]) return 1;
        }
        return 0;
    }

    public async syncProbes(): Promise<DiscoverySyncResult> {
        const result: DiscoverySyncResult = {
            created: 0,
            updated: 0,
            unchanged: 0,
            staleMarked: 0,
            totalSites: 0,
            totalDiscovered: 0,
            warnings: []
        };

        try {
            const [branchRes, dcRes] = await Promise.all([
                this.runPython(['--list-lan-interfaces', '--json']).catch(e => {
                    result.warnings.push(`Branch discovery failed: ${e.message}`);
                    return { lan_interfaces: [] };
                }),
                this.runPython(['--list-dc-lan-interfaces', '--json']).catch(e => {
                    result.warnings.push(`DC discovery failed: ${e.message}`);
                    return { dc_lan_interfaces: [] };
                })
            ]);

            const rawInterfaces = [
                ...(branchRes.lan_interfaces || []).map((i: any) => ({ ...i, scope: 'branch' })),
                ...(dcRes.dc_lan_interfaces || []).map((i: any) => ({ ...i, scope: 'dc' }))
            ];

            // Group by site_id
            const sitesMap = new Map<string, any[]>();
            rawInterfaces.forEach(iface => {
                if (!sitesMap.has(iface.site_id)) {
                    sitesMap.set(iface.site_id, []);
                }
                sitesMap.get(iface.site_id)!.push(iface);
            });

            result.totalSites = sitesMap.size;

            // Load existing discovered probes
            let currentProbes: DiscoveredProbe[] = [];
            if (fs.existsSync(this.discoveredFile)) {
                try {
                    currentProbes = JSON.parse(fs.readFileSync(this.discoveredFile, 'utf8'));
                } catch (e) {
                    result.warnings.push('Failed to read existing discovered probes, starting fresh.');
                }
            }

            const newProbesList: DiscoveredProbe[] = [];
            const seenKeys = new Set<string>();

            for (const [siteId, candidates] of sitesMap.entries()) {
                const scope = candidates[0].scope;

                if (scope === 'dc') {
                    // DC Cluster logic: all IPs
                    for (const selected of candidates) {
                        if (!selected.ip) continue;
                        const discoveryKey = `discovery:ping:${siteId}:${selected.ip}`;
                        const probeName = `${selected.site_name} (${selected.ip})`;
                        this.upsertOneProbe(newProbesList, currentProbes, selected, discoveryKey, probeName, seenKeys, result);
                    }
                } else {
                    // Branch logic: ONE probe (select best)
                    let selected = candidates.find(c => c.interface_name === '1');
                    if (!selected) {
                        selected = candidates.sort((a, b) => this.compareIPs(a.ip, b.ip))[0];
                    }

                    if (selected && selected.ip) {
                        const discoveryKey = `discovery:ping:${siteId}`;
                        this.upsertOneProbe(newProbesList, currentProbes, selected, discoveryKey, selected.site_name, seenKeys, result);
                    }
                }
            }

            // Handle stale probes
            currentProbes.forEach(existing => {
                if (!seenKeys.has(existing.discoveryKey)) {
                    if (!existing.stale) {
                        existing.stale = true;
                        result.staleMarked++;
                    }
                    newProbesList.push(existing);
                }
            });

            result.totalDiscovered = newProbesList.length;

            // Atomic write
            const tempFile = `${this.discoveredFile}.tmp`;
            fs.writeFileSync(tempFile, JSON.stringify(newProbesList, null, 2));
            fs.renameSync(tempFile, this.discoveredFile);

            return result;
        } catch (e: any) {
            throw new Error(`Sync failed: ${e.message}`);
        }
    }

    private upsertOneProbe(
        newProbesList: DiscoveredProbe[],
        currentProbes: DiscoveredProbe[],
        selected: any,
        discoveryKey: string,
        probeName: string,
        seenKeys: Set<string>,
        result: DiscoverySyncResult
    ): void {
        seenKeys.add(discoveryKey);
        const existingIndex = currentProbes.findIndex(p => p.discoveryKey === discoveryKey);

        if (existingIndex > -1) {
            const existing = currentProbes[existingIndex];
            const updatedProbe: DiscoveredProbe = {
                ...existing,
                name: probeName,
                target: selected.ip,
                site_name: selected.site_name,
                selected_interface_name: selected.interface_name,
                selected_interface_label: selected.interface_label,
                selected_network: selected.network,
                scope: selected.scope,
                stale: false
            };

            const changed = existing.target !== updatedProbe.target ||
                existing.site_name !== updatedProbe.site_name ||
                existing.name !== updatedProbe.name ||
                existing.selected_interface_label !== updatedProbe.selected_interface_label ||
                existing.stale === true;

            if (changed) result.updated++;
            else result.unchanged++;

            newProbesList.push(updatedProbe);
        } else {
            const newProbe: DiscoveredProbe = {
                name: probeName,
                type: 'PING',
                target: selected.ip,
                timeout: 5000,
                enabled: false,
                source: 'discovery',
                discoveryKey,
                site_id: selected.site_id,
                site_name: selected.site_name,
                scope: selected.scope,
                selected_interface_name: selected.interface_name,
                selected_interface_label: selected.interface_label,
                selected_network: selected.network,
                stale: false
            };
            result.created++;
            newProbesList.push(newProbe);
        }
    }

    public getProbes(): DiscoveredProbe[] {
        if (!fs.existsSync(this.discoveredFile)) return [];
        try {
            return JSON.parse(fs.readFileSync(this.discoveredFile, 'utf8'));
        } catch (e) {
            log('DISCOVERY', `Failed to read discovered probes: ${e}`, 'error');
            return [];
        }
    }

    public updateProbesFromUI(probes: any[]): void {
        const current = this.getProbes();
        const incomingDiscovered = probes.filter(p => p.source === 'discovery');

        const updated = current.map(existing => {
            const incoming = incomingDiscovered.find(p => p.discoveryKey === existing.discoveryKey);
            if (incoming) {
                return {
                    ...existing,
                    enabled: incoming.enabled,
                    timeout: incoming.timeout
                };
            }
            return existing;
        });

        const tempFile = `${this.discoveredFile}.tmp`;
        fs.writeFileSync(tempFile, JSON.stringify(updated, null, 2));
        fs.renameSync(tempFile, this.discoveredFile);
    }
}
