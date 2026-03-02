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

    constructor(configDir: string, xfrEnvTargets: { label: string; host: string }[]) {
        this.configDir = configDir;
        this.configFile = path.join(configDir, 'targets.json');
        this.xfrEnvTargets = xfrEnvTargets;
    }

    // ─── Persistence ───────────────────────────────────────────────────────────

    loadTargets(): TargetDefinition[] {
        try {
            if (!fs.existsSync(this.configFile)) return [];
            return JSON.parse(fs.readFileSync(this.configFile, 'utf-8')) as TargetDefinition[];
        } catch (e: any) {
            console.warn(`[TARGETS] Failed to load targets.json: ${e.message}`);
            return [];
        }
    }

    saveTargets(targets: TargetDefinition[]): void {
        try {
            fs.mkdirSync(this.configDir, { recursive: true });
            fs.writeFileSync(this.configFile, JSON.stringify(targets, null, 2), 'utf-8');
        } catch (e: any) {
            console.error(`[TARGETS] Failed to save targets.json: ${e.message}`);
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
        if (idx === -1) return null;
        targets[idx] = { ...targets[idx], ...data, id, source: 'managed' };
        this.saveTargets(targets);
        return targets[idx];
    }

    deleteTarget(id: string): boolean {
        const targets = this.loadTargets();
        const filtered = targets.filter(t => t.id !== id);
        if (filtered.length === targets.length) return false;
        this.saveTargets(filtered);
        return true;
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
        }));
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

        // Ordered from highest to lowest priority
        const allSources = [...managed, ...synVoice, ...synSecurity, ...synConv, ...synXfr];

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
            }
        }

        return Array.from(byHost.values());
    }
}
