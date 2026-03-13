/**
 * TargetsManager — Backend service for the shared Targets registry.
 *
 * Manages config/targets.json (user-managed targets) and builds a merged
 * view that also includes targets synthesized from legacy config files and
 * environment variables, without modifying those files.
 *
 * Priority (highest → lowest):
 *  1. targets.json (managed)
 *  2. voice-config.json (synthesized, voice capability)
 *  3. security-config.json (synthesized, security capability)
 *  4. convergence-endpoints.json (synthesized, convergence capability)
 *  5. XFR_QUICK_TARGETS env-var (synthesized, xfr capability)
 *
 * Dedup key: host (lowercase trimmed). Higher-priority source wins.
 */

import fs from 'fs';
import path from 'path';
import { log } from './utils/logger.js';
import { TargetDefinition, TargetCapability } from './src/types/targets.js';

const EMPTY_CAPS: TargetCapability = {
    voice: false,
    convergence: false,
    xfr: false,
    security: false,
    connectivity: false,
};

function makeId(): string {
    // crypto.randomUUID() is available in Node 16+
    // @ts-ignore — available in runtime
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return (crypto as any).randomUUID();
    }
    // Fallback
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export class TargetsManager {
    private configFile: string;
    private configDir: string;
    private xfrEnvTargets: { label: string; host: string }[];
    private registryManager?: any;

    constructor(configDir: string, xfrEnvTargets: { label: string; host: string }[], registryManager?: any) {
        this.configDir = configDir;
        this.configFile = path.join(configDir, 'targets.json');
        this.xfrEnvTargets = xfrEnvTargets;
        this.registryManager = registryManager;
    }

    // ─── Persistence ───────────────────────────────────────────────────────────

    loadTargets(): TargetDefinition[] {
        try {
            if (!fs.existsSync(this.configFile)) return [];
            return JSON.parse(fs.readFileSync(this.configFile, 'utf-8')) as TargetDefinition[];
        } catch (e: any) {
            log('TARGETS', `Failed to load targets.json: ${e.message}`, 'warn');
            return [];
        }
    }

    saveTargets(targets: TargetDefinition[]): void {
        try {
            fs.mkdirSync(this.configDir, { recursive: true });
            fs.writeFileSync(this.configFile, JSON.stringify(targets, null, 2), 'utf-8');
        } catch (e: any) {
            log('TARGETS', `Failed to save targets.json: ${e.message}`, 'error');
            throw e;
        }
    }

    // ─── CRUD ──────────────────────────────────────────────────────────────────

    createTarget(data: Omit<TargetDefinition, 'id' | 'source'>): TargetDefinition {
        const targets = this.loadTargets();
        const newTarget: TargetDefinition = {
            ...data,
            id: makeId(),
            source: 'managed',
        };
        targets.push(newTarget);
        this.saveTargets(targets);
        return newTarget;
    }

    updateTarget(id: string, data: Partial<Omit<TargetDefinition, 'id' | 'source'>>): TargetDefinition | null {
        const targets = this.loadTargets();
        const idx = targets.findIndex(t => t.id === id);
        
        if (idx !== -1) {
            targets[idx] = { ...targets[idx], ...data, id, source: 'managed' };
            this.saveTargets(targets);
            return targets[idx];
        }

        // If not found by ID, it might be a synthesized target being edited.
        // We look it up in the merged list by ID to get its original properties and promote it.
        const merged = this.getMergedTargets();
        const synthTarget = merged.find(t => t.id === id);
        if (synthTarget) {
            const promoted: TargetDefinition = {
                ...synthTarget,
                ...data,
                id: makeId(), // Assign a new managed ID
                source: 'managed'
            };
            // Remove meta data that shouldn't persist in managed (like local_config/registry)
            delete promoted.meta;
            targets.push(promoted);
            this.saveTargets(targets);
            return promoted;
        }

        return null;
    }

    deleteTarget(id: string): boolean {
        const targets = this.loadTargets();
        const initialLength = targets.length;
        const filtered = targets.filter(t => t.id !== id);
        
        if (filtered.length !== initialLength) {
            this.saveTargets(filtered);
            return true;
        }

        // If not found in managed targets, check if it's a synthesized target
        const merged = this.getMergedTargets();
        const synthTarget = merged.find(t => t.id === id);
        if (synthTarget) {
            // "Delete" a synthesized target by promoting it and explicitly disabling it
            const disabledTarget: TargetDefinition = {
                ...synthTarget,
                id: makeId(),
                enabled: false,
                source: 'managed'
            };
            delete disabledTarget.meta;
            targets.push(disabledTarget);
            this.saveTargets(targets);
            return true;
        }

        return false;
    }

    // ─── Synthesis from legacy configs ─────────────────────────────────────────

    private synthesizeFromVoiceConfig(): TargetDefinition[] {
        const file = path.join(this.configDir, 'voice-config.json');
        try {
            if (!fs.existsSync(file)) return [];
            const config = JSON.parse(fs.readFileSync(file, 'utf-8'));
            const servers: any[] = config.servers || [];
            return servers.map(s => {
                // target is "host:port"
                const [host, portStr] = String(s.target || '').split(':');
                if (!host) return null;
                const voicePort = portStr ? parseInt(portStr, 10) : 6100;
                return {
                    id: `syn-voice-${host}`,
                    name: host,
                    host: host.trim(),
                    enabled: true,
                    capabilities: { ...EMPTY_CAPS, voice: true },
                    ports: { voice: voicePort },
                    source: 'synthesized' as const,
                    meta: { local_config: true }
                };
            }).filter(Boolean) as TargetDefinition[];
        } catch { return []; }
    }

    private synthesizeFromSecurityConfig(): TargetDefinition[] {
        const file = path.join(this.configDir, 'security-config.json');
        try {
            if (!fs.existsSync(file)) return [];
            const config = JSON.parse(fs.readFileSync(file, 'utf-8'));
            const endpoints: string[] = [];
            if (config.threat_prevention?.eicar_endpoints) {
                endpoints.push(...config.threat_prevention.eicar_endpoints);
            } else if (config.threat_prevention?.eicar_endpoint) {
                endpoints.push(config.threat_prevention.eicar_endpoint);
            }
            return endpoints.map(ep => {
                try {
                    const url = new URL(ep);
                    const host = url.hostname;
                    const httpPort = url.port ? parseInt(url.port, 10) : 80;
                    return {
                        id: `syn-security-${host}`,
                        name: host,
                        host,
                        enabled: true,
                        capabilities: { ...EMPTY_CAPS, security: true },
                        ports: { http: httpPort },
                        source: 'synthesized' as const,
                        meta: { local_config: true }
                    } as TargetDefinition;
                } catch { return null; }
            }).filter(Boolean) as TargetDefinition[];
        } catch { return []; }
    }

    private synthesizeFromConvergenceEndpoints(): TargetDefinition[] {
        const file = path.join(this.configDir, 'convergence-endpoints.json');
        try {
            if (!fs.existsSync(file)) return [];
            const endpoints: any[] = JSON.parse(fs.readFileSync(file, 'utf-8'));
            return endpoints.map(ep => {
                if (!ep.target) return null;
                return {
                    id: `syn-conv-${ep.target}`,
                    name: ep.label || ep.target,
                    host: ep.target.trim(),
                    enabled: true,
                    capabilities: { ...EMPTY_CAPS, convergence: true },
                    ports: { convergence: ep.port || 6200 },
                    source: 'synthesized' as const,
                    meta: { local_config: true }
                } as TargetDefinition;
            }).filter(Boolean) as TargetDefinition[];
        } catch { return []; }
    }

    private synthesizeFromXfrEnv(): TargetDefinition[] {
        return this.xfrEnvTargets.map(t => ({
            id: `syn-xfr-${t.host}`,
            name: t.label || t.host,
            host: t.host.trim(),
            enabled: true,
            capabilities: { ...EMPTY_CAPS, xfr: true },
            source: 'synthesized' as const,
            meta: { local_config: true }
        }));
    }

    private synthesizeFromRegistry(): TargetDefinition[] {
        if (!this.registryManager) return [];
        
        // 1. Peer instances
        const peers = this.registryManager.getPeers();
        const peerTargets = peers.map((p: any) => ({
            id: `reg-${p.instance_id}`,
            name: p.meta?.site || p.instance_id,
            host: p.ip_private,
            enabled: true,
            capabilities: {
                voice: !!p.capabilities?.voice,
                convergence: !!p.capabilities?.convergence,
                xfr: !!p.capabilities?.xfr,
                security: !!p.capabilities?.security,
                connectivity: !!p.capabilities?.connectivity,
            },
            source: 'synthesized' as const, // Use synthesized to make it read-only in UI
            meta: {
                registry: true,
                location: p.location,
                ip_public: p.ip_public,
                last_seen: p.last_seen
            }
        }));

        // 2. Shared generic targets from local Leader (if we are a peer)
        const sharedTargetsList = typeof this.registryManager.getSharedTargets === 'function' 
            ? this.registryManager.getSharedTargets() : [];

        const sharedTgtDefs: TargetDefinition[] = sharedTargetsList.map((t: any) => ({
            ...t,
            id: `reg-shared-${t.id || t.host}`,
            source: 'synthesized' as const,
            meta: {
                ...(t.meta || {}),
                registry: true,
                leader_provided: true
            }
        }));

        return [...peerTargets, ...sharedTgtDefs];
    }

    // ─── Merged View ───────────────────────────────────────────────────────────

    /**
     * Returns the full merged target list.
     * Managed targets (targets.json) take highest priority.
     * Synthesized targets from legacy files fill in the rest.
     * Duplicate hosts are merged: the higher-priority source wins,
     * but capabilities are OR-merged so no capability is lost.
     */
    getMergedTargets(): TargetDefinition[] {
        const managed = this.loadTargets();
        const synVoice = this.synthesizeFromVoiceConfig();
        const synSecurity = this.synthesizeFromSecurityConfig();
        const synConv = this.synthesizeFromConvergenceEndpoints();
        const synXfr = this.synthesizeFromXfrEnv();
        const synRegistry = this.synthesizeFromRegistry();

        // Ordered from highest to lowest priority
        const allSources = [...managed, ...synVoice, ...synSecurity, ...synConv, ...synXfr, ...synRegistry];

        // Dedup by normalized host; first occurrence (highest priority) wins,
        // but we OR-merge capabilities from all occurrences of the same host.
        const byHost = new Map<string, TargetDefinition>();
        for (const t of allSources) {
            const key = t.host.toLowerCase().trim();
            const existing = byHost.get(key);
            if (!existing) {
                byHost.set(key, { ...t });
            } else {
                // Merge capabilities
                existing.capabilities = {
                    voice: existing.capabilities.voice || t.capabilities.voice,
                    convergence: existing.capabilities.convergence || t.capabilities.convergence,
                    xfr: existing.capabilities.xfr || t.capabilities.xfr,
                    security: existing.capabilities.security || t.capabilities.security,
                    connectivity: existing.capabilities.connectivity || t.capabilities.connectivity,
                };
                // Merge port overrides (only fill missing)
                if (t.ports) {
                    existing.ports = {
                        voice: existing.ports?.voice ?? t.ports.voice,
                        convergence: existing.ports?.convergence ?? t.ports.convergence,
                        iperf: existing.ports?.iperf ?? t.ports.iperf,
                        http: existing.ports?.http ?? t.ports.http,
                        xfr: existing.ports?.xfr ?? t.ports.xfr,
                    };
                }
                // Retain source metadata (e.g., if any source says it's from the registry, it stays auto)
                if (t.meta) {
                    existing.meta = {
                        ...(existing.meta || {}),
                        ...t.meta,
                        registry: existing.meta?.registry || t.meta.registry,
                        leader_provided: existing.meta?.leader_provided || t.meta.leader_provided,
                    };
                }
                
                // Prefer authoritative registry names over generic legacy local configuration names
                if (t.meta?.registry && existing.source === 'synthesized') {
                    existing.name = t.name;
                }
            }
        }

        return Array.from(byHost.values());
    }
}
