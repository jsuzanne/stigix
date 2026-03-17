import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { log } from './utils/logger.js';

/**
 * TargetScenario definition matches the configuration model.
 */
export interface TargetScenario {
    id: string;
    label: string;
    description: string;
    path: string;
    params?: Record<string, string | number>;
    category: 'info' | 'saas' | 'download' | 'security' | 'error';
    signedUrl?: string; // Generated at runtime
}

export interface TargetProbeResult {
    success: boolean;
    score: number;
    latency_ms: number;
    message: string;
    data?: any; // For Egress Info (ip, country, pop)
}

const DEFAULT_SCENARIOS: TargetScenario[] = [
    {
        id: 'egress-info',
        label: 'Info / Egress',
        description: 'Identifies your public IP, Country and Cloudflare POP.',
        path: '/saas/info',
        category: 'info'
    },
    {
        id: 'saas-slow',
        label: 'Slow SaaS',
        description: 'Simulates a 5s backend delay to test path selection.',
        path: '/saas/slow',
        category: 'saas'
    },
    {
        id: 'download-large',
        label: 'Large Download',
        description: 'Downloads a 10MB payload to test throughput.',
        path: '/download/large',
        category: 'download'
    },
    {
        id: 'security-eicar',
        label: 'Security (EICAR)',
        description: 'Downloads the EICAR test file to check security policies.',
        path: '/security/eicar',
        category: 'security'
    }
];

/**
 * TargetManager - Manages Cloudflare Target scenarios and signs URLs with the shared key.
 */
export class TargetManager {
    private scenarios: TargetScenario[] = [];
    private configPath: string;
    private baseUrl: string;
    private sharedKey: string;

    constructor(configDir: string, baseUrl?: string) {
        this.configPath = path.join(configDir, 'target-scenarios.json');
        // Logic: 1. Constructor arg, 2. Env var, 3. Default production fallback
        let rawBase = baseUrl || process.env.STIGIX_TARGET_BASE_URL || 'https://stigix-target.jlsuzanne.workers.dev';
        
        // Robustness: ensure protocol exists
        if (rawBase && !rawBase.startsWith('http')) {
            rawBase = `https://${rawBase}`;
        }
        
        this.baseUrl = rawBase;
        
        // Master Signature Architecture (Multi-tenant):
        // 1. Explicit env var override (legacy/debug)
        // 2. Master Key + TSG ID (production/multi-tenant)
        let key = process.env.STIGIX_TARGET_SHARED_KEY || '';
        
        // If no explicit key, we use the Master Signature approach
        const masterKey = process.env.STIGIX_TARGET_MASTER_KEY;
        const tsgId = process.env.PRISMA_SDWAN_TSGID || process.env.PRISMA_SDWAN_TSG_ID || '';

        if (masterKey && tsgId) {
            // key = SHA256(tsgId + ":" + masterKey)
            key = crypto.createHash('sha256').update(`${tsgId}:${masterKey}`).digest('hex');
            log('TARGET', `Master Signature generated for TSG ${tsgId}`);
        } else if (!key && tsgId) {
            // Legacy/PoC Fallback
            const clientId = process.env.PRISMA_SDWAN_CLIENT_ID;
            if (clientId) {
                key = crypto.createHash('sha256').update(`${tsgId}:${clientId}:stigix-v1`).digest('hex');
                log('TARGET', `Derived PoC key from TSG/Client ID`);
            }
        }

        this.sharedKey = key;
        this.loadScenarios();
    }

    /**
     * Loads scenarios from config file.
     */
    private loadScenarios() {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = fs.readFileSync(this.configPath, 'utf8');
                this.scenarios = JSON.parse(data);
                log('TARGET', `Loaded ${this.scenarios.length} scenarios from ${this.configPath}`);
            } else {
                log('TARGET', `No scenarios file found at ${this.configPath}. Using defaults.`, 'warn');
                this.scenarios = DEFAULT_SCENARIOS;
            }
        } catch (error) {
            log('TARGET', `Error loading scenarios: ${error}. Falling back to defaults.`, 'error');
            this.scenarios = DEFAULT_SCENARIOS;
        }
    }

    /**
     * Returns the raw list of scenarios (probes).
     */
    getProbes(): TargetScenario[] {
        return this.scenarios;
    }

    /**
     * Returns the list of scenarios with signed URLs.
     */
    getScenarios(): TargetScenario[] {
        if (!this.baseUrl) {
            return this.scenarios.map(s => ({ ...s, signedUrl: '' }));
        }

        return this.scenarios.map(scenario => {
            const url = new URL(this.baseUrl);
            url.pathname = scenario.path;

            // Injects shared key
            if (this.sharedKey) {
                url.searchParams.set('key', this.sharedKey);
                // Also inject TSG for the worker to know which signature to verify
                const tsgId = process.env.PRISMA_SDWAN_TSGID || process.env.PRISMA_SDWAN_TSG_ID;
                if (tsgId) url.searchParams.set('tsg', tsgId);
            }

            // Injects default params
            if (scenario.params) {
                for (const [key, val] of Object.entries(scenario.params)) {
                    url.searchParams.set(key, val.toString());
                }
            }

            return {
                ...scenario,
                signedUrl: url.toString()
            };
        });
    }

    /**
     * Executes a scenario as a probe and returns a standardized result.
     */
    async runProbe(scenarioId: string): Promise<TargetProbeResult> {
        const scenario = this.scenarios.find(s => s.id === scenarioId);
        if (!scenario || !this.baseUrl) {
            return { success: false, score: 0, latency_ms: 0, message: 'Scenario or Base URL missing' };
        }

        const signedScenarios = this.getScenarios();
        const signedScenario = signedScenarios.find(s => s.id === scenarioId);
        if (!signedScenario?.signedUrl) {
            return { success: false, score: 0, latency_ms: 0, message: 'Failed to sign URL' };
        }

        const startTime = Date.now();
        try {
            const response = await fetch(signedScenario.signedUrl);
            const latency = Date.now() - startTime;

            if (!response.ok) {
                return { success: false, score: 0, latency_ms: latency, message: `HTTP ${response.status}` };
            }

            if (scenario.category === 'info') {
                const data = await response.json();
                return {
                    success: true,
                    score: 100, // Info doesn't really have a performance score, but it's "success"
                    latency_ms: latency,
                    message: `Egress recognized: ${data.ip}`,
                    data: {
                        ip: data.ip,
                        country: data.country,
                        city: data.city,
                        pop: data.colo
                    }
                };
            }

            if (scenario.category === 'saas' || scenario.id === 'saas-slow') {
                // Score based on latency. 5s is the threshold for 0.
                const score = Math.max(0, Math.min(100, Math.round(100 * (1 - (latency - 200) / 4800))));
                return { success: true, score, latency_ms: latency, message: `Response received in ${latency}ms` };
            }

            if (scenario.category === 'download') {
                await response.arrayBuffer(); // Consume payload
                const totalTime = Date.now() - startTime;
                // Score for 10MB download. 2s is excellent (100), 10s is poor (20).
                const score = Math.max(0, Math.min(100, Math.round(100 * (1 - (totalTime - 1000) / 9000))));
                return { success: true, score, latency_ms: totalTime, message: `Download complete` };
            }

            if (scenario.category === 'security') {
                // Special case for EICAR: Success means BLOCKED (non-200 or timeout)
                // But here we are the backend calling the worker.
                return { success: true, score: 100, latency_ms: latency, message: 'Endpoint reachable' };
            }

            return { success: true, score: 100, latency_ms: latency, message: 'OK' };

        } catch (error: any) {
            const latency = Date.now() - startTime;
            return { success: false, score: 0, latency_ms: latency, message: error.message };
        }
    }

    /**
     * Useful for diagnostics
     */
    getConfig() {
        return {
            baseUrl: this.baseUrl,
            hasKey: !!this.sharedKey,
            scenarioCount: this.scenarios.length
        };
    }
}
